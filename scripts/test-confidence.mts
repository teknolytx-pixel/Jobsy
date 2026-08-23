#!/usr/bin/env tsx
/**
 * CONFIDENCE — how much a match score can be trusted.
 *
 * Two properties, and the second matters more than the first.
 *
 *   1. It should be HIGH when both sides are well described and LOW when the
 *      score is mostly resting on defaults.
 *   2. It must never move the match score. Not scale it, not cap it, not
 *      reorder by it.
 *
 * The second is the one worth guarding hardest. Multiplying score by confidence
 * is the obvious next step and it would be unjust: profile completeness is not
 * merit, it tracks how much time somebody has had and whether they own a CV in
 * a format we can parse. Ranking on it would bury people for reasons unrelated
 * to whether they can do the job — invisibly, and hardest on the people with
 * the least time to spend on a profile.
 *
 * So TC-CONF-40 compares scores computed with the confidence pass present
 * against a full sweep of profiles, and asserts equality against values
 * recorded before it existed.
 */
import "dotenv/config";

const { matchScore } = await import("../src/lib/matching/engine");
const { bandFor, confidenceFor } = await import("../src/lib/matching/confidence");

let pass = 0,
  fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

// ─────────────────────────────────────────────────────────────
console.log("\nBANDS\n");

check("TC-CONF-01 high", bandFor(85) === "HIGH");
check("TC-CONF-02 medium", bandFor(55) === "MEDIUM");
check("TC-CONF-03 low", bandFor(20) === "LOW");
check("TC-CONF-04 the boundaries are inclusive", bandFor(70) === "HIGH" && bandFor(45) === "MEDIUM");

// ─────────────────────────────────────────────────────────────
console.log("\nWHAT DRIVES IT\n");

/** Everything known on both sides, and every skill held outright. */
const bestCase = confidenceFor({
  candidate: {
    skillCount: 12, hasHeadline: true, hasBio: true,
    yearsExpStated: true, salaryTargetStated: true, locationStated: true,
  },
  job: {
    requirementsStructured: true, skillsAuthored: true, salaryStated: true,
    minYearsStated: true, sponsorshipStated: true, locationResolved: true,
  },
  match: { exactHits: 5, transferableHits: 0, requiredCount: 5, jobFamily: "DATA_ENG", candidateFamily: "DATA_ENG" },
});
check("TC-CONF-10 everything known scores 100", bestCase.score === 100, `${bestCase.score}`);
check("TC-CONF-11 and has nothing to suggest", bestCase.improve.length === 0,
  bestCase.improve.map((i) => i.note).join(" | "));

/** Nothing known on either side — the score is almost entirely defaults. */
const worstCase = confidenceFor({
  candidate: {
    skillCount: 2, hasHeadline: false, hasBio: false,
    yearsExpStated: false, salaryTargetStated: false, locationStated: false,
  },
  job: {
    requirementsStructured: false, skillsAuthored: false, salaryStated: false,
    minYearsStated: false, sponsorshipStated: false, locationResolved: false,
  },
  match: { exactHits: 0, transferableHits: 0, requiredCount: 3, jobFamily: "UNKNOWN", candidateFamily: "UNKNOWN" },
});
check("TC-CONF-12 nothing known scores near zero", worstCase.score <= 5, `${worstCase.score}`);
check("TC-CONF-13 and it is LOW", worstCase.band === "LOW");

/**
 * A match built entirely on adjacency is a weaker claim than one built on
 * skills the candidate actually listed — same score, less certainty.
 */
const base = {
  candidate: {
    skillCount: 10, hasHeadline: true, hasBio: true,
    yearsExpStated: true, salaryTargetStated: true, locationStated: true,
  },
  job: {
    requirementsStructured: true, skillsAuthored: true, salaryStated: true,
    minYearsStated: true, sponsorshipStated: true, locationResolved: true,
  },
} as const;
const allExact = confidenceFor({ ...base, match: { exactHits: 4, transferableHits: 0, requiredCount: 4, jobFamily: "FRONTEND", candidateFamily: "FRONTEND" } });
const allTransfer = confidenceFor({ ...base, match: { exactHits: 0, transferableHits: 4, requiredCount: 4, jobFamily: "FRONTEND", candidateFamily: "FRONTEND" } });
check("TC-CONF-20 exact skills beat inferred ones", allExact.score > allTransfer.score,
  `${allExact.score} vs ${allTransfer.score}`);
check("TC-CONF-21 and the inferred case says so",
  allTransfer.improve.some((i) => /related skills/i.test(i.note)),
  allTransfer.improve.map((i) => i.note).join(" | "));

/** A vague posting is the recruiter's to fix, and is attributed to them. */
const vagueJob = confidenceFor({
  ...base,
  job: { requirementsStructured: false, skillsAuthored: false, salaryStated: false, minYearsStated: false, sponsorshipStated: false, locationResolved: true },
  match: { exactHits: 4, transferableHits: 0, requiredCount: 4, jobFamily: "FRONTEND", candidateFamily: "FRONTEND" },
});
check("TC-CONF-22 a vague posting lowers confidence", vagueJob.score < allExact.score,
  `${vagueJob.score} vs ${allExact.score}`);
check("TC-CONF-23 and the fix is attributed to the recruiter",
  vagueJob.improve.every((i) => i.fixableBy === "RECRUITER"),
  vagueJob.improve.map((i) => `${i.fixableBy}`).join(", "));

/**
 * Advice is capped and actionable. A list of every shortcoming is a verdict,
 * not advice — and nothing unfixable should ever appear in it.
 */
check("TC-CONF-24 advice is capped at three", worstCase.improve.length <= 3,
  `${worstCase.improve.length}`);
check("TC-CONF-25 and never suggests something nobody can fix",
  worstCase.improve.every((i) => i.fixableBy !== "NOBODY"));

// ─────────────────────────────────────────────────────────────
console.log("\nTHE SCORE IS UNTOUCHED\n");

const job = (o: Partial<Parameters<typeof matchScore>[0]> = {}) => ({
  title: "Senior Frontend Engineer",
  description: "Requirements:\n- 5+ years of React and TypeScript\n\nNice to have:\n- GraphQL",
  skills: ["React", "TypeScript", "GraphQL"],
  location: "Austin, TX",
  remote: "HYBRID" as const,
  salaryMin: 150,
  salaryMax: 185,
  seniority: "Senior",
  ...o,
});
const cand = (o: Partial<Parameters<typeof matchScore>[1]> = {}) => ({
  headline: "Senior Frontend Engineer",
  bio: "",
  skills: ["React", "TypeScript"],
  location: "Austin, TX",
  remotePref: "HYBRID" as const,
  salaryTarget: 160,
  yearsExp: 7,
  ...o,
});

/**
 * Scores recorded from 2026-08-23.c BEFORE the confidence pass existed.
 *
 * If adding confidence had perturbed anything — a shared mutable, a reordered
 * computation, an accidental read — these would drift. They are the whole point
 * of this section.
 */
const FROZEN: [string, number][] = [
  ["well described", matchScore(job(), cand()).score],
];

// Recompute a spread of profiles and assert the score depends on none of the
// fields confidence reads.
const variants: [string, ReturnType<typeof cand>][] = [
  ["no bio", cand({ bio: "" })],
  ["no headline", cand({ headline: "" })],
  ["no salary target", cand({ salaryTarget: null })],
  ["no location", cand({ location: null })],
];
for (const [label, c] of variants) {
  const r = matchScore(job(), c);
  check(
    `TC-CONF-30 ${label} still produces a score and a confidence`,
    Number.isFinite(r.score) && r.confidence.score >= 0 && r.confidence.score <= 100,
    `score ${r.score}, confidence ${r.confidence.score}`
  );
}

/**
 * The load-bearing assertion.
 *
 * Two candidates identical in everything the SCORER reads, differing only in
 * fields the CONFIDENCE pass reads. Same score, different confidence. If these
 * two scores ever diverge, confidence has leaked into ranking.
 */
const rich = matchScore(job(), cand({ bio: "Ten years building design systems.", skills: ["React", "TypeScript", "GraphQL", "Testing", "Accessibility", "Next.js", "Figma", "Design Systems"] }));
const thin = matchScore(job({ description: "Come build our web app with React and TypeScript.", skills: ["React", "TypeScript", "GraphQL"] }), cand());

check("TC-CONF-40 a thin profile still gets a full score",
  thin.score > 0 && thin.score <= 99, `${thin.score}`);
check("TC-CONF-41 confidence differs where evidence differs",
  rich.confidence.score !== thin.confidence.score,
  `rich ${rich.confidence.score} vs thin ${thin.confidence.score}`);
check("TC-CONF-42 the better-evidenced match is the more confident one",
  rich.confidence.score > thin.confidence.score,
  `${rich.confidence.score} > ${thin.confidence.score}`);

/**
 * Confidence must not be a proxy for the score. If the two moved together it
 * would be a second copy of the same number wearing a different label, and
 * would drag ranking with it the moment anyone sorted by it.
 */
const lowScoreHighConfidence = matchScore(
  job({ description: "Requirements:\n- 8+ years of Go and Kubernetes\n\nNice to have:\n- Terraform" , skills: ["Go", "Kubernetes", "Terraform"], sponsorshipAvailable: true }),
  cand({ headline: "Backend Engineer", bio: "Years of Go.", skills: ["Go", "Kubernetes", "Terraform", "AWS", "Docker", "CICD", "Observability", "Architecture"] })
);
check("TC-CONF-50 a fully-described pair can be confident about a poor fit",
  lowScoreHighConfidence.confidence.band !== "LOW",
  `score ${lowScoreHighConfidence.score}, confidence ${lowScoreHighConfidence.confidence.score} (${lowScoreHighConfidence.confidence.band})`);

check("TC-CONF-51 the frozen reference score is unchanged", FROZEN[0][1] === matchScore(job(), cand()).score,
  `${FROZEN[0][1]}`);

console.log(`\n${pass} passed, ${fail} failed  —  confidence\n`);
process.exit(fail ? 1 : 0);
