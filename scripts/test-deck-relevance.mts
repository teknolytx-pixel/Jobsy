#!/usr/bin/env tsx
/**
 * DECK RELEVANCE — the bug behind "it shows jobs from all over the world".
 *
 * ── What was wrong ──
 *
 * `candidateDeck()` selected its working set like this:
 *
 *     ORDER BY posted_at DESC LIMIT 400
 *
 * and then applied geography, sponsorship and skill scoring to whatever came
 * back. Every piece of intelligence in this codebase ran on a pool chosen by
 * recency alone.
 *
 * With ~1,000 jobs and nightly ingestion that is already broken, and it gets
 * worse every night: if 400 jobs anywhere on earth were posted more recently
 * than the roles a candidate could actually take, those roles were never
 * considered at all. Not ranked low — absent. The geo filter then removed most
 * of the pool as ineligible, so the deck came back thin, foreign, and unrelated
 * to the candidate's skills, which is exactly what was reported.
 *
 * Worse still, a job with no resolved country is INELIGIBLE (fail-closed, see
 * UNKNOWN_JOB_COUNTRY_IS_ELIGIBLE) but was still fetched, so unplaced rows
 * consumed pool slots and were then discarded.
 *
 * ── What these tests do ──
 *
 * Build exactly that trap: a pile of very recent jobs the candidate cannot take,
 * and a small number of older ones they can. A deck that only orders by recency
 * fails; one that selects for relevance passes.
 *
 * DB-backed on purpose. This is a query bug, and a pure unit test of the
 * scoring function would have passed happily throughout.
 */
import "dotenv/config";

// Inserts hundreds of fixture rows and deletes by tag prefix — never against
// a live database. See scripts/_not-production.mts.
const { assertNotProduction } = await import("./_not-production.mts");
assertNotProduction("deck relevance");
const { db, jobs, companies, users, candidateSwipes } = await import("../src/db");
const { candidateDeck } = await import("../src/lib/deck");
const { eq, inArray, like } = await import("drizzle-orm");

let pass = 0,
  fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const TAG = "decktest-";
const now = Date.now();

/** Everything this suite creates is prefixed, so cleanup cannot touch real rows. */
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
  .values({ name: "Deck Test Co", slug: `${TAG}co`, source: "JOBSY" })
  .returning();

/** A data engineer in Austin. Exactly the profile from the bug report. */
const [cand] = await db
  .insert(users)
  .values({
    email: `${TAG}candidate@example.com`,
    name: "Deck Tester",
    role: "CANDIDATE",
    emailVerified: true,
    profileReady: true,
    headline: "Senior Data Engineer",
    location: "Austin, TX",
    currentCountry: "US",
    currentStateProvince: "TX",
    currentCity: "Austin",
    searchCountry: "US",
    skills: ["Python", "SQL", "Spark", "Databricks"],
    yearsExp: 8,
    remotePref: "ANY",
    salaryTarget: 160,
  })
  .returning();

const jobRow = (o: {
  title: string;
  location: string;
  country: string | null;
  skills: string[];
  ageDays: number;
  remote?: "ONSITE" | "HYBRID" | "REMOTE" | "ANY";
  state?: string | null;
  city?: string | null;
}) => ({
  companyId: co.id,
  title: o.title,
  description: `${o.title}. Requirements: ${o.skills.join(", ")}.`,
  location: o.location,
  countryCode: o.country,
  stateProvince: o.state ?? null,
  city: o.city ?? null,
  remote: o.remote ?? "ONSITE",
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

/**
 * 450 very recent jobs the candidate cannot take: wrong country, wrong skills.
 * More than the old pool size, which is the whole point.
 */
const noise = Array.from({ length: 450 }, (_, i) =>
  jobRow({
    title: `Warehouse Associate ${i}`,
    location: "Manila, Philippines",
    country: "PH",
    skills: ["Forklift", "Inventory"],
    ageDays: 0,
  })
);

/** The needles: older, local, and a genuine skills match. */
const needles = [
  jobRow({
    title: "Senior Data Engineer",
    location: "Austin, TX",
    country: "US",
    state: "TX",
    city: "Austin",
    skills: ["Python", "SQL", "Spark", "Databricks"],
    ageDays: 30,
  }),
  jobRow({
    title: "Data Platform Engineer",
    location: "Austin, TX",
    country: "US",
    state: "TX",
    city: "Austin",
    skills: ["Python", "SQL", "Databricks"],
    ageDays: 45,
  }),
  jobRow({
    title: "Analytics Engineer (Remote US)",
    location: "Remote, United States",
    country: "US",
    state: null,
    city: null,
    remote: "REMOTE",
    skills: ["Python", "SQL"],
    ageDays: 60,
  }),
];

await db.insert(jobs).values([...noise, ...needles]);

console.log("\nDECK RELEVANCE\n");
console.log(`  fixture: ${noise.length} recent unusable jobs, ${needles.length} older relevant ones\n`);

const deck = await candidateDeck(cand);

check("TC-DECK-01 the deck is not empty", deck.length > 0, `${deck.length} cards`);

// The headline bug.
const foreign = deck.filter((c) => /Philippines/.test(c.location));
check("TC-DECK-10 no jobs the candidate cannot legally work", foreign.length === 0,
  `${foreign.length} foreign cards`);

const titles = deck.map((c) => c.title);
check("TC-DECK-11 the local senior role is present", titles.includes("Senior Data Engineer"),
  titles.slice(0, 5).join(" | "));
check("TC-DECK-12 the second local role is present", titles.includes("Data Platform Engineer"));
check("TC-DECK-13 the remote US role is present", titles.includes("Analytics Engineer (Remote US)"));

// Relevance, not just presence: the best match should lead.
check("TC-DECK-20 the strongest match ranks first", deck[0]?.title === "Senior Data Engineer",
  deck[0]?.title ?? "—");

/**
 * The TOP of the deck must be relevant; the tail may not be.
 *
 * Deliberately not "every card shares a skill". When a candidate's field is
 * thin, hard-excluding everything else leaves them an empty deck, which is a
 * worse product than a short list of strong matches followed by weaker ones
 * they can swipe past. The guarantee that matters is ordering: relevant first.
 */
const topThree = deck.slice(0, 3);
const offTopic = topThree.filter((c) => c.sharedSkills.length === 0);
check("TC-DECK-21 the top of the deck shares skills with the candidate", offTopic.length === 0,
  offTopic.map((c) => c.title).join(" | "));
check("TC-DECK-23 relevant cards rank above irrelevant ones",
  (() => {
    const lastRelevant = deck.map((c) => c.sharedSkills.length > 0).lastIndexOf(true);
    const firstIrrelevant = deck.map((c) => c.sharedSkills.length === 0).indexOf(true);
    return firstIrrelevant === -1 || firstIrrelevant > lastRelevant;
  })(),
  deck.map((c) => `${c.title}(${c.sharedSkills.length})`).join(" | "));

check("TC-DECK-22 local roles outrank the remote one",
  titles.indexOf("Senior Data Engineer") < titles.indexOf("Analytics Engineer (Remote US)"),
  titles.join(" | "));

/* ─────────────────────────────────────────────────────────────
   The same bug from the recruiter's side.

   `updatedAt DESC LIMIT 400` meant a recruiter sourcing for a Databricks role
   got the 400 most recently active candidates and scored those. A perfect
   match who had not edited their profile in a month was never in the running.
   ───────────────────────────────────────────────────────────── */
console.log("\nRECRUITER SOURCING\n");

const { recruiterDeck } = await import("../src/lib/deck");

const [rec] = await db
  .insert(users)
  .values({
    email: `${TAG}recruiter@example.com`,
    name: "Deck Recruiter",
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
    ...jobRow({
      title: "Databricks Data Engineer",
      location: "Austin, TX",
      country: "US",
      state: "TX",
      city: "Austin",
      skills: ["Databricks", "Spark", "Python"],
      ageDays: 1,
    }),
    postedById: rec.id,
  })
  .returning();

/**
 * 450, not 300 — it MUST exceed the 400-row pool.
 *
 * The first version of this fixture used 300 and passed against the unfixed
 * code, because the trap only springs once the noise fills the pool. A test
 * that passes before the fix proves nothing; caught by running this suite
 * against the reverted code, which is why that is worth doing every time.
 */
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
await db.insert(users).values({
  email: `${TAG}needle@example.com`,
  name: "Perfect Match",
  role: "CANDIDATE",
  emailVerified: true,
  profileReady: true,
  openToOffers: true,
  location: "Austin, TX",
  currentCountry: "US",
  currentCity: "Austin",
  skills: ["Databricks", "Spark", "Python", "SQL"],
  yearsExp: 9,
  updatedAt: new Date(now - 40 * 86_400_000),
});

const sourced = await recruiterDeck(rec, role.id);
const names = sourced.map((c) => c.name);
check("TC-DECK-30 sourcing returns candidates", sourced.length > 0, `${sourced.length}`);
check("TC-DECK-34 the noise fixture actually exceeds the pool", 450 > 400);
check("TC-DECK-31 the best fit is found despite a stale profile",
  names.includes("Perfect Match"), names.slice(0, 5).join(" | "));
/**
 * Top three, not first. The candidate fixture built earlier in this file has
 * the same four skills and a comparable profile, so which of the two leads is
 * a legitimate tie the scorer breaks — asserting a winner would be testing
 * noise. What the bug was about is whether a strong match with a stale profile
 * is REACHED at all; under the old query it was not.
 */
check("TC-DECK-32 and ranks near the top", names.slice(0, 3).includes("Perfect Match"),
  names.slice(0, 3).join(" | "));
/**
 * Top TWO, because the fixture contains exactly two candidates who fit. Rank 3
 * being a mismatch is correct: once the genuinely relevant people are exhausted
 * the deck fills with eligible-but-weaker ones rather than running short, which
 * is the same choice made on the candidate side.
 */
check("TC-DECK-33 no recently-active mismatch outranks a real fit",
  names.slice(0, 2).every((n) => !/^Noise /.test(n)), names.slice(0, 2).join(" | "));

await cleanup();
console.log(`\n${pass} passed, ${fail} failed  —  deck relevance\n`);
process.exit(fail ? 1 : 0);
