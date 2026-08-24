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
  /**
   * Where to begin.
   *
   * A serverless run cannot always finish a large board, so it records where it
   * stopped and the next run starts there. Without this the loop restarts at
   * zero every time and a board bigger than one run's budget can never be
   * finished — it just re-reads its own first pages for ever.
   */
  startOffset?: number;
};

/**
 * Backstops, not budgets.
 *
 * These exist so a bug cannot turn into ten thousand requests against an
 * employer's server. They are deliberately far above any real board — the
 * largest single ATS account we have seen is under a thousand postings — so
 * that in practice the loop always ends because the data ran out, never because
 * a cap was hit. If one of these ever fires it is a signal worth logging, which
 * is why the adapters do.
 */
export const DEFAULT_GUARDS: Required<Omit<PageGuards, "deadline" | "startOffset">> = {
  maxPages: 400,
  maxItems: 20_000,
  delayMs: 150,
};

export type PageResult<T> = {
  items: T[];
  /** True when a guard stopped us rather than the data running out. */
  truncated: boolean;
  pages: number;
  /**
   * Where the next run should start.
   *
   * Zero when the board was read to the end — which is deliberate, because
   * starting over is how a board that has since changed gets refreshed.
   */
  nextOffset: number;
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
  const start = Math.max(0, guards.startOffset ?? 0);
  const seen = new Set<string>();
  const items: T[] = [];
  let pages = 0;
  let offset = start;

  for (; pages < g.maxPages; offset += pageSize) {
    // Out of time: hand back where to resume rather than losing the position.
    if (guards.deadline && Date.now() > guards.deadline) {
      return { items, truncated: true, pages, nextOffset: offset };
    }

    const page = await fetchPage(offset, pageSize);
    pages++;

    let added = 0;
    for (const item of page) {
      const k = keyOf(item);
      if (seen.has(k)) continue;
      seen.add(k);
      items.push(item);
      added++;
      if (items.length >= g.maxItems) {
        return { items, truncated: true, pages, nextOffset: offset + pageSize };
      }
    }

    // Nothing new: either the end, or an endpoint that ignores our offset.
    if (added === 0) return { items, truncated: false, pages, nextOffset: 0 };
    // A short page is the end of the data on every paginated API worth the name.
    if (page.length < pageSize) return { items, truncated: false, pages, nextOffset: 0 };

    if (g.delayMs) await new Promise((r) => setTimeout(r, g.delayMs));
  }

  return { items, truncated: true, pages, nextOffset: offset };
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
  // Page counters.
  { name: "page", firstValue: 2, step: 1 },
  { name: "pageNumber", firstValue: 2, step: 1 },
  { name: "pg", firstValue: 2, step: 1 },
  // Row offsets. firstValue -1 means "one page size", i.e. 20, 40, 60…
  { name: "startrow", firstValue: -1, step: -1 },
  { name: "start", firstValue: -1, step: -1 },
  { name: "offset", firstValue: -1, step: -1 },
  { name: "jobOffset", firstValue: -1, step: -1 },
  { name: "startIndex", firstValue: -1, step: -1 },
  { name: "from", firstValue: -1, step: -1 },
] as const;

/** The URL for page two under one candidate scheme. */
export function pagedUrl(feedUrl: string, param: (typeof PAGE_PARAMS)[number], pageSize: number, index: number): string {
  const u = new URL(feedUrl);
  const value = param.firstValue === -1 ? pageSize * index : param.firstValue + (index - 1) * param.step;
  u.searchParams.set(param.name, String(value));
  return u.toString();
}
