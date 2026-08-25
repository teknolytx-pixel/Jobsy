import type { AtsKind } from "./providers/ats";
import { safeFetch, type SafeFetchDeps } from "./safeFetch";
import { ATS_LABEL } from "./providers/ats";
import { recogniseVendor } from "./vendors";
import { PROBE_LIMIT, fetchJobPages, fetchRobots, findJobPages, robotsAllows } from "./crawl";
import { employerNameFrom } from "./employer";
import { jobsFromEmbeddedJson } from "./providers/embedded";

/**
 * CAREERS-URL AUTO-DETECTION.
 *
 * The user experience this exists for: a recruiter pastes
 * "https://acme.com/careers" and Jobsy figures out, on its own, how to keep
 * pulling every job Acme posts from that moment on.
 *
 * Six strategies, tried in order of reliability:
 *
 *   1. URL fingerprint      — the careers URL IS an ATS URL
 *                             (boards.greenhouse.io/acme, acme.recruitee.com…)
 *   2. HTML fingerprint     — a company-branded page that embeds or redirects
 *                             to an ATS; the token appears in an iframe src,
 *                             a script tag, or a link
 *   3. JSON-LD              — no known ATS, but the page publishes schema.org
 *                             JobPosting structured data
 *   4. Feed autodiscovery   — an <link rel="alternate"> XML/RSS job feed, or a
 *                             feed at a conventional path
 *   5. Linked job pages     — the listing carries no structured data, but the
 *                             jobs it links to do
 *   6. Sitemap              — the listing is rendered client-side and links to
 *                             nothing, but the sitemap lists every job
 *
 * ── Why 5 and 6 exist ──
 *
 * Strategy 3 was looking at the wrong page on most of the internet. Google for
 * Jobs requires JSON-LD on the page for ONE opening, and nothing requires it on
 * the index — so a site with clean structured data on four hundred job pages
 * was being reported as publishing none, because we only ever opened the index.
 * That single gap accounted for a large share of the sites we told recruiters
 * we couldn't read.
 *
 * ── The limits, stated plainly ──
 *
 * Nothing here defeats an access control, executes JavaScript, or reads a
 * private API. Every strategy reads what the company publishes for exactly this
 * purpose, robots.txt is honoured before anything is crawled, and when a site
 * genuinely publishes nothing machine-readable we name the system it runs on
 * and say what to ask for. "Every career site works" is not a promise anyone
 * can keep; being specific about which one this is, and why, is.
 */

export type DetectionKind = AtsKind | "JSONLD" | "JSONLD_CRAWL" | "XML_FEED";

export type Detection = {
  kind: DetectionKind;
  token: string; // board slug, or a URL for JSONLD / XML_FEED
  companyName: string;
  label: string;
  confidence: "certain" | "likely";
  via: string; // human-readable explanation of how we worked it out
};

export type DetectionFailure = {
  kind: null;
  reason: string;
  suggestions: string[];
  /**
   * What was actually tried, in order.
   *
   * Added because four separate rounds of "why won't this site connect" were
   * answered by guessing. The failure message said what we did not FIND; it
   * never said what we LOOKED AT, so nobody — including whoever wrote the
   * detector — could tell whether a site had no job links, or had them behind a
   * robots rule, or had them in a sitemap we never reached.
   *
   * Nothing here is sensitive: it is a list of the requests we made against a
   * public careers page, which the operator is entitled to see.
   */
  trace: string[];
};

const UA = { "User-Agent": "Jobsy/1.0 (+job aggregation; contact: hello@jobsy.app)" };

const titleCase = (s: string) =>
  s.replace(/[-_.]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();

// ─────────────────────────────────────────────────────────────
// 1 + 2. ATS FINGERPRINTS
//
// Each pattern is applied to the URL first, then to the page HTML — the same
// token shows up in both a direct ATS link and an embedded widget.
// ─────────────────────────────────────────────────────────────
type Pattern = { kind: AtsKind; re: RegExp; token?: (m: RegExpMatchArray) => string };

// ORDER MATTERS: the most specific pattern for a vendor must come first, or a
// generic one captures a path segment like "embed" instead of the board slug.
const PATTERNS: Pattern[] = [
  { kind: "GREENHOUSE", re: /greenhouse\.io\/embed\/job_board(?:\/js)?\?for=([a-z0-9_-]+)/i },
  { kind: "GREENHOUSE", re: /boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9_-]+)/i },
  { kind: "GREENHOUSE", re: /(?:boards|job-boards)\.greenhouse\.io\/([a-z0-9_-]+)/i },
  { kind: "LEVER", re: /jobs\.(?:eu\.)?lever\.co\/([a-z0-9_-]+)/i },
  { kind: "LEVER", re: /api\.lever\.co\/v0\/postings\/([a-z0-9_-]+)/i },
  { kind: "ASHBY", re: /jobs\.ashbyhq\.com\/([a-z0-9_.-]+)/i },
  { kind: "ASHBY", re: /api\.ashbyhq\.com\/posting-api\/job-board\/([a-z0-9_.-]+)/i },
  { kind: "WORKABLE", re: /apply\.workable\.com\/(?:api\/v1\/widget\/accounts\/)?([a-z0-9_-]+)/i },
  { kind: "WORKABLE", re: /([a-z0-9_-]+)\.workable\.com/i },
  { kind: "SMARTRECRUITERS", re: /jobs\.smartrecruiters\.com\/([a-z0-9_-]+)/i },
  { kind: "SMARTRECRUITERS", re: /api\.smartrecruiters\.com\/v1\/companies\/([a-z0-9_-]+)/i },
  { kind: "SMARTRECRUITERS", re: /careers\.smartrecruiters\.com\/([a-z0-9_-]+)/i },
  { kind: "RECRUITEE", re: /([a-z0-9_-]+)\.recruitee\.com/i },
  { kind: "PERSONIO", re: /([a-z0-9_-]+)\.jobs\.personio\.(?:de|com)/i },
  { kind: "BAMBOOHR", re: /([a-z0-9_-]+)\.bamboohr\.com\/(?:careers|jobs)/i },
  {
    kind: "WORKDAY",
    // tenant . wdN . myworkdayjobs.com [/lang] /SiteName
    re: /([a-z0-9_-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/,
    token: (m) => `${m[1]}|${m[2]}|${m[3]}`,
  },
];

/**
 * Pure URL/HTML → {vendor, board token}. No network.
 *
 * Exported so tooling can resolve a careers URL the SAME way the Sources screen
 * does. A second parser would drift, and the failure when it drifted would be a
 * board that connects in the UI but not from the command line, or the reverse —
 * with nothing to say which was right.
 */
export function matchPatterns(haystack: string): { kind: AtsKind; token: string } | null {
  for (const p of PATTERNS) {
    const m = haystack.match(p.re);
    if (m) {
      const token = p.token ? p.token(m) : m[1];
      // Never accept a vendor path segment or marketing subdomain as a slug.
      if (/^(www|apply|jobs|careers|api|help|support|blog|embed|job_board|v1|boards|posting-api|o|j)$/i.test(token)) {
        continue;
      }
      return { kind: p.kind, token };
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// 3. JSON-LD JobPosting on a bespoke careers page
// ─────────────────────────────────────────────────────────────
export function findJsonLdJobPostings(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const blocks = [...html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )];

  for (const b of blocks) {
    try {
      const parsed = JSON.parse(b[1].trim());
      // JSON-LD may be a single object, an array, or an @graph wrapper
      const nodes: unknown[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { "@graph"?: unknown[] })["@graph"])
          ? (parsed as { "@graph": unknown[] })["@graph"]
          : [parsed];
      for (const n of nodes) {
        const node = n as Record<string, unknown>;
        const t = node?.["@type"];
        const types = Array.isArray(t) ? t : [t];
        if (types.includes("JobPosting")) out.push(node);
      }
    } catch {
      /* malformed JSON-LD is common in the wild — skip it silently */
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// 4. Feed autodiscovery
// ─────────────────────────────────────────────────────────────
const FEED_PATHS = ["/jobs.xml", "/careers/jobs.xml", "/feed/jobs.xml", "/jobs.rss", "/careers.xml", "/indeed.xml"];

function findDeclaredFeed(html: string, base: URL): string | null {
  const link = html.match(
    /<link[^>]+rel=["']alternate["'][^>]+(?:type=["'](?:application\/(?:rss\+xml|atom\+xml|xml)|text\/xml)["'])[^>]*>/i
  );
  const href = link?.[0].match(/href=["']([^"']+)["']/i)?.[1];
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// THE ENTRY POINT
// ─────────────────────────────────────────────────────────────
export async function detectSource(
  rawUrl: string,
  /** Tests only. Production never passes this — see safeFetch.ts. */
  deps?: SafeFetchDeps
): Promise<Detection | DetectionFailure> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim().startsWith("http") ? rawUrl.trim() : `https://${rawUrl.trim()}`);
  } catch {
    return { kind: null, reason: "That doesn't look like a URL.", suggestions: [], trace: [] };
  }

  const domainName = titleCase(url.hostname.replace(/^(www|careers|jobs|apply)\./, "").split(".")[0]);

  // ── 1. the URL itself is an ATS URL ──
  const fromUrl = matchPatterns(url.toString());
  if (fromUrl) {
    return {
      kind: fromUrl.kind,
      token: fromUrl.token,
      companyName: domainName,
      label: ATS_LABEL[fromUrl.kind],
      confidence: "certain",
      via: `The URL is a ${ATS_LABEL[fromUrl.kind]} job board.`,
    };
  }

  /**
   * ── fetch the page for strategies 2–4 ──
   *
   * Through `safeFetch`, not `fetch`. This line used to read the URL directly
   * with `redirect: "follow"` and no validation, which made it a server-side
   * request forgery hole: pasting a cloud metadata address or an internal
   * hostname into the "careers page URL" field made our own server read it and
   * hand the result back. See src/lib/safeFetch.ts.
   */
  /**
   * robots.txt first, because everything below this line is a fetch.
   *
   * A site is entitled to say no, and some do: Citi's careers site disallows
   * its own /search-jobs/ paths, which is the exact URL a recruiter would
   * naturally paste. Reading it anyway would be both rude and, on a site that
   * blocks bots at the edge, useless. Saying so is more helpful than a generic
   * failure, because it tells the recruiter the problem is not their URL.
   */
  const trace: string[] = [];

  const rules = await fetchRobots(url.origin, deps);
  trace.push(
    rules.disallow.length
      ? `robots.txt: ${rules.disallow.length} disallow rule(s), ${rules.sitemaps.length} sitemap(s) declared`
      : `robots.txt: nothing disallowed, ${rules.sitemaps.length} sitemap(s) declared`
  );
  if (!robotsAllows(rules, url.pathname + url.search)) {
    const vendor = recogniseVendor(url.toString());
    return {
      kind: null,
      reason:
        `${url.hostname} asks crawlers not to read ${url.pathname} in its robots.txt, and Jobsy honours that.` +
        (vendor ? ` The site runs on ${vendor.name}. ${vendor.ask}` : ""),
      suggestions: [
        "Try the page one level up — many sites disallow their search results but not the careers index itself.",
        ...manualSuggestions(),
      ],
      trace: [...trace, `refused: robots.txt disallows ${url.pathname}`],
    };
  }

  const fetched = await safeFetch(url.toString(), deps);
  if (!fetched.ok) {
    return { kind: null, reason: fetched.reason, suggestions: manualSuggestions(), trace: [...trace, `fetch failed: ${fetched.reason}`] };
  }
  const html = fetched.body.slice(0, 900_000);
  trace.push(`page: ${html.length.toLocaleString()} bytes read from ${fetched.finalUrl}`);

  // ── 2. an ATS is embedded in the page ──
  const fromHtml = matchPatterns(html);
  if (fromHtml) {
    // prefer the company's real name from <title> or og:site_name
    const siteName =
      html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
      domainName;
    return {
      kind: fromHtml.kind,
      token: fromHtml.token,
      companyName: siteName.trim().slice(0, 80),
      label: ATS_LABEL[fromHtml.kind],
      confidence: "certain",
      via: `That careers page is powered by ${ATS_LABEL[fromHtml.kind]} (found the board "${fromHtml.token}" embedded in the page).`,
    };
  }

  // ── 3. schema.org JobPosting structured data ──
  const postings = findJsonLdJobPostings(html);
  if (postings.length) {
    const org = postings[0]?.hiringOrganization as { name?: string } | undefined;
    return {
      kind: "JSONLD",
      token: url.toString(),
      companyName: (org?.name ?? domainName).slice(0, 80),
      label: "Career site (structured data)",
      confidence: "certain",
      via: `No known ATS, but the page publishes ${postings.length} schema.org JobPosting record${postings.length > 1 ? "s" : ""} — the same data it gives Google for Jobs.`,
    };
  }

  // ── 4. a declared or conventional job feed ──
  const declared = findDeclaredFeed(html, url);
  const candidates = declared
    ? [declared]
    : FEED_PATHS.map((p) => new URL(p, url.origin).toString());

  for (const candidate of candidates) {
    try {
      // Guarded too: `declared` comes from a <link> tag in a page we do not
      // control, so it is every bit as attacker-supplied as the original URL.
      const feed = await safeFetch(candidate, deps);
      if (!feed.ok) continue;
      const body = feed.body.slice(0, 4000);
      if (/<(job|item|entry)[\s>]/i.test(body)) {
        return {
          kind: "XML_FEED",
          token: candidate,
          companyName: domainName,
          label: "XML job feed",
          confidence: declared ? "certain" : "likely",
          via: `Found an XML job feed at ${candidate}.`,
        };
      }
    } catch {
      /* try the next candidate */
    }
  }

  /*
   * ── 5. the page's own JavaScript state ──
   *
   * Checked BEFORE crawling, because it costs nothing: the HTML is already in
   * hand. A site that renders its jobs client-side has almost always shipped
   * the first page of them in a __NEXT_DATA__ or __INITIAL_STATE__ blob, and
   * reporting "the jobs only exist inside a JavaScript app" while holding that
   * blob in a string is a failure of effort, not of possibility.
   */
  const embedded = jobsFromEmbeddedJson(html, fetched.finalUrl, siteNameFrom(html) ?? domainName);
  trace.push(`page data: ${embedded.length} job-shaped record(s) in the page's own JSON`);
  if (embedded.length >= 2) {
    return {
      kind: "JSONLD",
      token: fetched.finalUrl,
      companyName: (siteNameFrom(html) ?? domainName).slice(0, 80),
      label: "Career site (page data)",
      confidence: "likely",
      via: `The page renders its jobs in the browser, but ships ${embedded.length} of them in the HTML as page data — that is what Jobsy reads.`,
    };
  }

  // ── 6 + 7. the jobs themselves carry the structured data ──
  //
  // Found by following links, or through the sitemap when the listing is
  // rendered client-side and links to nothing. Only a handful of pages are
  // opened here: this is a question ("is this site readable?"), not an import.
  const { urls, via } = await findJobPages(fetched.finalUrl, html, rules, PROBE_LIMIT, deps);
  trace.push(
    urls.length
      ? `job pages: ${urls.length} found via ${via} — e.g. ${urls[0]}`
      : `job pages: none found by following links, and none in the sitemap`
  );
  if (urls.length) {
    const probed = await fetchJobPages(urls, rules, deps);
    const records = probed.flatMap((p) => findJsonLdJobPostings(p.html));
    trace.push(`probed ${probed.length} job page(s): ${records.length} carried JobPosting data`);
    if (records.length) {
      return {
        kind: "JSONLD_CRAWL",
        token: fetched.finalUrl,
        /*
         * Across every probed page, not the first record.
         *
         * Taking the first is how Citi's connection ended up called "Early
         * Career" — a programme name in one record, mistaken for the employer.
         */
        companyName: employerNameFrom({
          jsonLdNames: records.map(
            (n) => ((n.hiringOrganization as { name?: string } | undefined)?.name ?? "")
          ),
          siteName: siteNameFrom(html),
          url: fetched.finalUrl,
        }),
        label: "Career site (job pages)",
        confidence: "certain",
        via:
          via === "sitemap"
            ? `The listing page is rendered in the browser, but the sitemap lists the individual jobs and each one publishes schema.org JobPosting data — the same data the site gives Google for Jobs.`
            : `The listing page carries no structured data, but the jobs it links to do — each job page publishes schema.org JobPosting data.`,
      };
    }
  }

  // ── nothing machine-readable. Say what this actually is. ──
  //
  // The old message here listed three things we failed to find and gave the
  // recruiter nothing to do about any of them. Naming the system the site runs
  // on turns it into a request they can forward: every one of these platforms
  // can emit an XML feed, and it is the same feed the employer already sends to
  // Indeed, so the talent team usually just has to switch it on.
  const vendor = recogniseVendor(url.toString()) ?? recogniseVendor(html.slice(0, 300_000));
  if (vendor) {
    return {
      kind: null,
      reason:
        `${domainName} runs on ${vendor.name}, which Jobsy can't pull from automatically — it publishes no job feed or structured data on this page. ${vendor.ask}`,
      suggestions: [
        `Send the employer this: "Please share your ${vendor.name} job feed URL — the same XML feed you supply to Indeed."`,
        "Once you have the feed URL, paste it here instead and it will connect in seconds.",
        "In the meantime you can import individual jobs by URL from the Post a job screen.",
      ],
      trace,
    };
  }

  return {
    kind: null,
    reason:
      `Jobsy read ${url.hostname} and everything it links to, and found nothing machine-readable: no ATS it recognises, no schema.org JobPosting data on the page or on the jobs, no page data, and no XML feed. That usually means the jobs are fetched by the browser after the page loads.`,
    suggestions: manualSuggestions(),
    trace,
  };
}

const siteNameFrom = (html: string): string | null =>
  html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)?.[1]?.trim() ?? null;

const manualSuggestions = () => [
  "Click through to the page that actually lists the jobs — many careers pages are just marketing, and the real board sits one link deeper.",
  "If you know the ATS, add it directly: Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee, Personio, BambooHR or Workday, plus the company's board slug.",
  "Ask the employer for their job feed URL — it's the same XML feed they already hand to Indeed, and Jobsy reads that format.",
];
