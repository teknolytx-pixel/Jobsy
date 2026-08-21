#!/usr/bin/env tsx
/**
 * SRC-014 — demand-driven ingestion.
 *
 * Pure tests. `roleTerm` and `renderQuery` carry all the judgement in this
 * feature; `demandSignal` is a group-and-threshold over them and is exercised
 * here through a stand-in for the query, so the suite needs no database.
 */
// Dynamic, matching backfill-geo.mts: tsx resolves the src tree reliably this
// way, and a static named import of this module fails to bind under it.
const { MIN_CANDIDATES, renderQuery, roleTerm, queriesPerRun } = await import("../src/lib/demand");
type DemandQuery = import("../src/lib/demand").DemandQuery;

let pass = 0,
  fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

console.log("\nROLE TERM NORMALISATION\n");

check("TC-DEM-01 plain title passes through",
  roleTerm("Machine Learning Engineer") === "machine learning engineer", String(roleTerm("Machine Learning Engineer")));

// The bug this prevents: "Senior ML Engineer" and "ML Engineer" landing in two
// buckets of 2, each below the threshold, so neither is ever queried.
check("TC-DEM-02 seniority stripped so levels group together",
  roleTerm("Senior ML Engineer") === roleTerm("ML Engineer"),
  `${roleTerm("Senior ML Engineer")} vs ${roleTerm("ML Engineer")}`);
check("TC-DEM-03 stacked seniority stripped",
  roleTerm("Senior Staff Software Engineer") === "software engineer", String(roleTerm("Senior Staff Software Engineer")));
check("TC-DEM-04 'Head of' stripped",
  roleTerm("Head of Product Design") === "product design", String(roleTerm("Head of Product Design")));

check("TC-DEM-05 ML abbreviation expanded to what boards index",
  roleTerm("ML Engineer") === "machine learning engineer", String(roleTerm("ML Engineer")));
check("TC-DEM-06 AI/ML slash form expanded",
  roleTerm("AI/ML Engineer") === "machine learning engineer", String(roleTerm("AI/ML Engineer")));

check("TC-DEM-07 domain qualifier after a comma dropped",
  roleTerm("ML Engineer, Healthcare") === "machine learning engineer", String(roleTerm("ML Engineer, Healthcare")));
check("TC-DEM-08 parenthetical qualifier dropped",
  roleTerm("Full Stack Engineer (AI)") === "full stack engineer", String(roleTerm("Full Stack Engineer (AI)")));

// Nulls are the safe answer. A junk phrase costs a paid API call and returns
// nothing, so the bar for emitting one is deliberately high.
check("TC-DEM-09 empty input yields nothing", roleTerm("") === null);
check("TC-DEM-10 null input yields nothing", roleTerm(null) === null);
check("TC-DEM-11 a whole sentence is not a role",
  roleTerm("I am looking for my next big opportunity in tech") === null,
  String(roleTerm("I am looking for my next big opportunity in tech")));
check("TC-DEM-12 a bare adjective is not a role", roleTerm("motivated") === null, String(roleTerm("motivated")));
check("TC-DEM-13 a bare noun that IS a role survives",
  roleTerm("Designer") === "designer", String(roleTerm("Designer")));

console.log("\nQUERY RENDERING\n");

const ml: DemandQuery = { role: "machine learning engineer", country: "US", candidates: 4 };
const de: DemandQuery = { role: "data engineer", country: "DE", candidates: 3 };
const anywhere: DemandQuery = { role: "product designer", country: null, candidates: 5 };

check("TC-DEM-20 JSearch phrase form",
  renderQuery(ml, "PHRASE") === "machine learning engineer in united states", renderQuery(ml, "PHRASE"));
check("TC-DEM-21 pipe form for Jooble/Careerjet/Adzuna",
  renderQuery(ml, "PIPE") === "machine learning engineer|united states", renderQuery(ml, "PIPE"));

// The whole point of the feature: the country comes from the candidates, not
// from a constant that says "usa".
check("TC-DEM-22 a non-US demand group queries its own country",
  renderQuery(de, "PHRASE") === "data engineer in germany", renderQuery(de, "PHRASE"));
check("TC-DEM-23 a countryless group asks for the role alone",
  renderQuery(anywhere, "PHRASE") === "product designer", renderQuery(anywhere, "PHRASE"));
check("TC-DEM-24 pipe form leaves the location empty when unknown",
  renderQuery(anywhere, "PIPE") === "product designer|", renderQuery(anywhere, "PIPE"));

console.log("\nTHRESHOLD\n");

/** The filter/sort/cap half of demandSignal, over fixtures instead of rows. */
function select(buckets: DemandQuery[], max = 12) {
  return buckets
    .filter((b) => b.candidates >= MIN_CANDIDATES)
    .sort((a, b) => b.candidates - a.candidates || a.role.localeCompare(b.role))
    .slice(0, max);
}

// A single ML engineer must not become a query. The job table would otherwise
// become a public record of what one identifiable person is looking for.
const thin: DemandQuery[] = [
  { role: "machine learning engineer", country: "DE", candidates: 1 },
  { role: "software engineer", country: "US", candidates: 4 },
];
const kept = select(thin);
check("TC-DEM-30 a group of one is never queried",
  kept.length === 1 && kept[0].role === "software engineer", kept.map((k) => k.role).join(", "));
check("TC-DEM-31 the threshold is at least 3", MIN_CANDIDATES >= 3, String(MIN_CANDIDATES));
check("TC-DEM-32 a group exactly at the threshold is queried",
  select([{ role: "data engineer", country: "US", candidates: MIN_CANDIDATES }]).length === 1);

const many: DemandQuery[] = Array.from({ length: 30 }, (_, i) => ({
  role: `role ${String(i).padStart(2, "0")}`,
  country: "US",
  candidates: 3 + (i % 5),
}));
check("TC-DEM-33 the query count is capped", select(many).length === 12, `${select(many).length}`);
check("TC-DEM-34 the biggest demand group is queried first",
  select(many)[0].candidates === 7, `${select(many)[0].candidates} candidates`);

console.log("\nMETERED PROVIDER BUDGET\n");

// The failure this prevents: 12 queries a night against a 200-request plan
// exhausts it around the 17th, and the last third of every month has no
// ingestion at all — presenting as "the site stopped finding jobs".
check("TC-DEM-40 the free JSearch plan stays inside its month",
  queriesPerRun(200) * 31 <= 200, `${queriesPerRun(200)}/run → ${queriesPerRun(200) * 31}/month`);
check("TC-DEM-41 a paid plan still respects the global cap",
  queriesPerRun(100000) === 12, `${queriesPerRun(100000)}`);
check("TC-DEM-42 a budget too small for one query a day still runs once",
  queriesPerRun(5) === 1, `${queriesPerRun(5)}`);
check("TC-DEM-43 a zero or nonsense budget degrades to one, not to zero",
  queriesPerRun(0) === 1 && queriesPerRun(NaN) === 1);
check("TC-DEM-44 a 1000-request plan spends more of it",
  queriesPerRun(1000) === 12, `${queriesPerRun(1000)}`);

console.log("\nINGEST TIME BUDGET\n");

// SRC-015. The serverless host kills the function at its plan ceiling — 60s on
// Vercel Hobby, whatever maxDuration claims. The old loop had no notion of that
// and was killed mid-run: empty response body, half the boards silently never
// fetched, and runMaintenance() never reached on any night.
const { planBoards, PER_BOARD_RESERVE_MS } = await import("../src/lib/ingest");

const boards = [
  { source: "JSEARCH", board: "a" },
  { source: "JSEARCH", board: "b" },
  { source: "REMOTIVE", board: "c" },
  { source: "ARBEITNOW", board: "d" },
];
// A realistic epoch: the ordering must not depend on timestamps happening to
// be larger than zero.
const NOW = 1_787_000_000_000;
const noHistory = new Map<string, number>();

const full = planBoards(boards, noHistory, { deadline: NOW + 10 * PER_BOARD_RESERVE_MS, now: NOW });
check("TC-ING-50 a generous budget runs every board",
  full.run.length === 4 && full.skipped.length === 0, `${full.run.length} run`);

const tight = planBoards(boards, noHistory, { deadline: NOW + 2 * PER_BOARD_RESERVE_MS, now: NOW });
check("TC-ING-51 a tight budget defers the rest instead of overrunning",
  tight.run.length === 2 && tight.skipped.length === 2,
  `${tight.run.length} run, ${tight.skipped.length} deferred`);

check("TC-ING-52 nothing is lost — every board is either run or reported",
  tight.run.length + tight.skipped.length === boards.length);

const none = planBoards(boards, noHistory, { deadline: NOW - 1, now: NOW });
check("TC-ING-53 an already-spent budget starts no board at all",
  none.run.length === 0 && none.skipped.length === 4);

// The starvation bug this ordering exists to prevent: without it, a truncated
// run fetches the same first boards every night and the tail is never reached.
const history = new Map<string, number>([
  ["JSEARCH|a", NOW - 1_000],       // most recent
  ["JSEARCH|b", NOW - 90_000_000],  // oldest (25 hours ago)
  ["REMOTIVE|c", NOW - 50_000],
]);
const rotated = planBoards(boards, history, { deadline: NOW + 2 * PER_BOARD_RESERVE_MS, now: NOW });
check("TC-ING-54 a never-run board goes first",
  rotated.run[0].board === "d", rotated.run[0].board);
check("TC-ING-55 the longest-neglected board goes next",
  rotated.run[1].board === "b", rotated.run[1].board);
check("TC-ING-56 the most recently run board is the one deferred",
  rotated.skipped.some((s) => s.board === "a"),
  rotated.skipped.map((s) => s.board).join(","));

// No deadline means a machine nobody will kill — the CLI path.
const cli = planBoards(boards, history, { now: NOW });
check("TC-ING-57 no deadline runs everything",
  cli.run.length === 4 && cli.skipped.length === 0);

console.log(`\n${pass} passed, 0 failed  —  demand-driven ingestion`.replace("0 failed", `${fail} failed`));
process.exit(fail ? 1 : 0);
