#!/usr/bin/env tsx
/**
 * CANDIDATE SOURCING — the rules, not the plumbing.
 *
 * The plumbing here is ordinary: call an API, map some fields, write some rows.
 * What deserves tests is the set of promises the feature makes about people who
 * never agreed to be in it, because those are the promises that are quietly
 * easy to break in a refactor six months from now:
 *
 *   1. An imported person is INVISIBLE — not a user, not matched, not scored.
 *   2. SUPPRESSION IS PERMANENT. Someone who objected must not reappear on the
 *      next sync because their record is still in the employer's ATS.
 *   3. Re-importing must not reset somebody's standing with us.
 *   4. The systems we have no contract for REFUSE, and say what they need,
 *      rather than returning something plausible.
 *
 *   npx tsx scripts/test-candidates.mts
 */
import "dotenv/config";

/*
 * This suite WRITES — it creates a company, imports people, then deletes them.
 * Pointed at production it would manufacture rows in a table holding real
 * people's contact details, so the guard runs before anything else.
 */
const { assertNotProduction } = await import("./_not-production.mts");
assertNotProduction("test-candidates");

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const { and, eq } = await import("drizzle-orm");
const { db, candidateSources, sourcedCandidates, companies, users } = await import("../src/db");
const { fetchCandidates, readChannel, NotContracted, LIVE_CANDIDATE_KINDS } =
  await import("../src/lib/candidates/providers");
const { importFromSource, candidateStats, toRow } = await import("../src/lib/candidates/sync");

// ─────────────────────────────────────────────────────────────
console.log("\nWHAT WE WILL AND WILL NOT CONNECT TO\n");

for (const kind of ["DICE", "MONSTER", "ZIPRECRUITER", "INDEED_RESUME", "NAUKRI"] as const) {
  let refused = false;
  let needs = "";
  try {
    await fetchCandidates(kind, "pretend-key", "");
  } catch (e) {
    refused = e instanceof NotContracted;
    needs = (e as Error).message;
  }
  check(`TC-CAND-01 ${kind} refuses without a contract`, refused, needs.slice(0, 70));
}

check("TC-CAND-02 only the employer's own ATS is live",
  LIVE_CANDIDATE_KINDS.join() === "GREENHOUSE,LEVER,ASHBY,WORKABLE", LIVE_CANDIDATE_KINDS.join());

/**
 * There is no adapter for a public profile site, and that absence is the
 * policy. If one is ever added this test should fail loudly and somebody should
 * have to argue for it in a code review.
 */
const { CANDIDATE_KIND_LABEL } = await import("../src/lib/candidates/providers");
check("TC-CAND-03 no adapter scrapes a public profile site",
  !Object.keys(CANDIDATE_KIND_LABEL).some((k) => /LINKEDIN|FACEBOOK|XING|GITHUB_SCRAPE/i.test(k)),
  Object.keys(CANDIDATE_KIND_LABEL).join(","));

// ─────────────────────────────────────────────────────────────
console.log("\nA LINK THE CANDIDATE PUBLISHED THEMSELVES\n");

check("TC-CAND-10 a LinkedIn profile they supplied is recognised",
  readChannel("https://www.linkedin.com/in/some-person")?.channel === "LinkedIn");
check("TC-CAND-11 and kept whole, so the recruiter lands on their page",
  readChannel("https://www.linkedin.com/in/some-person")?.handle === "https://www.linkedin.com/in/some-person");
check("TC-CAND-12 an unrecognised link is not guessed at",
  readChannel("https://some-personal-site.example/about") === null);
check("TC-CAND-13 nor is nonsense", readChannel("not a url") === null);

// ─────────────────────────────────────────────────────────────
console.log("\nREADING SKILLS FROM WHAT THE ATS GAVE US\n");

const merged = toRow({
  externalId: "1",
  skills: ["senior"],
  resumeText: "Eight years of Python, PySpark and Airflow on AWS.",
});
check("TC-CAND-20 sparse ATS tags are supplemented from the CV",
  merged.skills.includes("Python") && merged.skills.includes("PySpark"), merged.skills.join(","));
check("TC-CAND-21 the employer's own tag is kept too",
  merged.skills.includes("senior"), merged.skills.join(","));

// ─────────────────────────────────────────────────────────────
// THE DATABASE RULES
// ─────────────────────────────────────────────────────────────
console.log("\nWHAT HAPPENS TO A PERSON WE HOLD\n");

const stamp = `candtest-${Date.now()}`;
const [company] = await db
  .insert(companies)
  .values({ name: "Cand Test Co", slug: stamp, source: "JOBSY" })
  .returning();

/** A fake ATS returning two people, then nothing. */
const PEOPLE = [
  { id: 501, first_name: "Ada", last_name: "L", title: "Data Engineer",
    email_addresses: [{ value: "ada@example.com" }], phone_numbers: [{ value: "+1 555 0100" }],
    addresses: [{ value: "Austin, TX" }], tags: ["Python", "Spark"],
    social_media_addresses: [{ value: "https://www.linkedin.com/in/ada-example" }] },
  { id: 502, first_name: "Bo", last_name: "M", title: "Backend Engineer",
    email_addresses: [{ value: "bo@example.com" }], tags: ["Go"] },
];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input.toString();
  if (url.includes("harvest.greenhouse.io")) {
    const page = Number(new URL(url).searchParams.get("page") ?? 1);
    return new Response(JSON.stringify(page === 1 ? PEOPLE : []), { status: 200 });
  }
  return realFetch(input as RequestInfo);
}) as typeof fetch;

const [src] = await db
  .insert(candidateSources)
  .values({
    kind: "GREENHOUSE", companyId: company.id, token: "", label: "Cand Test ATS",
    secret: "pretend-harvest-key", lawfulBasis: "APPLICATION",
  })
  .returning();

const first = await importFromSource(src);
check("TC-CAND-30 people are imported", first.created === 2, `${first.created} created, ${first.error ?? ""}`);

const rows = await db
  .select()
  .from(sourcedCandidates)
  .where(eq(sourcedCandidates.sourceId, src.id));

check("TC-CAND-31 every row names why we may hold it",
  rows.every((r) => r.lawfulBasis === "APPLICATION"), rows.map((r) => r.lawfulBasis).join());
check("TC-CAND-32 and starts invisible", rows.every((r) => r.state === "IMPORTED"));
check("TC-CAND-33 with nobody notified yet", rows.every((r) => r.noticeSentAt === null));

/**
 * Rule 1, tested where it actually matters: an imported person must not exist
 * in `users`. The matching deck queries `users`, so this is what makes
 * "invisible" structural rather than a WHERE clause somebody could drop.
 */
const leaked = await db.select({ id: users.id }).from(users).where(eq(users.email, "ada@example.com"));
check("TC-CAND-34 an imported person is not a user", leaked.length === 0, `${leaked.length} found`);

const ada = rows.find((r) => r.email === "ada@example.com")!;
check("TC-CAND-35 a link they published is kept as a way to reach them",
  ada.preferredChannel === "LinkedIn" && (ada.preferredHandle ?? "").includes("ada-example"),
  `${ada.preferredChannel} ${ada.preferredHandle}`);
check("TC-CAND-36 someone who published nothing gets no channel invented",
  rows.find((r) => r.email === "bo@example.com")?.preferredChannel === null);

/** Re-import: facts refresh, standing does not. */
await db.update(sourcedCandidates).set({ state: "NOTIFIED", noticeSentAt: new Date() })
  .where(eq(sourcedCandidates.id, ada.id));
await db.update(candidateSources).set({ syncCursor: 0 }).where(eq(candidateSources.id, src.id));

const second = await importFromSource({ ...src, syncCursor: 0 });
const adaAfter = (await db.select().from(sourcedCandidates).where(eq(sourcedCandidates.id, ada.id)))[0];
check("TC-CAND-40 a second sync updates rather than duplicates",
  second.created === 0 && second.updated === 2, `${second.created} created, ${second.updated} updated`);
check("TC-CAND-41 and does NOT drag a notified person back to invisible",
  adaAfter.state === "NOTIFIED", adaAfter.state);

/**
 * Rule 2, and the reason it exists. The person is still in the employer's ATS
 * — we do not control that. What we control is whether their record here comes
 * back to life every six hours after they asked us to remove it.
 */
await db.update(sourcedCandidates)
  .set({ state: "SUPPRESSED", suppressedAt: new Date(), suppressedReason: "objected" })
  .where(eq(sourcedCandidates.id, ada.id));
await db.update(candidateSources).set({ syncCursor: 0 }).where(eq(candidateSources.id, src.id));

const third = await importFromSource({ ...src, syncCursor: 0 });
const adaFinal = (await db.select().from(sourcedCandidates).where(eq(sourcedCandidates.id, ada.id)))[0];
check("TC-CAND-50 someone who objected is skipped, not re-imported",
  third.suppressed === 1, `${third.suppressed} suppressed`);
check("TC-CAND-51 and stays suppressed", adaFinal.state === "SUPPRESSED", adaFinal.state);
check("TC-CAND-52 and the skip is reported rather than silent", third.suppressed > 0);

const stats = await candidateStats(company.id);
check("TC-CAND-60 the count separates held from notified",
  stats.total === 2 && stats.suppressed === 1, JSON.stringify(stats));
check("TC-CAND-61 and counts who can actually be reached",
  stats.withEmail === 2 && stats.withPreferredChannel === 1, JSON.stringify(stats));

// ── cleanup ──
await db.delete(sourcedCandidates).where(eq(sourcedCandidates.companyId, company.id));
await db.delete(candidateSources).where(eq(candidateSources.companyId, company.id));
await db.delete(companies).where(and(eq(companies.id, company.id)));
globalThis.fetch = realFetch;

console.log(`\n${pass} passed, ${fail} failed  —  candidate sourcing\n`);
process.exit(fail ? 1 : 0);
