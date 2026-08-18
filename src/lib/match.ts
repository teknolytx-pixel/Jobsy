import type { RemotePref } from "@/db";
import { seniorityRank } from "./skills";

/**
 * Bidirectional fit scoring.
 *
 * One symmetric function, two entry points. Both sides see a score derived
 * from the same four signals so a 78% means the same thing to a candidate
 * looking at a job as it does to a recruiter looking at a candidate.
 *
 *   skills     55  — canonical skill overlap, weighted by the job's needs
 *   location   15  — remote compatibility, then metro match
 *   comp       20  — does the band clear what the candidate wants
 *   seniority  10  — years/level distance, penalised in both directions
 */

export type ScoreInput = {
  jobSkills: string[];
  candidateSkills: string[];
  jobLocation: string;
  jobRemote: RemotePref;
  candidateLocation: string | null;
  candidateRemote: RemotePref;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryTarget: number | null;
  jobSeniority: string;
  candidateYears: number;
};

export type ScoreResult = {
  score: number;
  sharedSkills: string[];
  missingSkills: string[];
  reasons: string[];
  breakdown: { skills: number; location: number; comp: number; seniority: number };
};

const metro = (s: string | null | undefined): string =>
  (s ?? "").split(/[,–—-]/)[0].trim().toLowerCase();

function remoteCompatible(job: RemotePref, cand: RemotePref): boolean {
  // A remote job, or either side being flexible, always works.
  if (job === "REMOTE" || job === "ANY" || cand === "ANY") return true;
  // Remote-only candidate + non-remote job: incompatible.
  if (cand === "REMOTE") return false;
  // Hybrid/onsite candidate against a hybrid or onsite job: workable.
  return true;
}

const yearsForLevel: Record<number, [number, number]> = {
  1: [0, 3],
  2: [2, 6],
  3: [5, 12],
  4: [8, 20],
  5: [10, 40],
};

export function score(i: ScoreInput): ScoreResult {
  const reasons: string[] = [];

  // ---- skills (55) ----
  const jobSet = i.jobSkills.map((s) => s.toLowerCase());
  const candSet = new Set(i.candidateSkills.map((s) => s.toLowerCase()));
  const shared = i.jobSkills.filter((s) => candSet.has(s.toLowerCase()));
  const missing = i.jobSkills.filter((s) => !candSet.has(s.toLowerCase()));
  const skillPts = jobSet.length ? (shared.length / jobSet.length) * 55 : 27;
  if (shared.length >= 3) reasons.push(`${shared.slice(0, 3).join(", ")} all line up`);
  else if (shared.length) reasons.push(`${shared.join(" + ")} overlap`);

  // ---- location (15) ----
  let locPts = 3;
  if (i.jobRemote === "REMOTE") {
    locPts = 15;
    reasons.push("Fully remote");
  } else if (remoteCompatible(i.jobRemote, i.candidateRemote)) {
    const same = metro(i.jobLocation) && metro(i.jobLocation) === metro(i.candidateLocation);
    locPts = same ? 15 : 8;
    if (same) reasons.push(`Both in ${i.jobLocation.split(",")[0].trim()}`);
  }

  // ---- compensation (20) ----
  let compPts = 8;
  const target = i.salaryTarget;
  const top = i.salaryMax ?? i.salaryMin;
  if (target && top) {
    if (top >= target) {
      compPts = 20;
      reasons.push(`Band clears your $${target}k target`);
    } else if (top >= target * 0.9) compPts = 12;
    else compPts = 2;
  } else if (!target || !top) {
    compPts = 10; // unknown on either side — don't punish
  }

  // ---- seniority (10) ----
  const rank = seniorityRank(i.jobSeniority);
  const [lo, hi] = yearsForLevel[rank] ?? [2, 6];
  let senPts = 10;
  if (i.candidateYears < lo) senPts = Math.max(0, 10 - (lo - i.candidateYears) * 3);
  else if (i.candidateYears > hi) senPts = Math.max(3, 10 - (i.candidateYears - hi) * 1.5);
  else reasons.push(`${i.candidateYears} yrs fits a ${i.jobSeniority} role`);

  const total = Math.max(1, Math.min(99, Math.round(skillPts + locPts + compPts + senPts)));

  return {
    score: total,
    sharedSkills: shared,
    missingSkills: missing,
    reasons: reasons.slice(0, 3),
    breakdown: {
      skills: Math.round(skillPts),
      location: Math.round(locPts),
      comp: Math.round(compPts),
      seniority: Math.round(senPts),
    },
  };
}

type JobLike = {
  skills: string[];
  location: string;
  remote: RemotePref;
  salaryMin: number | null;
  salaryMax: number | null;
  seniority: string;
};
type CandLike = {
  skills: string[];
  location: string | null;
  remotePref: RemotePref;
  salaryTarget: number | null;
  yearsExp: number;
};

export const scoreJobForCandidate = (job: JobLike, cand: CandLike): ScoreResult =>
  score({
    jobSkills: job.skills,
    candidateSkills: cand.skills,
    jobLocation: job.location,
    jobRemote: job.remote,
    candidateLocation: cand.location,
    candidateRemote: cand.remotePref,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    salaryTarget: cand.salaryTarget,
    jobSeniority: job.seniority,
    candidateYears: cand.yearsExp,
  });

/** Same signals, phrased from the hiring side. */
export const scoreCandidateForJob = scoreJobForCandidate;
