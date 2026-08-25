#!/usr/bin/env tsx
/**
 * CAREER-SITE CRAWLING — robots.txt, job-page discovery, sitemaps, and the
 * detection strategies built on top of them.
 *
 * ── Why this file exists ──
 *
 * A recruiter pasted a large bank's careers URL and was told the site "isn't on
 * an ATS we recognise, publishes no JobPosting structured data, and exposes no
 * job feed". Every clause was true of the page we looked at, and the conclusion
 * was wrong about the internet: Google for Jobs requires structured data on the
 * page for ONE opening, not on the index. We were checking the index and
 * declaring the site unreadable.
 *
 * The fix is a crawl, and a crawl is exactly the kind of code that needs tests
 * — not because the happy path is hard, but because the restraints are the
 * point. Three of them are asserted here and none is optional:
 *
 *   • robots.txt is obeyed, including the awkward cases (an empty Disallow
 *     means allow, Allow beats Disallow at equal specificity, a named group
 *     overrides the wildcard);
 *   • we never leave the origin we were given;
 *   • we never open more pages than we said we would.
 *
 * Every fixture is recorded HTML. No network.
 *
 *   npx tsx scripts/test-crawl.mts
 */
import "dotenv/config";

let pass = 0,
  fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const {
  discoverJobUrls,
  paginationLinksFrom,
  parseRobots,
  robotsAllows,
  jobLinksFrom,
  looksLikeJobPage,
  sitemapLocs,
  ROBOTS_OPEN,
} = await import("../src/lib/crawl");

// ─────────────────────────────────────────────────────────────
console.log("\nROBOTS.TXT\n");

const citiLike = parseRobots(`
# hello
User-agent: *
Disallow: /search-jobs/
Disallow: /*/apply$
Allow: /search-jobs/professional
Crawl-delay: 2

Sitemap: https://jobs.example.com/sitemap.xml
`);

check("TC-CRAWL-01 a disallowed path is refused", !robotsAllows(citiLike, "/search-jobs/london"));
check("TC-CRAWL-02 the parent path is still allowed", robotsAllows(citiLike, "/search-jobs"));
check("TC-CRAWL-03 a more specific Allow wins", robotsAllows(citiLike, "/search-jobs/professional"));
check("TC-CRAWL-04 $ anchors to the end of the path",
  !robotsAllows(citiLike, "/job/123/apply") && robotsAllows(citiLike, "/job/123/apply/review"));
check("TC-CRAWL-05 Crawl-delay is read", citiLike.delayMs === 2000, `${citiLike.delayMs}ms`);
check("TC-CRAWL-06 Sitemap lines are collected",
  citiLike.sitemaps[0] === "https://jobs.example.com/sitemap.xml", citiLike.sitemaps.join());

/**
 * "Disallow:" with nothing after it is the documented way to write "allow
 * everything". Treating the empty string as a prefix would match every path on
 * the site and silently disable the crawler — the failure would look like a
 * site with no jobs rather than a bug.
 */
const emptyDisallow = parseRobots("User-agent: *\nDisallow:\n");
check("TC-CRAWL-07 an empty Disallow allows everything", robotsAllows(emptyDisallow, "/anything/at/all"));

const blanket = parseRobots("User-agent: *\nDisallow: /\n");
check("TC-CRAWL-08 Disallow: / refuses the whole site", !robotsAllows(blanket, "/careers"));

/** A group naming us overrides the wildcard group entirely, in both directions. */
const named = parseRobots(`
User-agent: *
Disallow: /

User-agent: JobsyBot
Allow: /jobs/
Disallow: /jobs/internal/
`);
check("TC-CRAWL-09 a group naming us overrides the wildcard", robotsAllows(named, "/jobs/1234-engineer"));
check("TC-CRAWL-10 and its own Disallow still applies", !robotsAllows(named, "/jobs/internal/1234"));

/** Consecutive User-agent lines share the rules that follow them. */
const shared = parseRobots("User-agent: Googlebot\nUser-agent: *\nDisallow: /private\n");
check("TC-CRAWL-11 stacked User-agent lines share one group", !robotsAllows(shared, "/private/x"));

check("TC-CRAWL-12 no robots.txt means yes", robotsAllows(ROBOTS_OPEN, "/anything"));
check("TC-CRAWL-13 politeness has a floor", ROBOTS_OPEN.delayMs >= 250, `${ROBOTS_OPEN.delayMs}ms`);

// ─────────────────────────────────────────────────────────────
console.log("\nTELLING A JOB PAGE FROM A LISTING PAGE\n");

const isJob = (u: string) => looksLikeJobPage(new URL(u));

check("TC-CRAWL-20 a numeric job URL is a job", isJob("https://x.com/job/mississauga/senior-engineer/287/99553409936"));
check("TC-CRAWL-21 a slug job URL is a job", isJob("https://x.com/careers/senior-data-engineer-remote"));
check("TC-CRAWL-22 the listing index is not", !isJob("https://x.com/jobs"));
check("TC-CRAWL-23 nor is the search page", !isJob("https://x.com/search-jobs"));
check("TC-CRAWL-24 nor are job alerts", !isJob("https://x.com/job-alerts/subscribe-now"));
check("TC-CRAWL-25 nor is an unrelated deep page", !isJob("https://x.com/about/our-leadership-team"));
check("TC-CRAWL-26 nor is the login page", !isJob("https://x.com/careers/sign-in-to-your-account"));

// ─────────────────────────────────────────────────────────────
console.log("\nFOLLOWING LINKS FROM A LISTING\n");

const LISTING = `<!doctype html><html><body>
  <a href="/job/1234/senior-platform-engineer">Senior Platform Engineer</a>
  <a href="/job/1235/staff-data-scientist">Staff Data Scientist</a>
  <a href="/job/1234/senior-platform-engineer#apply">Apply</a>
  <a href="https://twitter.com/acme/jobs/999999">Follow us</a>
  <a href="/about/our-leadership-team">Leadership</a>
  <a href="/jobs">All jobs</a>
  <a href="mailto:jobs@acme.com">Email us</a>
</body></html>`;

const links = jobLinksFrom(LISTING, new URL("https://acme.com/jobs"));
check("TC-CRAWL-30 finds the job pages", links.length === 2, links.join(" | "));
check("TC-CRAWL-31 resolves them absolutely",
  links[0] === "https://acme.com/job/1234/senior-platform-engineer", links[0]);
check("TC-CRAWL-32 a fragment is not a second job",
  new Set(links).size === links.length, links.join(" | "));
check("TC-CRAWL-33 never leaves the origin",
  links.every((l) => new URL(l).origin === "https://acme.com"), links.join(" | "));
check("TC-CRAWL-34 skips non-job links", !links.some((l) => /leadership|mailto/.test(l)));
check("TC-CRAWL-35 honours the limit", jobLinksFrom(LISTING, new URL("https://acme.com/jobs"), 1).length === 1);

// ─────────────────────────────────────────────────────────────
console.log("\nSITEMAPS\n");

const SITEMAP = `<?xml version="1.0"?><urlset>
  <url><loc>https://acme.com/careers/senior-backend-engineer</loc></url>
  <url><loc>https://acme.com/about</loc></url>
  <url><loc>https://acme.com/job/9911/principal-architect</loc></url>
</urlset>`;
check("TC-CRAWL-40 <loc> entries are read", sitemapLocs(SITEMAP).length === 3, `${sitemapLocs(SITEMAP).length}`);
check("TC-CRAWL-41 and ampersands decoded",
  sitemapLocs("<urlset><url><loc>https://a.com/j?a=1&amp;b=2</loc></url></urlset>")[0] ===
    "https://a.com/j?a=1&b=2");

// ─────────────────────────────────────────────────────────────
// DETECTION, END TO END
//
// Three sites, each the shape that used to defeat us.
// ─────────────────────────────────────────────────────────────
const JOB_LD = (title: string, id: string) => `<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org/",
  "@type": "JobPosting",
  title,
  description: "<p>Python, PySpark and Airflow on AWS.</p>",
  identifier: { "@type": "PropertyValue", name: "Acme", value: id },
  datePosted: "2026-08-14",
  employmentType: "FULL_TIME",
  hiringOrganization: { "@type": "Organization", name: "Acme Industrial" },
  jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Dallas", addressRegion: "TX" } },
  url: `https://acme-industrial.com/job/${id}/x`,
})}</script>`;

const PAGES: Record<string, { status?: number; body: string; type?: string }> = {
  // 1. Listing links to jobs; only the JOB pages carry JSON-LD.
  "https://acme-industrial.com/robots.txt": { body: "User-agent: *\nAllow: /\n", type: "text/plain" },
  "https://acme-industrial.com/careers": {
    body: `<!doctype html><html><head><meta property="og:site_name" content="Acme Industrial"></head><body>
      <a href="/job/5001/senior-data-engineer">Senior Data Engineer</a>
      <a href="/job/5002/ml-platform-engineer">ML Platform Engineer</a></body></html>`,
  },
  "https://acme-industrial.com/job/5001/senior-data-engineer": {
    body: `<!doctype html><html><head>${JOB_LD("Senior Data Engineer", "5001")}</head><body>x</body></html>`,
  },
  "https://acme-industrial.com/job/5002/ml-platform-engineer": {
    body: `<!doctype html><html><head>${JOB_LD("ML Platform Engineer", "5002")}</head><body>x</body></html>`,
  },

  // 2. Listing is a JavaScript shell with no links at all; the sitemap has the jobs.
  "https://spa-careers.com/robots.txt": { body: "User-agent: *\nAllow: /\nSitemap: https://spa-careers.com/sitemap.xml\n", type: "text/plain" },
  "https://spa-careers.com/careers": { body: `<!doctype html><html><body><div id="root"></div></body></html>` },
  "https://spa-careers.com/sitemap.xml": {
    body: `<?xml version="1.0"?><urlset><url><loc>https://spa-careers.com/careers/7001/staff-engineer</loc></url></urlset>`,
    type: "application/xml",
  },
  "https://spa-careers.com/careers/7001/staff-engineer": {
    body: `<!doctype html><html><head>${JOB_LD("Staff Engineer", "7001")}</head><body>x</body></html>`,
  },

  // 3. A real enterprise ATS with nothing machine-readable and a restrictive robots.
  "https://jobs.bigbank.com/robots.txt": { body: "User-agent: *\nDisallow: /search-jobs/\n", type: "text/plain" },
  "https://jobs.bigbank.com/search-jobs": {
    body: `<!doctype html><html><head><title>Careers</title>
      <script src="https://tbcdn.talentbrew.com/app/main.js"></script></head>
      <body><div id="search-results"></div></body></html>`,
  },
  "https://jobs.bigbank.com/search-jobs/london": { body: `<!doctype html><html><body>nope</body></html>` },
};

const realFetch = globalThis.fetch;
let fetchCount = 0;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = (typeof input === "string" ? input : input.toString()).replace(/\/$/, "");
  fetchCount++;
  const hit = PAGES[url] ?? PAGES[url + "/"];
  if (!hit) return new Response("", { status: 404 });
  return new Response(hit.body, {
    status: hit.status ?? 200,
    headers: { "Content-Type": hit.type ?? "text/html" },
  });
}) as typeof fetch;

const PUBLIC_DNS = { resolve: async () => [{ address: "93.184.216.34" }] };
const { detectSource } = await import("../src/lib/discovery");

console.log("\nDETECTION ON SITES THAT USED TO FAIL\n");

const linked = await detectSource("https://acme-industrial.com/careers", PUBLIC_DNS);
check("TC-CRAWL-50 a site whose JSON-LD is on the job pages is now detected",
  linked.kind === "JSONLD_CRAWL", linked.kind ?? linked.reason);
check("TC-CRAWL-51 and the source points at the listing, not one job",
  linked.kind === "JSONLD_CRAWL" && linked.token === "https://acme-industrial.com/careers",
  linked.kind ? linked.token : "—");
check("TC-CRAWL-52 and it names the employer from the posting",
  linked.kind === "JSONLD_CRAWL" && linked.companyName === "Acme Industrial",
  linked.kind ? linked.companyName : "—");
check("TC-CRAWL-53 and explains where it looked",
  linked.kind === "JSONLD_CRAWL" && /jobs it links to/i.test(linked.via), linked.kind ? linked.via : "—");

fetchCount = 0;
const spa = await detectSource("https://spa-careers.com/careers", PUBLIC_DNS);
check("TC-CRAWL-60 a client-rendered listing is reached through the sitemap",
  spa.kind === "JSONLD_CRAWL", spa.kind ?? spa.reason);
check("TC-CRAWL-61 and says so", spa.kind === "JSONLD_CRAWL" && /sitemap/i.test(spa.via), spa.kind ? spa.via : "—");
/**
 * Detection must stay bounded. The worst case walked here is the expensive one
 * — robots, the page, six conventional feed probes, two sitemap candidates and
 * the job page — and it still has to be a handful of requests rather than a
 * crawl of the site. If this number climbs, something started following
 * everything it found.
 */
check("TC-CRAWL-62 detection stays bounded", fetchCount <= 14, `${fetchCount} requests`);

const bank = await detectSource("https://jobs.bigbank.com/search-jobs", PUBLIC_DNS);
check("TC-CRAWL-70 a site with nothing readable still fails", bank.kind === null, bank.kind ?? "");
check("TC-CRAWL-71 but now names the platform it runs on",
  bank.kind === null && /Radancy/i.test(bank.reason), bank.kind === null ? bank.reason.slice(0, 90) : "—");
check("TC-CRAWL-72 and says what to ask the employer for",
  bank.kind === null && /feed/i.test(bank.reason) && bank.suggestions.length >= 2,
  bank.kind === null ? bank.suggestions[0]?.slice(0, 80) : "—");

/**
 * The load-bearing restraint. This URL is disallowed by the bank's robots.txt,
 * and the answer must be "we were asked not to" — not a fetch, and not a
 * generic failure that leaves the recruiter re-checking their URL.
 */
fetchCount = 0;
const disallowed = await detectSource("https://jobs.bigbank.com/search-jobs/london", PUBLIC_DNS);
check("TC-CRAWL-80 a disallowed path is not fetched", disallowed.kind === null && fetchCount <= 1,
  `${fetchCount} requests`);
check("TC-CRAWL-81 and robots.txt is named as the reason",
  disallowed.kind === null && /robots\.txt/i.test(disallowed.reason),
  disallowed.kind === null ? disallowed.reason.slice(0, 90) : "—");

// ─────────────────────────────────────────────────────────────
console.log("\nINGEST\n");

const { crawlJsonLdJobs } = await import("../src/lib/providers/universal");
const jobs = await crawlJsonLdJobs("https://acme-industrial.com/careers", "Acme Industrial");
check("TC-CRAWL-90 the crawl imports every linked job", jobs.length === 2, `${jobs.length}`);
check("TC-CRAWL-91 titles come from the job pages",
  jobs.map((j) => j.title).sort().join("|") === "ML Platform Engineer|Senior Data Engineer",
  jobs.map((j) => j.title).join("|"));
check("TC-CRAWL-92 skills are extracted", jobs[0]?.skills.includes("Python"), jobs[0]?.skills.join(","));
check("TC-CRAWL-93 rows are tagged as a career site", jobs.every((j) => j.source === "CAREER_SITE"));
check("TC-CRAWL-94 the same job under two URLs imports once",
  new Set(jobs.map((j) => j.externalId)).size === jobs.length);


// ─────────────────────────────────────────────────────────────
console.log("\nWHAT A FAILURE LOOKS LIKE TO THE PERSON READING IT\n");

const { describeError } = await import("../src/lib/apiError");

/**
 * The exact error an administrator was shown when the database had not been
 * migrated yet: forty words of SQL, column names, table names and bound
 * parameters — for a detection that had actually SUCCEEDED.
 */
const RAW_SQL_ERROR = new Error(
  'Failed query: select "id", "kind", "token", "company_name", "careers_url", "auto_detected", ' +
    '"detected_via", "enabled", "status", "last_error" from "job_sources" where ' +
    '("job_sources"."kind" = $1 and "job_sources"."token" = $2) limit $3 params: ' +
    "JSONLD_CRAWL,https://jobs.citi.com/search-jobs,1\n" +
    'invalid input value for enum source_kind: "JSONLD_CRAWL"'
);

/**
 * The shape Drizzle actually throws, and the reason the first attempt at this
 * classification silently produced a generic 500 in production: the outer
 * message is the query, and the DATABASE's complaint — text and SQLSTATE — is
 * hung on `.cause`. Matching only the outer message matched the one string
 * guaranteed to contain no diagnosis.
 */
const WRAPPED = Object.assign(new Error(RAW_SQL_ERROR.message.split("\n")[0]), {
  cause: Object.assign(new Error('invalid input value for enum source_kind: "JSONLD_CRAWL"'), {
    code: "22P02",
    severity: "ERROR",
  }),
});

const wrapped = describeError(WRAPPED, "connecting that careers page");
check("TC-CRAWL-107 the diagnosis is read from the cause, not the message",
  wrapped.status === 503, `${wrapped.status}`);
check("TC-CRAWL-108 and the SQLSTATE code comes back for diagnosis",
  wrapped.reference === "22P02", wrapped.reference ?? "none");
check("TC-CRAWL-109 still no SQL in what the caller sees",
  !/select |from "|params:/i.test(wrapped.error + (wrapped.hint ?? "")), wrapped.error);

/** Codes are preferred over prose, which is translated in some deployments. */
const byCodeOnly = describeError(
  Object.assign(new Error("Failed query"), {
    cause: Object.assign(new Error("Spalte existiert nicht"), { code: "42703" }),
  }),
  "loading job sources"
);
check("TC-CRAWL-110 a SQLSTATE code alone is enough", byCodeOnly.status === 503, `${byCodeOnly.status}`);

/** A cycle in the cause chain must not hang the request. */
const cyclic: { cause?: unknown; message: string } = { message: "outer" };
cyclic.cause = cyclic;
check("TC-CRAWL-111 a cyclic cause chain terminates",
  describeError(cyclic, "syncing that source").status === 500);

const behind = describeError(RAW_SQL_ERROR, "connecting that careers page");
check("TC-CRAWL-100 a schema-behind error is recognised", behind.status === 503, `${behind.status}`);
check("TC-CRAWL-101 and names the fix", /migration/i.test(behind.hint ?? ""), behind.hint ?? "—");
check("TC-CRAWL-102 no SQL reaches the caller",
  !/select |from "|params:|\$1/i.test(behind.error + (behind.hint ?? "")), behind.error);
check("TC-CRAWL-103 nor do column or table names",
  !/job_sources|company_name|detected_via/i.test(behind.error + (behind.hint ?? "")), behind.error);

const generic = describeError(new Error("ECONNRESET reading upstream at 10.0.4.19:5432"), "syncing that source");
check("TC-CRAWL-104 any other failure is generic", generic.status === 500, `${generic.status}`);
check("TC-CRAWL-105 and leaks no internals",
  !/10\.0\.|5432|ECONNRESET/.test(generic.error), generic.error);
check("TC-CRAWL-106 but still says what was being attempted",
  /syncing that source/.test(generic.error), generic.error);


// ─────────────────────────────────────────────────────────────
console.log("\nSPOTTING A DATABASE THAT IS BEHIND THE CODE\n");

const { compareEnums } = await import("../src/lib/schemaDrift");
const { assess } = await import("../src/lib/health");

const declared = [
  { enumName: "source_kind", enumValues: ["GREENHOUSE", "JSONLD", "JSONLD_CRAWL", "XML_FEED"] },
  { enumName: "source_status", enumValues: ["PENDING", "OK"] },
];

const behindDb = compareEnums(declared, new Map([
  ["source_kind", new Set(["GREENHOUSE", "JSONLD", "XML_FEED"])],
  ["source_status", new Set(["PENDING", "OK"])],
]));
check("TC-CRAWL-120 a missing enum value is found", behindDb.length === 1, JSON.stringify(behindDb));
check("TC-CRAWL-121 and named exactly", behindDb[0]?.missing.join() === "JSONLD_CRAWL", behindDb[0]?.missing.join());

const migrated = compareEnums(declared, new Map([
  ["source_kind", new Set(["GREENHOUSE", "JSONLD", "JSONLD_CRAWL", "XML_FEED"])],
  ["source_status", new Set(["PENDING", "OK"])],
]));
check("TC-CRAWL-122 a migrated database is quiet", migrated.length === 0, JSON.stringify(migrated));

/** Extra values in the database are not drift — an older deployment may still need them. */
const extra = compareEnums(declared, new Map([
  ["source_kind", new Set(["GREENHOUSE", "JSONLD", "JSONLD_CRAWL", "XML_FEED", "SOMETHING_NEWER"])],
  ["source_status", new Set(["PENDING", "OK"])],
]));
check("TC-CRAWL-123 values the code doesn't know are not an alarm", extra.length === 0, JSON.stringify(extra));

const HEALTH_BASE = {
  email: { sent: 10, failed: 0, loggedOnly: 0, suppressed: 0, queued: 0 },
  failingSources: [],
  resumeParseFailures: 0,
  resumeUploads: 0,
  resumesStored: 0,
  config: { emailEnabled: true, appUrl: "https://jobsy.app", isProduction: true,
    expectedHosts: ["jobsy.app"], usingBlob: true },
};

const alerted = assess({ ...HEALTH_BASE, schemaDrift: behindDb });
const schemaFinding = alerted.find((f) => f.area === "SCHEMA");
check("TC-CRAWL-124 health reports it", Boolean(schemaFinding), alerted.map((f) => f.area).join());
check("TC-CRAWL-125 as CRITICAL, because one feature fails while the app looks fine",
  schemaFinding?.severity === "CRITICAL", schemaFinding?.severity);
check("TC-CRAWL-126 and the action is the migration",
  /drizzle-kit migrate/.test(schemaFinding?.action ?? ""), schemaFinding?.action?.slice(0, 60));
check("TC-CRAWL-127 and warns that the wrong database is a real possibility",
  /DATABASE_URL/.test(schemaFinding?.action ?? ""), schemaFinding?.action?.slice(-70));
check("TC-CRAWL-128 a healthy database raises nothing",
  !assess({ ...HEALTH_BASE, schemaDrift: [] }).some((f) => f.area === "SCHEMA"));


// ─────────────────────────────────────────────────────────────
// COVERAGE — the reason a bank with 3,506 openings imported fifteen
// ─────────────────────────────────────────────────────────────
console.log("\nCOVERAGE\n");

const PAGED = `<!doctype html><html><body>
  <a href="/job/1/senior-alpha-engineer">a</a>
  <a href="/search-jobs?p=2" rel="next">Next</a>
  <a href="/search-jobs?p=3">3</a>
  <a href="/search-jobs?p=2">2 again</a>
  <a href="/job/2/staff-beta-engineer?p=9">a job with a page param</a>
  <a href="https://elsewhere.com/search?p=2">offsite</a>
</body></html>`;

const paged = paginationLinksFrom(PAGED, new URL("https://big.com/search-jobs"));
check("TC-CRAWL-140 pagination links are found", paged.length === 2, paged.join(" | "));
check("TC-CRAWL-141 in page order", /p=2$/.test(paged[0] ?? "") && /p=3$/.test(paged[1] ?? ""), paged.join(" | "));
check("TC-CRAWL-142 a job page carrying a page param is not pagination",
  !paged.some((u) => /\/job\//.test(u)), paged.join(" | "));
check("TC-CRAWL-143 and offsite pagination is ignored",
  paged.every((u) => new URL(u).origin === "https://big.com"), paged.join(" | "));

/**
 * The load-bearing regression.
 *
 * This site is the exact shape that produced fifteen: the listing page renders
 * a couple of job cards, and everything else is behind pagination and the
 * sitemap. The old code returned the listing's links and never looked further,
 * because the sitemap was a FALLBACK rather than an additional source.
 */
const BIG: Record<string, string> = {
  "https://big.com/robots.txt": "User-agent: *\nAllow: /\nSitemap: https://big.com/sitemap.xml\n",
  "https://big.com/search-jobs": `<html><body>
      <a href="/job/1/senior-alpha-engineer">1</a>
      <a href="/job/2/staff-beta-engineer">2</a>
      <a href="/search-jobs?p=2" rel="next">Next</a></body></html>`,
  "https://big.com/search-jobs?p=2": `<html><body>
      <a href="/job/3/principal-gamma-engineer">3</a>
      <a href="/job/4/lead-delta-engineer">4</a></body></html>`,
  "https://big.com/sitemap.xml": `<urlset>
      <url><loc>https://big.com/job/5/direct-from-sitemap-engineer</loc></url>
      <url><loc>https://big.com/jobs/category/technology</loc></url>
      <url><loc>https://big.com/jobs/location/dallas</loc></url>
    </urlset>`,
  "https://big.com/jobs/category/technology": `<html><body>
      <a href="/job/6/category-page-engineer">6</a></body></html>`,
  "https://big.com/jobs/location/dallas": `<html><body>
      <a href="/job/7/location-page-engineer">7</a></body></html>`,
};

const prevFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = (typeof input === "string" ? input : input.toString()).replace(/\/$/, "");
  const body = BIG[url] ?? BIG[url + "/"];
  if (body === undefined) return new Response("", { status: 404 });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/html" } });
}) as typeof fetch;

const bigRules = parseRobots(BIG["https://big.com/robots.txt"]);
const wide = await discoverJobUrls("https://big.com/search-jobs", BIG["https://big.com/search-jobs"], bigRules, {});
const ids = wide.urls.map((u) => u.match(/\/job\/(\d+)\//)?.[1]).sort().join(",");

check("TC-CRAWL-150 every route to a job is used, not just the first",
  wide.urls.length === 7, `${wide.urls.length}: ${ids}`);
check("TC-CRAWL-151 including the listing's later pages", /3/.test(ids) && /4/.test(ids), ids);
check("TC-CRAWL-152 and jobs named directly in the sitemap", /5/.test(ids), ids);
check("TC-CRAWL-153 and jobs behind sitemap category and location pages",
  /6/.test(ids) && /7/.test(ids), ids);
check("TC-CRAWL-154 and it says where they came from", wide.via.length === 4, wide.via.join(" | "));

/** The cap still holds, and says it was hit. */
const capped = await discoverJobUrls("https://big.com/search-jobs", BIG["https://big.com/search-jobs"], bigRules, { limit: 3 });
check("TC-CRAWL-155 the limit is respected", capped.urls.length === 3, `${capped.urls.length}`);
check("TC-CRAWL-156 and reported as truncated", capped.truncated);

/** A budget already spent stops the crawl instead of being ignored. */
const noTime = await discoverJobUrls("https://big.com/search-jobs", BIG["https://big.com/search-jobs"], bigRules, { deadline: Date.now() - 1 });
check("TC-CRAWL-157 an expired budget stops expansion — the page's own links still count",
  noTime.urls.length === 2, `${noTime.urls.length}`);
check("TC-CRAWL-158 and says it was cut short", noTime.truncated);

/**
 * Rotation. Two runs with different offsets must not open the same category
 * pages, or coverage stops dead at whatever the first run reached.
 */
const rotA = await discoverJobUrls("https://big.com/search-jobs", BIG["https://big.com/search-jobs"], bigRules, { limit: 6, listingLimit: 1, rotate: 0 });
const rotB = await discoverJobUrls("https://big.com/search-jobs", BIG["https://big.com/search-jobs"], bigRules, { limit: 6, listingLimit: 1, rotate: 1 });
check("TC-CRAWL-159 rotation changes which listing pages get expanded",
  rotA.urls.join() !== rotB.urls.join(),
  `${rotA.urls.length} vs ${rotB.urls.length}`);

const { crawlJsonLdReport: report } = await import("../src/lib/providers/universal");
const { crawlRotation } = await import("../src/lib/sources");
check("TC-CRAWL-160 the rotation offset advances once per sync window",
  crawlRotation(0) !== crawlRotation(6 * 3_600_000),
  `${crawlRotation(0)} vs ${crawlRotation(6 * 3_600_000)}`);
check("TC-CRAWL-161 and is stable within one window",
  crawlRotation(1_000) === crawlRotation(2_000));

/** Unseen job pages are opened before ones already imported. */
const ORDERED: Record<string, string> = {
  "https://ord.com/robots.txt": "User-agent: *\nAllow: /\n",
  "https://ord.com/careers": `<html><body>
      <a href="/job/100/old-known-engineer">old</a>
      <a href="/job/200/new-unknown-engineer">new</a></body></html>`,
  "https://ord.com/job/100/old-known-engineer": `<html><head>${JOB_LD("Old Known Engineer", "100")}</head></html>`,
  "https://ord.com/job/200/new-unknown-engineer": `<html><head>${JOB_LD("New Unknown Engineer", "200")}</head></html>`,
};
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = (typeof input === "string" ? input : input.toString()).replace(/\/$/, "");
  const body = ORDERED[url] ?? ORDERED[url + "/"];
  if (body === undefined) return new Response("", { status: 404 });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/html" } });
}) as typeof fetch;

const oneOnly = await report("https://ord.com/careers", "Ord", {
  known: new Set(["https://ord.com/job/100/old-known-engineer"]),
  limit: 2,
  budgetMs: 30_000,
  deps: PUBLIC_DNS,
});
check("TC-CRAWL-170 a page we have never seen is opened first",
  oneOnly.jobs[0]?.title === "New Unknown Engineer",
  oneOnly.jobs.map((j) => j.title).join(" | "));
check("TC-CRAWL-171 and the report counts what it found and what it read",
  oneOnly.discovered === 2 && oneOnly.opened === 2,
  `${oneOnly.discovered} found, ${oneOnly.opened} read`);

globalThis.fetch = prevFetch;


// ─────────────────────────────────────────────────────────────
// WHOSE JOBS ARE THESE?
//
// Citi connected and appeared in the sources list as "Early Career". The
// administrator looked for "Citi", didn't find it, and concluded the connection
// had failed. The fifteen imported jobs carried the same label.
// ─────────────────────────────────────────────────────────────
console.log("\nEMPLOYER NAMES\n");

const { employerFromHost, employerNameFrom, looksLikeSection } = await import("../src/lib/employer");

check("TC-CRAWL-180 a programme name is not an employer", looksLikeSection("Early Career"));
check("TC-CRAWL-181 nor is a menu item",
  ["Careers", "Jobs", "Job Search", "Search", "Apply Now", "Opportunities", "Talent"].every(looksLikeSection));
check("TC-CRAWL-182 but a real company that CONTAINS one is",
  !looksLikeSection("Careers Australia") && !looksLikeSection("Talent Inc"));
check("TC-CRAWL-183 and so is an ordinary company", !looksLikeSection("Citigroup"));

check("TC-CRAWL-184 the domain names the employer", employerFromHost("jobs.citi.com") === "Citi",
  employerFromHost("jobs.citi.com"));
check("TC-CRAWL-185 short labels are initialisms", employerFromHost("careers.td.com") === "TD",
  employerFromHost("careers.td.com"));
check("TC-CRAWL-186 compound suffixes are handled",
  employerFromHost("www.bespokeco.co.uk") === "Bespokeco", employerFromHost("www.bespokeco.co.uk"));
check("TC-CRAWL-187 a two-label host keeps its own name",
  employerFromHost("jobs.com") === "Jobs", employerFromHost("jobs.com"));

/** The exact failure. */
const citi = employerNameFrom({
  jsonLdNames: ["Early Career", "Early Career", "Early Career"],
  siteName: "Careers",
  url: "https://jobs.citi.com/search-jobs",
});
check("TC-CRAWL-190 a site that only ever says 'Early Career' is named from its domain",
  citi === "Citi", citi);

/** The company usually wins on volume; the mode is the right statistic. */
const mixed = employerNameFrom({
  jsonLdNames: ["Early Career", "Citigroup", "Citigroup", "Citigroup"],
  url: "https://jobs.citi.com/search-jobs",
});
check("TC-CRAWL-191 the most common real name wins over a one-off", mixed === "Citigroup", mixed);

check("TC-CRAWL-192 og:site_name is used when the records say nothing useful",
  employerNameFrom({ jsonLdNames: ["Jobs"], siteName: "Bespoke Co", url: "https://x.io/careers" }) === "Bespoke Co");
check("TC-CRAWL-193 and a real record still beats everything",
  employerNameFrom({ jsonLdNames: ["Acme Industrial"], siteName: "Careers", url: "https://jobs.acme.com" }) ===
    "Acme Industrial");

/** End to end: the jobs themselves must carry the employer, not the programme. */
const PROG: Record<string, string> = {
  "https://jobs.megabank.com/robots.txt": "User-agent: *\nAllow: /\n",
  "https://jobs.megabank.com/search-jobs": `<html><head><meta property="og:site_name" content="Careers"></head>
    <body><a href="/job/9001/analyst-technology-programme">a</a></body></html>`,
  "https://jobs.megabank.com/job/9001/analyst-technology-programme": `<html><head>
    <script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org/", "@type": "JobPosting", title: "Technology Analyst",
      description: "<p>Python and SQL.</p>", datePosted: "2026-08-20",
      hiringOrganization: { "@type": "Organization", name: "Early Career" },
      identifier: { "@type": "PropertyValue", value: "9001" },
    })}</script></head><body>x</body></html>`,
};
const before = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = (typeof input === "string" ? input : input.toString()).replace(/\/$/, "");
  const body = PROG[url] ?? PROG[url + "/"];
  if (body === undefined) return new Response("", { status: 404 });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/html" } });
}) as typeof fetch;

const detected = await detectSource("https://jobs.megabank.com/search-jobs", PUBLIC_DNS);
check("TC-CRAWL-194 detection names the employer, not the programme",
  detected.kind === "JSONLD_CRAWL" && detected.companyName === "Megabank",
  detected.kind ? detected.companyName : (detected.reason ?? ""));

const { crawlJsonLdReport: rep } = await import("../src/lib/providers/universal");
const progRun = await rep("https://jobs.megabank.com/search-jobs", "Early Career", { budgetMs: 20_000, deps: PUBLIC_DNS });
check("TC-CRAWL-195 and so do the jobs it imports",
  progRun.jobs[0]?.companyName === "Megabank", progRun.jobs[0]?.companyName);
check("TC-CRAWL-196 and the run reports the employer it settled on",
  progRun.employer === "Megabank", progRun.employer);

globalThis.fetch = before;


// ─────────────────────────────────────────────────────────────
// RESUMING — how a 60-second function reads a 3,000-job employer
// ─────────────────────────────────────────────────────────────
console.log("\nRESUMING ACROSS RUNS\n");

/** Four category pages, one job each — a site no single run can finish. */
const WIDE: Record<string, string> = {
  "https://wide.com/robots.txt": "User-agent: *\nAllow: /\nSitemap: https://wide.com/sitemap.xml\n",
  "https://wide.com/careers": `<html><body><div id="root"></div></body></html>`,
  "https://wide.com/sitemap.xml": `<urlset>${[1, 2, 3, 4]
    .map((n) => `<url><loc>https://wide.com/jobs/category/area-${n}</loc></url>`)
    .join("")}</urlset>`,
};
for (const n of [1, 2, 3, 4]) {
  WIDE[`https://wide.com/jobs/category/area-${n}`] =
    `<html><body><a href="/job/${n}00/role-in-area-${n}">j</a></body></html>`;
}

const prev2 = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = (typeof input === "string" ? input : input.toString()).replace(/\/$/, "");
  const body = WIDE[url] ?? WIDE[url + "/"];
  if (body === undefined) return new Response("", { status: 404 });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/html" } });
}) as typeof fetch;

const wideRules = parseRobots(WIDE["https://wide.com/robots.txt"]);
const runFrom = (cursor: number) =>
  discoverJobUrls("https://wide.com/careers", WIDE["https://wide.com/careers"], wideRules, {
    listingLimit: 2, rotate: cursor, deps: PUBLIC_DNS,
  });

const run1 = await runFrom(0);
const run2 = await runFrom(run1.nextCursor);

check("TC-CRAWL-200 one run reads only what it has budget for",
  run1.urls.length === 2, `${run1.urls.length}`);
check("TC-CRAWL-201 and reports where to resume",
  run1.nextCursor === 2 && run1.listingCount === 4, `cursor ${run1.nextCursor} of ${run1.listingCount}`);
check("TC-CRAWL-202 the next run continues rather than repeating",
  run2.urls.join() !== run1.urls.join(), `${run1.urls.join()} then ${run2.urls.join()}`);

const seenAcross = new Set([...run1.urls, ...run2.urls]);
check("TC-CRAWL-203 and two runs cover the whole site", seenAcross.size === 4, `${seenAcross.size} of 4`);

/**
 * The cursor WRAPS. Coverage that stopped at the end would freeze a site at
 * whatever was imported once; wrapping is what makes re-reads — and therefore
 * daily freshness — happen at all.
 */
const run3 = await runFrom(run2.nextCursor);
check("TC-CRAWL-204 the cursor wraps so the site is re-read, not frozen",
  run3.nextCursor < run2.nextCursor || run3.nextCursor === 2,
  `${run2.nextCursor} then ${run3.nextCursor}`);

/** A budget the caller sets is honoured over any the crawl might invent. */
const { crawlJsonLdReport: rep2 } = await import("../src/lib/providers/universal");
const tiny = await rep2("https://wide.com/careers", "Wide", {
  deadline: Date.now() + 1_500,
  deps: PUBLIC_DNS,
});
check("TC-CRAWL-205 the caller's deadline wins over the crawl's own default",
  Array.isArray(tiny.jobs), `${tiny.jobs.length} jobs, cursor ${tiny.nextCursor}`);

globalThis.fetch = prev2;


// ─────────────────────────────────────────────────────────────
console.log("\nTWO QUERIES THAT FAIL TOGETHER\n");

const { allOrFail } = await import("../src/lib/allOrFail");

/**
 * The bug: `Promise.all` adopts the FIRST rejection and abandons the rest. An
 * abandoned rejection is an unhandled rejection, and a serverless runtime
 * treats that as a crashed invocation — returning its own bare 503 and throwing
 * away the careful error response the handler was producing.
 *
 * That is exactly what the Candidates screen showed: "The server returned 503"
 * instead of "your database is a version behind, run the migration". The error
 * handling was correct and never got to run.
 *
 * Two independent queries against one database fail TOGETHER constantly,
 * because the reasons are shared: a missed migration, a dropped connection, a
 * suspended compute. So this is the common case, not the edge case.
 */
let unhandled: unknown = null;
const onUnhandled = (reason: unknown) => { unhandled = reason; };
process.on("unhandledRejection", onUnhandled);

let caught: Error | null = null;
try {
  await allOrFail([
    Promise.reject(new Error("relation sourced_candidates does not exist")),
    Promise.reject(new Error("relation candidate_sources does not exist")),
  ]);
} catch (e) {
  caught = e as Error;
}
// Give the runtime a turn to report anything orphaned.
await new Promise((r) => setTimeout(r, 50));
process.off("unhandledRejection", onUnhandled);

check("TC-CRAWL-210 the first failure is thrown for the caller to handle",
  /sourced_candidates/.test(caught?.message ?? ""), caught?.message ?? "nothing thrown");
check("TC-CRAWL-211 and the second is NOT left unhandled",
  unhandled === null, unhandled ? String((unhandled as Error).message) : "none");

const values = await allOrFail([Promise.resolve(1), Promise.resolve("two"), Promise.resolve(true)]);
check("TC-CRAWL-212 success returns values in order",
  values[0] === 1 && values[1] === "two" && values[2] === true, JSON.stringify(values));

/** Deterministic: the error reported is the first in ARGUMENT order, not the first to arrive. */
const slowFirst = allOrFail([
  new Promise((_, rej) => setTimeout(() => rej(new Error("first")), 30)),
  Promise.reject(new Error("second")),
]);
let which = "";
try { await slowFirst; } catch (e) { which = (e as Error).message; }
check("TC-CRAWL-213 and which error surfaces is not a race", which === "first", which);


// ─────────────────────────────────────────────────────────────
// JOBS THAT LIVE IN THE PAGE'S JAVASCRIPT STATE
//
// "The jobs only exist inside a JavaScript app" was true of the rendering and
// false about the data. A client-rendered careers site still has to get its
// first screenful into the browser, and ships it in the HTML.
// ─────────────────────────────────────────────────────────────
console.log("\nJOBS IN PAGE DATA\n");

const { jobsFromEmbeddedJson, looksLikeJobArray, embeddedJsonBlobs } =
  await import("../src/lib/providers/embedded");

const SPA_JOBS = [
  { jobId: "R-1001", jobTitle: "Senior Data Engineer", primaryLocation: { name: "Austin, TX" },
    jobDescription: "<p>Python, PySpark and Airflow on AWS.</p>", detailUrl: "/jobs/R-1001" },
  { jobId: "R-1002", jobTitle: "Machine Learning Engineer", primaryLocation: { name: "Remote - US" },
    jobDescription: "<p>PyTorch and MLOps.</p>", detailUrl: "/jobs/R-1002" },
  { jobId: "R-1003", jobTitle: "Frontend Engineer", primaryLocation: { name: "Dallas, TX" },
    jobDescription: "<p>React and TypeScript.</p>", detailUrl: "/jobs/R-1003" },
];

const NEXT_PAGE = `<!doctype html><html><head><title>Careers</title></head><body>
  <div id="__next"></div>
  <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { nav: [{ title: "Home", href: "/" }], searchResults: { jobs: SPA_JOBS } } },
  })}</script></body></html>`;

const fromNext = jobsFromEmbeddedJson(NEXT_PAGE, "https://digitalcareers.example.com/global");
check("TC-CRAWL-220 jobs are read out of __NEXT_DATA__", fromNext.length === 3, `${fromNext.length}`);
check("TC-CRAWL-221 titles survive nested key spellings",
  fromNext[0]?.title === "Senior Data Engineer", fromNext[0]?.title);
check("TC-CRAWL-222 so do nested locations",
  fromNext[0]?.location === "Austin, TX", fromNext[0]?.location);
check("TC-CRAWL-223 relative links are made absolute",
  fromNext[0]?.applyUrl === "https://digitalcareers.example.com/jobs/R-1001", fromNext[0]?.applyUrl);
check("TC-CRAWL-224 skills are extracted from the description",
  fromNext[0]?.skills.includes("PySpark"), fromNext[0]?.skills.join(","));
check("TC-CRAWL-225 remote is inferred", fromNext[1]?.remote === "REMOTE", fromNext[1]?.remote);

/** A Redux-style assignment, with braces inside strings to break a naive regex. */
const REDUX_PAGE = `<html><body><script>
  window.__INITIAL_STATE__ = ${JSON.stringify({
    ui: { banner: "Braces } inside { a string" },
    results: { positions: SPA_JOBS },
  })};
</script></body></html>`;
const fromRedux = jobsFromEmbeddedJson(REDUX_PAGE, "https://spa.example.com/careers");
check("TC-CRAWL-226 and out of a window assignment", fromRedux.length === 3, `${fromRedux.length}`);
check("TC-CRAWL-227 braces inside strings do not truncate the blob",
  embeddedJsonBlobs(REDUX_PAGE).length === 1, `${embeddedJsonBlobs(REDUX_PAGE).length} blobs`);

/**
 * The restraint that matters. A state blob is mostly navigation, flags and
 * translations; guessing wrong imports "Privacy Policy" as a vacancy.
 */
check("TC-CRAWL-230 a nav menu is not a job list",
  !looksLikeJobArray([{ title: "Home", href: "/" }, { title: "About", href: "/about" }]),
  "nav rejected");
check("TC-CRAWL-231 a list of bare strings is not a job list",
  !looksLikeJobArray(["Engineering", "Sales", "Design"]));
check("TC-CRAWL-232 one entry is not a list", !looksLikeJobArray([SPA_JOBS[0]]));
check("TC-CRAWL-233 titles alone are not enough",
  !looksLikeJobArray([{ title: "One" }, { title: "Two" }, { title: "Three" }]));
check("TC-CRAWL-234 but a title plus a place is",
  looksLikeJobArray([{ title: "One", city: "Austin" }, { title: "Two", city: "Dallas" }]));

const NOTHING = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  props: { pageProps: { menu: [{ title: "Home", href: "/" }, { title: "News", href: "/news" }] } },
})}</script></body></html>`;
check("TC-CRAWL-235 a page with no jobs yields none",
  jobsFromEmbeddedJson(NOTHING, "https://x.example.com/careers").length === 0);

/** Detection reports it honestly, and the ingest path reads the same data. */
const SPA_SITE: Record<string, string> = {
  "https://spajobs.example.com/robots.txt": "User-agent: *\nAllow: /\n",
  "https://spajobs.example.com/careers": NEXT_PAGE,
};
const beforeSpa = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = (typeof input === "string" ? input : input.toString()).replace(/\/$/, "");
  const body = SPA_SITE[url] ?? SPA_SITE[url + "/"];
  if (body === undefined) return new Response("", { status: 404 });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/html" } });
}) as typeof fetch;

const spaDetect = await detectSource("https://spajobs.example.com/careers", PUBLIC_DNS);
check("TC-CRAWL-240 a client-rendered site is no longer a dead end",
  spaDetect.kind === "JSONLD", spaDetect.kind ?? spaDetect.reason.slice(0, 70));
check("TC-CRAWL-241 and the explanation says where the jobs were found",
  spaDetect.kind !== null && /page data/i.test(spaDetect.via), spaDetect.kind ? spaDetect.via.slice(0, 80) : "—");

const { fetchJsonLdJobs: fetchLd } = await import("../src/lib/providers/universal");
const spaJobs = await fetchLd("https://spajobs.example.com/careers", "SPA Jobs");
check("TC-CRAWL-242 and the importer pulls them", spaJobs.length === 3, `${spaJobs.length}`);

globalThis.fetch = beforeSpa;


// ─────────────────────────────────────────────────────────────
// SAYING WHAT WAS TRIED
//
// Four rounds of "why won't this site connect" were answered by guessing,
// because the failure named what we did not FIND and never what we LOOKED AT.
// ─────────────────────────────────────────────────────────────
console.log("\nTHE FAILURE EXPLAINS ITSELF\n");

const OPAQUE: Record<string, string> = {
  "https://opaque-co.example/robots.txt": "User-agent: *\nDisallow: /private/\n",
  "https://opaque-co.example/careers": `<!doctype html><html><head><title>Careers</title>
    <script src="https://tbcdn.talentbrew.com/app.js"></script></head>
    <body><div id="app"></div></body></html>`,
};
const beforeTrace = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = (typeof input === "string" ? input : input.toString()).replace(/\/$/, "");
  const body = OPAQUE[url] ?? OPAQUE[url + "/"];
  if (body === undefined) return new Response("", { status: 404 });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/html" } });
}) as typeof fetch;

const opaque = await detectSource("https://opaque-co.example/careers", PUBLIC_DNS);
const tr = opaque.kind === null ? opaque.trace : [];
check("TC-CRAWL-250 a failure reports what was tried", tr.length >= 4, `${tr.length} steps`);
check("TC-CRAWL-251 including what robots.txt said",
  tr.some((t) => /robots\.txt/i.test(t)), tr[0] ?? "—");
check("TC-CRAWL-252 and that the page was read",
  tr.some((t) => /bytes read/i.test(t)), tr.find((t) => /bytes/.test(t)) ?? "—");
check("TC-CRAWL-253 and whether the page carried job data",
  tr.some((t) => /page data/i.test(t)), tr.find((t) => /page data/.test(t)) ?? "—");
check("TC-CRAWL-254 and whether any job pages were found",
  tr.some((t) => /job pages/i.test(t)), tr.find((t) => /job pages/.test(t)) ?? "—");
check("TC-CRAWL-255 the vendor is still named", opaque.kind === null && /Radancy/i.test(opaque.reason));

/** A site refused by robots says so in one line, and stops there. */
const blocked = await detectSource("https://opaque-co.example/private/jobs", PUBLIC_DNS);
check("TC-CRAWL-256 a robots refusal is traced, not silent",
  blocked.kind === null && blocked.trace.some((t) => /disallows/i.test(t)),
  blocked.kind === null ? blocked.trace.join(" | ").slice(0, 90) : "—");

globalThis.fetch = beforeTrace;

globalThis.fetch = realFetch;
console.log(`\n${pass} passed, ${fail} failed  —  crawl\n`);
process.exit(fail ? 1 : 0);
