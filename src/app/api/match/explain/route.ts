import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, companies, jobs, users } from "@/db";
import { requireUser, authErrorResponse } from "@/lib/auth";
import { matchScore } from "@/lib/matching/engine";
import { explain } from "@/lib/explain";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * XPLAIN-001 — "Why this match?"
 *
 * GET /api/match/explain?jobId=…[&candidateId=…]
 *
 * A candidate always explains themselves against a job. A recruiter may explain
 * a candidate against a job they own — and only a job they own (AC-11), because
 * a match explanation reveals what is on someone's profile.
 */
export async function GET(req: Request) {
  let me;
  try {
    me = await requireUser();
  } catch (e) {
    return authErrorResponse(e)!;
  }

  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId");
  const candidateId = url.searchParams.get("candidateId") ?? me.id;
  if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 });

  const rows = await db
    .select({ job: jobs, company: companies })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(eq(jobs.id, jobId))
    .limit(1);
  const found = rows[0];
  if (!found) return NextResponse.json({ error: "That role no longer exists" }, { status: 404 });

  // AC-11 — explaining someone else requires owning the job.
  if (candidateId !== me.id && found.job.postedById !== me.id) {
    return NextResponse.json(
      { error: "You can only see explanations for your own matches", code: "FORBIDDEN" },
      { status: 403 }
    );
  }

  const candRows = await db.select().from(users).where(eq(users.id, candidateId)).limit(1);
  const cand = candRows[0];
  if (!cand) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

  const result = matchScore(
    {
      title: found.job.title,
      description: found.job.description,
      skills: found.job.skills,
      requiredSkills: found.job.requiredSkills,
      preferredSkills: found.job.preferredSkills,
      location: found.job.location,
      remote: found.job.remote,
      salaryMin: found.job.salaryMin,
      salaryMax: found.job.salaryMax,
      seniority: found.job.seniority,
    },
    cand
  );

  const explanation = explain(result);

  // AC-7 is a hard invariant, not a nicety: if the components stop summing to
  // the score, the explanation has become a plausible-looking fiction. Log it
  // loudly rather than quietly serving it.
  if (!explanation.reconciles) {
    console.error(
      "[explain] RECONCILIATION FAILED — breakdown does not sum to score",
      { jobId, candidateId, score: result.rawScore, breakdown: result.breakdown }
    );
  }

  await audit({
    action: "review.requested",
    actorId: me.id,
    subjectType: "job",
    subjectId: jobId,
    detail: { kind: "explanation", forSelf: candidateId === me.id },
  });

  return NextResponse.json({
    job: { id: found.job.id, title: found.job.title, company: found.company.name },
    explanation,
  });
}
