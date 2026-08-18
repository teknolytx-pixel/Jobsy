import type { AtsKind } from "./providers/ats";
import { ATS_LABEL } from "./providers/ats";

/**
 * CAREERS-URL AUTO-DETECTION.
 *
 * The user experience this exists for: a recruiter pastes
 * "https://acme.com/careers" and Jobsy figures out, on its own, how to keep
 * pulling every job Acme posts from that moment on.
 *
 * Four strategies, tried in order of reliability:
 *
 *   1. URL fingerprint      — the careers URL IS an ATS URL
 *                             (boards.greenhouse.io/acme, acme.recruitee.com…)
 *   2. HTML fingerprint     — a company-branded page that embeds or redirects
 *                             to an ATS; the token appears in an iframe src,
 *                             a script tag, or a link
 *   3. JSON-LD              — no known ATS, but the page publishes schema.org
 *                             JobPosting structured data (most modern career
 *                             sites do, because Google for Jobs requires it)
 *   4. Feed autodiscovery   — an <link rel="alternate"> XML/RSS job feed, or a
 *                             feed at a conventional path
 *
 * Nothing here defeats an access control: every strategy reads data the company
 * publishes for exactly this purpose. If all four miss, we say so plainly and
 * offer the manual paths rather than guessing.
 */

export type DetectionKind = AtsKind | "JSONLD" | "XML_FEED";

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

function matchPatterns(haystack: string): { kind: AtsKind; token: string } | null {
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
export async function detectSource(rawUrl: string): Promise<Detection | DetectionFailure> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim().startsWith("http") ? rawUrl.trim() : `https://${rawUrl.trim()}`);
  } catch {
    return { kind: null, reason: "That doesn't look like a URL.", suggestions: [] };
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

  // ── fetch the page for strategies 2–4 ──
  let html = "";
  try {
    const res = await fetch(url.toString(), { headers: UA, redirect: "follow", cache: "no-store" });
    if (!res.ok) {
      return {
        kind: null,
        reason: `Couldn't read that page — it returned HTTP ${res.status}.`,
        suggestions: manualSuggestions(),
      };
    }
    html = (await res.text()).slice(0, 900_000);
  } catch (e) {
    return {
      kind: null,
      reason: `Couldn't reach that page: ${(e as Error).message}`,
      suggestions: manualSuggestions(),
    };
  }

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
      const res = await fetch(candidate, { headers: UA, cache: "no-store" });
      if (!res.ok) continue;
      const body = (await res.text()).slice(0, 4000);
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

  return {
    kind: null,
    reason:
      "That page loaded, but it isn't on an ATS we recognise, publishes no JobPosting structured data, and exposes no job feed.",
    suggestions: manualSuggestions(),
  };
}

const manualSuggestions = () => [
  "Click through to the page that actually lists the jobs — many careers pages are just marketing, and the real board sits one link deeper.",
  "If you know the ATS, add it directly: Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee, Personio, BambooHR or Workday, plus the company's board slug.",
  "Ask the employer for their job feed URL — it's the same XML feed they already hand to Indeed, and Jobsy reads that format.",
];
