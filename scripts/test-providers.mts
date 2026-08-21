/**
 * Provider parser tests — runs each adapter against a recorded payload in the
 * exact shape the live API returns, with fetch stubbed. Proves normalization,
 * skill extraction, seniority inference and salary maths without network.
 *
 *   npx tsx scripts/test-providers.ts
 */
import "dotenv/config";

process.env.GREENHOUSE_BOARDS = "acme";
process.env.LEVER_BOARDS = "acme";
process.env.ASHBY_BOARDS = "acme";
process.env.ADZUNA_APP_ID = "x";
process.env.ADZUNA_APP_KEY = "y";
process.env.RAPIDAPI_KEY = "z";
process.env.JOOBLE_API_KEY = "j";
process.env.CAREERJET_AFFID = "c";

const FIXTURES: Record<string, unknown> = {
  "boards-api.greenhouse.io": {
    jobs: [
      {
        id: 5312345,
        title: "Senior Frontend Engineer, Payments",
        absolute_url: "https://boards.greenhouse.io/acme/jobs/5312345",
        updated_at: "2026-08-10T12:00:00-04:00",
        location: { name: "San Francisco, CA" },
        departments: [{ name: "Engineering" }],
        content:
          "&lt;p&gt;We are hiring a senior engineer to work with &lt;strong&gt;React&lt;/strong&gt;, TypeScript and GraphQL on our hybrid team. Experience with Kubernetes and testing is a plus.&lt;/p&gt;",
      },
    ],
  },
  "api.lever.co": [
    {
      id: "abc-123",
      text: "Staff Backend Engineer",
      hostedUrl: "https://jobs.lever.co/acme/abc-123",
      applyUrl: "https://jobs.lever.co/acme/abc-123/apply",
      createdAt: 1754000000000,
      descriptionPlain:
        "Build distributed systems in Go with Kafka and Postgres on AWS. Fully remote across the US.",
      categories: { location: "Remote - US", team: "Platform", commitment: "Full-time" },
      salaryRange: { min: 180000, max: 220000, currency: "USD", interval: "per-year-salary" },
      lists: [{ text: "What you'll do", content: "<li>Own the ledger</li>" }],
    },
  ],
  "api.ashbyhq.com": {
    jobs: [
      {
        id: "ash-9",
        title: "Product Designer",
        location: "New York, NY",
        department: "Design",
        employmentType: "FullTime",
        isListed: true,
        isRemote: false,
        descriptionPlain:
          "Own research through shipped pixels. Deep Figma skill and design systems experience required. Onsite in NYC.",
        publishedAt: "2026-08-12T09:00:00Z",
        jobUrl: "https://jobs.ashbyhq.com/acme/ash-9",
        compensation: {
          summaryComponents: [
            { compensationType: "Salary", interval: "1 YEAR", currencyCode: "USD", minValue: 140000, maxValue: 175000 },
          ],
        },
      },
    ],
  },
  "api.adzuna.com": {
    results: [
      {
        id: "4455",
        title: "Junior Data Engineer",
        description: "Work with SQL, dbt and Snowflake. Entry level role, onsite in Chicago.",
        redirect_url: "https://www.adzuna.com/details/4455",
        created: "2026-08-14T08:00:00Z",
        salary_min: 95000,
        salary_max: 115000,
        salary_is_predicted: "0",
        company: { display_name: "Gridline Data" },
        location: { display_name: "Chicago, IL" },
        category: { label: "IT Jobs" },
      },
    ],
  },
  // v5 envelope: results moved from `data` (array) to `data.jobs`, and
  // job_salary_currency was dropped entirely. Both are pinned by tests below.
  "jsearch.p.rapidapi.com": {
    data: {
      cursor: "next-page-token",
      jobs: [
        {
          job_id: "gfj-777",
          job_title: "Machine Learning Engineer",
          employer_name: "Beacon Health",
          job_publisher: "Indeed",
          job_employment_type: "FULLTIME",
          job_apply_link: "https://www.indeed.com/viewjob?jk=777",
          job_description: "Take PyTorch models to production with MLOps on AWS. Python required.",
          job_is_remote: true,
          job_posted_at_datetime_utc: "2026-08-13T00:00:00Z",
          job_city: "Boston",
          job_state: "MA",
          job_country: "US",
          job_location: "Boston, MA",
          job_min_salary: 85,
          job_max_salary: 110,
          job_salary_period: "HOUR",
        },
      ],
    },
  },
  "jooble.org": {
    jobs: [
      {
        id: 9001,
        title: "Solutions Architect",
        location: "Dallas, TX",
        snippet: "<b>AWS</b> architecture and presales for enterprise logistics. Kubernetes a plus.",
        salary: "$150,000 - $190,000 per year",
        source: "Monster",
        type: "Full-time",
        link: "https://jooble.org/jdp/9001",
        company: "Vertex Freight",
        updated: "2026-08-11T00:00:00",
      },
    ],
  },
  "public.api.careerjet.net": {
    jobs: [
      {
        title: "React Native Developer",
        company: "Trailhead Fitness",
        locations: "Seattle, WA",
        description: "Ship a React Native app with TypeScript across iOS and Android.",
        url: "https://www.careerjet.com/jobad/xyz",
        date: "2026-08-09",
        salary: "$130,000 - $160,000",
        site: "Monster",
      },
    ],
  },
  "remotive.com": {
    jobs: [
      {
        id: 42,
        url: "https://remotive.com/remote-jobs/42",
        title: "Senior Full Stack Engineer",
        company_name: "Lumen Labs",
        category: "Software Development",
        job_type: "full_time",
        candidate_required_location: "USA",
        salary: "$150,000 - $180,000",
        description: "<p>Node.js, React and Postgres. LLM APIs experience valued.</p>",
        publication_date: "2026-08-15T10:00:00",
      },
    ],
  },
  "www.arbeitnow.com": {
    data: [
      {
        slug: "berlin-go-dev",
        company_name: "Kontor",
        title: "Go Backend Developer",
        description: "<p>Golang, Kubernetes and Terraform. Visa sponsorship available.</p>",
        remote: true,
        url: "https://www.arbeitnow.com/jobs/berlin-go-dev",
        tags: ["visa-sponsorship", "backend"],
        job_types: ["full_time"],
        location: "Berlin",
        created_at: 1754300000,
      },
    ],
  },
};

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input.toString();
  const host = new URL(url).hostname;
  const body = FIXTURES[host];
  if (!body) return realFetch(input as RequestInfo);
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

const { ALL_PROVIDERS } = await import("../src/lib/providers");
const { scoreJobForCandidate } = await import("../src/lib/match");

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

console.log("\nPROVIDER PARSERS\n");

for (const p of ALL_PROVIDERS) {
  if (p.source === "LINKEDIN") {
    let threw = false;
    try {
      await p.fetchBoard("x");
    } catch (e) {
      threw = /partnership/i.test((e as Error).message);
    }
    check("LINKEDIN adapter refuses cleanly", threw);
    continue;
  }
  if (!p.isConfigured()) {
    check(`${p.source} skipped (not configured)`, true);
    continue;
  }

  try {
    // boards() is async for the demand-driven aggregators (SRC-014).
    const board = (await p.boards())[0];
    const out = await p.fetchBoard(board);
    const j = out[0];
    const ok =
      out.length === 1 &&
      Boolean(j.title) &&
      Boolean(j.companyName) &&
      Boolean(j.externalId) &&
      Boolean(j.applyUrl) &&
      j.postedAt instanceof Date &&
      !Number.isNaN(j.postedAt.getTime()) &&
      Array.isArray(j.skills);
    check(
      `${p.source} parsed`,
      ok,
      ok
        ? `"${j.title}" @ ${j.companyName} · ${j.location} · ${j.remote} · ${j.seniority} · ` +
            `$${j.salaryMin ?? "?"}k-$${j.salaryMax ?? "?"}k · skills[${j.skills.join(",")}]` +
            (j.publisher ? ` · via ${j.publisher}` : "")
        : JSON.stringify(j).slice(0, 200)
    );
  } catch (e) {
    check(`${p.source} parsed`, false, (e as Error).message);
  }
}

console.log("\nDERIVED FIELDS\n");

// hourly → annual conversion: $85-110/hr * 2080 = $177k-229k
const js = await ALL_PROVIDERS.find((p) => p.source === "JSEARCH")!.fetchBoard("q");
check("JSearch annualises hourly pay", js[0].salaryMin === 177 && js[0].salaryMax === 229, `$${js[0].salaryMin}k–$${js[0].salaryMax}k`);
check("JSearch keeps the true publisher", js[0].publisher === "Indeed", js[0].publisher ?? "none");
check("JSearch honours is_remote", js[0].remote === "REMOTE", js[0].remote);

// ── The v5 contract change (found in production, Aug 2026) ──
//
// The API renamed /search to /search-v2 and moved results from `data` to
// `data.jobs` with no version bump on the host. The fixture above is now the
// v5 shape, so this assertion is what proves we read the new envelope at all.
check("JSearch reads the v5 data.jobs envelope", js.length === 1, `${js.length} jobs`);

// v5 also dropped job_salary_currency. The previous code read
// `job_salary_currency ?? "USD"`, which with the field gone would stamp USD on
// every posting on earth — a £45,000 London role displayed as $45,000.
check("JSearch derives currency from the country, not a default",
  js[0].currency === "USD", js[0].currency);
{
  const { jsearchProvider } = await import("../src/lib/providers/aggregators");
  const orig = globalThis.fetch;
  const gbFixture = {
    data: {
      jobs: [
        {
          job_id: "gfj-gb-1", job_title: "Data Engineer", employer_name: "Thames Analytics",
          job_apply_link: "https://example.com/1", job_description: "SQL and dbt.",
          job_city: "London", job_country: "GB",
          job_min_salary: 60000, job_max_salary: 80000, job_salary_period: "YEAR",
        },
      ],
    },
  };
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(gbFixture), { status: 200 })) as typeof fetch;
  const gb = await jsearchProvider.fetchBoard("data engineer in united kingdom");
  globalThis.fetch = orig;
  check("JSearch stamps GBP on a UK posting", gb[0].currency === "GBP", gb[0].currency);
  check("JSearch keeps the UK location", gb[0].location === "London", gb[0].location);
}

// An unrecognised envelope must throw, not return []. A provider that quietly
// yields zero jobs is indistinguishable from one with no results, and that is
// how a broken integration survives a month unnoticed — which is exactly what
// happened here.
{
  const { jsearchProvider } = await import("../src/lib/providers/aggregators");
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ status: "OK", results: [] }), { status: 200 })) as typeof fetch;
  let threw = false;
  try {
    await jsearchProvider.fetchBoard("q");
  } catch (e) {
    threw = /unexpected response envelope/i.test((e as Error).message);
  }
  globalThis.fetch = orig;
  check("JSearch fails loudly on an unknown envelope", threw);
}

const gh = await ALL_PROVIDERS.find((p) => p.source === "GREENHOUSE")!.fetchBoard("acme");
check("Greenhouse un-escapes + strips HTML", !gh[0].description.includes("&lt;") && !gh[0].description.includes("<p>"), gh[0].description.slice(0, 60));
check("Greenhouse infers Senior from title", gh[0].seniority === "Senior", gh[0].seniority);
check("Greenhouse infers HYBRID from body", gh[0].remote === "HYBRID", gh[0].remote);
check("Greenhouse extracts canonical skills", gh[0].skills.includes("React") && gh[0].skills.includes("TypeScript"), gh[0].skills.join(","));

const lv = await ALL_PROVIDERS.find((p) => p.source === "LEVER")!.fetchBoard("acme");
check("Lever converts salary to $k", lv[0].salaryMin === 180 && lv[0].salaryMax === 220, `$${lv[0].salaryMin}k–$${lv[0].salaryMax}k`);
check("Lever maps Go + Kafka aliases", lv[0].skills.includes("Go") && lv[0].skills.includes("Kafka"), lv[0].skills.join(","));

const ash = await ALL_PROVIDERS.find((p) => p.source === "ASHBY")!.fetchBoard("acme");
check("Ashby reads structured comp", ash[0].salaryMin === 140 && ash[0].salaryMax === 175, `$${ash[0].salaryMin}k–$${ash[0].salaryMax}k`);

const adz = await ALL_PROVIDERS.find((p) => p.source === "ADZUNA")!.fetchBoard("q|");
check("Adzuna infers Junior", adz[0].seniority === "Junior", adz[0].seniority);

const job = await ALL_PROVIDERS.find((p) => p.source === "JOOBLE")!.fetchBoard("q|");
check("Jooble parses salary text", job[0].salaryMin === 150 && job[0].salaryMax === 190, `$${job[0].salaryMin}k–$${job[0].salaryMax}k`);
check("Jooble surfaces Monster as publisher", job[0].publisher === "Monster", job[0].publisher ?? "none");

const cj = await ALL_PROVIDERS.find((p) => p.source === "CAREERJET")!.fetchBoard("q|");
check("Careerjet surfaces Monster as publisher", cj[0].publisher === "Monster", cj[0].publisher ?? "none");

console.log("\nMATCH ENGINE\n");

const candidate = {
  skills: ["React", "TypeScript", "GraphQL", "Design Systems", "Testing"],
  location: "San Francisco, CA",
  remotePref: "HYBRID" as const,
  salaryTarget: 170,
  yearsExp: 7,
};
const perfect = scoreJobForCandidate(
  { skills: candidate.skills, location: "San Francisco, CA", remote: "HYBRID", salaryMin: 170, salaryMax: 210, seniority: "Senior" },
  candidate
);
check("Perfect fit scores 95+", perfect.score >= 95, `${perfect.score}%`);
check("Perfect fit lists all shared skills", perfect.sharedSkills.length === 5, perfect.sharedSkills.join(","));

const wrong = scoreJobForCandidate(
  { skills: ["Kubernetes", "Go", "Terraform", "Observability"], location: "Berlin, DE", remote: "ONSITE", salaryMin: 80, salaryMax: 95, seniority: "Junior" },
  candidate
);
check("Bad fit scores low", wrong.score < 30, `${wrong.score}%`);
check("Bad fit reports the gaps", wrong.missingSkills.length === 4, wrong.missingSkills.join(","));

const remoteOnly = scoreJobForCandidate(
  { skills: candidate.skills, location: "Austin, TX", remote: "ONSITE", salaryMin: 170, salaryMax: 210, seniority: "Senior" },
  { ...candidate, remotePref: "REMOTE" as const }
);
const remoteJob = scoreJobForCandidate(
  { skills: candidate.skills, location: "Austin, TX", remote: "REMOTE", salaryMin: 170, salaryMax: 210, seniority: "Senior" },
  { ...candidate, remotePref: "REMOTE" as const }
);
check("Remote-only candidate penalised on onsite job", remoteJob.score > remoteOnly.score, `${remoteJob.score}% vs ${remoteOnly.score}%`);

const junior = scoreJobForCandidate(
  { skills: candidate.skills, location: "San Francisco, CA", remote: "HYBRID", salaryMin: 170, salaryMax: 210, seniority: "Senior" },
  { ...candidate, yearsExp: 1 }
);
check("Under-experienced scores below well-matched", junior.score < perfect.score, `${junior.score}% vs ${perfect.score}%`);
check("Score always within 1..99", [perfect, wrong, junior, remoteJob].every((r) => r.score >= 1 && r.score <= 99));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
