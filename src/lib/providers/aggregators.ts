import { demandQueries } from "../demand";
import { env } from "../env";
import { extractSkills, inferSeniority } from "../skills";
import {
  type JobProvider,
  type NormalizedJob,
  inferEmploymentType,
  inferRemote,
  stripHtml,
} from "./types";

/**
 * MULTI-BOARD AGGREGATORS — this is how Jobsy reaches Indeed and Monster.
 *
 * Neither Indeed nor Monster offers a self-serve search API any more:
 *   • Indeed retired its Publisher API to new signups; the Job Search API is
 *     partner-only under a signed agreement.
 *   • Monster's search API is likewise partner/enterprise only.
 *
 * Both are, however, indexed by Google for Jobs and by licensed aggregators.
 * Pulling Indeed/Monster listings through an aggregator that licenses them is
 * the legitimate route — no scraping, no ToS exposure, and each posting keeps
 * its original apply URL so the candidate still lands on Indeed/Monster to
 * finish applying (exactly the EXTERNAL apply path Jobsy already models).
 */

// ─────────────────────────────────────────────────────────────
// JSEARCH (RapidAPI) — Google for Jobs index
// Coverage: Indeed, LinkedIn, Glassdoor, ZipRecruiter, Monster, company sites
// ─────────────────────────────────────────────────────────────
type JSearchJob = {
  job_id: string;
  job_title: string;
  employer_name?: string;
  employer_website?: string;
  job_publisher?: string;
  job_employment_type?: string;
  job_apply_link?: string;
  job_description?: string;
  job_is_remote?: boolean;
  job_posted_at_datetime_utc?: string;
  job_city?: string;
  job_state?: string;
  job_country?: string;
  job_min_salary?: number;
  job_max_salary?: number;
  job_salary_period?: string;
  job_salary_currency?: string;
};

const JSEARCH_QUERIES = [
  "software engineer in usa",
  "frontend engineer in usa",
  "data engineer in usa",
  "product designer in usa",
  "machine learning engineer in usa",
];

/** Annualise whatever period the aggregator reports, then express in $k. */
function annualiseToK(
  min: number | undefined,
  max: number | undefined,
  period: string | undefined
): [number | null, number | null] {
  const mult =
    period === "HOUR" ? 2080 : period === "DAY" ? 260 : period === "WEEK" ? 52 : period === "MONTH" ? 12 : 1;
  const k = (v: number | undefined) => (v && v > 0 ? Math.round((v * mult) / 1000) : null);
  return [k(min), k(max)];
}

export const jsearchProvider: JobProvider = {
  source: "JSEARCH",
  label: "JSearch / Google for Jobs (Indeed, LinkedIn, Glassdoor, ZipRecruiter, Monster)",

  isConfigured: () => Boolean(env.jobs.rapidApiKey),
  // SRC-014 — phrases follow live candidate demand, not a constant.
  boards: () => demandQueries("PHRASE", JSEARCH_QUERIES),

  async fetchBoard(query: string): Promise<NormalizedJob[]> {
    const url = `https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(query)}&page=1&num_pages=1&date_posted=month`;
    const res = await fetch(url, {
      headers: {
        "X-RapidAPI-Key": env.jobs.rapidApiKey!,
        "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
      },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`JSearch "${query}" → HTTP ${res.status}`);

    const data = (await res.json()) as { data?: JSearchJob[] };

    return (data.data ?? []).map((j): NormalizedJob => {
      const description = stripHtml(j.job_description ?? "");
      const location =
        [j.job_city, j.job_state].filter(Boolean).join(", ") || j.job_country || "United States";
      const [min, max] = annualiseToK(j.job_min_salary, j.job_max_salary, j.job_salary_period);

      return {
        source: "JSEARCH",
        publisher: j.job_publisher ?? "Google for Jobs",
        externalId: `jsearch:${j.job_id}`,
        sourceUrl: j.job_apply_link ?? "",
        title: j.job_title.trim(),
        companyName: j.employer_name?.trim() || "Undisclosed",
        companyWebsite: j.employer_website ?? undefined,
        location,
        remote: j.job_is_remote ? "REMOTE" : inferRemote(description.slice(0, 1200), location),
        employmentType: j.job_employment_type
          ? j.job_employment_type.charAt(0) + j.job_employment_type.slice(1).toLowerCase().replace("time", "-time")
          : inferEmploymentType(description.slice(0, 600)),
        seniority: inferSeniority(j.job_title, description),
        salaryMin: min,
        salaryMax: max,
        currency: j.job_salary_currency ?? "USD",
        description: description.slice(0, 6000),
        skills: extractSkills(description),
        perks: j.job_publisher ? [`via ${j.job_publisher}`] : [],
        applyMethod: "EXTERNAL",
        applyUrl: j.job_apply_link ?? "",
        postedAt: j.job_posted_at_datetime_utc ? new Date(j.job_posted_at_datetime_utc) : new Date(),
        // publisher is the real origin: "Indeed", "Monster", "LinkedIn", …
        raw: { publisher: j.job_publisher, query, id: j.job_id },
      };
    });
  },
};

// ─────────────────────────────────────────────────────────────
// JOOBLE — free API key on request, aggregates Indeed + Monster + others
// POST https://jooble.org/api/{key}   body: { keywords, location, page }
// ─────────────────────────────────────────────────────────────
type JoobleJob = {
  id?: number | string;
  title: string;
  location?: string;
  snippet?: string;
  salary?: string;
  source?: string;
  type?: string;
  link: string;
  company?: string;
  updated?: string;
};

/** Parse "$120,000 - $150,000 per year" style strings into $k figures. */
function parseSalaryText(s: string | undefined): [number | null, number | null] {
  if (!s) return [null, null];
  const nums = [...s.matchAll(/([\d][\d,.]*)\s*(k)?/gi)]
    .map((m) => {
      const raw = Number(m[1].replace(/,/g, ""));
      if (!Number.isFinite(raw)) return null;
      if (m[2]) return raw; // "150k"
      return raw >= 1000 ? Math.round(raw / 1000) : null;
    })
    .filter((n): n is number => n !== null && n > 10 && n < 1500);
  if (!nums.length) return [null, null];
  if (nums.length === 1) return [nums[0], null];
  return [Math.min(...nums), Math.max(...nums)];
}

export const joobleProvider: JobProvider = {
  source: "JOOBLE",
  label: "Jooble (Indeed, Monster, CareerBuilder aggregate)",

  isConfigured: () => Boolean(env.jobs.joobleKey),
  boards: () => demandQueries("PIPE", ["software engineer|", "data engineer|", "designer|"]),

  async fetchBoard(board: string): Promise<NormalizedJob[]> {
    const [keywords, location] = board.split("|");
    const res = await fetch(`https://jooble.org/api/${env.jobs.joobleKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keywords, location: location || "", page: "1" }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Jooble "${board}" → HTTP ${res.status}`);

    const data = (await res.json()) as { jobs?: JoobleJob[] };

    return (data.jobs ?? []).map((j): NormalizedJob => {
      const description = stripHtml(j.snippet ?? "");
      const location = j.location?.trim() || "United States";
      const [min, max] = parseSalaryText(j.salary);
      return {
        source: "JOOBLE",
        publisher: j.source ?? "Jooble",
        externalId: `jooble:${j.id ?? j.link}`,
        sourceUrl: j.link,
        title: j.title.trim(),
        companyName: j.company?.trim() || "Undisclosed",
        location,
        remote: inferRemote(`${location} ${description}`, location),
        employmentType: j.type || inferEmploymentType(description),
        seniority: inferSeniority(j.title, description),
        salaryMin: min,
        salaryMax: max,
        currency: "USD",
        description: description.slice(0, 6000),
        skills: extractSkills(description),
        perks: j.source ? [`via ${j.source}`] : [],
        applyMethod: "EXTERNAL",
        applyUrl: j.link,
        postedAt: j.updated ? new Date(j.updated) : new Date(),
        raw: { publisher: j.source, board },
      };
    });
  },
};

// ─────────────────────────────────────────────────────────────
// CAREERJET — free API key, no approval, 90+ countries
// ─────────────────────────────────────────────────────────────
type CareerjetJob = {
  title: string;
  company?: string;
  locations?: string;
  description?: string;
  url: string;
  date?: string;
  salary?: string;
  site?: string;
};

export const careerjetProvider: JobProvider = {
  source: "CAREERJET",
  label: "Careerjet (multi-board aggregate)",

  isConfigured: () => Boolean(env.jobs.careerjetAffid),
  boards: () => demandQueries("PIPE", ["software engineer|", "designer|"]),

  async fetchBoard(board: string): Promise<NormalizedJob[]> {
    const [keywords, location] = board.split("|");
    const p = new URLSearchParams({
      affid: env.jobs.careerjetAffid!,
      keywords,
      location: location || "",
      locale_code: "en_US",
      pagesize: "50",
      user_ip: "127.0.0.1",
      user_agent: "Jobsy/1.0",
    });
    const res = await fetch(`https://public.api.careerjet.net/search?${p.toString()}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Careerjet "${board}" → HTTP ${res.status}`);

    const data = (await res.json()) as { jobs?: CareerjetJob[] };

    return (data.jobs ?? []).map((j): NormalizedJob => {
      const description = stripHtml(j.description ?? "");
      const location = j.locations?.trim() || "United States";
      const [min, max] = parseSalaryText(j.salary);
      return {
        source: "CAREERJET",
        publisher: j.site ?? "Careerjet",
        externalId: `careerjet:${j.url}`,
        sourceUrl: j.url,
        title: j.title.trim(),
        companyName: j.company?.trim() || "Undisclosed",
        location,
        remote: inferRemote(`${location} ${description}`, location),
        employmentType: inferEmploymentType(description),
        seniority: inferSeniority(j.title, description),
        salaryMin: min,
        salaryMax: max,
        currency: "USD",
        description: description.slice(0, 6000),
        skills: extractSkills(description),
        perks: j.site ? [`via ${j.site}`] : [],
        applyMethod: "EXTERNAL",
        applyUrl: j.url,
        postedAt: j.date ? new Date(j.date) : new Date(),
        raw: { publisher: j.site, board },
      };
    });
  },
};

// ─────────────────────────────────────────────────────────────
// KEYLESS PUBLIC BOARDS — work out of the box, zero configuration
// ─────────────────────────────────────────────────────────────
type RemotiveJob = {
  id: number;
  url: string;
  title: string;
  company_name: string;
  category?: string;
  job_type?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
  publication_date?: string;
};

export const remotiveProvider: JobProvider = {
  source: "REMOTIVE",
  label: "Remotive (remote roles, no key needed)",

  isConfigured: () => env.jobs.keylessBoards,
  boards: () => ["software-dev", "design", "data"],

  async fetchBoard(category: string): Promise<NormalizedJob[]> {
    const res = await fetch(
      `https://remotive.com/api/remote-jobs?category=${encodeURIComponent(category)}&limit=60`,
      { headers: { "User-Agent": "Jobsy/1.0 (job aggregation)" }, cache: "no-store" }
    );
    if (!res.ok) throw new Error(`Remotive ${category} → HTTP ${res.status}`);

    const data = (await res.json()) as { jobs?: RemotiveJob[] };

    return (data.jobs ?? []).map((j): NormalizedJob => {
      const description = stripHtml(j.description ?? "");
      const [min, max] = parseSalaryText(j.salary);
      return {
        source: "REMOTIVE",
        publisher: "Remotive",
        externalId: `remotive:${j.id}`,
        sourceUrl: j.url,
        title: j.title.trim(),
        companyName: j.company_name?.trim() || "Undisclosed",
        location: j.candidate_required_location?.trim() || "Remote",
        remote: "REMOTE",
        employmentType: j.job_type
          ? j.job_type.replace(/_/g, "-").replace(/\b\w/g, (c) => c.toUpperCase())
          : "Full-time",
        seniority: inferSeniority(j.title, description),
        salaryMin: min,
        salaryMax: max,
        currency: "USD",
        description: description.slice(0, 6000),
        skills: extractSkills(description),
        perks: j.category ? [j.category] : [],
        applyMethod: "EXTERNAL",
        applyUrl: j.url,
        postedAt: j.publication_date ? new Date(j.publication_date) : new Date(),
        raw: { publisher: "Remotive", category },
      };
    });
  },
};

type ArbeitnowJob = {
  slug: string;
  company_name: string;
  title: string;
  description?: string;
  remote?: boolean;
  url: string;
  tags?: string[];
  job_types?: string[];
  location?: string;
  created_at?: number;
};

export const arbeitnowProvider: JobProvider = {
  source: "ARBEITNOW",
  label: "Arbeitnow (EU + visa-sponsor roles, no key needed)",

  isConfigured: () => env.jobs.keylessBoards,
  boards: () => ["1"],

  async fetchBoard(page: string): Promise<NormalizedJob[]> {
    const res = await fetch(`https://www.arbeitnow.com/api/job-board-api?page=${page}`, {
      headers: { "User-Agent": "Jobsy/1.0 (job aggregation)" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Arbeitnow → HTTP ${res.status}`);

    const data = (await res.json()) as { data?: ArbeitnowJob[] };

    return (data.data ?? []).map((j): NormalizedJob => {
      const description = stripHtml(j.description ?? "");
      return {
        source: "ARBEITNOW",
        publisher: "Arbeitnow",
        externalId: `arbeitnow:${j.slug}`,
        sourceUrl: j.url,
        title: j.title.trim(),
        companyName: j.company_name?.trim() || "Undisclosed",
        location: j.location?.trim() || "Europe",
        remote: j.remote ? "REMOTE" : inferRemote(description.slice(0, 1200), j.location),
        employmentType: j.job_types?.[0]
          ? j.job_types[0].replace(/_/g, "-").replace(/\b\w/g, (c) => c.toUpperCase())
          : "Full-time",
        seniority: inferSeniority(j.title, description),
        salaryMin: null,
        salaryMax: null,
        currency: "EUR",
        description: description.slice(0, 6000),
        skills: [...extractSkills(description), ...(j.tags ?? []).slice(0, 4)].slice(0, 12),
        perks: (j.tags ?? []).slice(0, 3),
        applyMethod: "EXTERNAL",
        applyUrl: j.url,
        postedAt: j.created_at ? new Date(j.created_at * 1000) : new Date(),
        raw: { publisher: "Arbeitnow", slug: j.slug },
      };
    });
  },
};
