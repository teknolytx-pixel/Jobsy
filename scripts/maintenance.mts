#!/usr/bin/env tsx
/**
 * Run the nightly maintenance tasks by hand.
 *
 *   npm run maintenance
 *
 * In production these run inside the daily cron alongside ingestion. This entry
 * point exists so they can be exercised and audited independently — a purge job
 * you cannot run on demand is a purge job you cannot verify.
 */
import "dotenv/config";

const { runMaintenance } = await import("../src/lib/maintenance");
const report = await runMaintenance();

console.log("\nMaintenance report\n");
for (const [k, v] of Object.entries(report)) {
  if (k === "errors") continue;
  console.log(`  ${k.padEnd(24)} ${v}`);
}
if (report.errors.length) {
  console.error("\nErrors:");
  for (const e of report.errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log("\n✓ no errors\n");
process.exit(0);
