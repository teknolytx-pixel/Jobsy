import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { applications, companies, db, jobs, matches, recruiterSwipes, users } from "@/db";
import { AuthError, ForbiddenError, authErrorResponse, requireVerifiedUser, requireUser } from "@/lib/auth";
import { extractSkills, inferSeniority, normalizeSkills } from "@/lib/skills";
import { checkPayTransparency } from "@/lib/compliance/payTransparency";
import { screenPosting, explainScreen } from "@/lib/compliance/contentScreen";
import { screenForScam } from "@/lib/trust";
import { clientIp, consume, tooMany } from "@/lib/ratelimit";
import { audit, safeDetail } from "@/lib/audit";
import { canPostForCompany } from "@/lib/company";

const Body = z.object({
  title: z.string().min(2),
  companyName: z.string().min(1),
  location: z.string().min(1),
  remote: z.enum(["ONSITE", "HYBRID", "REMOTE", "ANY"]).default("ONSITE"),
  employmentType: z.string().default("Full-time"),
  salaryMin: z.number().int().min(0).max(2000).nullable().optional(),
  salaryMax: z.number().int().min(0).max(2000).nullable().optional(),
  /** LEGAL-002 — required alongside a range in WA, MN, NJ, MD, IL, CO, DE, CT. */
  benefitsDescription: z.string().max(4000).nullable().optional(),
  description: z.string().min(20),
  skills: z.array(z.string()).max(30).optional(),
  perks: z.array(z.string()).max(10).optional(),
  applyMethod: z.enum(["EASY", "EXTERNAL"]).default("EASY"),
  applyUrl: z.string().url().optional().nullable(),
  /** WORK-002 — three states. Unstated is the default and never inferred. */
  sponsorshipAvailable: z.boolean().nullable().optional(),
  /** Employer headcount, if the recruiter supplies it. Drives LEGAL-002 thresholds. */
  employeeCount: z.number().int().min(1).max(5_000_000).nullable().optional(),
  /**
   * TRUST-001 — the ghost-jobs attestation.
   *
   * Illinois requires a current job order before advertising; Texas prohibits
   * advertising without a verified job order with a TREBLE-damages private
   * right of action; California prohibits referring to nonexistent jobs. This
   * checkbox is the affirmative defence, so it is required, not optional.
   */
  attestCurrentVacancy: z.literal(true, {
    message:
      "Please confirm this is a current, open vacancy that you're authorized to advertise.",
  }),
});

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await db
      .select({
        job: jobs,
        company: companies,
        applicants: sql<number>`(select count(*)::int from ${applications} where ${applications.jobId} = ${jobs.id})`,
        matched: sql<number>`(select count(*)::int from ${matches} where ${matches.jobId} = ${jobs.id})`,
        reviewed: sql<number>`(select count(*)::int from ${recruiterSwipes} where ${recruiterSwipes.jobId} = ${jobs.id})`,
      })
      .from(jobs)
      .innerJoin(companies, eq(jobs.companyId, companies.id))
      .where(eq(jobs.postedById, user.id))
      .orderBy(desc(jobs.postedAt));

    return NextResponse.json({
      jobs: rows.map((r) => ({
        id: r.job.id,
        title: r.job.title,
        company: r.company.name,
        location: r.job.location,
        remote: r.job.remote,
        salaryMin: r.job.salaryMin,
        salaryMax: r.job.salaryMax,
        applyMethod: r.job.applyMethod,
        applyUrl: r.job.applyUrl,
        skills: r.job.skills,
        active: r.job.active,
        applicants: r.applicants,
        matches: r.matched,
        reviewed: r.reviewed,
        // JOB-003 — surfaced so a recruiter can see what is about to expire.
        lastConfirmedAt: r.job.lastConfirmedAt?.toISOString() ?? null,
        postedAt: r.job.postedAt.toISOString(),
      })),
    });
  } catch (e) {
    return authErrorResponse(e) ?? NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  try {
    // AUTH-006 AC-5 — an unverified address cannot publish a job.
    const user = await requireVerifiedUser();

    const rl = await consume("write", user.id);
    if (!rl.ok) return tooMany(rl);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return NextResponse.json(
        { error: issue?.message ?? "Invalid", field: issue?.path?.[0], code: "VALIDATION" },
        { status: 400 }
      );
    }
    const b = parsed.data;

    if (b.applyMethod === "EXTERNAL" && !b.applyUrl) {
      return NextResponse.json(
        {
          error: "External apply needs an applyUrl — the posting on your careers site or job board",
          field: "applyUrl",
          code: "VALIDATION",
        },
        { status: 400 }
      );
    }
    if (b.salaryMin != null && b.salaryMax != null && b.salaryMin > b.salaryMax) {
      return NextResponse.json(
        { error: "The minimum salary can't be above the maximum", field: "salaryMin", code: "VALIDATION" },
        { status: 400 }
      );
    }

    // ── TRUST-004: discriminatory content. Blocks BEFORE anything is written. ──
    const screen = screenPosting({ title: b.title, description: b.description, perks: b.perks });
    await audit({
      action: "trust.posting_screened",
      actorId: user.id,
      detail: safeDetail({ findings: screen.findings.length, blocking: screen.blocking.length }),
      ip,
    });
    if (!screen.ok) {
      await audit({
        action: "trust.posting_blocked",
        actorId: user.id,
        detail: safeDetail({ categories: screen.blocking.map((f) => f.category) }),
        ip,
      });
      return NextResponse.json(
        {
          error: explainScreen(screen),
          code: "DISCRIMINATORY_CONTENT",
          findings: screen.blocking,
        },
        { status: 400 }
      );
    }

    // ── LEGAL-002: pay transparency. Also blocks before any write. ──
    const pay = checkPayTransparency({
      location: b.location,
      remote: b.remote,
      salaryMin: b.salaryMin,
      salaryMax: b.salaryMax,
      benefitsDescription: b.benefitsDescription,
      employeeCount: b.employeeCount ?? null,
      consentSource: "EMPLOYER_SUBMITTED",
    });
    if (!pay.ok) {
      return NextResponse.json(
        {
          error: pay.message,
          code: "PAY_TRANSPARENCY_REQUIRED",
          problems: pay.problems,
          laws: pay.applicable.map((a) => ({ scope: a.scope, cite: a.rule.cite })),
        },
        { status: 400 }
      );
    }

    // ── TRUST-003: advance-fee heuristics. Advisory — logged, not blocking. ──
    const scam = screenForScam(`${b.title}\n${b.description}`);

    const slug = b.companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    // SEAT-003 — a recruiter may only post under their own company.
    const gate = await canPostForCompany(user, slug);
    if (!gate.ok) throw new ForbiddenError(gate.reason, gate.code);

    const [company] = await db
      .insert(companies)
      .values({ name: b.companyName, slug, source: "JOBSY" })
      .onConflictDoUpdate({ target: companies.slug, set: { name: b.companyName } })
      .returning();

    const skills = b.skills?.length ? normalizeSkills(b.skills) : extractSkills(b.description);

    const [job] = await db
      .insert(jobs)
      .values({
        source: "JOBSY",
        externalId: null,
        title: b.title,
        companyId: company.id,
        location: b.location,
        remote: b.remote,
        employmentType: b.employmentType,
        seniority: inferSeniority(b.title, b.description),
        salaryMin: b.salaryMin ?? null,
        salaryMax: b.salaryMax ?? null,
        benefitsDescription: b.benefitsDescription ?? null,
        // The Illinois affirmative defence, recorded at the moment of submission.
        employerSuppliedPay: b.salaryMin != null || b.salaryMax != null,
        consentSource: "EMPLOYER_SUBMITTED",
        description: b.description,
        skills,
        perks: b.perks ?? [],
        applyMethod: b.applyMethod,
        applyUrl: b.applyUrl ?? null,
        sponsorshipAvailable: b.sponsorshipAvailable ?? null,
        postedById: user.id,
        attestedAt: new Date(),
        attestedById: user.id,
        lastConfirmedAt: new Date(),
      })
      .returning();

    await db
      .update(users)
      .set({
        role: user.role === "CANDIDATE" ? "BOTH" : user.role,
        companyId: user.companyId ?? company.id,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    await audit({
      action: "job.created",
      actorId: user.id,
      subjectType: "job",
      subjectId: job.id,
      detail: safeDetail({
        company: company.name,
        payDisclosed: job.employerSuppliedPay,
        payLaws: pay.applicable.map((a) => a.scope),
        advisoryScreen: screen.advisory.map((f) => f.category),
        scamSignals: scam.signals,
      }),
      ip,
    });
    await audit({
      action: "job.attested",
      actorId: user.id,
      subjectType: "job",
      subjectId: job.id,
      ip,
    });

    return NextResponse.json(
      {
        ok: true,
        jobId: job.id,
        skills,
        // LEGAL-002 AC-1 — tell the recruiter which rules applied, even on
        // success. Compliance the user cannot see reads as arbitrary friction.
        payLawsApplied: pay.applicable.map((a) => ({ scope: a.scope, cite: a.rule.cite })),
        advisories: screen.advisory,
        ...(scam.suspicious
          ? { warning: "This posting was flagged for review because of its wording.", scamSignals: scam.signals }
          : {}),
      },
      { status: 201 }
    );
  } catch (e) {
    const mapped = authErrorResponse(e);
    if (mapped) return mapped;
    const status = e instanceof AuthError ? 401 : 400;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
