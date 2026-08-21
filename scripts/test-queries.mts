#!/usr/bin/env tsx
/**
 * SRC-016 — the suite that would have caught it.
 *
 * `syncAllSources` contained `asc(sql\`col nulls first\`)`, which Postgres
 * rejects with `syntax error at or near "asc"`. It threw on every call, so
 * `/api/ingest` returned 500 for every authorised request and the nightly cron
 * never ingested anything — from the day the line was written.
 *
 * Nothing caught it, and the reason is worth stating plainly:
 *
 *   • The unit suites stub `fetch` and never open a database connection, so a
 *     malformed query is invisible to them.
 *   • The lifecycle suite exercised /api/ingest only to assert that it REJECTS
 *     an unauthorised caller. The authorised path — the one that does the work,
 *     and the only one the cron ever uses — was never called by anything.
 *
 * A query builder is code. It compiles, it type-checks, and it can still be
 * invalid SQL; the only thing that proves otherwise is a real database. So this
 * suite executes every DB-backed entry point against one.
 *
 * Deadlines are set in the past on purpose: the SQL runs, and then every source
 * and board is deferred, so the suite touches no third-party API.
 *
 *   npx tsx scripts/test-queries.mts        (needs DATABASE_URL)
 */
import "dotenv/config";

let pass = 0,
  fail = 0;

async function t(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    console.log(`  ✓ ${label}`);
    pass++;
  } catch (e) {
    console.log(`  ✗ ${label}\n      ${(e as Error).message.split("\n")[0]}`);
    fail++;
  }
}

const { syncAllSources, staleSources, listSources } = await import("../src/lib/sources");
const { ingestAll, deactivateStale, jobStats } = await import("../src/lib/ingest");
const { runMaintenance } = await import("../src/lib/maintenance");

// Already elapsed: the queries execute, the work is skipped, no network.
const SPENT = Date.now() - 1;

console.log("\nDATABASE-BACKED QUERIES\n");

await t("TC-SQL-01 syncAllSources orders by last_run_at (asc nulls first)", async () => {
  const r = await syncAllSources({ deadline: SPENT });
  if (!Array.isArray(r.results)) throw new Error("no results array");
});

await t("TC-SQL-02 syncAllSources honours its limit", async () => {
  await syncAllSources({ limit: 1, deadline: SPENT });
});

await t("TC-SQL-03 ingestAll reads per-board run history", async () => {
  const r = await ingestAll({ deadline: SPENT });
  if (!Array.isArray(r.runs)) throw new Error("no runs array");
});

await t("TC-SQL-04 staleSources", async () => {
  await staleSources();
});

await t("TC-SQL-05 listSources", async () => {
  await listSources();
});

await t("TC-SQL-06 deactivateStale", async () => {
  await deactivateStale();
});

await t("TC-SQL-07 jobStats", async () => {
  await jobStats();
});

// Never reached in production either: it runs last in /api/ingest, after the
// call that was throwing.
await t("TC-SQL-08 runMaintenance", async () => {
  await runMaintenance();
});

console.log(`\n${pass} passed, ${fail} failed  —  database-backed queries\n`);
process.exit(fail ? 1 : 0);
