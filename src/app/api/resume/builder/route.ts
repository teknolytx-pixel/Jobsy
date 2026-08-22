import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { companies, db, jobs, resumeParses, resumes } from "@/db";
import { AuthError, authErrorResponse, requireRole } from "@/lib/auth";
import { buildResume, toHtml, toText, type ResumeProfile } from "@/lib/resume/build";
import { tailorResume } from "@/lib/resume/tailor";
import { gapReport } from "@/lib/resume/gaps";
import { polishLines } from "@/lib/resume/rewrite";
import { aiEnabled, disclosure } from "@/lib/ai";
import { matchScore } from "@/lib/matching/engine";
import { isPubliclyReadable } from "@/lib/jobStatus";
import { consume, tooMany } from "@/lib/ratelimit";
import type { ParsedResume } from "@/lib/resume/parse";

export const dynamic = "force-dynamic";

/**
 * RES-004 / RES-005 / RES-006 — the resume builder.
 *
 * CANDIDATE only. A recruiter has no resume in this product, and `requireRole`
 * is what says so rather than a comment.
 *
 * The three things this returns are deliberately separate:
 *   `resume`  the document, built from the profile — always present
 *   `tailored` the same document reordered for one posting — only with ?jobId
 *   `gaps`    what the posting asks for that the profile doesn't say
 *
 * Only the optional `polish=1` touches a model, and when no key is configured
 * it returns `ai.available: false` and the document is unchanged. Nothing here
 * fails because a free tier is unavailable.
 */

async function loadProfile(me: {
  id: string;
  name: string | null;
  email: string;
  headline: string | null;
  bio: string | null;
  location: string | null;
  skills: string[];
  yearsExp: number;
  availability: string | null;
}): Promise<{ profile: ResumeProfile; parsed: ParsedResume | null }> {
  const profile: ResumeProfile = {
    name: me.name,
    email: me.email,
    headline: me.headline,
    bio: me.bio,
    location: me.location,
    skills: me.skills ?? [],
    yearsExp: me.yearsExp ?? 0,
    availability: me.availability,
  };

  // The most recent successful parse of the candidate's own upload. Parsed data
  // is a suggestion (AC-4) and is never written to the profile, so the builder
  // reads it here rather than expecting the profile to already contain it.
  const rows = await db
    .select({ p: resumeParses })
    .from(resumeParses)
    .innerJoin(resumes, eq(resumeParses.resumeId, resumes.id))
    .where(and(eq(resumes.userId, me.id), isNull(resumes.deletedAt)))
    .orderBy(desc(resumeParses.createdAt))
    .limit(1);

  const parsed = (rows[0]?.p.structured as ParsedResume | null) ?? null;
  return { profile, parsed };
}

export async function GET(req: Request) {
  try {
    const me = await requireRole("CANDIDATE");
    const url = new URL(req.url);
    const jobId = url.searchParams.get("jobId");
    const wantPolish = url.searchParams.get("polish") === "1";
    const format = url.searchParams.get("format");

    const { profile, parsed } = await loadProfile(me);
    const resume = buildResume(profile, parsed);

    // A download is the document as it stands. Tailoring and polish are
    // deliberately not applied here — a file the candidate cannot see before it
    // is written is a file they cannot check.
    if (format === "html" || format === "txt") {
      const body = format === "html" ? toHtml(resume) : toText(resume);
      return new NextResponse(body, {
        headers: {
          "Content-Type": format === "html" ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="resume.${format}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    let tailored = null;
    let gaps = null;

    if (jobId) {
      const rows = await db
        .select({ job: jobs, company: companies })
        .from(jobs)
        .leftJoin(companies, eq(jobs.companyId, companies.id))
        .where(eq(jobs.id, jobId))
        .limit(1);
      const row = rows[0];
      if (!row || !isPubliclyReadable(row.job.status)) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }

      tailored = tailorResume(
        resume,
        { title: row.job.title, description: row.job.description, skills: row.job.skills ?? [] },
        profile.skills
      );

      // RES-006 runs through the SAME engine that ranks this pair, so the advice
      // a candidate reads and the score a recruiter sees can never disagree.
      const result = matchScore(
        {
          title: row.job.title,
          description: row.job.description,
          skills: row.job.skills ?? [],
          requiredSkills: row.job.requiredSkills,
          preferredSkills: row.job.preferredSkills,
          location: row.job.location,
          remote: row.job.remote,
          salaryMin: row.job.salaryMin,
          salaryMax: row.job.salaryMax,
          seniority: row.job.seniority,
        },
        {
          headline: profile.headline,
          bio: profile.bio,
          skills: profile.skills,
          location: profile.location,
          remotePref: me_remotePref(me),
          salaryTarget: me_salaryTarget(me),
          yearsExp: profile.yearsExp,
        }
      );
      gaps = gapReport(result, row.job.title);
    }

    let polish = null;
    if (wantPolish) {
      const limit = await consume("resumePolish", me.id);
      if (!limit.ok) return tooMany(limit);

      const source = tailored ?? resume;
      const experience = source.sections.find((s) => s.key === "experience");
      // Headings are stated by the builder — a bullet containing an em-dash
      // is a bullet, and must not be skipped as if it were a job title.
      const heads = new Set(experience?.headings ?? []);
      const bullets = (experience?.lines ?? []).filter((_, i) => !heads.has(i));
      polish = await polishLines(bullets);
    }

    return NextResponse.json({
      resume,
      tailored,
      gaps,
      polish,
      ai: { available: aiEnabled(), subProcessors: disclosure() },
    });
  } catch (e) {
    const status = e instanceof AuthError ? 401 : 400;
    return authErrorResponse(e) ?? NextResponse.json({ error: (e as Error).message }, { status });
  }
}

// The user row carries these but the ResumeProfile type does not need them —
// they belong to matching, not to the document.
function me_remotePref(u: Record<string, unknown>) {
  return (u.remotePref as "ONSITE" | "HYBRID" | "REMOTE" | "ANY") ?? "ANY";
}
function me_salaryTarget(u: Record<string, unknown>) {
  const v = u.salaryTarget;
  return typeof v === "number" ? v : null;
}

/**
 * POST — the same thing, for a job the candidate is looking at right now.
 *
 * Exists separately from GET because a client that already has the job on
 * screen should not have to round-trip an id and re-read a posting the user is
 * literally looking at.
 */
const Body = z.object({ jobId: z.string().min(1), polish: z.boolean().optional() });

export async function POST(req: Request) {
  try {
    await requireRole("CANDIDATE");
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }
    const url = new URL(req.url);
    url.searchParams.set("jobId", parsed.data.jobId);
    if (parsed.data.polish) url.searchParams.set("polish", "1");
    return GET(new Request(url.toString(), { headers: req.headers }));
  } catch (e) {
    const status = e instanceof AuthError ? 401 : 400;
    return authErrorResponse(e) ?? NextResponse.json({ error: (e as Error).message }, { status });
  }
}
