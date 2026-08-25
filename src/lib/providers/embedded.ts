import { extractSkills, inferSeniority } from "../skills";
import {
  type NormalizedJob,
  inferEmploymentType,
  inferRemote,
  stripHtml,
} from "./types";

/**
 * JOBS THAT LIVE IN THE PAGE'S OWN JAVASCRIPT STATE.
 *
 * ── The gap ──
 *
 * "Jobsy read the site and everything it links to, and found nothing
 * machine-readable… the jobs only exist inside a JavaScript app." True, and
 * usually only half true. A JavaScript careers site still has to get its first
 * screenful of jobs into the browser somehow, and the overwhelmingly common way
 * is to SHIP THEM IN THE HTML as serialised state:
 *
 *   <script id="__NEXT_DATA__" type="application/json">{…}</script>   Next.js
 *   window.__INITIAL_STATE__ = {…}                                    Redux
 *   window.__NUXT__ = {…}                                             Nuxt
 *   <script type="application/json" data-component="…">[…]</script>   generic
 *
 * The framework put the data there so the page could render without a second
 * request. It is in the HTML we already fetched. Declaring the site unreadable
 * while holding its job list in a string is the kind of failure that makes a
 * product look far less capable than it is.
 *
 * ── What this is not ──
 *
 * It is not reverse-engineering a private API. Nothing here watches network
 * traffic, replays an internal endpoint, or sends a request the site did not
 * already serve to any visitor. It reads the HTML the server returned — the
 * same document, parsed more carefully.
 *
 * ── Why the shape detection is conservative ──
 *
 * A page's state blob contains navigation, feature flags, tracking config and
 * translations as well as jobs. Guessing wrong imports "Privacy Policy" as a
 * vacancy. So an array only counts as jobs when EVERY sampled entry has a
 * title AND something only a job has — a place of work, a description, a
 * contract type, a posting date, a requisition number.
 *
 * Notably NOT a link. The first version accepted title-plus-link and a
 * navigation menu is exactly that; "Home", "About", "Newsroom" would have been
 * imported as vacancies. A URL is what we link to once a row is established as
 * a job, never what establishes it.
 */

type Obj = Record<string, unknown>;

/** Read a value under any of several likely key spellings, case-insensitively. */
function pick(o: Obj, ...names: string[]): string {
  const lower = new Map(Object.keys(o).map((k) => [k.toLowerCase(), k]));
  for (const n of names) {
    const key = lower.get(n.toLowerCase());
    if (key === undefined) continue;
    const v = o[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
    // Frameworks nest constantly: { location: { name: "Austin" } }.
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const inner = pick(v as Obj, "name", "label", "title", "text", "value", "displayName");
      if (inner) return inner;
    }
    if (Array.isArray(v) && v.length) {
      const first = v[0];
      if (typeof first === "string" && first.trim()) return first.trim();
      if (first && typeof first === "object") {
        const inner = pick(first as Obj, "name", "label", "title", "text", "value");
        if (inner) return inner;
      }
    }
  }
  return "";
}

const TITLE_KEYS = ["title", "jobTitle", "positionTitle", "name", "postingTitle", "roleName"];
const ID_KEYS = ["id", "jobId", "reqId", "requisitionId", "jobReqId", "referenceNumber", "slug", "code"];
const LOCATION_KEYS = ["location", "city", "jobLocation", "primaryLocation", "locationName", "workLocation", "country"];
const URL_KEYS = ["url", "applyUrl", "jobUrl", "detailUrl", "link", "href", "canonicalUrl", "applyLink"];
const DESC_KEYS = ["description", "jobDescription", "summary", "jobSummary", "content", "body", "shortDescription"];

/**
 * Does this look like a list of jobs?
 *
 * Sampled rather than exhaustive — a thousand-entry array does not need a
 * thousand checks to establish its shape — but EVERY sampled entry must pass,
 * because a mixed array is a navigation tree with one job-shaped node in it.
 */
export function looksLikeJobArray(arr: unknown[]): boolean {
  if (arr.length < 2) return false;
  const sample = arr.slice(0, Math.min(6, arr.length));
  if (!sample.every((v) => v && typeof v === "object" && !Array.isArray(v))) return false;

  return sample.every((v) => {
    const o = v as Obj;
    const title = pick(o, ...TITLE_KEYS);
    if (!title || title.length < 2 || title.length > 200) return false;

    /*
     * A LINK IS NOT EVIDENCE.
     *
     * The first version accepted a title plus any of location, id, url or
     * description — and a navigation menu is a list of exactly title-plus-url.
     * "Home", "About", "Newsroom" sailed straight through and would have been
     * imported as vacancies.
     *
     * So a URL corroborates nothing on its own; it is what we LINK to once a
     * row is established as a job, not what establishes it. What distinguishes
     * a job from a menu item is something only a job has: a place of work, a
     * description, a contract type, a posting date, or a requisition number.
     */
    return (
      Boolean(pick(o, ...LOCATION_KEYS)) ||
      Boolean(pick(o, ...DESC_KEYS)) ||
      Boolean(pick(o, "employmentType", "jobType", "contractType", "workType")) ||
      Boolean(pick(o, "postedDate", "datePosted", "createdAt", "publishedAt", "postingDate")) ||
      Boolean(pick(o, "reqId", "requisitionId", "jobReqId", "referenceNumber", "jobId"))
    );
  });
}

/**
 * Every JSON blob the page carries.
 *
 * Both shapes: a script tag whose whole body is JSON, and an assignment to a
 * window property. The second needs a brace-matching scan rather than a regex,
 * because the value routinely contains braces inside strings and a greedy match
 * swallows the rest of the document.
 */
export function embeddedJsonBlobs(html: string, limit = 12): unknown[] {
  const out: unknown[] = [];

  const parse = (text: string) => {
    if (out.length >= limit) return;
    const t = text.trim();
    if (t.length < 40 || (t[0] !== "{" && t[0] !== "[")) return;
    try {
      out.push(JSON.parse(t));
    } catch {
      /* a partial or templated blob — skip it rather than guess */
    }
  };

  for (const m of html.matchAll(
    /<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    parse(m[1]);
  }

  // window.__INITIAL_STATE__ = {...};  /  window.__NUXT__=(function(){...}
  for (const m of html.matchAll(
    /\b(?:window|self|globalThis)\s*\.\s*(__[A-Z0-9_]+__|[A-Za-z_$][\w$]*)\s*=\s*([[{])/g
  )) {
    const start = m.index! + m[0].length - 1;
    const end = matchBrace(html, start);
    if (end > start) parse(html.slice(start, end + 1));
    if (out.length >= limit) break;
  }

  return out;
}

/**
 * Find the closing brace for the one at `start`, ignoring braces inside strings.
 *
 * Written out rather than regexed because this is precisely what a regex cannot
 * do: `{"note":"} not the end"}` ends at the second brace, and any pattern that
 * gets that right is no longer a pattern.
 */
function matchBrace(s: string, start: number): number {
  const open = s[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < s.length && i < start + 4_000_000; i++) {
    const c = s[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === "\\") {
      escaped = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Every job-shaped array anywhere inside a parsed blob, depth-limited. */
export function findJobArrays(data: unknown, depth = 0, found: Obj[][] = []): Obj[][] {
  if (depth > 8 || found.length >= 4 || !data || typeof data !== "object") return found;

  if (Array.isArray(data)) {
    if (looksLikeJobArray(data)) {
      found.push(data as Obj[]);
      return found;
    }
    for (const v of data.slice(0, 40)) findJobArrays(v, depth + 1, found);
    return found;
  }

  const o = data as Obj;
  // Keys that name jobs are checked first, so the right array wins when a page
  // holds several plausible ones.
  const keys = Object.keys(o).sort(
    (a, b) => Number(/job|position|opening|vacan|posting|result/i.test(b)) -
              Number(/job|position|opening|vacan|posting|result/i.test(a))
  );
  for (const k of keys) findJobArrays(o[k], depth + 1, found);
  return found;
}

/** Turn the page's own state into jobs. */
export function jobsFromEmbeddedJson(
  html: string,
  pageUrl: string,
  companyFallback?: string
): NormalizedJob[] {
  const origin = new URL(pageUrl).origin;
  const host = new URL(pageUrl).hostname;
  const company = companyFallback || host;

  const arrays = embeddedJsonBlobs(html).flatMap((blob) => findJobArrays(blob));
  if (!arrays.length) return [];

  // The largest job-shaped array is the listing; the smaller ones are usually
  // "related roles" or a recently-viewed strip.
  const rows = arrays.sort((a, b) => b.length - a.length)[0];

  const seen = new Set<string>();
  const out: NormalizedJob[] = [];

  for (const row of rows.slice(0, 500)) {
    const title = pick(row, ...TITLE_KEYS);
    if (!title) continue;

    const id = pick(row, ...ID_KEYS) || title;
    if (seen.has(id)) continue;
    seen.add(id);

    const rawUrl = pick(row, ...URL_KEYS);
    const url = rawUrl.startsWith("http")
      ? rawUrl
      : rawUrl
        ? `${origin}${rawUrl.startsWith("/") ? "" : "/"}${rawUrl}`
        : pageUrl;

    const description = stripHtml(pick(row, ...DESC_KEYS));
    const location = pick(row, ...LOCATION_KEYS) || "Not specified";

    out.push({
      source: "CAREER_SITE",
      publisher: `${company} careers site`,
      externalId: `embedded:${host}:${id}`.slice(0, 180),
      sourceUrl: url,
      title: title.slice(0, 200),
      companyName: company,
      location,
      remote: inferRemote(`${location} ${description.slice(0, 1200)}`, location),
      employmentType: pick(row, "employmentType", "jobType", "type", "contractType") ||
        inferEmploymentType(description.slice(0, 600)),
      seniority: inferSeniority(title, description),
      salaryMin: null,
      salaryMax: null,
      currency: "USD",
      description: description.slice(0, 6000),
      skills: extractSkills(`${title}\n${description}`),
      perks: [],
      applyMethod: "EXTERNAL",
      applyUrl: url,
      postedAt: (() => {
        const d = pick(row, "postedDate", "datePosted", "createdAt", "publishedAt", "postingDate");
        const parsed = d ? new Date(d) : null;
        return parsed && !Number.isNaN(parsed.valueOf()) ? parsed : new Date();
      })(),
      raw: { via: "embedded-json", pageUrl },
    });
  }

  return out;
}
