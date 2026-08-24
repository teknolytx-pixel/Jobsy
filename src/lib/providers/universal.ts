import { extractSkills, inferSeniority } from "../skills";
import { findJsonLdJobPostings } from "../discovery";
import {
  CRAWL_BUDGET_MS,
  CRAWL_LIMIT,
  discoverJobUrls,
  fetchJobPages,
  fetchRobots,
} from "../crawl";
import { safeFetch, type SafeFetchDeps } from "../safeFetch";
import {
  DEFAULT_GUARDS,
  PAGE_PARAMS,
  nextLinkFrom,
  pagedUrl,
  type PageGuards,
} from "./paging";
import { employerForJob, employerNameFrom } from "../employer";
import {
  type NormalizedJob,
  inferEmploymentType,
  inferRemote,
  stripHtml,
} from "./types";

/**
 * UNIVERSAL FALLBACKS — for companies not on any ATS we recognise.
 *
 * Between them these two cover nearly everything the ATS adapters miss,
 * because both formats exist precisely so machines can read the jobs:
 *
 *   JSON-LD   Every careers page that wants to appear in Google for Jobs must
 *             embed schema.org JobPosting structured data. Reading it is the
 *             documented purpose of publishing it.
 *
 *   XML feed  The format employers already hand to Indeed, Monster and
 *             ZipRecruiter. If a company has one, they can give Jobsy the same
 *             URL and be live in seconds — no integration work on their side.
 */

const UA = { "User-Agent": "Jobsy/1.0 (+job aggregation; contact: hello@jobsy.app)" };

const first = <T,>(v: T | T[] | undefined): T | undefined => (Array.isArray(v) ? v[0] : v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** schema.org allows several shapes for the same field; flatten them all. */
function readLocation(node: Record<string, unknown>): { text: string; remote: boolean } {
  const remote = /telecommute/i.test(str(node.jobLocationType));
  const loc = first(node.jobLocation as Record<string, unknown> | Record<string, unknown>[]);
  const addr = loc?.address as Record<string, unknown> | undefined;
  const text = [str(addr?.addressLocality), str(addr?.addressRegion) || str(addr?.addressCountry)]
    .filter(Boolean)
    .join(", ");
  return { text: text || (remote ? "Remote" : ""), remote };
}

function readSalary(node: Record<string, unknown>): [number | null, number | null, string] {
  const bs = node.baseSalary as Record<string, unknown> | undefined;
  const cur = str(bs?.currency) || "USD";
  const val = bs?.value as Record<string, unknown> | undefined;
  if (!val) return [null, null, cur];

  const unit = str(val.unitText).toUpperCase();
  const mult = unit === "HOUR" ? 2080 : unit === "DAY" ? 260 : unit === "WEEK" ? 52 : unit === "MONTH" ? 12 : 1;
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN);

  const lo = num(val.minValue ?? val.value);
  const hi = num(val.maxValue ?? val.value);
  const k = (n: number) => (Number.isFinite(n) && n > 0 ? Math.round((n * mult) / 1000) : null);
  return [k(lo), k(hi), cur];
}

/**
 * Turn one page's schema.org JobPosting records into jobs.
 *
 * Split out from the fetch so the crawler can reuse it. Two copies of this
 * mapping would drift, and the drift would show up as jobs that import
 * correctly from a listing page and wrongly from a detail page — with nothing
 * to say which was right.
 */
export function jsonLdJobsFromHtml(
  html: string,
  pageUrl: string,
  companyFallback?: string
): NormalizedJob[] {
  const nodes = findJsonLdJobPostings(html);
  const origin = new URL(pageUrl).origin;

  return nodes.map((n, i): NormalizedJob => {
    const org = n.hiringOrganization as Record<string, unknown> | undefined;
    /*
     * Not `str(org.name) || fallback`. That is what produced fifteen Citi jobs
     * labelled "Early Career": the record named a PROGRAMME, the code took the
     * first non-empty string, and the employer's name never appeared anywhere a
     * candidate could see it.
     */
    const company = employerForJob(str(org?.name), companyFallback, pageUrl);
    const description = stripHtml(str(n.description));
    const { text: location, remote } = readLocation(n);
    const [min, max, currency] = readSalary(n);

    const idNode = n.identifier as Record<string, unknown> | undefined;
    const externalId =
      str(idNode?.value) || str(n.url) || `${new URL(pageUrl).hostname}#${i}`;
    const url = str(n.url) || str((n.hiringOrganization as Record<string, unknown>)?.url) || pageUrl;

    return {
      source: "CAREER_SITE",
      publisher: `${company} careers site`,
      externalId: `jsonld:${externalId}`.slice(0, 180),
      sourceUrl: url.startsWith("http") ? url : `${origin}${url}`,
      title: str(n.title).trim() || "Untitled role",
      companyName: company,
      location: location || "Not specified",
      remote: remote ? "REMOTE" : inferRemote(description.slice(0, 1500), location),
      employmentType: str(first(n.employmentType as string | string[]))
        .replace(/_/g, "-")
        .replace(/\b\w/g, (c) => c.toUpperCase()) || inferEmploymentType(description.slice(0, 600)),
      seniority: inferSeniority(str(n.title), description),
      salaryMin: min,
      salaryMax: max,
      currency,
      description: description.slice(0, 6000),
      skills: extractSkills([str(n.skills), str(n.qualifications), description].join("\n")),
      perks: [],
      applyMethod: "EXTERNAL",
      applyUrl: url.startsWith("http") ? url : `${origin}${url}`,
      postedAt: str(n.datePosted) ? new Date(str(n.datePosted)) : new Date(),
      raw: { via: "jsonld", pageUrl },
    };
  });
}

/** Scrape schema.org JobPosting records off a careers page. */
export async function fetchJsonLdJobs(pageUrl: string, companyFallback?: string): Promise<NormalizedJob[]> {
  const res = await fetch(pageUrl, { headers: UA, redirect: "follow", cache: "no-store" });
  if (!res.ok) throw new Error(`${new URL(pageUrl).hostname} → HTTP ${res.status}`);
  const html = (await res.text()).slice(0, 900_000);
  return jsonLdJobsFromHtml(html, pageUrl, companyFallback);
}

/**
 * CRAWL a careers site whose structured data lives on the job pages.
 *
 * The common case, not an edge case. Google for Jobs wants JSON-LD on the page
 * for one opening; almost nothing requires it on the index.
 *
 * ── Coverage, and why it takes more than one run ──
 *
 * A bank with 3,506 openings imported fifteen on its first sync, for three
 * reasons that all had to be fixed: the sitemap was only a fallback so it was
 * never opened, the listing's later pages were never read, and the page cap was
 * forty. Discovery is now additive and paginated, and the cap is the clock.
 *
 * What one run cannot do is fetch three thousand pages politely. So a run takes
 * as much as its budget allows, prefers job pages we do not already hold, and
 * rotates which category pages it expands — and the six-hourly sync widens
 * coverage each time rather than re-reading the same fifteen for ever. That is
 * a deliberate trade: a slower ramp in exchange for being a crawler a site
 * wants to keep serving.
 */
export type CrawlOpts = {
  limit?: number;
  /** Wall-clock budget for the whole crawl, in ms. Ignored when `deadline` is set. */
  budgetMs?: number;
  /**
   * Absolute stop time.
   *
   * Preferred over budgetMs, because the caller knows how much of the RUN's
   * budget is left and this function does not. A crawl that decides its own
   * deadline is how a 75-second budget ended up inside a 60-second function.
   */
  deadline?: number;
  /** Rotates which listing pages get expanded. See discoverJobUrls. */
  rotate?: number;
  /**
   * Job URLs already imported.
   *
   * Not for skipping — a stored job still needs refreshing — but for ORDER.
   * Unseen pages first means the budget goes on jobs nobody has seen, which is
   * what makes successive runs widen coverage instead of re-reading the front
   * page of the catalogue.
   */
  known?: Set<string>;
  /**
   * Injected DNS resolution, exactly as safeFetch takes it.
   *
   * Present so the crawl is testable against recorded fixtures the same way
   * detection already is. Without it the tests reached the real resolver and
   * passed only for fixture domains that happen to exist — which is a test
   * suite quietly depending on the internet.
   */
  deps?: SafeFetchDeps;
};

export type CrawlReport = {
  jobs: NormalizedJob[];
  /** The employer this run concluded the site belongs to. */
  employer: string;
  /** Where the next run should resume, and how much there is to get through. */
  nextCursor: number;
  listingCount: number;
  /** Job URLs discovery found, whether or not they were opened. */
  discovered: number;
  /** Pages actually opened this run. */
  opened: number;
  /** Ran out of budget with pages left. */
  truncated: boolean;
  via: string[];
};

/** The reporting form — used by the sync loop, which explains itself to an operator. */
export async function crawlJsonLdReport(
  listingUrl: string,
  companyFallback?: string,
  opts: CrawlOpts = {}
): Promise<CrawlReport> {
  const deadline = opts.deadline ?? Date.now() + (opts.budgetMs ?? CRAWL_BUDGET_MS);
  const limit = opts.limit ?? CRAWL_LIMIT;

  const page = await safeFetch(listingUrl, opts.deps);
  if (!page.ok) throw new Error(`${new URL(listingUrl).hostname} → ${page.reason}`);

  const rules = await fetchRobots(new URL(listingUrl).origin, opts.deps);
  const found = await discoverJobUrls(page.finalUrl, page.body, rules, {
    limit,
    deadline,
    rotate: opts.rotate,
    deps: opts.deps,
  });

  /**
   * Unseen first, stable within each group.
   *
   * A plain sort would be enough, except that "known" is the majority on a
   * mature source and we want the ORDER inside each group left alone — the site
   * lists its newest openings first and that is a better default than anything
   * we would invent.
   */
  const known = opts.known ?? new Set<string>();
  const fresh = found.urls.filter((u) => !known.has(u));
  const seen = found.urls.filter((u) => known.has(u));
  const ordered = [...fresh, ...seen];

  const pages = await fetchJobPages(ordered, rules, opts.deps, deadline);

  /*
   * Resolve the employer ONCE, across every record read, before naming any job.
   *
   * Per-page resolution would let one page's programme name ("Early Career")
   * label the jobs on that page while the rest carried the company — the same
   * source appearing under two employers in the deck.
   */
  const employer = employerNameFrom({
    jsonLdNames: [page.body, ...pages.map((p) => p.html)].flatMap((html) =>
      findJsonLdJobPostings(html).map((n) =>
        str((n.hiringOrganization as Record<string, unknown> | undefined)?.name)
      )
    ),
    stored: companyFallback,
    url: page.finalUrl,
  });

  // The listing page itself sometimes carries records too. Free to check.
  const jobs = jsonLdJobsFromHtml(page.body, page.finalUrl, employer);
  for (const p of pages) {
    jobs.push(...jsonLdJobsFromHtml(p.html, p.url, employer));
  }

  const deduped = new Map<string, NormalizedJob>();
  for (const j of jobs) if (!deduped.has(j.externalId)) deduped.set(j.externalId, j);

  return {
    jobs: [...deduped.values()],
    employer,
    nextCursor: found.nextCursor,
    listingCount: found.listingCount,
    discovered: found.urls.length,
    opened: pages.length,
    truncated: found.truncated || pages.length < ordered.length,
    via: found.via,
  };
}

/** The plain form, for callers that only want the jobs. */
export async function crawlJsonLdJobs(
  listingUrl: string,
  companyFallback?: string,
  limitOrOpts: number | CrawlOpts = {}
): Promise<NormalizedJob[]> {
  const opts = typeof limitOrOpts === "number" ? { limit: limitOrOpts } : limitOrOpts;
  return (await crawlJsonLdReport(listingUrl, companyFallback, opts)).jobs;
}

// ─────────────────────────────────────────────────────────────
// XML FEEDS — the Indeed / Monster / ZipRecruiter interchange format.
// Also handles plain RSS <item> feeds, which some ATSs emit instead.
// ─────────────────────────────────────────────────────────────
const cdata = (s: string) => s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim();

function tag(block: string, ...names: string[]): string {
  for (const n of names) {
    const m = block.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`, "i"));
    if (m) return cdata(m[1]);
  }
  return "";
}

/** "120000 - 150000 USD per year", "$85/hr", "150k" → [min$k, max$k] */
function parseSalary(s: string): [number | null, number | null] {
  if (!s) return [null, null];
  const hourly = /\b(per\s*hour|\/\s*hr|hourly)\b/i.test(s);
  const nums = [...s.matchAll(/([\d][\d,.]*)\s*(k\b)?/gi)]
    .map((m) => {
      const raw = Number(m[1].replace(/,/g, ""));
      if (!Number.isFinite(raw) || raw <= 0) return null;
      if (m[2]) return raw; // "150k"
      if (hourly) return Math.round((raw * 2080) / 1000);
      return raw >= 1000 ? Math.round(raw / 1000) : null;
    })
    .filter((n): n is number => n !== null && n > 10 && n < 2000);
  if (!nums.length) return [null, null];
  if (nums.length === 1) return [nums[0], null];
  return [Math.min(...nums), Math.max(...nums)];
}

/**
 * Read one feed document into its item blocks.
 *
 * `<job>` is the Indeed interchange schema, `<item>` is RSS, `<entry>` is Atom.
 */
function feedItems(xml: string): string[] {
  const jobs = [...xml.matchAll(/<job\b[^>]*>([\s\S]*?)<\/job>/gi)].map((m) => m[1]);
  if (jobs.length) return jobs;
  return [...xml.matchAll(/<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi)].map((m) => m[1]);
}

/** A stable-enough identity for a feed item, for detecting a repeated page. */
const itemKey = (block: string): string =>
  tag(block, "referencenumber", "requisitionid", "guid", "id") ||
  `${tag(block, "title")}|${tag(block, "url", "link", "applyurl")}`;

/**
 * Every page of a job feed.
 *
 * ── Why this is more than one fetch ──
 *
 * Deloitte's feed reported twenty jobs. Twenty is an RSS page size, not the
 * size of Deloitte. Feeds paginate two ways: a declared `rel="next"` link,
 * which is unambiguous, and an undocumented query parameter, which is not.
 *
 * Guessing at parameters is dangerous — a server that does not recognise
 * `?page=2` returns page one with a 200, and a naive loop would request it
 * until it hit a cap. So a parameter is tried ONCE and kept only if the items
 * that come back are actually new. One wasted request buys a fact we cannot
 * otherwise learn, and a wrong guess cannot run away.
 */
async function allFeedPages(
  feedUrl: string,
  guards: PageGuards = {}
): Promise<{ blocks: string[]; pages: number; truncated: boolean }> {
  const g = { ...DEFAULT_GUARDS, ...guards };
  const seen = new Set<string>();
  const blocks: string[] = [];
  let pages = 0;

  const take = (xml: string): number => {
    let added = 0;
    for (const b of feedItems(xml)) {
      const k = itemKey(b);
      if (seen.has(k)) continue;
      seen.add(k);
      blocks.push(b);
      added++;
    }
    return added;
  };

  const fetchXml = async (url: string): Promise<string> => {
    const res = await fetch(url, { headers: UA, cache: "no-store" });
    if (!res.ok) throw new Error(`${new URL(url).hostname} → HTTP ${res.status}`);
    pages++;
    return res.text();
  };

  const first = await fetchXml(feedUrl);
  const pageSize = take(first);
  if (!pageSize) return { blocks, pages, truncated: false };

  // ── 1. a declared next link, followed as far as it goes ──
  let next = nextLinkFrom(first, feedUrl);
  while (next && pages < g.maxPages && blocks.length < g.maxItems) {
    if (guards.deadline && Date.now() > guards.deadline) return { blocks, pages, truncated: true };
    let xml: string;
    try {
      xml = await fetchXml(next);
    } catch {
      break;
    }
    if (take(xml) === 0) break;
    next = nextLinkFrom(xml, next);
    if (g.delayMs) await new Promise((r) => setTimeout(r, g.delayMs));
  }
  if (pages > 1) return { blocks, pages, truncated: blocks.length >= g.maxItems };

  // ── 2. no next link: probe the common parameters, verifying each ──
  for (const param of PAGE_PARAMS) {
    if (guards.deadline && Date.now() > guards.deadline) break;
    let worked = false;
    for (let index = 1; pages < g.maxPages && blocks.length < g.maxItems; index++) {
      let xml: string;
      try {
        xml = await fetchXml(pagedUrl(feedUrl, param, pageSize, index));
      } catch {
        break;
      }
      // Nothing new means the server ignored the parameter — or we reached the
      // end. Either way this scheme has nothing more to give.
      if (take(xml) === 0) break;
      worked = true;
      if (g.delayMs) await new Promise((r) => setTimeout(r, g.delayMs));
    }
    if (worked) break; // a scheme that works is the site's scheme; stop guessing
  }

  return { blocks, pages, truncated: blocks.length >= g.maxItems };
}

export async function fetchXmlFeedJobs(feedUrl: string, companyFallback?: string): Promise<NormalizedJob[]> {
  const { blocks, pages } = await allFeedPages(feedUrl);
  if (pages > 1) console.info(`[feed] ${new URL(feedUrl).hostname}: ${blocks.length} jobs across ${pages} pages`);
  const items = blocks;
  const host = new URL(feedUrl).hostname;

  return items.map((block, i): NormalizedJob => {
    const title = tag(block, "title");
    const company = tag(block, "company") || companyFallback || host;
    const url = tag(block, "url", "link", "applyurl") || feedUrl;
    const description = stripHtml(tag(block, "description", "summary", "content:encoded"));
    const city = tag(block, "city");
    const state = tag(block, "state");
    const country = tag(block, "country");
    const location = [city, state].filter(Boolean).join(", ") || country || tag(block, "location");
    const [min, max] = parseSalary(tag(block, "salary"));
    const remoteType = tag(block, "remotetype");
    const posted = tag(block, "date", "pubdate", "published", "updated");

    return {
      source: "XML_FEED",
      publisher: `${company} job feed`,
      externalId: `feed:${tag(block, "referencenumber", "requisitionid", "guid", "id") || `${host}#${i}`}`.slice(0, 180),
      sourceUrl: url,
      title: title || "Untitled role",
      companyName: company,
      location: location || "Not specified",
      // Check hybrid FIRST — Indeed's vocabulary uses "Hybrid remote", which
      // contains "remote" and would otherwise be read as fully remote.
      remote: /hybrid/i.test(remoteType)
        ? "HYBRID"
        : /remote|telecommute/i.test(remoteType)
          ? "REMOTE"
          : inferRemote(`${location} ${description.slice(0, 1200)}`, location),
      employmentType: tag(block, "jobtype", "employmenttype") || inferEmploymentType(description.slice(0, 600)),
      seniority: tag(block, "experience") || inferSeniority(title, description),
      salaryMin: min,
      salaryMax: max,
      currency: "USD",
      description: description.slice(0, 6000),
      skills: extractSkills([tag(block, "category"), description].join("\n")),
      perks: [tag(block, "category")].filter(Boolean),
      applyMethod: "EXTERNAL",
      applyUrl: url,
      postedAt: posted && !Number.isNaN(Date.parse(posted)) ? new Date(posted) : new Date(),
      raw: { via: "xmlfeed", feedUrl },
    };
  });
}
