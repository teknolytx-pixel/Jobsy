import { and, eq } from "drizzle-orm";
import {
  applications,
  candidateSwipes,
  companies,
  db,
  jobs,
  matches,
  recruiterSwipes,
  users,
  type Direction,
  type User,
} from "@/db";
import { env } from "./env";
import { scoreJobForCandidate } from "./match";
import { applicationEmail, matchEmail, recruiterInterestEmail, sendEmail } from "./email";

export type SwipeOutcome = {
  ok: true;
  direction: Direction;
  matched: boolean;
  matchId?: string;
  apply?: { method: "EASY" | "EXTERNAL"; url?: string; applicationId: string };
  emailSent?: boolean;
  message: string;
};

async function loadJob(jobId: string) {
  const rows = await db
    .select({ job: jobs, company: companies, poster: users })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .leftJoin(users, eq(jobs.postedById, users.id))
    .where(eq(jobs.id, jobId))
    .limit(1);
  return rows[0] ?? null;
}

// ─────────────────────────────────────────────────────────────
// CANDIDATE SWIPES A JOB
// ─────────────────────────────────────────────────────────────
export async function candidateSwipe(
  candidate: User,
  jobId: string,
  direction: Direction
): Promise<SwipeOutcome> {
  const row = await loadJob(jobId);
  if (!row) throw new Error("Job not found");
  const { job, company, poster } = row;

  const fit = scoreJobForCandidate(job, candidate);

  await db
    .insert(candidateSwipes)
    .values({ candidateId: candidate.id, jobId, direction, score: fit.score })
    .onConflictDoUpdate({
      target: [candidateSwipes.candidateId, candidateSwipes.jobId],
      set: { direction, score: fit.score },
    });

  if (direction === "PASS") return { ok: true, direction, matched: false, message: "Passed" };

  // ---- record the application ----
  const [application] = await db
    .insert(applications)
    .values({
      candidateId: candidate.id,
      jobId,
      method: job.applyMethod,
      status: job.applyMethod === "EASY" ? "SUBMITTED" : "REDIRECTED",
    })
    .onConflictDoUpdate({
      target: [applications.candidateId, applications.jobId],
      set: { method: job.applyMethod },
    })
    .returning();

  // ---- Easy Apply pushes the profile to whoever owns the post ----
  let emailSent = false;
  if (job.applyMethod === "EASY" && poster?.email) {
    const r = await sendEmail(
      applicationEmail({
        to: poster.email,
        recruiterName: poster.name,
        candidateName: candidate.name,
        candidateEmail: candidate.email,
        candidateHeadline: candidate.headline ?? "Candidate",
        candidateLocation: candidate.location ?? "Not specified",
        candidateYears: candidate.yearsExp,
        availability: candidate.availability ?? "Not specified",
        sharedSkills: fit.sharedSkills,
        score: fit.score,
        jobTitle: job.title,
        profileUrl: `${env.appUrl}/u/${candidate.id}`,
      })
    );
    emailSent = r.delivered;
  }

  // ---- had the recruiter already liked this candidate for this job? ----
  const theirs = await db
    .select()
    .from(recruiterSwipes)
    .where(and(eq(recruiterSwipes.jobId, jobId), eq(recruiterSwipes.candidateId, candidate.id)))
    .limit(1);

  let matchId: string | undefined;
  if (theirs[0]?.direction === "LIKE" && job.postedById) {
    matchId = await createMatch(jobId, candidate.id, job.postedById, fit.score, {
      jobTitle: job.title,
      companyName: company.name,
    });
  }

  return {
    ok: true,
    direction,
    matched: Boolean(matchId),
    matchId,
    apply: {
      method: job.applyMethod,
      url: job.applyMethod === "EXTERNAL" ? (job.applyUrl ?? job.sourceUrl ?? undefined) : undefined,
      applicationId: application.id,
    },
    emailSent,
    message: job.applyMethod === "EASY" ? "Applied" : "Redirecting to apply",
  };
}

// ─────────────────────────────────────────────────────────────
// RECRUITER SWIPES A CANDIDATE (against one of their job posts)
// ─────────────────────────────────────────────────────────────
export async function recruiterSwipe(
  recruiter: User,
  jobId: string,
  candidateId: string,
  direction: Direction
): Promise<SwipeOutcome> {
  const row = await loadJob(jobId);
  if (!row) throw new Error("Job not found");
  const { job, company } = row;
  if (job.postedById !== recruiter.id) throw new Error("You can only source for your own job posts");

  const cands = await db.select().from(users).where(eq(users.id, candidateId)).limit(1);
  const candidate = cands[0];
  if (!candidate) throw new Error("Candidate not found");

  const fit = scoreJobForCandidate(job, candidate);

  await db
    .insert(recruiterSwipes)
    .values({ recruiterId: recruiter.id, jobId, candidateId, direction, score: fit.score })
    .onConflictDoUpdate({
      target: [recruiterSwipes.jobId, recruiterSwipes.candidateId],
      set: { direction, score: fit.score, recruiterId: recruiter.id },
    });

  if (direction === "PASS") return { ok: true, direction, matched: false, message: "Passed" };

  // ---- spec #6: ask the candidate if they want to move forward ----
  const base = `${env.appUrl}/i/${jobId}/${candidateId}`;
  const r = await sendEmail(
    recruiterInterestEmail({
      candidateName: candidate.name,
      candidateEmail: candidate.email,
      recruiterName: recruiter.name,
      companyName: company.name,
      jobTitle: job.title,
      jobLocation: job.location,
      jobRemote: job.remote,
      salaryMin: job.salaryMin,
      salaryMax: job.salaryMax,
      sharedSkills: fit.sharedSkills,
      score: fit.score,
      acceptUrl: `${base}?r=yes`,
      declineUrl: `${base}?r=no`,
    })
  );

  // ---- had the candidate already liked this job? ----
  const theirs = await db
    .select()
    .from(candidateSwipes)
    .where(and(eq(candidateSwipes.candidateId, candidateId), eq(candidateSwipes.jobId, jobId)))
    .limit(1);

  let matchId: string | undefined;
  if (theirs[0]?.direction === "LIKE") {
    matchId = await createMatch(jobId, candidateId, recruiter.id, fit.score, {
      jobTitle: job.title,
      companyName: company.name,
    });
  }

  return {
    ok: true,
    direction,
    matched: Boolean(matchId),
    matchId,
    emailSent: r.delivered,
    message: matchId ? "Match — they had already swiped right" : "Interest email sent",
  };
}

// ─────────────────────────────────────────────────────────────
// Candidate answering the interest email
// ─────────────────────────────────────────────────────────────
export async function respondToInterest(
  jobId: string,
  candidateId: string,
  interested: boolean
): Promise<{ matched: boolean; matchId?: string }> {
  const row = await loadJob(jobId);
  const cands = await db.select().from(users).where(eq(users.id, candidateId)).limit(1);
  if (!row || !cands[0]) throw new Error("Not found");
  const { job, company } = row;
  const candidate = cands[0];

  const fit = scoreJobForCandidate(job, candidate);
  const direction: Direction = interested ? "LIKE" : "PASS";

  await db
    .insert(candidateSwipes)
    .values({ candidateId, jobId, direction, score: fit.score })
    .onConflictDoUpdate({
      target: [candidateSwipes.candidateId, candidateSwipes.jobId],
      set: { direction, score: fit.score },
    });

  if (!interested || !job.postedById) return { matched: false };

  const matchId = await createMatch(jobId, candidateId, job.postedById, fit.score, {
    jobTitle: job.title,
    companyName: company.name,
  });
  return { matched: true, matchId };
}

// ─────────────────────────────────────────────────────────────
// MATCH CREATION — idempotent, notifies both sides exactly once
// ─────────────────────────────────────────────────────────────
async function createMatch(
  jobId: string,
  candidateId: string,
  recruiterId: string,
  score: number,
  ctx: { jobTitle: string; companyName: string }
): Promise<string> {
  const existing = await db
    .select()
    .from(matches)
    .where(and(eq(matches.jobId, jobId), eq(matches.candidateId, candidateId)))
    .limit(1);
  if (existing[0]) return existing[0].id;

  const [match] = await db
    .insert(matches)
    .values({ jobId, candidateId, recruiterId, score })
    .onConflictDoNothing({ target: [matches.jobId, matches.candidateId] })
    .returning();

  // lost a race — another request created it first
  if (!match) {
    const again = await db
      .select()
      .from(matches)
      .where(and(eq(matches.jobId, jobId), eq(matches.candidateId, candidateId)))
      .limit(1);
    return again[0].id;
  }

  const people = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, candidateId));
  const recs = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, recruiterId));

  const cand = people[0];
  const rec = recs[0];
  const chatUrl = `${env.appUrl}/matches/${match.id}`;

  if (cand && rec) {
    await Promise.all([
      sendEmail(
        matchEmail({
          to: cand.email,
          toName: cand.name,
          otherName: rec.name,
          jobTitle: ctx.jobTitle,
          companyName: ctx.companyName,
          chatUrl,
          forCandidate: true,
        })
      ),
      sendEmail(
        matchEmail({
          to: rec.email,
          toName: rec.name,
          otherName: cand.name,
          jobTitle: ctx.jobTitle,
          companyName: ctx.companyName,
          chatUrl,
          forCandidate: false,
        })
      ),
    ]);
  }

  return match.id;
}
