#!/usr/bin/env tsx
/**
 * FOLLOWING AN EMPLOYER THROUGH THE JOB BOARDS.
 *
 * The escape hatch for careers sites that cannot be read without a browser.
 * One thing here matters far more than the rest, and it is the name match.
 *
 * A query for "Infosys" returns jobs AT Infosys, jobs at agencies recruiting
 * FOR Infosys, and anything whose description mentions them. Importing the
 * second kind under Infosys's name is worse than importing nothing: a candidate
 * swipes on a role believing it is with a company it is not with, applies, and
 * discovers the truth from a recruiter who has already sold their CV onward.
 *
 *   npx tsx scripts/test-follow.mts
 */
import "dotenv/config";
const { assertNotProduction } = await import("./_not-production.mts");
assertNotProduction("test-follow");

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const { isSameEmployer, employerSearchProviders, QUERY_SOURCES } =
  await import("../src/lib/followedEmployers");

// ─────────────────────────────────────────────────────────────
console.log("\nIS THIS JOB ACTUALLY AT THAT EMPLOYER?\n");

check("TC-FOL-01 an exact name matches", isSameEmployer("Infosys", "Infosys"));
check("TC-FOL-02 case and spacing are ignored", isSameEmployer("infosys", "  INFOSYS  "));
check("TC-FOL-03 a legal suffix is still the same company",
  isSameEmployer("Infosys", "Infosys Limited") && isSameEmployer("Wipro", "Wipro Ltd."));
check("TC-FOL-04 and so is a named division", isSameEmployer("Infosys", "Infosys BPM"));
check("TC-FOL-05 the reverse also holds", isSameEmployer("Infosys Limited", "Infosys"));

/**
 * The important half. Each of these would attribute somebody else's vacancy to
 * the followed employer.
 */
check("TC-FOL-10 an agency recruiting FOR them is not them",
  !isSameEmployer("Infosys", "TechStaff Recruiting for Infosys"));
check("TC-FOL-11 nor is a differently-named company that contains the word",
  !isSameEmployer("Infosys", "Global Infosys Partners LLC"));
check("TC-FOL-12 nor an unrelated employer", !isSameEmployer("Infosys", "Wipro"));
check("TC-FOL-13 nor a prefix collision", !isSameEmployer("Info", "Infosys"));
check("TC-FOL-14 an empty name never matches",
  !isSameEmployer("Infosys", "") && !isSameEmployer("", "Infosys"));

// ─────────────────────────────────────────────────────────────
console.log("\nWHICH BOARDS CAN ACTUALLY ANSWER\n");

const p = employerSearchProviders();
check("TC-FOL-20 the boards are reported, live and unconfigured",
  Array.isArray(p.live) && Array.isArray(p.needsKey),
  `live: ${p.live.join(", ") || "none"} | needs a key: ${p.needsKey.join(", ") || "none"}`);
check("TC-FOL-21 every query source is accounted for",
  p.live.length + p.needsKey.length === QUERY_SOURCES.length,
  `${p.live.length + p.needsKey.length} of ${QUERY_SOURCES.length}`);

/**
 * The ATS providers take a board slug — "stripe", "acme|wd5|Careers". Handing
 * one an employer name would fetch a board that does not exist, so they are
 * excluded by name rather than by trying and failing.
 */
check("TC-FOL-22 ATS providers are not asked to answer a name query",
  !(QUERY_SOURCES as readonly string[]).some((s) => ["GREENHOUSE", "LEVER", "ASHBY"].includes(s)),
  QUERY_SOURCES.join(","));

// ─────────────────────────────────────────────────────────────
console.log("\nHOW MUCH OF AN EMPLOYER WE ASK FOR\n");

const { EMPLOYER_PAGES } = await import("../src/lib/followedEmployers");
const { jsearchProvider } = await import("../src/lib/providers/aggregators");

/**
 * One page is about ten jobs. For a company the size of Infosys that reads as a
 * broken feature rather than a first page — which is exactly how this shipped
 * before the number was made a parameter.
 */
check("TC-FOL-30 following asks for more than one page", EMPLOYER_PAGES >= 2, `${EMPLOYER_PAGES}`);
check("TC-FOL-31 but not an unbounded number", EMPLOYER_PAGES <= 5, `${EMPLOYER_PAGES}`);

let asked = "";
const priorFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  asked = typeof input === "string" ? input : input.toString();
  return new Response(JSON.stringify({ data: { jobs: [] } }), { status: 200 });
}) as typeof fetch;

process.env.RAPIDAPI_KEY ||= "test-key-for-url-shape";
await jsearchProvider.fetchBoard("Infosys", { pages: 3 }).catch(() => {});
check("TC-FOL-32 the page count reaches the request", /num_pages=3/.test(asked),
  asked.replace(/^.*jsearch/, "jsearch").slice(0, 90));

await jsearchProvider.fetchBoard("senior react engineer").catch(() => {});
check("TC-FOL-33 and the demand queries are unchanged at one page",
  /num_pages=1/.test(asked), asked.replace(/^.*jsearch/, "jsearch").slice(0, 90));

await jsearchProvider.fetchBoard("Infosys", { pages: 99 }).catch(() => {});
check("TC-FOL-34 an absurd request is capped, not obeyed",
  /num_pages=5/.test(asked), asked.replace(/^.*jsearch/, "jsearch").slice(0, 90));

globalThis.fetch = priorFetch;

console.log(`\n${pass} passed, ${fail} failed  —  followed employers\n`);
process.exit(fail ? 1 : 0);
