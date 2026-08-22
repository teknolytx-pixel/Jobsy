import type { RemotePref } from "@/db";
import { matchScore, type MatchResult } from "./matching/engine";

/**
 * Compatibility shim.
 *
 * The real engine now lives in src/lib/matching/. This keeps the original
 * `scoreJobForCandidate(job, cand)` signature that deck.ts and swipe.ts already
 * call, so the upgrade needed no changes at those call sites, and preserves the
 * four fields the UI reads (score / sharedSkills / missingSkills / reasons).
 *
 * New callers should import from ./matching/engine directly — it returns
 * exclusions, transferable-skill provenance, concerns and role families too.
 */

export type ScoreResult = {
  score: number;
  sharedSkills: string[];
  missingSkills: string[];
  reasons: string[];
  breakdown: { skills: number; location: number; comp: number; seniority: number };
  /** Everything the richer engine produces. */
  full: MatchResult;
};

type JobLike = {
  title?: string;
  description?: string;
  skills: string[];
  /** MATCH-002 — optional, because ingested jobs never have them. */
  requiredSkills?: string[] | null;
  preferredSkills?: string[] | null;
  location: string;
  remote: RemotePref;
  salaryMin: number | null;
  salaryMax: number | null;
  seniority: string;
};

type CandLike = {
  headline?: string | null;
  bio?: string | null;
  skills: string[];
  location: string | null;
  remotePref: RemotePref;
  salaryTarget: number | null;
  yearsExp: number;
};

export function scoreJobForCandidate(job: JobLike, cand: CandLike): ScoreResult {
  const r = matchScore(
    {
      title: job.title ?? "",
      description: job.description ?? "",
      skills: job.skills,
      requiredSkills: job.requiredSkills,
      preferredSkills: job.preferredSkills,
      location: job.location,
      remote: job.remote,
      salaryMin: job.salaryMin,
      salaryMax: job.salaryMax,
      seniority: job.seniority,
    },
    cand
  );

  return {
    // Already floored by the engine when excluded.
    score: r.score,
    sharedSkills: r.sharedSkills,
    missingSkills: r.missingSkills,
    reasons: r.excluded && r.exclusionReason ? [r.exclusionReason] : r.reasons,
    breakdown: {
      skills: r.breakdown.requiredSkills + r.breakdown.preferredSkills,
      location: r.breakdown.workStyle,
      comp: r.breakdown.compensation,
      seniority: r.breakdown.experience,
    },
    full: r,
  };
}

/** Same signals, read from the hiring side. */
export const scoreCandidateForJob = scoreJobForCandidate;

export { matchScore } from "./matching/engine";
export type { MatchResult } from "./matching/engine";
