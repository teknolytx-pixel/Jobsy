import "dotenv/config";
/**
 * Pull live jobs from every configured provider.
 *   npm run ingest
 */
import { ingestAll, deactivateStale } from "../src/lib/ingest";
import { ALL_PROVIDERS } from "../src/lib/providers";

async function main() {
  console.log("\nProviders:");
  for (const p of ALL_PROVIDERS) {
    const on = p.isConfigured();
    console.log(
      `  ${on ? "✓" : "·"} ${p.label.padEnd(42)} ${on ? (await p.boards()).join(", ") : "not configured"}`
    );
  }

  const t0 = Date.now();
  // No deadline from the CLI: this runs on a machine nobody is going to kill at
  // 60 seconds, so it covers every board in one pass. The deadline exists for
  // the serverless path (SRC-015).
  const { runs, skipped } = await ingestAll();

  if (!runs.length) {
    console.log(
      "\nNothing to ingest. Set GREENHOUSE_BOARDS / LEVER_BOARDS / ASHBY_BOARDS in .env\n" +
        "(no API keys needed — those are public job board endpoints), or add Adzuna keys.\n"
    );
    return;
  }

  console.log("\nResults:");
  for (const r of runs) {
    const line = `  ${r.source}/${r.board}`.padEnd(38);
    console.log(
      r.error
        ? `${line} ✗ ${r.error}`
        : `${line} ${r.fetched} fetched · ${r.created} new · ${r.updated} updated`
    );
  }

  const totals = runs.reduce(
    (a, r) => ({
      fetched: a.fetched + r.fetched,
      created: a.created + r.created,
      updated: a.updated + r.updated,
    }),
    { fetched: 0, created: 0, updated: 0 }
  );
  const stale = await deactivateStale();

  if (skipped.length) {
    console.log(
      `\n  deferred: ${skipped.map((s) => `${s.source}/${s.board}`).join(", ")}`
    );
  }

  console.log(
    `\n${totals.created} new jobs, ${totals.updated} refreshed, ${stale} retired ` +
      `(${((Date.now() - t0) / 1000).toFixed(1)}s)\n`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .then(() => process.exit(0));
