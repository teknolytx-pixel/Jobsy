import type { RemotePref } from "@/db";
import { seniorityRank } from "../skills";
import {
  FAMILY_LABEL,
  bestCredit,
  familyCompatibility,
  roleFamily,
  type RoleFamily,
} from "./taxonomy";
import { parseRequirements, type Dealbreaker, type Requirements } from "./requirements";

/**
 * THE MATCH ENGINE
 *
 * Every score decomposes into named features with visible weights. That is a
 * deliberate constraint, not a limitation of ambition: Jobsy ranks candidates
 * for employers, which makes it an Automated Employment Decision Tool under
 * NYC Local Law 144 and Colorado SB 24-205. Those require an annual
 * independent bias audit and an explanation of adverse decisions. You cannot
 * audit a number you cannot decompose.
 *
 * FEATURES NEVER USED, BY DESIGN — name, photo, school, graduation year, exact
 * address, age, gender, or anything correlated with them. Location is used only
 * as commute feasibility (same metro / remote-compatible), never as a
 * neighbourhood signal.
 *
 *   required skills   40   weighted by how central each is, partial credit for
 *                          adjacent skills (Vue counts toward React)
 *   preferred skills  12   the "nice to have" block
 *   role family        —   MULTIPLIER on both skill scores, not points
 *   experience        18   years vs what the posting actually asks for
 *   compensation      16   does the band clear the candidate's target
 *   work style        14   remote/hybrid/onsite feasibility
 *                    ────
 *                     100
 */

/**
 * NFR-005 / NFR-009 / §10.3 — the scoring model, versioned.
 *
 * These numbers decide who gets seen. That makes them the single most
 * consequential constant in the product, and until now they were an unlabelled
 * literal: nothing recorded which weights produced a given match, so "was this
 * candidate ranked under the old model or the new one?" had no answer.
 *
 * That question is not academic. NYC Local Law 144 requires an annual bias
 * audit of an automated employment decision tool, and an audit is of a specific
 * model. Without a version stamp on each result there is no way to say which
 * model an audit covered, or to re-run last quarter's rankings after a change.
 *
 * ── The rule when changing these ──
 *
 * Any change to a weight, or to how a component is computed, is a NEW VERSION.
 * Bump MODEL_VERSION in the same commit. The date is the release date, and the
 * suffix distinguishes more than one change in a day.
 *
 * The values below deliberately differ from the table in FSD v1.0 §10.3
 * (35/15/15/10/10/5/5/5), which described eight components this engine does not
 * have. Reconciling the two is a product decision, not a refactor — and now
 * that the model is versioned, making that change is a traceable event rather
 * than a silent edit.
 */
/**
 * 2026-08-22.a — required vs preferred may now be STATED by the recruiter
 * rather than inferred from the description prose. For any posting that states
 * them, the split feeding the 40-point and 12-point blocks changes, so scores
 * change. That is a new model by the rule three paragraphs above, and this is
 * the first time that rule has been exercised.
 */
export const MODEL_VERSION = "2026-08-22.a";

export const WEIGHTS = {
  requiredSkills: 40,
  preferredSkills: 12,
  experience: 18,
  compensation: 16,
  workStyle: 14,
} as const;

/** Sums to 100. A model whose components do not is not a percentage. */
export const WEIGHT_TOTAL = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

export type JobInput = {
  title: string;
  description: string;
  skills: string[];
  /**
   * MATCH-002 — the authored split, when the recruiter provided one.
   *
   * Optional because most jobs in the table are ingested from feeds and will
   * never have it. Absent means the requirements parser infers the split from
   * the description exactly as it always has.
   */
  requiredSkills?: string[] | null;
  preferredSkills?: string[] | null;
  location: string;
  remote: RemotePref;
  salaryMin: number | null;
  salaryMax: number | null;
  seniority: string;
};

export type CandidateInput = {
  headline?: string | null;
  bio?: string | null;
  skills: string[];
  location: string | null;
  remotePref: RemotePref;
  salaryTarget: number | null;
  yearsExp: number;
};

export type SkillHit = {
  skill: string;
  credit: number;
  /** Which of the candidate's skills earned the credit. */
  via: string | null;
  required: boolean;
};

export type MatchResult = {
  /**
   * NFR-005 — which model produced this. Carried on every result so a stored
   * score is never an orphan number: an audit, a dispute, or a candidate asking
   * "why was I ranked this way" can all be answered against a specific model.
   */
  modelVersion: string;
  /** What ranking uses. Floored when `excluded`, so an excluded pair can never
   *  surface even if a caller forgets to check the flag. */
  score: number;
  /** What the score WOULD have been ignoring hard filters. Kept because a bias
   *  audit needs to see that an exclusion was a filter decision, not a low
   *  score — those are very different things to have to justify. */
  rawScore: number;
  /** Set when a hard filter fired — the pair should not be shown at all. */
  excluded: boolean;
  exclusionReason: string | null;

  sharedSkills: string[];
  missingSkills: string[];
  /** Skills earned through adjacency rather than an exact match. */
  transferableSkills: SkillHit[];

  reasons: string[];
  concerns: string[];

  jobFamily: RoleFamily;
  candidateFamily: RoleFamily;
  familyFit: number;
  /** 0..1 — can this person do the job at all? Skills × role family. */
  qualification: number;
  /** 0..1 — the multiplier qualification applies to the logistics features. */
  relevance: number;

  breakdown: {
    requiredSkills: number;
    preferredSkills: number;
    experience: number;
    compensation: number;
    workStyle: number;
  };
  /** Kept for the older callers that expect these four keys. */
  requirements: Requirements;
};

const metro = (s: string | null | undefined): string =>
  (s ?? "").split(/[,–—]/)[0].trim().toLowerCase();

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Required skills are not equally important. A posting lists them roughly in
 * priority order, so weight earlier ones higher — 1.0 down to 0.6. This stops a
 * candidate acing five trailing "nice" skills while missing the headline one.
 */
function positionalWeight(index: number, total: number): number {
  if (total <= 1) return 1;
  return 1 - (index / (total - 1)) * 0.4;
}

function scoreSkillSet(
  needed: string[],
  candidateSkills: string[]
): { pct: number; hits: SkillHit[]; missing: string[] } {
  if (!needed.length) return { pct: 1, hits: [], missing: [] };

  let earned = 0;
  let possible = 0;
  const hits: SkillHit[] = [];
  const missing: string[] = [];

  needed.forEach((skill, i) => {
    const w = positionalWeight(i, needed.length);
    possible += w;
    const { credit, via } = bestCredit(skill, candidateSkills);
    if (credit > 0) {
      earned += credit * w;
      hits.push({ skill, credit, via, required: true });
    } else {
      missing.push(skill);
    }
  });

  return { pct: possible ? earned / possible : 1, hits, missing };
}

// ─────────────────────────────────────────────────────────────
// HARD FILTERS — exclude rather than downrank.
//
// A remote-only candidate shown a strictly-onsite job in another country isn't
// "a weak match", it's a waste of both sides' attention. But we only exclude on
// things the POSTING states, never on inference about the person.
// ─────────────────────────────────────────────────────────────
function hardFilter(
  job: JobInput,
  cand: CandidateInput,
  reqs: Requirements
): string | null {
  const onsiteOnly =
    job.remote === "ONSITE" || reqs.dealbreakers.some((d) => d.kind === "ONSITE_ONLY");

  if (onsiteOnly && cand.remotePref === "REMOTE") {
    const where = job.location.split(",")[0].trim();
    return `This role is onsite in ${where || "the office"} and you're remote-only`;
  }

  if (onsiteOnly && metro(job.location) && metro(cand.location) && metro(job.location) !== metro(cand.location)) {
    return `Onsite in ${job.location.split(",")[0].trim()}, which isn't your metro`;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
export function matchScore(job: JobInput, cand: CandidateInput): MatchResult {
  const reqs = parseRequirements(job);
  const reasons: string[] = [];
  const concerns: string[] = [];

  const jobFamily = roleFamily(job.title, job.description);
  const candidateFamily = roleFamily(cand.headline ?? "", cand.bio ?? "");
  const familyFit = familyCompatibility(jobFamily, candidateFamily);

  // ---- skills ----
  const req = scoreSkillSet(reqs.required, cand.skills);
  const pref = scoreSkillSet(reqs.preferred, cand.skills);

  // Family gates the skill score. Coincidental token overlap across professions
  // is the single biggest source of nonsense results.
  //
  // Most postings have no "nice to have" block at all. Scoring an empty set as
  // 100% would hand every candidate those points for free, so the weight moves
  // to the required skills instead of being given away.
  const hasPreferred = reqs.preferred.length > 0;
  const reqWeight = WEIGHTS.requiredSkills + (hasPreferred ? 0 : WEIGHTS.preferredSkills);
  const prefWeight = hasPreferred ? WEIGHTS.preferredSkills : 0;

  const requiredPts = req.pct * familyFit * reqWeight;
  const preferredPts = hasPreferred ? pref.pct * familyFit * prefWeight : 0;

  const exact = req.hits.filter((h) => h.credit === 1);
  const transferable = [...req.hits, ...pref.hits.map((h) => ({ ...h, required: false }))].filter(
    (h) => h.credit < 1
  );

  if (exact.length >= 3) {
    reasons.push(`${exact.slice(0, 3).map((h) => h.skill).join(", ")} — direct match`);
  } else if (exact.length) {
    reasons.push(`${exact.map((h) => h.skill).join(" + ")} match`);
  }
  if (transferable.length) {
    const t = transferable[0];
    reasons.push(`${t.via} transfers to ${t.skill}`);
  }
  if (req.missing.length) {
    concerns.push(
      req.missing.length <= 3
        ? `Missing ${req.missing.join(", ")}`
        : `Missing ${req.missing.slice(0, 3).join(", ")} +${req.missing.length - 3} more`
    );
  }
  if (familyFit < 0.5 && jobFamily !== "UNKNOWN" && candidateFamily !== "UNKNOWN") {
    concerns.push(`${FAMILY_LABEL[candidateFamily]} background for a ${FAMILY_LABEL[jobFamily]} role`);
  }

  // ---- experience ----
  // Prefer what the posting explicitly asks for; fall back to the seniority band.
  let expPts: number;
  const asked = reqs.minYears;
  if (asked != null) {
    if (cand.yearsExp >= asked) {
      // Being far over isn't free — it usually means comp mismatch or boredom.
      const over = cand.yearsExp - asked;
      expPts = over > 8 ? WEIGHTS.experience * 0.75 : WEIGHTS.experience;
      if (over > 8) concerns.push(`${cand.yearsExp} yrs against a ${asked}-year ask — may be over-levelled`);
      else reasons.push(`${cand.yearsExp} yrs meets the ${asked}-year requirement`);
    } else {
      const shortfall = asked - cand.yearsExp;
      expPts = clamp(WEIGHTS.experience * (1 - shortfall / Math.max(asked, 1)), 0, WEIGHTS.experience);
      concerns.push(`${cand.yearsExp} yrs vs ${asked} required`);
    }
  } else {
    const band: Record<number, [number, number]> = {
      1: [0, 3],
      2: [2, 6],
      3: [5, 12],
      4: [8, 20],
      5: [10, 40],
    };
    const [lo, hi] = band[seniorityRank(job.seniority)] ?? [2, 6];
    if (cand.yearsExp < lo) {
      expPts = clamp(WEIGHTS.experience - (lo - cand.yearsExp) * 4, 0, WEIGHTS.experience);
      concerns.push(`${cand.yearsExp} yrs is light for a ${job.seniority} role`);
    } else if (cand.yearsExp > hi) {
      expPts = clamp(WEIGHTS.experience - (cand.yearsExp - hi) * 1.5, WEIGHTS.experience * 0.4, WEIGHTS.experience);
    } else {
      expPts = WEIGHTS.experience;
      reasons.push(`${cand.yearsExp} yrs fits a ${job.seniority} role`);
    }
  }

  // ---- compensation ----
  let compPts: number;
  const target = cand.salaryTarget;
  const top = job.salaryMax ?? job.salaryMin;
  if (!target || !top) {
    // Unknown on either side. Neutral, not zero — most ingested jobs hide comp,
    // and punishing them would bury the entire external corpus.
    compPts = WEIGHTS.compensation * 0.6;
  } else if (top >= target) {
    compPts = WEIGHTS.compensation;
    reasons.push(`Pays to $${top}k, clearing your $${target}k target`);
  } else if (top >= target * 0.9) {
    compPts = WEIGHTS.compensation * 0.6;
    concerns.push(`Tops out at $${top}k vs your $${target}k target`);
  } else {
    compPts = WEIGHTS.compensation * 0.15;
    concerns.push(`Pays up to $${top}k — well under your $${target}k target`);
  }

  // ---- work style ----
  let workPts: number;
  const sameMetro = Boolean(metro(job.location)) && metro(job.location) === metro(cand.location);
  if (job.remote === "REMOTE") {
    workPts = WEIGHTS.workStyle;
    reasons.push("Fully remote");
  } else if (cand.remotePref === "ANY") {
    workPts = sameMetro ? WEIGHTS.workStyle : WEIGHTS.workStyle * 0.7;
  } else if (job.remote === "HYBRID") {
    workPts = sameMetro
      ? WEIGHTS.workStyle
      : cand.remotePref === "REMOTE"
        ? WEIGHTS.workStyle * 0.2
        : WEIGHTS.workStyle * 0.45;
    if (sameMetro) reasons.push(`Hybrid in ${job.location.split(",")[0].trim()} — your city`);
  } else {
    workPts = sameMetro ? WEIGHTS.workStyle * 0.9 : WEIGHTS.workStyle * 0.15;
    if (!sameMetro) concerns.push(`Onsite in ${job.location.split(",")[0].trim()}`);
  }

  // ---- dealbreakers we surface but don't silently apply ----
  for (const d of reqs.dealbreakers) {
    if (d.kind === "CLEARANCE") concerns.push("Requires a security clearance");
    if (d.kind === "WORK_AUTH") concerns.push("No visa sponsorship");
    if (d.kind === "LICENSE") concerns.push("Requires a professional licence");
  }

  // ---- qualification gates everything else ----
  //
  // Experience, pay and commute are worth 48 points between them. Left ungated,
  // any candidate in the right city with a plausible salary target floors near
  // 50% — a Product Designer scored 53% on a backend role purely on logistics.
  //
  // Those three only matter once someone can actually do the job, so scale them
  // by qualification. Multiplying the components (rather than capping the total)
  // keeps the score exactly equal to the sum of its parts, which is what makes
  // it explainable to a candidate and auditable by a third-party assessor.
  const qualification = clamp((requiredPts + preferredPts) / (reqWeight + prefWeight), 0, 1);
  const relevance = 0.25 + 0.75 * qualification;

  expPts *= relevance;
  compPts *= relevance;
  workPts *= relevance;

  const raw = requiredPts + preferredPts + expPts + compPts + workPts;
  const rawScore = clamp(Math.round(raw), 1, 99);

  const exclusion = hardFilter(job, cand, reqs);
  // Floor here, not at the call site. A hard filter that only sets a flag is a
  // filter that will eventually be ignored by some caller and leak through.
  const score = exclusion ? Math.min(rawScore, 5) : rawScore;

  return {
    modelVersion: MODEL_VERSION,
    score,
    rawScore,
    excluded: Boolean(exclusion),
    exclusionReason: exclusion,
    sharedSkills: [...exact.map((h) => h.skill), ...pref.hits.filter((h) => h.credit === 1).map((h) => h.skill)],
    missingSkills: req.missing,
    transferableSkills: transferable,
    reasons: exclusion ? [exclusion] : reasons.slice(0, 3),
    concerns: concerns.slice(0, 3),
    jobFamily,
    candidateFamily,
    familyFit,
    qualification: Number(qualification.toFixed(3)),
    relevance: Number(relevance.toFixed(3)),
    breakdown: {
      requiredSkills: Math.round(requiredPts),
      preferredSkills: Math.round(preferredPts),
      experience: Math.round(expPts),
      compensation: Math.round(compPts),
      workStyle: Math.round(workPts),
    },
    requirements: reqs,
  };
}

export type { Dealbreaker, Requirements };
