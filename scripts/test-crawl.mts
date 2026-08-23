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

globalThis.fetch = realFetch;
console.log(`\n${pass} passed, ${fail} failed  —  crawl\n`);
process.exit(fail ? 1 : 0);
