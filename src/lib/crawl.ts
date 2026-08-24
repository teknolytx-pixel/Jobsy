import { safeFetch, type SafeFetchDeps } from "./safeFetch";

/**
 * CRAWLING A CAREERS SITE THAT PUBLISHES NOTHING ON ITS LISTING PAGE.
 *
 * ── The gap this closes ──
 *
 * Detection used to look for schema.org JobPosting data on the one page the
 * recruiter pasted. That is the wrong page on most career sites.
 *
 * Google for Jobs requires the structured data on the JOB DETAIL page — the
 * page for one specific opening. Nothing requires it on the listing page, and
 * most sites don't put it there, because the listing is usually rendered by
 * JavaScript from an internal API. So a site can be perfectly readable, publish
 * clean JSON-LD for every one of its four hundred jobs, and still be reported
 * by us as "publishes no JobPosting structured data" — because we looked at the
 * index and never opened a job.
 *
 * This module opens the jobs. Two ways of finding them, tried in order:
 *
 *   • links on the listing page that look like job detail URLs;
 *   • the site's own sitemap, which frequently lists every job even when the
 *     listing page is JavaScript.
 *
 * ── robots.txt ──
 *
 * Following links is a crawl, and a crawl that ignores robots.txt is one we
 * have no business running. Publishing structured data is an invitation to read
 * it; robots.txt is where a site sets the terms of that invitation, and some
 * sites — Citi's careers site among them — disallow their own search paths.
 *
 * So every fetch here is checked first, we identify ourselves honestly as
 * JobsyBot (the same name safeFetch sends), and we honour Crawl-delay. A site
 * that says no gets no as an answer, and the recruiter is told that is what
 * happened rather than being shown a vague failure.
 *
 * ── What it deliberately does not do ──
 *
 * No JavaScript execution, no headless browser, no reading of internal APIs
 * found by watching network traffic. If a site's jobs exist only inside a
 * client-side app and nowhere in its HTML or sitemap, we report that honestly
 * instead of reverse-engineering a private endpoint.
 */

/** The name safeFetch sends. robots.txt groups are matched against it. */
export const BOT_TOKEN = "jobsybot";

/** Job pages opened while merely DETECTING whether a site is readable. */
export const PROBE_LIMIT = 4;

/**
 * Job pages opened during one ingest run.
 *
 * Was 40, which was the third of three reasons a bank with 3,506 openings
 * imported fifteen. A cap is still needed — a run has to end — but the real
 * limiter should be the clock, not an arbitrary count, because the useful
 * number depends entirely on how fast the site answers.
 */
export const CRAWL_LIMIT = 400;

/**
 * Listing pages expanded per run: the paginated pages of the listing itself,
 * plus category and location pages found in the sitemap.
 *
 * Each one is a request that yields links rather than jobs, so this is the
 * budget for looking around as opposed to collecting.
 */
export const LISTING_LIMIT = 30;

/**
 * How long one source may spend crawling.
 *
 * The route allows 120s and the sync loop reserves headroom for the next
 * source, so stopping ourselves at 75s means a large site degrades into
 * "imported as much as it could this cycle" rather than the function being
 * killed mid-write.
 */
export const CRAWL_BUDGET_MS = 75_000;
/** Floor on politeness, even when robots.txt asks for less. */
export const MIN_DELAY_MS = 250;

// ─────────────────────────────────────────────────────────────
// robots.txt
// ─────────────────────────────────────────────────────────────

export type RobotsRules = {
  allow: string[];
  disallow: string[];
  /** From Crawl-delay, in milliseconds. */
  delayMs: number;
  sitemaps: string[];
};

/** No robots.txt at all is a yes, and the least surprising default. */
export const ROBOTS_OPEN: RobotsRules = { allow: [], disallow: [], delayMs: MIN_DELAY_MS, sitemaps: [] };

/**
 * Parse robots.txt for one agent.
 *
 * Group selection follows the convention every crawler uses: a group named for
 * us wins outright, otherwise the `*` group applies, and consecutive
 * `User-agent:` lines share the group that follows them. Sitemap lines are
 * global and collected regardless of group.
 */
export function parseRobots(text: string, agent = BOT_TOKEN): RobotsRules {
  const specific: RobotsRules = { allow: [], disallow: [], delayMs: 0, sitemaps: [] };
  const wildcard: RobotsRules = { allow: [], disallow: [], delayMs: 0, sitemaps: [] };
  const sitemaps: string[] = [];

  /** The groups the current run of User-agent lines applies to. */
  let targets: RobotsRules[] = [];
  /** True while reading User-agent lines, so a run of them accumulates. */
  let naming = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "sitemap") {
      sitemaps.push(value);
      continue;
    }

    if (field === "user-agent") {
      if (!naming) targets = [];
      naming = true;
      const name = value.toLowerCase();
      if (name === "*") targets.push(wildcard);
      // "jobsybot" and "jobsybot/1.0" both name us; robots.txt matching is on
      // the product token, not the full user-agent string.
      else if (agent.startsWith(name.split("/")[0]) && name.length > 1) targets.push(specific);
      continue;
    }

    naming = false;
    if (!targets.length) continue;

    for (const t of targets) {
      if (field === "disallow") {
        // "Disallow:" with nothing after it means allow everything — it is the
        // documented way to write an empty rule and must not become a prefix
        // that matches every path.
        if (value) t.disallow.push(value);
      } else if (field === "allow") {
        if (value) t.allow.push(value);
      } else if (field === "crawl-delay") {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) t.delayMs = Math.min(n * 1000, 10_000);
      }
    }
  }

  const chosen = specific.allow.length || specific.disallow.length || specific.delayMs ? specific : wildcard;
  return { ...chosen, delayMs: Math.max(chosen.delayMs, MIN_DELAY_MS), sitemaps };
}

/** robots.txt patterns support `*` for any run of characters and `$` for end-of-path. */
function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp(
    "^" + body.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + (anchored ? "$" : "")
  );
  return re.test(path);
}

/**
 * May we fetch this path?
 *
 * Longest matching rule wins, and Allow beats Disallow at equal length. That is
 * the rule as written down, and it matters: sites routinely disallow a whole
 * directory and then allow one path inside it.
 */
export function robotsAllows(rules: RobotsRules, pathWithQuery: string): boolean {
  let bestAllow = -1;
  let bestDisallow = -1;
  for (const p of rules.allow) if (patternMatches(p, pathWithQuery)) bestAllow = Math.max(bestAllow, p.length);
  for (const p of rules.disallow) if (patternMatches(p, pathWithQuery)) bestDisallow = Math.max(bestDisallow, p.length);
  if (bestDisallow < 0) return true;
  return bestAllow >= bestDisallow;
}

/** Read a site's robots.txt. Unreachable or unparseable is treated as open. */
export async function fetchRobots(origin: string, deps?: SafeFetchDeps): Promise<RobotsRules> {
  try {
    const res = await safeFetch(new URL("/robots.txt", origin).toString(), deps);
    if (!res.ok) return ROBOTS_OPEN;
    // A 200 that returns the site's HTML shell is a soft 404, not a policy.
    if (/^\s*<(!doctype|html)/i.test(res.body)) return ROBOTS_OPEN;
    return parseRobots(res.body.slice(0, 200_000));
  } catch {
    return ROBOTS_OPEN;
  }
}

// ─────────────────────────────────────────────────────────────
// FINDING JOB PAGES
// ─────────────────────────────────────────────────────────────

/**
 * A path that looks like one specific opening rather than a listing.
 *
 * Two conditions, and both are needed. The first says the URL is about jobs at
 * all. The second says it identifies ONE of them — a numeric id or a slug of
 * several words — which is what separates /job/1234/senior-engineer from
 * /jobs, /careers/benefits and /job-alerts.
 */
const JOBBISH = /\/(jobs?|careers?|positions?|openings?|vacanc(?:y|ies)|opportunit(?:y|ies)|stelle|emplois?)(?:[/-]|$)/i;
/** A requisition number anywhere in the path — the most reliable signal there is. */
const HAS_ID = /\/\d{3,}(?:[/_-]|$)/;
/** Or a title-shaped final segment: three or more words is a role, not a section. */
const HAS_SLUG = /\/[a-z0-9]+(?:-[a-z0-9]+){2,}\/?$/i;

/** Listing furniture that satisfies both tests by accident. */
const NOT_A_JOB =
  /\/(job-alerts?|job-search|search-results|saved-jobs|login|sign-?in|register|apply-now|privacy|cookie|terms|accessibility|sitemap)\b/i;

export function looksLikeJobPage(u: URL): boolean {
  const path = u.pathname;
  if (NOT_A_JOB.test(path)) return false;
  if (!JOBBISH.test(path)) return false;
  return HAS_ID.test(path) || HAS_SLUG.test(path);
}

/**
 * Candidate job detail URLs linked from a listing page.
 *
 * Same origin only — an off-site link is somebody else's ATS, and if it is one
 * we support the pattern matcher will already have caught it upstream.
 */
export function jobLinksFrom(html: string, base: URL, limit = CRAWL_LIMIT): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)) {
    let u: URL;
    try {
      u = new URL(m[1], base);
    } catch {
      continue;
    }
    if (u.origin !== base.origin) continue;
    u.hash = "";
    const key = u.toString();
    if (key === base.toString() || seen.has(key)) continue;
    if (!looksLikeJobPage(u)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= limit) break;
  }
  return out;
}

/** <loc> entries from a sitemap or sitemap index. */
export function sitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) =>
    m[1].replace(/&amp;/g, "&").trim()
  );
}

/**
 * Job URLs discovered through the sitemap.
 *
 * Worth the extra requests because it is often the ONLY machine-readable index
 * a JavaScript careers site has: the listing renders client-side and links to
 * nothing, while the sitemap dutifully lists all four hundred jobs, because it
 * was generated for search engines.
 *
 * One level of sitemap-index recursion, and a hard cap on nested documents. A
 * large employer's sitemap index can point at dozens of files and we are not
 * entitled to pull all of them to answer "is this site readable".
 */
/**
 * Pagination links on a listing page.
 *
 * The second reason a bank with 3,506 openings imported fifteen: we read page
 * one and stopped. Fifteen was not a cap we chose, it was simply how many job
 * cards that page renders server-side.
 *
 * Three shapes cover almost everything: an explicit rel="next", a page number
 * in the query string, and a page number in the path. Sorted by page number so
 * the budget is spent on the earliest pages rather than whichever the template
 * happened to emit first.
 */
const PAGE_QUERY = /[?&](page|p|pg|pageno|offset|start|from|skip)=(\d+)/i;
const PAGE_PATH = /\/(?:page|p)[/-](\d+)(?:\/|$)/i;

export function paginationLinksFrom(html: string, base: URL, limit = LISTING_LIMIT): string[] {
  const found = new Map<string, number>();

  const consider = (href: string, forced?: number) => {
    let u: URL;
    try {
      u = new URL(href, base);
    } catch {
      return;
    }
    if (u.origin !== base.origin) return;
    u.hash = "";
    if (u.toString() === base.toString()) return;
    const n =
      forced ??
      Number(u.search.match(PAGE_QUERY)?.[2] ?? u.pathname.match(PAGE_PATH)?.[1] ?? NaN);
    if (!Number.isFinite(n) || n < 1 || n > 500) return;
    // A job page that happens to carry a page number is not pagination.
    if (looksLikeJobPage(u)) return;
    const key = u.toString();
    if (!found.has(key)) found.set(key, n);
  };

  for (const m of html.matchAll(/<a\b([^>]*)\bhref=["']([^"']+)["']([^>]*)>/gi)) {
    const attrs = `${m[1]} ${m[3]}`;
    // rel="next" is the site telling us outright, so trust it without a number.
    if (/\brel=["'][^"']*\bnext\b/i.test(attrs)) consider(m[2], 2);
    else consider(m[2]);
  }

  return [...found.entries()].sort((a, b) => a[1] - b[1]).slice(0, limit).map(([u]) => u);
}

/**
 * Every jobs-related URL a site's sitemap names, split by what it looks like.
 *
 * The split matters. A sitemap that lists individual jobs is the jackpot. A
 * sitemap that lists category and location landing pages — which is what a
 * large employer usually has — looked like a dead end to the first version of
 * this crawler, and is actually the index we want: each of those pages links to
 * jobs, so expanding a few of them per run reaches thousands.
 */
export async function sitemapCandidates(
  origin: string,
  rules: RobotsRules,
  deps?: SafeFetchDeps,
  maxDocuments = 8,
  deadline?: number
): Promise<{ jobs: string[]; listings: string[] }> {
  const roots = [
    ...rules.sitemaps,
    new URL("/sitemap.xml", origin).toString(),
    new URL("/sitemap_index.xml", origin).toString(),
  ];

  const jobs: string[] = [];
  const listings: string[] = [];
  const seen = new Set<string>();
  let documents = 0;

  const outOfTime = () => Boolean(deadline && Date.now() > deadline);

  const read = async (url: string, depth: number): Promise<void> => {
    if (documents >= maxDocuments || outOfTime()) return;
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return;
    }
    if (u.origin !== origin) return;
    if (!robotsAllows(rules, u.pathname + u.search)) return;
    if (seen.has(u.toString())) return;
    seen.add(u.toString());

    documents++;
    const res = await safeFetch(u.toString(), deps);
    if (!res.ok || !/<(urlset|sitemapindex)/i.test(res.body)) return;

    const locs = sitemapLocs(res.body);

    if (/<sitemapindex/i.test(res.body) && depth === 0) {
      // A big site's index is mostly news, images and marketing. Read the
      // nested sitemaps whose own names mention jobs first.
      const ranked = locs.sort((a, b) => Number(JOBBISH.test(b)) - Number(JOBBISH.test(a)));
      for (const loc of ranked) {
        if (documents >= maxDocuments || outOfTime()) return;
        await new Promise((r) => setTimeout(r, rules.delayMs));
        await read(loc, depth + 1);
      }
      return;
    }

    for (const loc of locs) {
      let l: URL;
      try {
        l = new URL(loc);
      } catch {
        continue;
      }
      if (l.origin !== origin) continue;
      if (!robotsAllows(rules, l.pathname + l.search)) continue;
      const key = l.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      if (looksLikeJobPage(l)) jobs.push(key);
      else if (JOBBISH.test(l.pathname) && !NOT_A_JOB.test(l.pathname)) listings.push(key);
    }
  };

  for (const root of roots) await read(root, 0);
  return { jobs, listings };
}

/** Kept for the detection path: cheap, first-answer-wins. */
export async function sitemapJobUrls(
  origin: string,
  rules: RobotsRules,
  limit = PROBE_LIMIT,
  deps?: SafeFetchDeps
): Promise<string[]> {
  const { jobs } = await sitemapCandidates(origin, rules, deps, 4);
  return jobs.slice(0, limit);
}

// ─────────────────────────────────────────────────────────────
// PUTTING IT TOGETHER
// ─────────────────────────────────────────────────────────────

export type JobPageSource = "links" | "sitemap" | "none";

/**
 * Job pages for DETECTION — is this site readable at all?
 *
 * Deliberately first-answer-wins and tiny. The question is whether structured
 * data exists anywhere, and four pages settles it.
 */
export async function findJobPages(
  listingUrl: string,
  html: string,
  rules: RobotsRules,
  limit = PROBE_LIMIT,
  deps?: SafeFetchDeps
): Promise<{ urls: string[]; via: JobPageSource }> {
  const base = new URL(listingUrl);

  const linked = jobLinksFrom(html, base, limit).filter((u) => {
    const p = new URL(u);
    return robotsAllows(rules, p.pathname + p.search);
  });
  if (linked.length) return { urls: linked, via: "links" };

  const fromSitemap = await sitemapJobUrls(base.origin, rules, limit, deps);
  if (fromSitemap.length) return { urls: fromSitemap, via: "sitemap" };

  return { urls: [], via: "none" };
}

export type DiscoveryOpts = {
  limit?: number;
  /** Wall-clock stop, as an epoch millisecond. */
  deadline?: number;
  /** Listing pages to expand this run. */
  listingLimit?: number;
  /**
   * Where to start in the list of expandable listing pages.
   *
   * A large employer has hundreds of category pages and one run can afford to
   * open a few dozen. Without an offset every run would open the SAME few dozen
   * and coverage would stop dead; with it, successive runs walk the catalogue.
   */
  rotate?: number;
  deps?: SafeFetchDeps;
};

export type DiscoveryResult = {
  urls: string[];
  /** Which strategies contributed, for the operator-facing explanation. */
  via: string[];
  /** Whether the budget ran out before discovery finished. */
  truncated: boolean;
};

/**
 * EVERY job URL this site will show us, within a budget.
 *
 * ── What was wrong before ──
 *
 * The first version was `if (linked.length) return linked` — the sitemap was a
 * FALLBACK, consulted only when the listing page yielded nothing. So a site
 * whose listing renders fifteen job cards returned exactly fifteen job URLs and
 * the sitemap naming hundreds more was never opened. That is the first and
 * largest of the three reasons a bank with 3,506 openings imported fifteen.
 *
 * Strategies are now additive. Cheapest first, so a small site still costs one
 * request, but nothing short-circuits the rest.
 */
export async function discoverJobUrls(
  listingUrl: string,
  html: string,
  rules: RobotsRules,
  opts: DiscoveryOpts = {}
): Promise<DiscoveryResult> {
  const limit = opts.limit ?? CRAWL_LIMIT;
  const listingLimit = opts.listingLimit ?? LISTING_LIMIT;
  const { deadline, deps } = opts;
  const base = new URL(listingUrl);

  const urls = new Set<string>();
  const via: string[] = [];

  const outOfTime = () => Boolean(deadline && Date.now() > deadline);
  const allowed = (u: string) => {
    const p = new URL(u);
    return robotsAllows(rules, p.pathname + p.search);
  };
  const add = (found: string[]) => {
    for (const u of found) {
      if (urls.size >= limit) return;
      if (allowed(u)) urls.add(u);
    }
  };

  // ── 1. the page we were given ──
  const direct = jobLinksFrom(html, base, limit);
  if (direct.length) {
    add(direct);
    via.push("links on the listing page");
  }

  /**
   * Expand listing pages into job links.
   *
   * Each caller gets its OWN allowance rather than sharing one. Sharing looked
   * tidier and was wrong: a site with thirty paginated pages would spend the
   * whole budget on pagination and never open a single sitemap category page,
   * which is precisely the rotation that lets successive runs widen coverage.
   * The wall clock is the real limiter, and it applies to both.
   */
  const expand = async (pages: string[], label: string) => {
    let used = false;
    let spent = 0;
    for (const page of pages) {
      if (urls.size >= limit || spent >= listingLimit || outOfTime()) break;
      if (!allowed(page)) continue;
      spent++;
      const res = await safeFetch(page, deps);
      await new Promise((r) => setTimeout(r, rules.delayMs));
      if (!res.ok) continue;
      const before = urls.size;
      add(jobLinksFrom(res.body, new URL(res.finalUrl), limit));
      if (urls.size > before) used = true;
    }
    if (used) via.push(label);
  };

  // ── 2. the rest of the listing ──
  if (urls.size < limit && !outOfTime()) {
    await expand(paginationLinksFrom(html, base, listingLimit), "the listing's later pages");
  }

  // ── 3 + 4. the sitemap: jobs directly, then pages that link to jobs ──
  if (urls.size < limit && !outOfTime()) {
    const { jobs, listings } = await sitemapCandidates(base.origin, rules, deps, 8, deadline);

    if (jobs.length) {
      const before = urls.size;
      add(jobs);
      if (urls.size > before) via.push("the sitemap");
    }

    if (urls.size < limit && listings.length) {
      // Rotate, so successive runs walk the catalogue instead of re-reading the
      // same few dozen category pages for ever.
      const offset = ((opts.rotate ?? 0) % listings.length + listings.length) % listings.length;
      const ordered = [...listings.slice(offset), ...listings.slice(0, offset)];
      await expand(ordered, "category and location pages from the sitemap");
    }
  }

  return {
    urls: [...urls],
    via,
    truncated: urls.size >= limit || outOfTime(),
  };
}

/**
 * Fetch job pages one at a time, honouring Crawl-delay and the deadline.
 *
 * Sequential on purpose. Parallel fetches would be faster and would also be the
 * behaviour that gets a crawler blocked; a large employer's catalogue is worth
 * spreading across runs rather than hammering in one.
 */
export async function fetchJobPages(
  urls: string[],
  rules: RobotsRules,
  deps?: SafeFetchDeps,
  deadline?: number
): Promise<{ url: string; html: string }[]> {
  const out: { url: string; html: string }[] = [];
  for (const url of urls) {
    if (deadline && Date.now() > deadline) break;
    const res = await safeFetch(url, deps);
    if (res.ok) out.push({ url: res.finalUrl, html: res.body.slice(0, 400_000) });
    await new Promise((r) => setTimeout(r, rules.delayMs));
  }
  return out;
}
