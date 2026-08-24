#!/usr/bin/env tsx
/**
 * PAGING — asking for the second page.
 *
 * Accenture: 20 jobs. TD: 20 jobs. Deloitte: 20 jobs. Three employers on two
 * different systems all reporting the same round number, while the Greenhouse
 * boards beside them pulled 575 and 161. Twenty was never how many jobs
 * Accenture has — it was the size of one request, and it looked like an answer.
 *
 * The tests that matter here are the ones about NOT running away. An endpoint
 * that ignores paging returns page one with a 200 for ever, and a loop that
 * cannot recognise that is worse than the bug it replaced.
 *
 *   npx tsx scripts/test-paging.mts
 */
import "dotenv/config";

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const { pageAll, nextLinkFrom, pagedUrl, PAGE_PARAMS } = await import("../src/lib/providers/paging");

// ─────────────────────────────────────────────────────────────
console.log("\nWALKING AN OFFSET-PAGINATED ENDPOINT\n");

/** 47 jobs behind a 20-per-page endpoint — the Accenture shape. */
const CORPUS = Array.from({ length: 47 }, (_, i) => ({ id: `J${i}` }));
let requests = 0;
const paged = await pageAll(
  async (offset, size) => { requests++; return CORPUS.slice(offset, offset + size); },
  (j) => j.id, 20, { delayMs: 0 }
);
check("TC-PAGE-01 every job is collected, not just the first page",
  paged.items.length === 47, `${paged.items.length}`);
check("TC-PAGE-02 in three requests", requests === 3, `${requests}`);
check("TC-PAGE-03 and it knows it finished", !paged.truncated);

/** An exact multiple must not stop one page early, nor loop for ever. */
requests = 0;
const exact = await pageAll(
  async (o, n) => { requests++; return CORPUS.slice(0, 40).slice(o, o + n); },
  (j) => j.id, 20, { delayMs: 0 }
);
check("TC-PAGE-04 an exact multiple of the page size is fully read",
  exact.items.length === 40 && requests === 3, `${exact.items.length} in ${requests}`);

/**
 * The dangerous case. An endpoint that ignores `offset` answers page one
 * for ever with a 200; nothing about the response says anything is wrong.
 */
requests = 0;
const stuck = await pageAll(
  async () => { requests++; return CORPUS.slice(0, 20); },
  (j) => j.id, 20, { delayMs: 0 }
);
check("TC-PAGE-10 an endpoint that ignores offset is detected, not looped",
  requests === 2, `${requests} requests`);
check("TC-PAGE-11 and what it did return is kept", stuck.items.length === 20, `${stuck.items.length}`);

const many = await pageAll(
  async (o, n) => Array.from({ length: n }, (_, i) => ({ id: `x${o + i}` })),
  (j) => j.id, 20, { maxItems: 55, delayMs: 0 }
);
/* Stops exactly ON the cap, mid-page, rather than overshooting to a page boundary. */
check("TC-PAGE-12 an endless endpoint stops on the item cap",
  many.items.length === 55 && many.truncated, `${many.items.length}`);

const capped = await pageAll(
  async (o, n) => Array.from({ length: n }, (_, i) => ({ id: `y${o + i}` })),
  (j) => j.id, 20, { maxPages: 4, delayMs: 0 }
);
check("TC-PAGE-13 and on the page cap", capped.pages === 4 && capped.truncated, `${capped.pages}`);

const expired = await pageAll(
  async (o, n) => Array.from({ length: n }, (_, i) => ({ id: `z${o + i}` })),
  (j) => j.id, 20, { deadline: Date.now() - 1, delayMs: 0 }
);
check("TC-PAGE-14 and on the clock", expired.truncated && expired.items.length === 0);

// ─────────────────────────────────────────────────────────────
console.log("\nFEEDS\n");

check("TC-PAGE-20 an Atom next link is followed",
  nextLinkFrom(`<feed><link rel="self" href="/f"/><link rel="next" href="/f?p=2"/></feed>`, "https://a.com/f") ===
    "https://a.com/f?p=2");
check("TC-PAGE-21 namespaced and entity-encoded links too",
  nextLinkFrom(`<atom:link rel="next" href="https://a.com/f?a=1&amp;p=2" />`, "https://a.com/f") ===
    "https://a.com/f?a=1&p=2");
check("TC-PAGE-22 a self link is not a next link",
  nextLinkFrom(`<link rel="self" href="/f"/>`, "https://a.com/f") === null);

check("TC-PAGE-23 page-number schemes count pages",
  pagedUrl("https://a.com/f", PAGE_PARAMS[0], 20, 1).endsWith("page=2"),
  pagedUrl("https://a.com/f", PAGE_PARAMS[0], 20, 1));
check("TC-PAGE-24 row-offset schemes count rows",
  pagedUrl("https://a.com/f", PAGE_PARAMS[1], 20, 1).endsWith("startrow=20"),
  pagedUrl("https://a.com/f", PAGE_PARAMS[1], 20, 1));
check("TC-PAGE-25 existing query parameters survive",
  pagedUrl("https://a.com/f?loc=us", PAGE_PARAMS[0], 20, 1).includes("loc=us"));

// ─────────────────────────────────────────────────────────────
console.log("\nEND TO END\n");

const job = (i: number) =>
  `<job><title>Engineer ${i}</title><referencenumber>R${i}</referencenumber>` +
  `<url>https://apply.acme.com/j/${i}</url><company>Acme</company><city>Dallas</city><state>TX</state>` +
  `<description><![CDATA[<p>Python and SQL.</p>]]></description></job>`;

/** A feed that pages through ?startrow= and never declares a next link. */
const FEED_TOTAL = 45;
let feedHits = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const u = new URL(typeof input === "string" ? input : input.toString());
  feedHits++;
  if (u.hostname === "apply.acme.com") {
    const start = Number(u.searchParams.get("startrow") ?? 0);
    const slice = Array.from({ length: FEED_TOTAL }, (_, i) => i).slice(start, start + 20);
    return new Response(`<?xml version="1.0"?><source>${slice.map(job).join("")}</source>`,
      { status: 200, headers: { "Content-Type": "application/xml" } });
  }
  // A feed that ignores every paging parameter — always the same 20.
  if (u.hostname === "static.acme.com") {
    const fixed = Array.from({ length: 20 }, (_, i) => i);
    return new Response(`<?xml version="1.0"?><source>${fixed.map(job).join("")}</source>`,
      { status: 200, headers: { "Content-Type": "application/xml" } });
  }
  return new Response("", { status: 404 });
}) as typeof fetch;

const { fetchXmlFeedJobs } = await import("../src/lib/providers/universal");

const all = await fetchXmlFeedJobs("https://apply.acme.com/feed");
check("TC-PAGE-30 a paginated feed is read to the end", all.length === FEED_TOTAL, `${all.length}`);
check("TC-PAGE-31 with no duplicates",
  new Set(all.map((j) => j.externalId)).size === all.length, `${all.length}`);
check("TC-PAGE-32 and the jobs are intact",
  all[0]?.location === "Dallas, TX" && all[0]?.skills.includes("Python"), all[0]?.skills.join(","));

feedHits = 0;
const stubborn = await fetchXmlFeedJobs("https://static.acme.com/feed");
check("TC-PAGE-40 a feed that ignores paging still returns its jobs",
  stubborn.length === 20, `${stubborn.length}`);
check("TC-PAGE-41 and is abandoned after one probe per scheme, not looped",
  feedHits <= 1 + PAGE_PARAMS.length, `${feedHits} requests for ${PAGE_PARAMS.length} schemes`);

globalThis.fetch = realFetch;
console.log(`\n${pass} passed, ${fail} failed  —  paging\n`);
process.exit(fail ? 1 : 0);
