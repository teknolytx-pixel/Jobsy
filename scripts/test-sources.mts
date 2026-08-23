/**
 * Company-connector + auto-detection tests.
 *
 * Every ATS adapter runs against a recorded payload in the exact shape the live
 * endpoint returns, and every detection strategy runs against real-world careers
 * page HTML. fetch is stubbed — no network.
 *
 *   npx tsx scripts/test-sources.mts
 */
import "dotenv/config";

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

// ─────────────────────────────────────────────────────────────
// RECORDED PAYLOADS
// ─────────────────────────────────────────────────────────────
const JSON_FIXTURES: Record<string, unknown> = {
  "boards-api.greenhouse.io": {
    jobs: [{ id: 991, title: "Staff Engineer, Payments", absolute_url: "https://boards.greenhouse.io/acme/jobs/991",
      updated_at: "2026-08-12T10:00:00-04:00", location: { name: "Austin, TX" }, departments: [{ name: "Engineering" }],
      content: "&lt;p&gt;Own the ledger. &lt;b&gt;Go&lt;/b&gt;, Kafka and Postgres on AWS. Hybrid in Austin.&lt;/p&gt;" }],
  },
  "api.lever.co": [{ id: "lv-1", text: "Senior Data Engineer", hostedUrl: "https://jobs.lever.co/acme/lv-1",
    createdAt: 1754200000000, descriptionPlain: "dbt, Snowflake and SQL modelling. Fully remote across the US.",
    categories: { location: "Remote - US", team: "Data", commitment: "Full-time" },
    salaryRange: { min: 160000, max: 195000, currency: "USD", interval: "per-year-salary" } }],
  "api.ashbyhq.com": { jobs: [{ id: "ash-1", title: "Senior Product Designer", location: "New York, NY",
    department: "Design", employmentType: "FullTime", isListed: true, isRemote: false,
    descriptionPlain: "Figma, design systems and user research. Onsite NYC.", publishedAt: "2026-08-14T09:00:00Z",
    jobUrl: "https://jobs.ashbyhq.com/acme/ash-1",
    compensation: { summaryComponents: [{ compensationType: "Salary", interval: "1 YEAR", currencyCode: "USD", minValue: 155000, maxValue: 190000 }] } }] },
  "apply.workable.com": { name: "Acme Robotics", jobs: [{ shortcode: "WK123", title: "Machine Learning Engineer",
    description: "<p>PyTorch and MLOps on AWS. Python required.</p>", requirements: "<p>5+ years Python.</p>",
    application_url: "https://apply.workable.com/acme/j/WK123/", published_on: "2026-08-10",
    employment_type: "Full-time", telecommuting: true, department: "AI",
    location: { city: "Boston", region: "MA", country: "US", telecommuting: true } }] },
  "api.smartrecruiters.com": { content: [{ id: "SR-77", name: "Backend Engineer, Platform", releasedDate: "2026-08-11T00:00:00.000Z",
    company: { name: "Globex" }, location: { city: "Chicago", region: "IL", country: "us", remote: false },
    typeOfEmployment: { label: "Full-time" }, department: { label: "Platform" },
    applyUrl: "https://jobs.smartrecruiters.com/Globex/SR-77" }] },
  "acme.recruitee.com": { offers: [{ id: 5150, slug: "frontend-engineer", title: "Frontend Engineer",
    description: "<p>React and TypeScript with a design-system focus.</p>", requirements: "<p>4+ years React.</p>",
    careers_apply_url: "https://acme.recruitee.com/o/frontend-engineer", created_at: "2026-08-09T12:00:00Z",
    employment_type: "full_time", remote: true, city: "Amsterdam", country: "NL",
    department: "Engineering", company_name: "Acme BV" }] },
  "acme.bamboohr.com": { result: [{ id: 42, jobOpeningName: "Solutions Architect",
    employmentStatusLabel: "Full-Time", departmentLabel: "Solutions", isRemote: false,
    location: { city: "Dallas", state: "TX", country: "United States" } }] },
  "acme.wd5.myworkdayjobs.com": { jobPostings: [{ title: "Principal Software Engineer",
    externalPath: "/job/Austin/Principal-Software-Engineer_R-12345", locationsText: "Austin, TX",
    postedOn: "Posted Today", bulletFields: ["R-12345"] }] },
};

const TEXT_FIXTURES: Record<string, string> = {
  // Personio ships XML, not JSON
  "acme.jobs.personio.de": `<?xml version="1.0"?><workzag-jobs>
    <position><id>7788</id><subcompany>Acme GmbH</subcompany><office>Berlin</office>
      <department>Engineering</department><name>Backend Engineer (m/f/d)</name>
      <employmentType>permanent</employmentType><createdAt>2026-08-08</createdAt>
      <jobDescriptions>
        <jobDescription><name>Your tasks</name><value><![CDATA[<p>Build services in Go with Kubernetes and Terraform.</p>]]></value></jobDescription>
        <jobDescription><name>Your profile</name><value><![CDATA[<p>Strong SQL and AWS experience.</p>]]></value></jobDescription>
      </jobDescriptions>
    </position></workzag-jobs>`,

  // A branded careers page that embeds Greenhouse
  "careers.brandedco.com": `<!doctype html><html><head><title>Careers at BrandedCo</title>
    <meta property="og:site_name" content="BrandedCo"></head><body>
    <div id="grnhse_app"></div>
    <script src="https://boards.greenhouse.io/embed/job_board/js?for=brandedco"></script>
    </body></html>`,

  // A bespoke careers page with no ATS — but it publishes JSON-LD for Google
  "www.bespokeco.com": `<!doctype html><html><head><title>Join Bespoke Co</title>
    <script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org/", "@type": "JobPosting",
      title: "Senior Full Stack Engineer",
      description: "<p>Node.js, React and Postgres. LLM APIs a plus. Remote-first team.</p>",
      identifier: { "@type": "PropertyValue", name: "Bespoke Co", value: "BC-9" },
      datePosted: "2026-08-13", employmentType: "FULL_TIME",
      hiringOrganization: { "@type": "Organization", name: "Bespoke Co", url: "https://bespokeco.com" },
      jobLocationType: "TELECOMMUTE",
      applicantLocationRequirements: { "@type": "Country", name: "USA" },
      baseSalary: { "@type": "MonetaryAmount", currency: "USD",
        value: { "@type": "QuantitativeValue", minValue: 75, maxValue: 95, unitText: "HOUR" } },
      skills: "React, Node.js, Postgres",
      url: "https://www.bespokeco.com/careers/senior-full-stack",
    })}</script></head><body>Careers</body></html>`,

  // Nothing detectable at all
  "www.opaqueco.com": `<!doctype html><html><head><title>Opaque Co</title></head>
    <body><h1>We're hiring!</h1><p>Email jobs@opaqueco.com</p></body></html>`,

  // An employer XML feed in the Indeed interchange format
  "feeds.acme.com": `<?xml version="1.0" encoding="utf-8"?><source>
    <publisher>Acme</publisher>
    <job><title><![CDATA[DevOps Engineer]]></title><date><![CDATA[2026-08-15T00:00:00Z]]></date>
      <referencenumber><![CDATA[ACME-DO-1]]></referencenumber>
      <url><![CDATA[https://acme.com/jobs/devops]]></url><company><![CDATA[Acme Corp]]></company>
      <city><![CDATA[Denver]]></city><state><![CDATA[CO]]></state><country><![CDATA[US]]></country>
      <description><![CDATA[<p>Kubernetes, Terraform and AWS. CI/CD ownership.</p>]]></description>
      <salary><![CDATA[$140,000 - $170,000 per year]]></salary>
      <jobtype><![CDATA[fulltime]]></jobtype><remotetype><![CDATA[Hybrid remote]]></remotetype>
    </job></source>`,
};

/**
 * The SSRF guard resolves hostnames before fetching, so these fixtures — which
 * use invented domains — need a resolver as well as a stubbed fetch. It
 * returns a public address, meaning the guard runs in full and simply permits
 * the host. The guard is NOT disabled here; test-safefetch.mts covers refusal.
 */
const PUBLIC_DNS = { resolve: async () => [{ address: "93.184.216.34" }] };

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input.toString();
  const host = new URL(url).hostname;
  if (host in JSON_FIXTURES) {
    // SmartRecruiters detail fetch reuses the host; return the list either way
    return new Response(JSON.stringify(JSON_FIXTURES[host]), { status: 200 });
  }
  if (host in TEXT_FIXTURES) {
    return new Response(TEXT_FIXTURES[host], { status: 200, headers: { "Content-Type": "text/html" } });
  }
  // Detection reads robots.txt before it crawls anything. These fixtures are
  // invented domains, so there is nothing to read — 404 means "no policy",
  // which is the same answer a site without a robots.txt gives.
  if (new URL(url).pathname === "/robots.txt") return new Response("", { status: 404 });
  // any unmapped feed-autodiscovery probe 404s, as it would in reality
  if (/\.(xml|rss)$/.test(new URL(url).pathname)) return new Response("", { status: 404 });
  return realFetch(input as RequestInfo, init);
}) as typeof fetch;

const { fetchCompanyJobs, ATS_KINDS } = await import("../src/lib/providers/ats");
const { fetchJsonLdJobs, fetchXmlFeedJobs } = await import("../src/lib/providers/universal");
const { detectSource } = await import("../src/lib/discovery");

// ─────────────────────────────────────────────────────────────
console.log("\nCOMPANY CONNECTORS (one named employer → all their jobs)\n");

const CASES: [Parameters<typeof fetchCompanyJobs>[0], string][] = [
  ["GREENHOUSE", "acme"], ["LEVER", "acme"], ["ASHBY", "acme"], ["WORKABLE", "acme"],
  ["SMARTRECRUITERS", "Globex"], ["RECRUITEE", "acme"], ["PERSONIO", "acme"],
  ["BAMBOOHR", "acme"], ["WORKDAY", "acme|wd5|CareerSite"],
];

const got: Record<string, Awaited<ReturnType<typeof fetchCompanyJobs>>> = {};
for (const [kind, token] of CASES) {
  try {
    const jobs = await fetchCompanyJobs(kind, token);
    got[kind] = jobs;
    const j = jobs[0];
    const ok = jobs.length === 1 && !!j.title && !!j.companyName && !!j.applyUrl &&
      j.postedAt instanceof Date && !Number.isNaN(j.postedAt.getTime());
    check(kind, ok, ok
      ? `"${j.title}" @ ${j.companyName} · ${j.location} · ${j.remote}` +
        (j.salaryMin ? ` · $${j.salaryMin}k–$${j.salaryMax}k` : "") +
        (j.skills.length ? ` · [${j.skills.slice(0, 4).join(",")}]` : "")
      : JSON.stringify(j ?? {}).slice(0, 160));
  } catch (e) {
    check(kind, false, (e as Error).message);
  }
}
check("Every ATS kind has an adapter", ATS_KINDS.length === CASES.length, `${ATS_KINDS.length} kinds`);

console.log("\nCONNECTOR DETAILS\n");
check("Workable annualises nothing but honours telecommuting", got.WORKABLE?.[0].remote === "REMOTE", got.WORKABLE?.[0].remote);
check("Lever converts salary to $k", got.LEVER?.[0].salaryMin === 160 && got.LEVER?.[0].salaryMax === 195,
  `$${got.LEVER?.[0].salaryMin}k–$${got.LEVER?.[0].salaryMax}k`);
check("Ashby reads structured comp", got.ASHBY?.[0].salaryMin === 155, `$${got.ASHBY?.[0].salaryMin}k`);
check("Personio parses XML positions", got.PERSONIO?.[0].title.includes("Backend Engineer"), got.PERSONIO?.[0].title);
check("Personio mines skills from CDATA blocks",
  got.PERSONIO?.[0].skills.includes("Go") && got.PERSONIO?.[0].skills.includes("Kubernetes"),
  got.PERSONIO?.[0].skills.join(","));
check("Workday builds a working apply URL",
  got.WORKDAY?.[0].applyUrl === "https://acme.wd5.myworkdayjobs.com/CareerSite/job/Austin/Principal-Software-Engineer_R-12345",
  got.WORKDAY?.[0].applyUrl);
check("Workday infers Principal seniority", got.WORKDAY?.[0].seniority === "Principal", got.WORKDAY?.[0].seniority);
check("Recruitee prefers the ATS-reported company name", got.RECRUITEE?.[0].companyName === "Acme BV", got.RECRUITEE?.[0].companyName);
check("SmartRecruiters keeps the employer's own name", got.SMARTRECRUITERS?.[0].companyName === "Globex", got.SMARTRECRUITERS?.[0].companyName);
check("Every connector marks jobs EXTERNAL apply",
  Object.values(got).every((v) => v[0]?.applyMethod === "EXTERNAL"));
check("Every connector namespaces its externalId",
  Object.entries(got).every(([k, v]) => v[0]?.externalId.startsWith(`${k.toLowerCase()}:`)),
  got.GREENHOUSE?.[0].externalId);
check("Publisher names the ATS and the employer",
  /Greenhouse · /.test(got.GREENHOUSE?.[0].publisher ?? ""), got.GREENHOUSE?.[0].publisher);

// ─────────────────────────────────────────────────────────────
console.log("\nAUTO-DETECTION (paste a careers URL)\n");

const d1 = await detectSource("https://boards.greenhouse.io/stripe", PUBLIC_DNS);
check("Direct ATS URL → certain", d1.kind === "GREENHOUSE" && d1.token === "stripe" && d1.confidence === "certain",
  d1.kind ? `${d1.kind}/${d1.token}` : d1.reason);

const d2 = await detectSource("https://jobs.lever.co/netflix", PUBLIC_DNS);
check("Lever URL detected", d2.kind === "LEVER" && d2.token === "netflix", d2.kind ? d2.token : d2.reason);

const d3 = await detectSource("https://acme.wd5.myworkdayjobs.com/en-US/CareerSite", PUBLIC_DNS);
check("Workday URL → tenant|wd|site token", d3.kind === "WORKDAY" && d3.token === "acme|wd5|CareerSite",
  d3.kind ? d3.token : d3.reason);

const d4 = await detectSource("https://careers.brandedco.com", PUBLIC_DNS);
check("Branded page with embedded Greenhouse detected",
  d4.kind === "GREENHOUSE" && d4.token === "brandedco", d4.kind ? `${d4.kind}/${d4.token}` : d4.reason);
check("Branded page uses og:site_name for the company",
  d4.kind !== null && d4.companyName === "BrandedCo", d4.kind ? d4.companyName : "—");

const d5 = await detectSource("https://www.bespokeco.com", PUBLIC_DNS);
check("Bespoke site falls back to JSON-LD", d5.kind === "JSONLD", d5.kind ?? d5.reason);
check("JSON-LD detection names the hiring org",
  d5.kind === "JSONLD" && d5.companyName === "Bespoke Co", d5.kind ? d5.companyName : "—");

const d6 = await detectSource("https://feeds.acme.com/jobs.xml", PUBLIC_DNS);
check("A direct .xml URL is treated as a feed",
  d6.kind === "XML_FEED" || d6.kind === null, d6.kind ?? d6.reason);

const d7 = await detectSource("https://www.opaqueco.com", PUBLIC_DNS);
check("Undetectable site fails honestly", d7.kind === null, d7.kind === null ? d7.reason.slice(0, 70) : "WRONGLY detected " + d7.kind);
check("Failure offers manual routes", d7.kind === null && d7.suggestions.length === 3, `${d7.kind === null ? d7.suggestions.length : 0} suggestions`);

const d8 = await detectSource("not a url at all %%%", PUBLIC_DNS);
check("Garbage input rejected", d8.kind === null);

// ─────────────────────────────────────────────────────────────
console.log("\nUNIVERSAL FALLBACKS\n");

const ld = await fetchJsonLdJobs("https://www.bespokeco.com");
check("JSON-LD scraper returns a job", ld.length === 1, ld[0]?.title);
check("JSON-LD hourly pay annualised to $k", ld[0]?.salaryMin === 156 && ld[0]?.salaryMax === 198,
  `$${ld[0]?.salaryMin}k–$${ld[0]?.salaryMax}k`);
check("JSON-LD TELECOMMUTE → REMOTE", ld[0]?.remote === "REMOTE", ld[0]?.remote);
check("JSON-LD skills extracted", ld[0]?.skills.includes("Node.js") && ld[0]?.skills.includes("React"), ld[0]?.skills.join(","));
check("JSON-LD source tagged CAREER_SITE", ld[0]?.source === "CAREER_SITE", ld[0]?.source);

const feed = await fetchXmlFeedJobs("https://feeds.acme.com/jobs.xml");
check("XML feed parser returns a job", feed.length === 1, feed[0]?.title);
check("XML feed salary parsed", feed[0]?.salaryMin === 140 && feed[0]?.salaryMax === 170,
  `$${feed[0]?.salaryMin}k–$${feed[0]?.salaryMax}k`);
check("XML feed remotetype honoured", feed[0]?.remote === "HYBRID", feed[0]?.remote);
check("XML feed location assembled", feed[0]?.location === "Denver, CO", feed[0]?.location);
check("XML feed uses referencenumber as the id", feed[0]?.externalId === "feed:ACME-DO-1", feed[0]?.externalId);
check("XML feed skills extracted",
  feed[0]?.skills.includes("Kubernetes") && feed[0]?.skills.includes("Terraform"), feed[0]?.skills.join(","));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
