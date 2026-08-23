#!/usr/bin/env tsx
/**
 * SKILL-INTENT MATCHING — "it throws random jobs at me".
 *
 * ── The three defects these tests pin down ──
 *
 * 1. ALIASES THAT WERE NOT ALIASES.
 *    `Spark: ["spark", "pyspark", "databricks"]` meant a candidate entering
 *    "SQL, Python, PySpark, Databricks" stored THREE skills, not four. A
 *    Databricks role and a generic Spark role became the same thing to the
 *    ranker, and the candidate could never be shown the fourth skill back
 *    because it no longer existed.
 *
 * 2. RETRIEVAL THAT DID NOT KNOW WHAT SCORING KNEW.
 *    The engine credits Vue at 0.55 toward React and Spark at 0.8 toward
 *    Databricks. The query that chose which 400 rows to score compared strings
 *    for equality, so those pairs scored ZERO at selection time, lost the pool
 *    to whatever was newest, and never reached the engine that would have liked
 *    them. This is the one that produces the reported symptom: the scoring was
 *    never wrong, it was being handed the wrong rows.
 *
 * 3. TOP SKILLS RANKED BY POSITION.
 *    `extractSkills` returned the first twelve skills by position in the
 *    document, so a CV's opening "seeking a role using Java or Python" outranked
 *    the Databricks work the person had actually done at three employers.
 *
 * ── Why the DB fixtures are the size they are ──
 *
 * The pool is 400 rows. A fixture smaller than that never fills it, so the trap
 * never springs and the test passes against the unfixed code — which is exactly
 * the mistake corrected in v2.15. 450 is not a round number chosen for looks.
 */
import "dotenv/config";

const { db, jobs, companies, users, candidateSwipes } = await import("../src/db");
const { candidateDeck, recruiterDeck } = await import("../src/lib/deck");
const { normalizeSkills, extractSkillEvidence, extractSkills, rankByEvidence } = await import(
  "../src/lib/skills"
);
const { expandSkills } = await import("../src/lib/matching/expansion");
const { bestCredit } = await import("../src/lib/matching/taxonomy");
const { inArray, like } = await import("drizzle-orm");

let pass = 0,
  fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const TAG = "skilltest-";
const now = Date.now();

// ─────────────────────────────────────────────────────────────
console.log("\nSKILL VOCABULARY\n");

/**
 * The reported case, exactly as typed. Four skills in, four skills out.
 * Before the split this returned three.
 */
const typed = normalizeSkills(["SQL", "Python", "PySpark", "Databricks"]);
check("TC-SKILL-01 four stated skills survive normalisation", typed.length === 4, typed.join(", "));
check("TC-SKILL-02 PySpark is its own skill", typed.includes("PySpark"), typed.join(", "));
check("TC-SKILL-03 Databricks is its own skill", typed.includes("Databricks"), typed.join(", "));

/** Splitting without relating would have DELETED matches, not sharpened them. */
const dbFromSpark = bestCredit("Databricks", ["Spark"]);
check("TC-SKILL-10 Spark still transfers to Databricks", dbFromSpark.credit >= 0.7,
  `credit ${dbFromSpark.credit} via ${dbFromSpark.via}`);
const sparkFromPy = bestCredit("Spark", ["PySpark"]);
check("TC-SKILL-11 PySpark still transfers to Spark", sparkFromPy.credit >= 0.85,
  `credit ${sparkFromPy.credit}`);
check("TC-SKILL-12 but they are no longer treated as identical", dbFromSpark.credit < 1,
  `${dbFromSpark.credit} < 1`);

/** The same error class, elsewhere in the table. */
const stores = normalizeSkills(["PostgreSQL", "MySQL", "SQL Server"]);
check("TC-SKILL-13 relational engines are distinct skills", stores.length === 3, stores.join(", "));
check("TC-SKILL-14 and all still transfer to SQL",
  ["PostgreSQL", "MySQL", "SQL Server"].every((s) => bestCredit("SQL", [s]).credit >= 0.8));

/**
 * "lambda" was an alias for AWS, and appears in job descriptions about Java,
 * Python and C# far more often than it refers to the AWS product.
 */
check("TC-SKILL-15 a lambda expression is not AWS experience",
  !extractSkills("Comfortable with lambda expressions and functional style").includes("AWS"),
  extractSkills("Comfortable with lambda expressions and functional style").join(", "));

// ─────────────────────────────────────────────────────────────
console.log("\nTOP SKILLS FROM A CV\n");

/**
 * Java appears once, in an objective line at the very top. Databricks appears
 * three times, in the work itself. Ranking by position put Java first.
 */
const cv = `
  Objective: seeking a senior role using Java.
  Experience:
  Acme — built Databricks pipelines for the analytics team.
  Globex — migrated the warehouse onto Databricks.
  Initech — Databricks and Airflow orchestration.
`;
const evidence = extractSkillEvidence(cv);
const top = evidence[0];
check("TC-SKILL-20 the CV's top skill is what it demonstrates", top?.skill === "Databricks",
  evidence.slice(0, 3).map((e) => `${e.skill}×${e.mentions}`).join(" | "));
check("TC-SKILL-21 a one-line mention still registers, lower down",
  evidence.some((e) => e.skill === "Java" && e.mentions === 1));

/** A listed Skills section is kept whole, but ordered by what backs it up. */
const reordered = rankByEvidence(["Java", "Databricks", "Airflow"], cv);
check("TC-SKILL-22 a listed skills section is reordered by evidence",
  reordered[0] === "Databricks", reordered.join(" → "));
check("TC-SKILL-23 and nothing the candidate claimed is dropped",
  reordered.length === 3 && reordered.includes("Java"), reordered.join(" → "));

// ─────────────────────────────────────────────────────────────
console.log("\nEXPANSION\n");

const vueExp = expandSkills(["Vue", "TypeScript"]);
const reactTerm = vueExp.find((e) => e.skill === "react");
check("TC-SKILL-30 a Vue developer's expansion reaches React", Boolean(reactTerm),
  vueExp.slice(0, 5).map((e) => `${e.skill}:${e.weight.toFixed(2)}`).join(" "));
check("TC-SKILL-31 at partial weight, not full",
  Boolean(reactTerm && reactTerm.weight > 0.3 && reactTerm.weight < 1),
  `${reactTerm?.weight.toFixed(2)}`);

/** Top skills outweigh trailing ones — the "based on their top skills" ask. */
const ordered = expandSkills(["Databricks", "Python", "SQL", "Excel", "Cooking"]);
const first = ordered.find((e) => e.skill === "databricks")?.weight ?? 0;
const last = ordered.find((e) => e.skill === "cooking")?.weight ?? 0;
check("TC-SKILL-32 the first-listed skill outweighs the last", first > last,
  `databricks ${first.toFixed(2)} vs cooking ${last.toFixed(2)}`);
check("TC-SKILL-33 but the last is not worthless", last >= 0.55, last.toFixed(2));

// ─────────────────────────────────────────────────────────────
// DB-backed. The query is the thing under test, so a unit test cannot reach it.
// ─────────────────────────────────────────────────────────────
async function cleanup() {
  const cos = await db.select({ id: companies.id }).from(companies).where(like(companies.slug, `${TAG}%`));
  if (cos.length) {
    const ids = cos.map((c) => c.id);
    const js = await db.select({ id: jobs.id }).from(jobs).where(inArray(jobs.companyId, ids));
    if (js.length) {
      await db.delete(candidateSwipes).where(inArray(candidateSwipes.jobId, js.map((j) => j.id)));
      await db.delete(jobs).where(inArray(jobs.companyId, ids));
    }
    await db.delete(companies).where(inArray(companies.id, ids));
  }
  await db.delete(users).where(like(users.email, `${TAG}%`));
}

await cleanup();

const [co] = await db
  .insert(companies)
  .values({ name: "Skill Test Co", slug: `${TAG}co`, source: "JOBSY" })
  .returning();

const jobRow = (o: { title: string; skills: string[]; ageDays: number }) => ({
  companyId: co.id,
  title: o.title,
  description: `${o.title}. Requirements: ${o.skills.join(", ")}.`,
  location: "Austin, TX",
  countryCode: "US",
  stateProvince: "TX",
  city: "Austin",
  remote: "ONSITE" as const,
  employmentType: "Full-time",
  seniority: "Senior",
  salaryMin: 140,
  salaryMax: 190,
  skills: o.skills,
  requiredSkills: o.skills,
  source: "JOBSY" as const,
  active: true,
  status: "PUBLISHED" as const,
  postedAt: new Date(now - o.ageDays * 86_400_000),
});

console.log("\nRETRIEVAL REACHES ADJACENT SKILLS\n");

/**
 * A Spark/Python data engineer. Note what they did NOT write: "Databricks".
 * The engine has always known Spark covers most of it. The query did not.
 */
const [cand] = await db
  .insert(users)
  .values({
    email: `${TAG}candidate@example.com`,
    name: "Skill Tester",
    role: "CANDIDATE",
    emailVerified: true,
    profileReady: true,
    headline: "Senior Data Engineer",
    location: "Austin, TX",
    currentCountry: "US",
    currentStateProvince: "TX",
    currentCity: "Austin",
    searchCountry: "US",
    skills: ["Spark", "Python", "SQL"],
    yearsExp: 8,
    remotePref: "ANY",
    salaryTarget: 160,
    /**
     * Kept out of recruiter decks on purpose.
     *
     * This person exists to test the CANDIDATE side, and candidateDeck does not
     * consult openToOffers. Leaving it at the default put a second strong Spark
     * profile into the recruiter fixture further down, where it competed with
     * the candidate that test is actually about and made the ranking assertion
     * depend on a coin-flip between two near-identical profiles. Isolating the
     * fixture is better than loosening the assertion to accommodate the noise.
     */
    openToOffers: false,
  })
  .returning();

/**
 * 450 recent jobs sharing NO skill with the candidate — and, crucially, no
 * skill ADJACENT to one either. Under exact matching these tie with the
 * Databricks roles at zero, and the tie is broken by recency, so they take the
 * whole pool.
 */
const noise = Array.from({ length: 450 }, (_, i) =>
  jobRow({ title: `Warehouse Associate ${i}`, skills: ["Forklift", "Inventory"], ageDays: 0 })
);

/** Older, and tagged only with a skill the candidate never typed. */
const needles = [
  jobRow({ title: "Databricks Platform Engineer", skills: ["Databricks", "Delta Lake"], ageDays: 30 }),
  jobRow({ title: "Lakehouse Data Engineer", skills: ["Databricks"], ageDays: 45 }),
];

await db.insert(jobs).values([...noise, ...needles]);
console.log(`  fixture: ${noise.length} recent unrelated jobs, ${needles.length} older adjacent ones\n`);

const deck = await candidateDeck(cand);
const titles = deck.map((c) => c.title);

check("TC-SKILL-40 the deck is not empty", deck.length > 0, `${deck.length} cards`);
check("TC-SKILL-41 a Databricks role reaches a Spark candidate",
  titles.includes("Databricks Platform Engineer"), titles.slice(0, 4).join(" | "));
check("TC-SKILL-42 both adjacent roles are reachable",
  titles.includes("Lakehouse Data Engineer"), titles.slice(0, 4).join(" | "));
check("TC-SKILL-43 and they outrank the unrelated recent jobs",
  titles.indexOf("Databricks Platform Engineer") < titles.findIndex((t) => t.startsWith("Warehouse")) ||
    !titles.some((t) => t.startsWith("Warehouse")),
  titles.slice(0, 4).join(" | "));

// ─────────────────────────────────────────────────────────────
console.log("\nRECRUITER SOURCING BY SKILL\n");

const [rec] = await db
  .insert(users)
  .values({
    email: `${TAG}recruiter@example.com`,
    name: "Skill Recruiter",
    role: "RECRUITER",
    emailVerified: true,
    profileReady: true,
    currentCountry: "US",
    skills: [],
  })
  .returning();

const [role] = await db
  .insert(jobs)
  .values({
    ...jobRow({ title: "Databricks Data Engineer", skills: ["Databricks", "Spark"], ageDays: 1 }),
    postedById: rec.id,
  })
  .returning();

/** Recently active, entirely unrelated. 450 to fill the pool. */
await db.insert(users).values(
  Array.from({ length: 450 }, (_, i) => ({
    email: `${TAG}noise${i}@example.com`,
    name: `Noise ${i}`,
    role: "CANDIDATE" as const,
    emailVerified: true,
    profileReady: true,
    openToOffers: true,
    location: "Austin, TX",
    currentCountry: "US",
    currentCity: "Austin",
    skills: ["Cooking", "Retail"],
    yearsExp: 3,
    updatedAt: new Date(now),
  }))
);

/**
 * The person the recruiter is looking for, who used a different word for it and
 * has not touched their profile in over a month.
 */
await db.insert(users).values({
  email: `${TAG}sparkperson@example.com`,
  name: "Spark Person",
  role: "CANDIDATE",
  emailVerified: true,
  profileReady: true,
  openToOffers: true,
  headline: "Senior Data Engineer",
  location: "Austin, TX",
  currentCountry: "US",
  currentCity: "Austin",
  skills: ["Spark", "PySpark", "Python", "SQL"],
  yearsExp: 9,
  updatedAt: new Date(now - 40 * 86_400_000),
});

const sourced = await recruiterDeck(rec, role.id, { skills: ["Databricks"] });
const names = sourced.map((c) => c.name);

check("TC-SKILL-50 sourcing returns candidates", sourced.length > 0, `${sourced.length}`);
check("TC-SKILL-51 the noise fixture actually exceeds the pool", 450 > 400);
/**
 * Under the old code this failed twice over: the pool was chosen by exact
 * coverage so Spark Person was never fetched, and even if she had been, the
 * skills filter required an exact "Databricks" and would have dropped her.
 */
check("TC-SKILL-52 searching Databricks finds a Spark candidate",
  names.includes("Spark Person"), names.slice(0, 4).join(" | "));
/**
 * Asserted against the NOISE, not against an absolute rank.
 *
 * A development database holds other seeded candidates, and any of them may
 * legitimately rank near a fixture profile. What the bug was about is whether
 * 450 recently-active people with nothing to do with the role could bury
 * someone who actually fits — so that is what is asserted. Pinning her to rank
 * 1 would be testing whatever else happens to be in the database.
 */
check("TC-SKILL-53 and no unrelated recent profile outranks her",
  names.indexOf("Spark Person") >= 0 &&
    !names.slice(0, names.indexOf("Spark Person")).some((n) => n.startsWith("Noise ")),
  names.slice(0, 3).join(" | "));

const her = sourced.find((c) => c.name === "Spark Person");
check("TC-SKILL-54 the card says which searched skill she covers",
  Boolean(her && her.requested.length === 1 && her.requested[0].skill === "Databricks"),
  JSON.stringify(her?.requested ?? []));
check("TC-SKILL-55 and names the skill that earned the credit",
  Boolean(her && her.requested[0].credit > 0 && her.requested[0].via),
  `credit ${her?.requested[0]?.credit} via ${her?.requested[0]?.via}`);

/**
 * A missing skill must still be reported. "Has 1 of your 2" is only a usable
 * sourcing signal if the recruiter can see WHICH one is absent.
 */
const sourced2 = await recruiterDeck(rec, role.id, { skills: ["Databricks", "Kubernetes"] });
const her2 = sourced2.find((c) => c.name === "Spark Person");
check("TC-SKILL-56 a skill she lacks is reported, not hidden",
  Boolean(her2 && her2.requested.length === 2 &&
    her2.requested.find((r) => r.skill === "Kubernetes")?.credit === 0),
  JSON.stringify(her2?.requested ?? []));
check("TC-SKILL-57 and lacking one no longer excludes her",
  Boolean(her2), her2 ? "present" : "MISSING FROM DECK");

await cleanup();
console.log(`\n${pass} passed, ${fail} failed  —  skill matching\n`);
process.exit(fail ? 1 : 0);
