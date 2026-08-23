#!/usr/bin/env tsx
/**
 * PROBE COMPANY JOB BOARDS before connecting them.
 *
 *   npm run check-boards -- https://boards.greenhouse.io/figma https://jobs.ashbyhq.com/ramp
 *   npm run check-boards -- greenhouse:stripe lever:netflix ashby:linear
 *
 * Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee, Personio,
 * BambooHR and Workday all publish their customers' postings on public, keyless
 * endpoints. Connecting one costs nothing and yields the best jobs available to
 * Jobsy: first-hand from the employer's own system, complete descriptions, real
 * salary fields, no aggregator truncation and no per-request charge.
 *
 * ── Why this exists when the Sources screen already does it ──
 *
 * The screen connects boards one at a time and writes to the database. This
 * only LOOKS, so a list of thirty candidate companies can be checked before any
 * of them is connected — and a board that answers with zero jobs is worth
 * knowing about before it becomes a row that quietly syncs nothing every night.
 *
 * It resolves URLs with `matchPatterns` and fetches with `fetchCompanyJobs` —
 * the same functions the Sources screen uses, not a parallel implementation.
 * A second parser would drift, and the drift would show up as a board that
 * connects in the UI but not here, with nothing to say which was right.
 *
 * ── Network ──
 *
 * These are outbound calls to third-party hosts. A sandbox with an egress
 * allowlist will refuse them — HTTP 403 with no request reaching the vendor, or
 * a connection failure — which looks nothing like a wrong slug and is reported
 * separately below.
 */
import "dotenv/config";

const { matchPatterns } = await import("../src/lib/discovery");
const { fetchCompanyJobs, ATS_LABEL } = await import("../src/lib/providers/ats");

type Target = { label: string; kind: string; token: string };

const VENDOR_ALIASES: Record<string, string> = {
  greenhouse: "GREENHOUSE",
  lever: "LEVER",
  ashby: "ASHBY",
  workable: "WORKABLE",
  smartrecruiters: "SMARTRECRUITERS",
  recruitee: "RECRUITEE",
  personio: "PERSONIO",
  bamboohr: "BAMBOOHR",
  workday: "WORKDAY",
};

function resolve(arg: string): Target | { error: string; input: string } {
  // vendor:token
  const colon = /^([a-z]+):(.+)$/i.exec(arg);
  if (colon && VENDOR_ALIASES[colon[1].toLowerCase()]) {
    return { label: arg, kind: VENDOR_ALIASES[colon[1].toLowerCase()], token: colon[2] };
  }
  // A URL, resolved exactly as the Sources screen resolves it.
  const hit = matchPatterns(arg);
  if (hit) return { label: arg, kind: hit.kind, token: hit.token };
  return {
    input: arg,
    error:
      "not a recognised board URL. Use the company's ATS link (boards.greenhouse.io/acme, " +
      "jobs.lever.co/acme, jobs.ashbyhq.com/acme…) or vendor:token.",
  };
}

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!args.length) {
  console.log(`
  Give it board URLs or vendor:token pairs.

      npm run check-boards -- https://boards.greenhouse.io/figma
      npm run check-boards -- greenhouse:figma ashby:ramp lever:netflix

  Find a company's board by opening their careers page — the "apply" link almost
  always lands on the ATS, and that URL is what to paste. The same URL works on
  the Sources screen inside Jobsy, which connects it for real.
`);
  process.exit(0);
}

/** Bounded concurrency — these are other people's servers. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    })
  );
  return out;
}

const resolved = args.map(resolve);
const bad = resolved.filter((r): r is { error: string; input: string } => "error" in r);
const targets = resolved.filter((r): r is Target => !("error" in r));

console.log("\nPROBING BOARDS\n");

type Outcome = { t: Target; n: number; err: string | null; blocked: boolean };

const results = await mapLimit(targets, 4, async (t): Promise<Outcome> => {
  try {
    const jobs = await fetchCompanyJobs(t.kind as never, t.token, t.token);
    return { t, n: jobs.length, err: null, blocked: false };
  } catch (e) {
    const msg = ((e as Error).message ?? String(e)).slice(0, 120);
    // 403 with no vendor body, or an outright connection failure, is an egress
    // block rather than a wrong slug. Reported apart so a sandbox run is not
    // mistaken for thirty dead companies.
    const blocked = /HTTP 403|ENOTFOUND|ECONNREFUSED|fetch failed|ETIMEDOUT|EAI_AGAIN/i.test(msg);
    return { t, n: 0, err: msg, blocked };
  }
});

const live = results.filter((r) => r.n > 0).sort((a, b) => b.n - a.n);
const empty = results.filter((r) => r.n === 0 && !r.err);
const blocked = results.filter((r) => r.blocked);
const failed = results.filter((r) => r.err && !r.blocked);

for (const r of live) {
  console.log(`  ${String(r.n).padStart(5)} jobs   ${ATS_LABEL[r.t.kind as never] ?? r.t.kind}  ${r.t.token}`);
}
if (empty.length) {
  console.log("");
  for (const r of empty) console.log(`      0 jobs   ${r.t.token} — board answered but is empty right now`);
}
if (failed.length) {
  console.log("");
  for (const r of failed) console.log(`      no board  ${r.t.token} — ${r.err}`);
}
if (bad.length) {
  console.log("");
  for (const b of bad) console.log(`      skipped   ${b.input} — ${b.error}`);
}

const total = live.reduce((a, r) => a + r.n, 0);
console.log(`\n  ${live.length} of ${targets.length} boards live, ${total} jobs reachable\n`);

if (blocked.length === results.length && results.length > 0) {
  console.log(
    "  Every request was refused before reaching the vendor, which is an egress\n" +
      "  block rather than thirty wrong slugs. Run this from a normal terminal, or\n" +
      "  connect the boards through the Sources screen on the deployed site, where\n" +
      "  the outbound call is made by the server rather than from here.\n"
  );
} else if (live.length) {
  console.log("  Connect these on the Sources screen (paste the same URL), or set:\n");
  for (const vendor of ["GREENHOUSE", "LEVER", "ASHBY"]) {
    const t = live.filter((r) => r.t.kind === vendor).map((r) => r.t.token);
    if (t.length) console.log(`      ${vendor}_BOARDS=${t.join(",")}`);
  }
  console.log(
    "\n  The Sources screen needs no redeploy and covers every vendor above;\n" +
      "  the environment variables cover only those three.\n"
  );
}
process.exit(0);
