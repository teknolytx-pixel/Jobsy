import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import {
  candidateSwipes,
  companies,
  db,
  jobs,
  recruiterSwipes,
  users,
  type User,
} from "@/db";
import { scoreJobForCandidate } from "./match";

export type JobCard = {
  id: string; title: string; company: string; location: string; remote: string;
  employmentType: string; seniority: string; salaryMin: number | null; salaryMax: number | null;
  description: string; skills: string[]; perks: string[];
  applyMethod: "EASY" | "EXTERNAL"; applyUrl: string | null;
  source: string; sourceUrl: string | null; postedAt: string; recruiterName: string | null;
  score: number; sharedSkills: string[]; missingSkills: string[]; reasons: string[];
};

export type CandidateCard = {
  id: string; name: string; headline: string; location: string; remotePref: string;
  yearsExp: number; salaryTarget: number | null; availability: string; bio: string;
  skills: string[]; image: string | null; linkedinVerified: boolean;
  score: number; sharedSkills: string[]; missingSkills: string[]; reasons: string[];
};

const DECK_SIZE = 25;
/** Over-fetch, then re-rank in app — SQL can't express the scoring function. */
const POOL = 400;

export async function candidateDeck(candidate: User): Promise<JobCard[]> {
  const seen = await db
    .select({ jobId: candidateSwipes.jobId })
    .from(candidateSwipes)
    .where(eq(candidateSwipes.candidateId, candidate.id));
  const seenIds = seen.map((s) => s.jobId);

  const where = seenIds.length
    ? and(eq(jobs.active, true), notInArray(jobs.id, seenIds))
    : eq(jobs.active, true);

  const rows = await db
    .select({ job: jobs, company: companies, posterName: users.name })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .leftJoin(users, eq(jobs.postedById, users.id))
    .where(where)
    .orderBy(desc(jobs.postedAt))
    .limit(POOL);

  return rows
    .map(({ job, company, posterName }) => {
      const fit = scoreJobForCandidate(job, candidate);
      return {
        id: job.id,
        title: job.title,
        company: company.name,
        location: job.location,
        remote: job.remote,
        employmentType: job.employmentType,
        seniority: job.seniority,
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
        description: job.description.slice(0, 1400),
        skills: job.skills,
        perks: job.perks,
        applyMethod: job.applyMethod,
        applyUrl: job.applyUrl,
        source: job.source,
        sourceUrl: job.sourceUrl,
        postedAt: job.postedAt.toISOString(),
        recruiterName: posterName ?? null,
        score: fit.score,
        sharedSkills: fit.sharedSkills,
        missingSkills: fit.missingSkills.slice(0, 6),
        reasons: fit.reasons,
      } satisfies JobCard;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, DECK_SIZE);
}

export async function recruiterDeck(recruiter: User, jobId: string): Promise<CandidateCard[]> {
  const found = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  const job = found[0];
  if (!job || job.postedById !== recruiter.id) throw new Error("Not your job post");

  const seen = await db
    .select({ candidateId: recruiterSwipes.candidateId })
    .from(recruiterSwipes)
    .where(eq(recruiterSwipes.jobId, jobId));
  const exclude = [...seen.map((s) => s.candidateId), recruiter.id];

  const rows = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.profileReady, true),
        eq(users.openToOffers, true),
        inArray(users.role, ["CANDIDATE", "BOTH"]),
        notInArray(users.id, exclude),
        sql`cardinality(${users.skills}) > 0`
      )
    )
    .orderBy(desc(users.updatedAt))
    .limit(POOL);

  return rows
    .map((c) => {
      const fit = scoreJobForCandidate(job, c);
      return {
        id: c.id,
        name: c.name,
        headline: c.headline ?? "Candidate",
        location: c.location ?? "Not specified",
        remotePref: c.remotePref,
        yearsExp: c.yearsExp,
        salaryTarget: c.salaryTarget,
        availability: c.availability ?? "Not specified",
        bio: c.bio ?? "",
        skills: c.skills,
        image: c.image,
        linkedinVerified: Boolean(c.linkedinSub),
        score: fit.score,
        sharedSkills: fit.sharedSkills,
        missingSkills: fit.missingSkills.slice(0, 6),
        reasons: fit.reasons,
      } satisfies CandidateCard;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, DECK_SIZE);
}
