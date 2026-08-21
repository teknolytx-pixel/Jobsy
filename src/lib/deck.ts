import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { blockedIdsFor } from "./trust";
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
import { checkGeoEligibility, toCandidateGeo, toJobGeo } from "./geo";
import { isSponsorshipEligible } from "./authorization";

export type JobCard = {
  id: string; title: string; company: string; location: string; remote: string;
  employmentType: string; seniority: string; salaryMin: number | null; salaryMax: number | null;
  description: string; skills: string[]; perks: string[];
  applyMethod: "EASY" | "EXTERNAL"; applyUrl: string | null;
  source: string; sourceUrl: string | null; postedAt: string; recruiterName: string | null;
  score: number; sharedSkills: string[]; missingSkills: string[]; reasons: string[];
  /** Why it might not work — shown so a low score never looks arbitrary. */
  concerns: string[];
  /** Skills credited via adjacency, with what earned the credit. */
  transferable: { skill: string; via: string | null }[];
  /** 0..1 — can they do the job at all. Gates the logistics features. */
  qualification: number;
};

export type CandidateCard = {
  id: string; name: string; headline: string; location: string; remotePref: string;
  yearsExp: number; salaryTarget: number | null; availability: string; bio: string;
  skills: string[]; image: string | null; linkedinVerified: boolean;
  score: number; sharedSkills: string[]; missingSkills: string[]; reasons: string[];
  /** Why it might not work — shown so a low score never looks arbitrary. */
  concerns: string[];
  /** Skills credited via adjacency, with what earned the credit. */
  transferable: { skill: string; via: string | null }[];
  /** 0..1 — can they do the job at all. Gates the logistics features. */
  qualification: number;
};

const DECK_SIZE = 25;
/** Over-fetch, then re-rank in app — SQL can't express the scoring function. */
const POOL = 400;

export async function candidateDeck(candidate: User): Promise<JobCard[]> {
  const [seen, blocked] = await Promise.all([
    db
      .select({ jobId: candidateSwipes.jobId })
      .from(candidateSwipes)
      .where(eq(candidateSwipes.candidateId, candidate.id)),
    // MSG-004 AC-2 — a blocked person's postings never appear again.
    blockedIdsFor(candidate.id),
  ]);
  const seenIds = seen.map((s) => s.jobId);

  const clauses = [
    eq(jobs.active, true),
    // SRC-007 — a posting that lost the canonical contest is never surfaced.
    sql`${jobs.canonicalJobId} IS NULL`,
  ];
  if (seenIds.length) clauses.push(notInArray(jobs.id, seenIds));
  if (blocked.length) {
    clauses.push(
      sql`(${jobs.postedById} IS NULL OR ${jobs.postedById} NOT IN ${blocked})`
    );
  }
  const where = and(...clauses);
  const candGeo = toCandidateGeo(candidate);

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
      const geo = checkGeoEligibility(toJobGeo(job), candGeo);
      return {
        _excluded: fit.full.excluded,
        _geoEligible: geo.eligible,
        // BR-006 — Stage 1, beside geography and for the same reason: this
        // decides WHICH pairs are considered. It never reaches the scorer.
        _sponsorshipEligible: isSponsorshipEligible({
          jobSponsorshipAvailable: job.sponsorshipAvailable,
          candidateRequiresSponsorship: candidate.requiresSponsorship,
        }),
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
        concerns: fit.full.concerns,
        transferable: fit.full.transferableSkills.map((t) => ({ skill: t.skill, via: t.via })),
        qualification: fit.full.qualification,
      };
    })
    // A hard filter means "don't show this", not "show it last" — an onsite job
    // in another city is noise in a remote-only candidate's deck, however good
    // the skill overlap looks.
    .filter((c) => !c._excluded)
    // BR-018 — geographic incompatibility removes the pair from the pool. This
    // runs on the row, not on the score, because Stage 1 of FSD §34 is the
    // eligibility layer and the scoring engine never sees geography.
    .filter((c) => c._geoEligible)
    .filter((c) => c._sponsorshipEligible)
    .map(({ _excluded, _geoEligible, _sponsorshipEligible, ...card }) => card satisfies JobCard)
    // XPLAIN-003 AC-3/5 — an opted-out candidate still sees the same jobs. What
    // changes is the ORDER: newest first instead of score-ranked. Withholding
    // the product because someone exercised a statutory right is retaliation,
    // which several of these statutes name explicitly.
    .sort((a, b) =>
      candidate.profilingOptOut
        ? Date.parse(b.postedAt) - Date.parse(a.postedAt)
        : b.score - a.score
    )
    .slice(0, DECK_SIZE);
}

export async function recruiterDeck(recruiter: User, jobId: string): Promise<CandidateCard[]> {
  const found = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  const job = found[0];
  if (!job || job.postedById !== recruiter.id) throw new Error("Not your job post");

  const [seen, blocked] = await Promise.all([
    db
      .select({ candidateId: recruiterSwipes.candidateId })
      .from(recruiterSwipes)
      .where(eq(recruiterSwipes.jobId, jobId)),
    blockedIdsFor(recruiter.id),
  ]);
  const exclude = [...new Set([...seen.map((s) => s.candidateId), recruiter.id, ...blocked])];
  const jobGeo = toJobGeo(job);

  const rows = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.profileReady, true),
        eq(users.openToOffers, true),
        eq(users.role, "CANDIDATE"),
        notInArray(users.id, exclude),
        // AUTH-006 AC-6 — an unverified address never appears in a recruiter's
        // deck. Anyone can type an address they do not control.
        eq(users.emailVerified, true),
        // AUTH-012 — a closed account disappears immediately, before the purge.
        sql`${users.deletionRequestedAt} IS NULL`,
        sql`cardinality(${users.skills}) > 0`
      )
    )
    .orderBy(desc(users.updatedAt))
    .limit(POOL);

  return rows
    .map((c) => {
      const fit = scoreJobForCandidate(job, c);
      const geo = checkGeoEligibility(jobGeo, toCandidateGeo(c));
      return {
        _excluded: fit.full.excluded,
        _geoEligible: geo.eligible,
        // Symmetrical with the candidate deck. If a role does not sponsor and a
        // person has said they will need it, neither side benefits from the
        // introduction — and showing the recruiter a candidate they cannot hire
        // is how a lawful policy turns into a conversation about status.
        _sponsorshipEligible: isSponsorshipEligible({
          jobSponsorshipAvailable: job.sponsorshipAvailable,
          candidateRequiresSponsorship: c.requiresSponsorship,
        }),
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
        concerns: fit.full.concerns,
        transferable: fit.full.transferableSkills.map((t) => ({ skill: t.skill, via: t.via })),
        qualification: fit.full.qualification,
      };
    })
    .filter((c) => !c._excluded)
    // BR-016 / BR-018 — a candidate outside the boundary is not a weaker
    // candidate, they are not in the pool. Skill coverage does not override it.
    .filter((c) => c._geoEligible)
    .filter((c) => c._sponsorshipEligible)
    .map(({ _excluded, _geoEligible, _sponsorshipEligible, ...card }) => card satisfies CandidateCard)
    .sort((a, b) => b.score - a.score)
    .slice(0, DECK_SIZE);
}


/**
 * GEO-007 — why the deck is empty.
 *
 * An empty deck with no explanation reads as a broken product, and a candidate
 * who has not turned international search on has no way to guess that is why.
 * This returns the counts and the most common exclusion reason so the empty
 * state can say something true and actionable.
 *
 * Every reason string comes from checkGeoEligibility, which phrases exclusions
 * in terms of work location and never in terms of who the candidate is.
 */
export async function candidateGeoDiagnostics(candidate: User): Promise<{
  considered: number;
  excludedByGeography: number;
  topReason: string | null;
}> {
  const rows = await db
    .select({ job: jobs })
    .from(jobs)
    .where(and(eq(jobs.active, true), sql`${jobs.canonicalJobId} IS NULL`))
    .orderBy(desc(jobs.postedAt))
    .limit(POOL);

  const candGeo = toCandidateGeo(candidate);
  const reasons = new Map<string, number>();
  let excluded = 0;

  for (const { job } of rows) {
    const verdict = checkGeoEligibility(toJobGeo(job), candGeo);
    if (verdict.eligible) continue;
    excluded++;
    reasons.set(verdict.reason, (reasons.get(verdict.reason) ?? 0) + 1);
  }

  const topReason =
    [...reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return { considered: rows.length, excludedByGeography: excluded, topReason };
}
