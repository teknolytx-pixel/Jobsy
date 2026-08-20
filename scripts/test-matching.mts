/**
 * Match-engine tests.
 *
 * Written as scenarios a recruiter would recognise, not unit tests of internals
 * — the point is whether the RANKING is defensible, which is also what a bias
 * auditor asks. No network, no database.
 *
 *   npx tsx scripts/test-matching.mts
 */
import "dotenv/config";
import type { CandidateInput, JobInput } from "../src/lib/matching/engine";

// Dynamic imports: tsx loads .ts through the CJS bridge, and a static named
// import from a .mts ESM entry point doesn't see those exports.
const { matchScore } = await import("../src/lib/matching/engine");
const { parseRequirements, extractMinYears } = await import("../src/lib/matching/requirements");
const { roleFamily, skillCredit, familyCompatibility } = await import("../src/lib/matching/taxonomy");

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const job = (o: Partial<JobInput>): JobInput => ({
  title: "Senior Frontend Engineer",
  description: "Build the web app.",
  skills: ["React", "TypeScript"],
  location: "Austin, TX",
  remote: "HYBRID",
  salaryMin: 150,
  salaryMax: 185,
  seniority: "Senior",
  ...o,
});

const cand = (o: Partial<CandidateInput>): CandidateInput => ({
  headline: "Senior Frontend Engineer",
  bio: "",
  skills: ["React", "TypeScript"],
  location: "Austin, TX",
  remotePref: "HYBRID",
  salaryTarget: 160,
  yearsExp: 7,
  ...o,
});

// ─────────────────────────────────────────────────────────────
console.log("\nTHE BUGS THAT MOTIVATED THE REWRITE\n");

// 1. Designer vs backend role — coincidental token overlap
const designerOnBackend = matchScore(
  job({
    title: "Senior Backend Engineer",
    description: "Own our API. Requirements: Go, Postgres, Kafka, Design Systems knowledge helpful.",
    skills: ["Go", "SQL", "Kafka", "Design Systems"],
  }),
  cand({ headline: "Product Designer", skills: ["Figma", "Design Systems", "Prototyping", "User Research"] })
);
check("Designer does NOT rank well on a backend role", designerOnBackend.score < 35,
  `${designerOnBackend.score}% (families ${designerOnBackend.candidateFamily}→${designerOnBackend.jobFamily}, fit ${designerOnBackend.familyFit})`);
check("...and the mismatch is stated as a concern",
  designerOnBackend.concerns.some((c) => /background for a/i.test(c)),
  designerOnBackend.concerns[0]);

// 2. Vue dev on a React job — should get partial credit, not zero
const vueOnReact = matchScore(
  job({ description: "Requirements: 5+ years of React and TypeScript." }),
  cand({ skills: ["Vue", "TypeScript", "JavaScript"] })
);
const noSkillsAtAll = matchScore(
  job({ description: "Requirements: 5+ years of React and TypeScript." }),
  cand({ skills: ["Kubernetes", "Terraform"] })
);
check("Vue developer gets partial credit on a React role", vueOnReact.score > noSkillsAtAll.score + 15,
  `Vue ${vueOnReact.score}% vs unrelated ${noSkillsAtAll.score}%`);
check("...and the transfer is explained", vueOnReact.transferableSkills.some((t) => t.skill === "React" && t.via === "Vue"),
  vueOnReact.reasons.join(" · "));

// 3. Required beats preferred
const hasRequired = matchScore(
  job({
    description: "Requirements:\n5+ years of React and TypeScript.\n\nNice to have:\nKubernetes, GraphQL, Terraform.",
    skills: [],
  }),
  cand({ skills: ["React", "TypeScript"] })
);
const hasPreferredOnly = matchScore(
  job({
    description: "Requirements:\n5+ years of React and TypeScript.\n\nNice to have:\nKubernetes, GraphQL, Terraform.",
    skills: [],
  }),
  cand({ skills: ["Kubernetes", "GraphQL", "Terraform"], headline: "Senior Frontend Engineer" })
);
check("Must-haves outrank nice-to-haves", hasRequired.score > hasPreferredOnly.score + 20,
  `required-only ${hasRequired.score}% vs preferred-only ${hasPreferredOnly.score}%`);

// ─────────────────────────────────────────────────────────────
console.log("\nREQUIREMENT PARSING\n");

const parsed = parseRequirements({
  title: "Senior Frontend Engineer",
  skills: [],
  description: `About us:
We are a fast growing company.

Requirements:
- 5+ years of professional experience with React and TypeScript
- Strong SQL skills

Nice to have:
- Kubernetes and Terraform
- GraphQL

Benefits:
- Unlimited PTO and Docker discounts`,
});
check("Splits required from preferred",
  parsed.required.includes("React") && parsed.required.includes("TypeScript") && !parsed.required.includes("Kubernetes"),
  `required=[${parsed.required}]`);
check("Captures the preferred block", parsed.preferred.includes("Kubernetes") && parsed.preferred.includes("Terraform"),
  `preferred=[${parsed.preferred}]`);
check("Stops at the benefits heading", !parsed.required.includes("Docker") && !parsed.preferred.includes("Docker"),
  "Docker (in benefits) excluded");
check("Reads the years requirement", parsed.minYears === 5, String(parsed.minYears));
check("Flags that the posting was structured", parsed.structured === true);

check("Takes the lowest stated years", extractMinYears("3+ years required, 10 years preferred") === 3,
  String(extractMinYears("3+ years required, 10 years preferred")));
check("Handles 'at least N years'", extractMinYears("at least 7 years of experience") === 7);
check("Ignores absurd figures", extractMinYears("founded 30 years ago") === null);

const unstructured = parseRequirements({
  title: "Data Engineer",
  skills: ["dbt", "Snowflake"],
  description: "Come work with us on data pipelines using Python and SQL.",
});
check("Falls back to tagged skills when unstructured",
  unstructured.required.includes("dbt") && unstructured.structured === false,
  `required=[${unstructured.required}] preferred=[${unstructured.preferred}]`);

const db = parseRequirements({
  title: "Systems Engineer",
  skills: [],
  description: "Must be a US citizen. Active security clearance required. This role is 100% onsite.",
});
check("Detects dealbreakers", db.dealbreakers.length === 3,
  db.dealbreakers.map((d) => d.kind).join(","));

// ─────────────────────────────────────────────────────────────
console.log("\nHARD FILTERS\n");

const remoteOnlyOnOnsite = matchScore(
  job({ title: "Backend Engineer", remote: "ONSITE", location: "New York, NY" }),
  cand({ headline: "Backend Engineer", remotePref: "REMOTE", location: "Austin, TX" })
);
check("Remote-only candidate excluded from an onsite role", remoteOnlyOnOnsite.excluded === true,
  remoteOnlyOnOnsite.exclusionReason ?? "");
check("...and the score is floored so it can't surface", remoteOnlyOnOnsite.score <= 40,
  `${remoteOnlyOnOnsite.score}%`);

const localOnOnsite = matchScore(
  job({ remote: "ONSITE", location: "Austin, TX" }),
  cand({ location: "Austin, TX", remotePref: "HYBRID" })
);
check("Local candidate NOT excluded from the same onsite role", localOnOnsite.excluded === false,
  `${localOnOnsite.score}%`);

// ─────────────────────────────────────────────────────────────
console.log("\nEXPERIENCE, COMP, WORK STYLE\n");

const under = matchScore(job({ description: "Requirements: 8+ years experience with React." }), cand({ yearsExp: 2 }));
const meets = matchScore(job({ description: "Requirements: 8+ years experience with React." }), cand({ yearsExp: 9 }));
check("Under-experienced scores below qualified", under.score < meets.score, `${under.score}% vs ${meets.score}%`);
check("...and says why", under.concerns.some((c) => /vs 8 required/.test(c)), under.concerns.join(" · "));

const wayOver = matchScore(job({ description: "Requirements: 2+ years experience with React." }), cand({ yearsExp: 18 }));
check("Heavily over-levelled is flagged, not rewarded",
  wayOver.concerns.some((c) => /over-levelled/.test(c)), wayOver.concerns.join(" · "));

const underpaid = matchScore(job({ salaryMin: 90, salaryMax: 110 }), cand({ salaryTarget: 180 }));
const paysWell = matchScore(job({ salaryMin: 170, salaryMax: 200 }), cand({ salaryTarget: 160 }));
check("Comp below target hurts", underpaid.breakdown.compensation < paysWell.breakdown.compensation,
  `${underpaid.breakdown.compensation} vs ${paysWell.breakdown.compensation}`);

const noComp = matchScore(job({ salaryMin: null, salaryMax: null }), cand({ salaryTarget: 160 }));
check("Undisclosed comp stays neutral, not zero", noComp.breakdown.compensation > 5,
  `${noComp.breakdown.compensation}/16 — most ingested jobs hide comp`);

const remoteJob = matchScore(job({ remote: "REMOTE", location: "San Francisco, CA" }), cand({ location: "Austin, TX", remotePref: "REMOTE" }));
check("Remote job works for a remote candidate in another city", remoteJob.breakdown.workStyle === 14,
  `${remoteJob.breakdown.workStyle}/14`);

// ─────────────────────────────────────────────────────────────
console.log("\nTAXONOMY\n");

check("Exact skill = full credit", skillCredit("React", "React") === 1);
check("Related skill = partial", skillCredit("React", "Vue") > 0 && skillCredit("React", "Vue") < 1,
  String(skillCredit("React", "Vue")));
check("Unrelated skill = zero", skillCredit("React", "Kubernetes") === 0);
check("Adjacency is symmetric", skillCredit("TypeScript", "JavaScript") === skillCredit("JavaScript", "TypeScript"));
check("No transitive reach (React→Vue→Svelte stays 0 for unrelated pairs)",
  skillCredit("Kubernetes", "Figma") === 0);

check("Title drives family", roleFamily("Senior iOS Engineer") === "MOBILE", roleFamily("Senior iOS Engineer"));
check("Specific beats generic", roleFamily("Data Engineer") === "DATA_ENG", roleFamily("Data Engineer"));
check("Designer classified", roleFamily("Product Designer") === "DESIGN");
check("Unclassifiable stays UNKNOWN", roleFamily("Chief Vibes Officer") === "UNKNOWN");
check("Same family = full compatibility", familyCompatibility("BACKEND", "BACKEND") === 1);
check("Adjacent families partial", familyCompatibility("BACKEND", "FULLSTACK") > 0.5);
check("Distant families penalised hard", familyCompatibility("BACKEND", "DESIGN") < 0.4,
  String(familyCompatibility("BACKEND", "DESIGN")));
check("UNKNOWN is neutral, never punitive", familyCompatibility("BACKEND", "UNKNOWN") === 0.8,
  "an unusual job title must not silently bury someone");

// ─────────────────────────────────────────────────────────────
console.log("\nEXPLAINABILITY (required for a bias audit)\n");

const full = matchScore(
  job({ description: "Requirements:\n5+ years of React, TypeScript and GraphQL.\n\nNice to have:\nTesting." }),
  cand({ skills: ["React", "TypeScript", "Vue"], yearsExp: 6 })
);
const sum =
  full.breakdown.requiredSkills + full.breakdown.preferredSkills + full.breakdown.experience +
  full.breakdown.compensation + full.breakdown.workStyle;
check("Breakdown reconstructs the score", Math.abs(sum - full.score) <= 3, `parts ${sum} vs score ${full.score}`);
check("Every score carries a reason", full.reasons.length > 0, full.reasons.join(" · "));
check("Gaps are named, not hidden", full.missingSkills.length > 0, `missing: ${full.missingSkills.join(",")}`);
check("Transferable credit records its provenance",
  full.transferableSkills.every((t) => t.via !== null),
  full.transferableSkills.map((t) => `${t.via}→${t.skill}@${t.credit}`).join(", "));

// determinism — same inputs must always give the same score, or an audit is meaningless
const a = matchScore(job({}), cand({}));
const b = matchScore(job({}), cand({}));
check("Deterministic", a.score === b.score && JSON.stringify(a.breakdown) === JSON.stringify(b.breakdown));

// bounds
const extremes = [
  matchScore(job({ skills: [], description: "" }), cand({ skills: [] })),
  matchScore(job({}), cand({ skills: [], yearsExp: 0, salaryTarget: 2000 })),
  matchScore(job({}), cand({ yearsExp: 60 })),
];
check("Score always within 1..99", extremes.every((r) => r.score >= 1 && r.score <= 99),
  extremes.map((r) => r.score).join(","));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
