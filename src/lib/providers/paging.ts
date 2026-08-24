/**
 * PAGING — asking for the second page.
 *
 * ── The failure ──
 *
 * Accenture: 20 jobs. TD: 20 jobs. Deloitte: 20 jobs. Three different employers
 * on two different systems, all reporting the same suspiciously round number,
 * while Greenhouse boards next to them pulled 575 and 161.
 *
 * The Workday adapter sent `{ limit: 20, offset: 0 }` and never sent anything
 * else. Twenty was not how many jobs Accenture has; it was the size of one
 * request. The adapters that looked healthy were the ones whose APIs happen to
 * return everything in a single payload — Greenhouse and Lever — so the bug hid
 * behind them.
 *
 * ── Two kinds of paging, and why feeds need care ──
 *
 * An API that documents its paging is easy: ask for the next offset until the
 * answers run out. `pageAll` does that, with the three guards any loop against
 * somebody else's server needs — a page cap, an item cap, and a clock.
 *
 * A job FEED is different. Some declare a next page (Atom's rel="next"); many
 * paginate through a query parameter they never document. Guessing at
 * parameters is how a crawler ends up requesting the same page four hundred
 * times, because a server that does not recognise `?page=2` cheerfully returns
 * page one with a 200.
 *
 * So parameters are PROBED AND VERIFIED: try one, and keep it only if what came
 * back is actually different from what we already have. A parameter the server
 * ignores produces identical items and is abandoned after a single wasted
 * request. That costs one round trip to learn something we cannot otherwise
 * know, and it cannot run away.
 */

export type PageGuards = {
  /** Stop after this many requests, whatever the server claims. */
  maxPages?: number;
  /** Stop after this many items. */
  maxItems?: number;
  /** Epoch ms to stop at. */
  deadline?: number;
  /** Politeness between requests. */
  delayMs?: number;
};

export const DEFAULT_GUARDS: Required<Omit<PageGuards, "deadline">> = {
  maxPages: 60,
  maxItems: 2_000,
  delayMs: 150,
};

export type PageResult<T> = {
  items: T[];
  /** True when a guard stopped us rather than the data running out. */
  truncated: boolean;
  pages: number;
};

/**
 * Walk an offset-paginated endpoint until it runs dry.
 *
 * `fetchPage` returns one page. Paging stops when a page comes back empty,
 * shorter than the page size, or entirely made of items already seen — the last
 * of which is the important one, because an endpoint that ignores `offset`
 * returns page one for ever and would otherwise loop until the caps.
 */
export async function pageAll<T>(
  fetchPage: (offset: number, pageSize: number) => Promise<T[]>,
  keyOf: (item: T) => string,
  pageSize: number,
  guards: PageGuards = {}
): Promise<PageResult<T>> {
  const g = { ...DEFAULT_GUARDS, ...guards };
  const seen = new Set<string>();
  const items: T[] = [];
  let pages = 0;

  for (let offset = 0; pages < g.maxPages; offset += pageSize) {
    if (guards.deadline && Date.now() > guards.deadline) return { items, truncated: true, pages };

    const page = await fetchPage(offset, pageSize);
    pages++;

    let added = 0;
    for (const item of page) {
      const k = keyOf(item);
      if (seen.has(k)) continue;
      seen.add(k);
      items.push(item);
      added++;
      if (items.length >= g.maxItems) return { items, truncated: true, pages };
    }

    // Nothing new: either the end, or an endpoint that ignores our offset.
    if (added === 0) return { items, truncated: false, pages };
    // A short page is the end of the data on every paginated API worth the name.
    if (page.length < pageSize) return { items, truncated: false, pages };

    if (g.delayMs) await new Promise((r) => setTimeout(r, g.delayMs));
  }

  return { items, truncated: true, pages };
}

// ─────────────────────────────────────────────────────────────
// FEEDS
// ─────────────────────────────────────────────────────────────

/** Atom and RSS both express "there is more" as a link with rel="next". */
export function nextLinkFrom(xml: string, base: string): string | null {
  for (const m of xml.matchAll(/<(?:atom:)?link\b([^>]*)\/?>/gi)) {
    const attrs = m[1];
    if (!/\brel\s*=\s*["']next["']/i.test(attrs)) continue;
    const href = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try {
      return new URL(href.replace(/&amp;/g, "&"), base).toString();
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Query parameters employers' feeds actually use for paging.
 *
 * Ordered by how often they turn up. Each is tried at most once, and only
 * survives if it changes the response — see the note at the top of this file.
 */
export const PAGE_PARAMS = [
  { name: "page", firstValue: 2, step: 1 },
  { name: "startrow", firstValue: -1, step: -1 }, // -1 means "one page size"
  { name: "start", firstValue: -1, step: -1 },
  { name: "offset", firstValue: -1, step: -1 },
] as const;

/** The URL for page two under one candidate scheme. */
export function pagedUrl(feedUrl: string, param: (typeof PAGE_PARAMS)[number], pageSize: number, index: number): string {
  const u = new URL(feedUrl);
  const value = param.firstValue === -1 ? pageSize * index : param.firstValue + (index - 1) * param.step;
  u.searchParams.set(param.name, String(value));
  return u.toString();
}
