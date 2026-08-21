#!/usr/bin/env tsx
/**
 * FSD v1.1 §39.2 D-1 — resolve the legacy free-text locations.
 *
 * Every job and candidate created before v1.1 holds location as a single
 * string. The eligibility layer fails closed on an unknown country (GEO-006),
 * which is correct but means those rows are invisible until something resolves
 * them. That something is this script.
 *
 * It is deliberately conservative and deliberately idempotent:
 *
 *   • It only writes rows whose structured country is still null, so running it
 *     twice is a no-op and it never overwrites a value a human supplied.
 *   • It writes only what the resolver is confident about. A row it cannot
 *     resolve is left alone and REPORTED, not guessed at.
 *   • It never invents a remote scope. RMT-005 handles unscoped remote roles at
 *     read time; writing a scope here would launder an inference into a fact.
 *
 * Usage:
 *   npx tsx scripts/backfill-geo.mts            # report only, writes nothing
 *   npx tsx scripts/backfill-geo.mts --apply    # write
 */
import "dotenv/config";

const { db, jobs, users } = await import("../src/db");
const { resolveLocation, UNKNOWN_COUNTRY } = await import("../src/lib/geo/resolve").then(
  async (m) => ({ ...m, ...(await import("../src/lib/geo/countries")) })
);
const { dedupeKey } = await import("../src/lib/dedupe");
const { eq, isNull, sql } = await import("drizzle-orm");

const APPLY = process.argv.includes("--apply");

type Tally = { total: number; resolved: number; inferred: number; unresolved: number };

function pct(n: number, d: number) {
  return d === 0 ? "0%" : `${Math.round((n / d) * 100)}%`;
}

async function backfillJobs(): Promise<Tally> {
  const rows = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      location: jobs.location,
      companyId: jobs.companyId,
      source: jobs.source,
    })
    .from(jobs)
    .where(isNull(jobs.countryCode));

  const tally: Tally = { total: rows.length, resolved: 0, inferred: 0, unresolved: 0 };
  const unresolvedSamples: string[] = [];

  for (const row of rows) {
    const r = resolveLocation(row.location);
    if (r.country === UNKNOWN_COUNTRY) {
      tally.unresolved++;
      if (unresolvedSamples.length < 10) unresolvedSamples.push(row.location ?? "(empty)");
      continue;
    }
    if (r.confidence === "INFERRED") tally.inferred++;
    tally.resolved++;

    if (!APPLY) continue;
    await db
      .update(jobs)
      .set({
        countryCode: r.country,
        stateProvince: r.stateProvince,
        city: r.city,
        postalCode: r.postalCode,
        // SRC-007 — a key is only useful once the place is known.
        dedupeKey: dedupeKey({
          title: row.title,
          companyName: row.companyId,
          location: row.location,
          countryCode: r.country,
          stateProvince: r.stateProvince,
          postalCode: r.postalCode,
          city: r.city,
        }),
      })
      .where(eq(jobs.id, row.id));
  }

  console.log(
    `\njobs: ${tally.total} without a country\n` +
      `  resolved   ${tally.resolved} (${pct(tally.resolved, tally.total)}), of which ${tally.inferred} inferred from a city name\n` +
      `  unresolved ${tally.unresolved} (${pct(tally.unresolved, tally.total)}) — these stay hidden until a human fixes them`
  );
  if (unresolvedSamples.length) {
    console.log(`  examples: ${unresolvedSamples.map((s) => JSON.stringify(s)).join(", ")}`);
  }
  return tally;
}

async function backfillUsers(): Promise<Tally> {
  const rows = await db
    .select({ id: users.id, location: users.location })
    .from(users)
    .where(isNull(users.currentCountry));

  const tally: Tally = { total: rows.length, resolved: 0, inferred: 0, unresolved: 0 };

  for (const row of rows) {
    const r = resolveLocation(row.location);
    if (r.country === UNKNOWN_COUNTRY) {
      tally.unresolved++;
      continue;
    }
    if (r.confidence === "INFERRED") tally.inferred++;
    tally.resolved++;

    if (!APPLY) continue;
    await db
      .update(users)
      .set({
        currentCountry: r.country,
        currentStateProvince: r.stateProvince,
        currentCity: r.city,
        currentPostalCode: r.postalCode,
      })
      .where(eq(users.id, row.id));
  }

  console.log(
    `\nusers: ${tally.total} without a country\n` +
      `  resolved   ${tally.resolved} (${pct(tally.resolved, tally.total)}), of which ${tally.inferred} inferred from a city name\n` +
      `  unresolved ${tally.unresolved} (${pct(tally.unresolved, tally.total)}) — these candidates will be asked on next sign-in`
  );
  return tally;
}

/**
 * SRC-007 — link duplicates that already exist.
 *
 * Runs after the location backfill, because a dedupe key needs a resolved
 * place. Pure SQL rather than the ingest path: we are reconciling rows that are
 * already stored, not deciding what to store.
 */
async function linkExistingDuplicates(): Promise<number> {
  const groups = await db
    .select({ key: jobs.dedupeKey, n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(sql`${jobs.dedupeKey} IS NOT NULL AND ${jobs.active} = true`)
    .groupBy(jobs.dedupeKey)
    .having(sql`count(*) > 1`);

  let linked = 0;
  for (const g of groups) {
    if (!g.key) continue;
    const siblings = await db
      .select({
        id: jobs.id,
        origin: jobs.origin,
        consentSource: jobs.consentSource,
        postedAt: jobs.postedAt,
      })
      .from(jobs)
      .where(sql`${jobs.dedupeKey} = ${g.key} AND ${jobs.active} = true`);

    const { preferCanonical } = await import("../src/lib/dedupe");
    const winner = siblings.reduce((best, cur) => preferCanonical(best, cur));

    if (!APPLY) {
      linked += siblings.length - 1;
      continue;
    }
    for (const s of siblings) {
      await db
        .update(jobs)
        .set({ canonicalJobId: s.id === winner.id ? null : winner.id })
        .where(eq(jobs.id, s.id));
      if (s.id !== winner.id) linked++;
    }
  }
  console.log(`\nduplicates: ${linked} postings folded into a canonical one across ${groups.length} groups`);
  return linked;
}

console.log(
  APPLY
    ? "Backfilling structured locations (WRITING)…"
    : "Backfilling structured locations (DRY RUN — pass --apply to write)…"
);

await backfillJobs();
await backfillUsers();
await linkExistingDuplicates();

if (!APPLY) {
  console.log("\nNothing was written. Re-run with --apply once the numbers look right.");
}
process.exit(0);
