import { and, eq, lt, ne, sql } from "drizzle-orm";
import { companies, db, ingestRuns, jobs } from "@/db";
import { activeProviders, type JobProvider, type NormalizedJob } from "./providers";
import { resolveLocation, UNKNOWN_COUNTRY } from "./geo";
import { dedupeKey, preferCanonical } from "./dedupe";

export type IngestSummary = {
  source: string;
  board: string;
  fetched: number;
  created: number;
  updated: number;
  error?: string;
};

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "unknown";

async function companyIdFor(j: NormalizedJob): Promise<string> {
  const slug = slugify(j.companyName);
  const found = await db.select({ id: companies.id }).from(companies).where(eq(companies.slug, slug)).limit(1);
  if (found[0]) return found[0].id;

  const [created] = await db
    .insert(companies)
    .values({ name: j.companyName, slug, website: j.companyWebsite ?? null, source: j.source })
    .onConflictDoNothing({ target: companies.slug })
    .returning();
  if (created) return created.id;

  // lost the race — read it back
  const again = await db.select({ id: companies.id }).from(companies).where(eq(companies.slug, slug)).limit(1);
  return again[0].id;
}

export async function upsertJob(j: NormalizedJob): Promise<"created" | "updated"> {
  const companyId = await companyIdFor(j);

  // ── FSD v1.1 §29 / §30 — structure the location at the point of ingestion ──
  // Nobody is present to ask, so we resolve what the feed gave us and accept
  // UNKNOWN where it is genuinely unclear. UNKNOWN fails closed in the
  // eligibility layer (GEO-006), which is the intended outcome: a posting that
  // does not say where the work happens should not reach anyone.
  const place = resolveLocation(j.location);

  // RMT-005 / BR-017 — the load-bearing default. A feed that says "Remote" and
  // nothing else is remote WITHIN ITS OWN COUNTRY, never worldwide. The scope
  // is stamped DEFAULTED so a later reader can tell it was inferred, not stated.
  const isRemote = String(j.remote).toUpperCase() === "REMOTE";
  const scopeFromFeed = /\b(anywhere in the world|worldwide|work from anywhere|global(?:ly)?)\b/i.test(
    `${j.title}\n${j.description ?? ""}\n${j.location ?? ""}`
  );

  const values = {
    source: j.source,
    externalId: j.externalId,
    sourceUrl: j.sourceUrl,
    publisher: j.publisher ?? null,
    title: j.title,
    companyId,
    location: j.location,
    remote: j.remote,
    employmentType: j.employmentType,
    seniority: j.seniority,
    salaryMin: j.salaryMin,
    salaryMax: j.salaryMax,
    currency: j.currency,
    description: j.description,
    skills: j.skills,
    perks: j.perks,
    applyMethod: j.applyMethod,
    applyUrl: j.applyUrl,
    postedAt: j.postedAt,
    syncedAt: new Date(),
    active: true,
    raw: (j.raw ?? {}) as object,

    // ── FSD v1.1 §36.1 ──
    countryCode: place.country === UNKNOWN_COUNTRY ? null : place.country,
    stateProvince: place.stateProvince,
    city: place.city,
    // Identity, pulled out of whatever string the board gave us.
    postalCode: place.postalCode,
    remoteScope: isRemote ? (scopeFromFeed ? ("WORLDWIDE" as const) : ("SAME_COUNTRY" as const)) : null,
    remoteScopeSource: isRemote ? (scopeFromFeed ? "EMPLOYER" : "DEFAULTED") : null,

    // SRC-012 — discovered by us, with no recruiter in the loop.
    origin: "EXTERNALLY_DISCOVERED" as const,
    dedupeKey: dedupeKey({
      title: j.title,
      companyName: j.companyName,
      location: j.location,
      countryCode: place.country === UNKNOWN_COUNTRY ? null : place.country,
      stateProvince: place.stateProvince,
      postalCode: place.postalCode,
      city: place.city,
    }),
  };

  const existing = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.source, j.source), eq(jobs.externalId, j.externalId)))
    .limit(1);

  if (existing[0]) {
    await db.update(jobs).set(values).where(eq(jobs.id, existing[0].id));
    return "updated";
  }
  const [inserted] = await db
    .insert(jobs)
    .values(values)
    .onConflictDoNothing({ target: [jobs.source, jobs.externalId] })
    .returning({ id: jobs.id });

  if (inserted) await linkDuplicates(inserted.id, values.dedupeKey);
  return "created";
}

/**
 * SRC-007 — consolidate the same role arriving from several sources.
 *
 * We do not delete the loser. Its source URL, publisher and sync history are
 * evidence about where a posting was seen, which matters for the ghost-jobs
 * work and for any later question about provenance. We point it at the winner
 * instead, and the deck only ever surfaces postings whose canonicalJobId is
 * null.
 */
export async function linkDuplicates(jobId: string, key: string | null): Promise<void> {
  if (!key) return;

  const siblings = await db
    .select({
      id: jobs.id,
      origin: jobs.origin,
      consentSource: jobs.consentSource,
      postedAt: jobs.postedAt,
    })
    .from(jobs)
    .where(and(eq(jobs.dedupeKey, key), eq(jobs.active, true)));

  if (siblings.length < 2) return;

  const winner = siblings.reduce((best, cur) => preferCanonical(best, cur));

  for (const s of siblings) {
    await db
      .update(jobs)
      .set({ canonicalJobId: s.id === winner.id ? null : winner.id })
      .where(eq(jobs.id, s.id));
  }
  void jobId;
}

async function runBoard(p: JobProvider, board: string): Promise<IngestSummary> {
  const [run] = await db.insert(ingestRuns).values({ source: p.source, board }).returning();
  const s: IngestSummary = { source: p.source, board, fetched: 0, created: 0, updated: 0 };

  try {
    const found = await p.fetchBoard(board);
    s.fetched = found.length;
    for (const j of found) {
      try {
        const r = await upsertJob(j);
        if (r === "created") s.created++;
        else s.updated++;
      } catch (e) {
        // one malformed posting must not abort the whole board
        console.error(`[ingest] ${p.source}/${board} job ${j.externalId}:`, (e as Error).message);
      }
    }
  } catch (e) {
    s.error = (e as Error).message;
    console.error(`[ingest] ${p.source}/${board} FAILED:`, s.error);
  }

  await db
    .update(ingestRuns)
    .set({
      fetched: s.fetched,
      created: s.created,
      updated: s.updated,
      error: s.error ?? null,
      finishedAt: new Date(),
    })
    .where(eq(ingestRuns.id, run.id));

  return s;
}

/**
 * Pull every env-configured provider/board.
 *
 * This is the DISCOVERY half of ingestion — broad, query-based, "what exists
 * out there". The TARGETED half (every job a named employer posts) lives in
 * src/lib/sources.ts and runs from the job_sources table. `/api/ingest` runs
 * both; see runEverything() below.
 */
export type IngestAllResult = {
  runs: IngestSummary[];
  /** Boards the clock ran out on. Empty when everything was covered. */
  skipped: { source: string; board: string }[];
  truncated: boolean;
};

/** Headroom reserved for one more board before the deadline. */
export const PER_BOARD_RESERVE_MS = 9_000;

export type BoardRef = { source: string; board: string };

/**
 * The scheduling decision, as a pure function: given every board, when each was
 * last run, and how much clock is left, which run now and which defer?
 *
 * Split out from ingestAll so it can be tested without a database or a network
 * — the ordering and the budget arithmetic are the parts that can be subtly
 * wrong, and the parts that starve a board forever if they are.
 */
export function planBoards<T extends BoardRef>(
  all: T[],
  lastRunAt: Map<string, number>,
  opts: { deadline?: number; now: number; perBoardMs?: number }
): { run: T[]; skipped: T[] } {
  const reserve = opts.perBoardMs ?? PER_BOARD_RESERVE_MS;
  const key = (b: BoardRef) => `${b.source}|${b.board}`;

  // Least-recently-run first. Without this, a truncated run would starve the
  // tail of the list forever — the same boards would be fetched every night and
  // the last few never at all.
  // A board with no history sorts first — but "no history" is handled by an
  // explicit branch, not by a sentinel value.
  //
  // The previous attempt used -Infinity, which is correct right up until BOTH
  // boards are unrun: `-Infinity - -Infinity` is NaN, and a comparator that
  // returns NaN makes sort() implementation-defined. On a fresh install every
  // board is unrun, so that is not an edge case, it is the first run — and it
  // showed up in production as JSearch never being reached while the older
  // providers ran every time.
  const at = (b: BoardRef) => lastRunAt.get(key(b));
  const ordered = [...all].sort((a, b) => {
    const x = at(a);
    const y = at(b);
    if (x === undefined && y === undefined) return 0;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    return x - y;
  });

  if (!opts.deadline) return { run: ordered, skipped: [] };

  const run: T[] = [];
  const skipped: T[] = [];
  // Cost is assumed, not measured: each board is charged the reserve whether it
  // takes that long or not. Optimism here is what produced the original bug.
  let projected = opts.now;
  for (const b of ordered) {
    if (projected + reserve > opts.deadline) skipped.push(b);
    else {
      run.push(b);
      projected += reserve;
    }
  }
  return { run, skipped };
}

/**
 * SRC-015 — a bounded run, and coverage by rotation.
 *
 * The host kills a serverless function at its plan's ceiling — 60 seconds on
 * Vercel Hobby, whatever `maxDuration` claims. This loop had no notion of that,
 * so as boards were added it eventually ran past the limit and was killed
 * mid-flight. That failure is nastier than it sounds:
 *
 *   • The response body is empty, so the caller sees nothing, not an error.
 *   • Boards already processed HAVE written to the database, so the run looks
 *     partially successful and nobody investigates.
 *   • Everything after the kill — including runMaintenance(), which expires
 *     ghost jobs and purges old data — silently never happens, every night.
 *
 * So the run is now bounded, and boards are ordered least-recently-run first.
 * A single invocation may not cover everything; successive invocations rotate
 * through, and whatever was skipped is REPORTED rather than dropped quietly.
 */
export async function ingestAll(opts: { deadline?: number } = {}): Promise<IngestAllResult> {
  const providers = activeProviders();
  if (!providers.length) {
    console.warn("[ingest] no query providers configured — connected companies still sync");
    return { runs: [], skipped: [], truncated: false };
  }

  const pairs: { p: JobProvider; board: string; source: string }[] = [];
  for (const p of providers) {
    for (const board of await p.boards()) pairs.push({ p, board, source: p.source });
  }

  const last = await db
    .select({
      source: ingestRuns.source,
      board: ingestRuns.board,
      at: sql<string | null>`max(${ingestRuns.startedAt})`,
    })
    .from(ingestRuns)
    .groupBy(ingestRuns.source, ingestRuns.board);

  const lastAt = new Map<string, number>();
  for (const r of last) {
    lastAt.set(`${r.source}|${r.board ?? ""}`, r.at ? new Date(r.at).getTime() : 0);
  }

  const plan = planBoards(pairs, lastAt, { deadline: opts.deadline, now: Date.now() });
  const runs: IngestSummary[] = [];
  const skipped: BoardRef[] = plan.skipped.map((b) => ({ source: b.source, board: b.board }));

  const hasTime = () => !opts.deadline || Date.now() + PER_BOARD_RESERVE_MS <= opts.deadline;

  for (const { p, board } of plan.run) {
    // Re-checked against the real clock, not the projection: a board that took
    // far longer than the reserve must not push the run past the ceiling.
    if (!hasTime()) {
      skipped.push({ source: p.source, board });
      continue;
    }
    runs.push(await runBoard(p, board));
    await new Promise((r) => setTimeout(r, 250)); // be a polite client
  }

  // The reserve is a pessimistic estimate, so a run of fast boards leaves time
  // on the table. Spend it rather than deferring work for a day over an
  // estimate that turned out to be wrong.
  for (const { p, board } of plan.skipped) {
    if (!hasTime()) break;
    const i = skipped.findIndex((s) => s.source === p.source && s.board === board);
    if (i >= 0) skipped.splice(i, 1);
    runs.push(await runBoard(p, board));
    await new Promise((r) => setTimeout(r, 250));
  }

  if (skipped.length) {
    console.warn(
      `[ingest] out of time — ${skipped.length} board(s) deferred to the next run: ` +
        skipped.map((s) => `${s.source}/${s.board}`).join(", ")
    );
  }
  return { runs, skipped, truncated: skipped.length > 0 };
}

/** Retire postings a provider has stopped returning. */
export async function deactivateStale(olderThanHours = 72): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 3600_000);
  const res = await db
    .update(jobs)
    // ARCHIVED, not CLOSED: the source stopped carrying it, so it is gone
    // rather than deliberately closed by an employer.
    .set({ active: false, status: "ARCHIVED" })
    .where(and(eq(jobs.active, true), ne(jobs.source, "JOBSY"), lt(jobs.syncedAt, cutoff)))
    .returning({ id: jobs.id });
  return res.length;
}

/** Quick counts for the ops surface. */
export async function jobStats() {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${jobs.active})::int`,
    })
    .from(jobs);
  return row;
}
