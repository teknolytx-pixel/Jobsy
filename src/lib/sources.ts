import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import {
  db,
  ingestRuns,
  jobs,
  jobSources,
  type JobSourceRow,
  type SourceKind,
} from "@/db";
import { detectSource, type Detection, type DetectionFailure } from "./discovery";
import { ATS_LABEL, ATS_SOURCE, fetchCompanyJobs, type AtsKind } from "./providers/ats";
import { crawlJsonLdReport, fetchJsonLdJobs, fetchXmlFeedReport } from "./providers/universal";
import type { NormalizedJob } from "./providers/types";
import { upsertJob } from "./ingest";
import { looksLikeSection } from "./employer";

/**
 * CONNECTED COMPANIES — the continuous half of ingestion.
 *
 * Query-based aggregators answer "what software jobs exist anywhere?".
 * This answers "what is *this specific employer* hiring for, right now?" —
 * and keeps answering it on every sync, without anyone re-importing anything.
 */

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  ...ATS_LABEL,
  JSONLD: "Career site (structured data)",
  JSONLD_CRAWL: "Career site (job pages)",
  XML_FEED: "XML job feed",
};

const UNIVERSAL = ["JSONLD", "JSONLD_CRAWL", "XML_FEED"] as const;
const isAts = (k: SourceKind): k is AtsKind => !(UNIVERSAL as readonly string[]).includes(k);

/**
 * How wide a crawl spreads its attention this run.
 *
 * A large employer has hundreds of category pages and one run can politely open
 * a few dozen. Without rotation every run would open the SAME few dozen and
 * coverage would stop dead at whatever the first run reached.
 *
 * The offset advances once per sync window rather than being stored, because a
 * stored cursor is a column, a migration, and a thing to get wrong — and the
 * cron already runs on this cadence. Derived from the clock so it moves even
 * when a run imports nothing new, which is exactly when being stuck matters.
 */
const ROTATION_WINDOW_MS = 6 * 3_600_000;
export const crawlRotation = (now = Date.now()) => Math.floor(now / ROTATION_WINDOW_MS);

/**
 * Job URLs this source has already given us.
 *
 * Used for ORDER, not for skipping — a stored job still needs refreshing, but
 * unseen pages go first so a run's budget widens coverage instead of re-reading
 * the front of the catalogue.
 */
async function knownUrlsFor(listingUrl: string): Promise<Set<string>> {
  let origin: string;
  try {
    origin = new URL(listingUrl).origin;
  } catch {
    return new Set();
  }
  /*
   * Scoped by ORIGIN rather than by source id, because `jobs` has no foreign
   * key to `job_sources` — only the source kind and an external id. Two crawled
   * career sites would otherwise pollute each other's ordering, and the origin
   * is the thing that actually distinguishes them.
   */
  const rows = await db
    .select({ url: jobs.sourceUrl })
    .from(jobs)
    .where(and(eq(jobs.source, "CAREER_SITE"), sql`${jobs.sourceUrl} like ${origin + "%"}`))
    .limit(5_000);
  return new Set(rows.map((r) => r.url).filter((u): u is string => Boolean(u)));
}

/** Fetch every job a connected source currently exposes. */
export async function fetchSourceJobs(
  src: Pick<JobSourceRow, "kind" | "token" | "companyName"> & { crawlCursor?: number },
  opts: { deadline?: number } = {}
): Promise<{
  jobs: NormalizedJob[];
  note?: string;
  employer?: string;
  nextCursor?: number;
  discovered?: number;
}> {
  if (isAts(src.kind)) {
    /*
     * A large board is bigger than one 60-second run, so the same resume
     * contract the careers-site crawler uses applies here: stop on the deadline,
     * report where, and continue there next time.
     */
    const page = await fetchCompanyJobs(src.kind, src.token, src.companyName, {
      deadline: opts.deadline,
      startOffset: src.crawlCursor ?? 0,
    });
    return {
      jobs: page.jobs,
      nextCursor: page.nextOffset,
      note: page.complete
        ? undefined
        : `Read ${page.jobs.length} postings before this run's time budget ran out. ` +
          "The next sync resumes from here.",
    };
  }
  if (src.kind === "JSONLD") {
    return { jobs: await fetchJsonLdJobs(src.token, src.companyName) };
  }
  if (src.kind === "JSONLD_CRAWL") {
    const report = await crawlJsonLdReport(src.token, src.companyName, {
      /*
       * The STORED cursor, not the clock.
       *
       * A clock-derived offset re-read arbitrary parts of a site and could
       * never promise it had seen all of it. A cursor that persists means each
       * run continues where the last stopped, so a three-thousand-job employer
       * is fully covered after enough runs instead of approximately covered for
       * ever — and once it wraps, the re-read is what keeps postings fresh.
       */
      rotate: src.crawlCursor ?? 0,
      known: await knownUrlsFor(src.token),
      deadline: opts.deadline,
    });
    return {
      jobs: report.jobs,
      employer: report.employer,
      nextCursor: report.nextCursor,
      discovered: report.discovered,
      note: report.truncated
        ? `Read ${report.opened} of ${report.discovered} job pages found this run` +
          `${report.listingCount ? `, section ${report.nextCursor} of ${report.listingCount}` : ""}. ` +
          "The next sync resumes from here."
        : undefined,
    };
  }
  /*
   * The note matters more than it looks. "20 jobs" and "20 jobs, one page, no
   * pagination scheme worked" appear identical in the sources list and mean
   * completely different things — a small employer, versus a feed we are
   * failing to walk. Saying which removes the guesswork.
   */
  const feed = await fetchXmlFeedReport(src.token, src.companyName);
  return {
    jobs: feed.jobs,
    note:
      feed.pages > 1
        ? `Read ${feed.pages} pages of the feed (paged by ${feed.pagedBy}).`
        : `The feed returned one page of ${feed.jobs.length} jobs and offers no next link or working page parameter. ` +
          "If this employer has more openings, ask them for their full feed URL.",
  };
}

/** The `jobs.source` value rows from this connector should carry. */
export const jobSourceFor = (k: SourceKind) =>
  isAts(k) ? ATS_SOURCE[k] : k === "XML_FEED" ? ("XML_FEED" as const) : ("CAREER_SITE" as const);

// ─────────────────────────────────────────────────────────────
// CONNECT
// ─────────────────────────────────────────────────────────────
export type ConnectResult =
  | { ok: true; source: JobSourceRow; detection: Detection; imported: number; alreadyExisted: boolean }
  | { ok: false; error: string; suggestions: string[]; trace?: string[] };

/**
 * Paste a careers URL → detect → save → immediately pull, so the person who
 * connected it sees their jobs land instead of being told to wait for a cron.
 */
export async function connectByUrl(rawUrl: string, addedById?: string): Promise<ConnectResult> {
  const detected = await detectSource(rawUrl);
  if (detected.kind === null) {
    const f = detected as DetectionFailure;
    return { ok: false, error: f.reason, suggestions: f.suggestions, trace: f.trace };
  }
  const d = detected as Detection;
  return connectDetected(d, rawUrl, addedById);
}

/** Save a known connector directly, skipping detection. */
export async function connectDetected(
  d: Detection,
  careersUrl?: string,
  addedById?: string
): Promise<ConnectResult> {
  const existing = await db
    .select()
    .from(jobSources)
    .where(and(eq(jobSources.kind, d.kind as SourceKind), eq(jobSources.token, d.token)))
    .limit(1);

  let row = existing[0];
  const alreadyExisted = Boolean(row);

  if (!row) {
    const [created] = await db
      .insert(jobSources)
      .values({
        kind: d.kind as SourceKind,
        token: d.token,
        companyName: d.companyName,
        careersUrl: careersUrl ?? null,
        autoDetected: true,
        detectedVia: d.via,
        addedById: addedById ?? null,
      })
      .onConflictDoNothing({ target: [jobSources.kind, jobSources.token] })
      .returning();
    row =
      created ??
      (
        await db
          .select()
          .from(jobSources)
          .where(and(eq(jobSources.kind, d.kind as SourceKind), eq(jobSources.token, d.token)))
          .limit(1)
      )[0];
  } else if (!row.enabled) {
    // reconnecting a previously disabled company should switch it back on
    [row] = await db
      .update(jobSources)
      .set({ enabled: true, status: "PENDING", consecutiveFailures: 0, lastError: null })
      .where(eq(jobSources.id, row.id))
      .returning();
  }

  const result = await syncSource(row);
  const refreshed = (await db.select().from(jobSources).where(eq(jobSources.id, row.id)).limit(1))[0];

  if (result.error) {
    return {
      ok: false,
      error: `Detected ${SOURCE_KIND_LABEL[row.kind]} (${row.token}) but the first pull failed: ${result.error}`,
      suggestions: ["Double-check the board slug, then retry from the Sources page."],
    };
  }

  return { ok: true, source: refreshed ?? row, detection: d, imported: result.created, alreadyExisted };
}

// ─────────────────────────────────────────────────────────────
// SYNC
// ─────────────────────────────────────────────────────────────
export type SyncResult = {
  sourceId: string;
  company: string;
  kind: SourceKind;
  fetched: number;
  created: number;
  updated: number;
  error?: string;
  /**
   * Not an error — a partial success worth saying out loud.
   *
   * A crawl of a large employer legitimately stops on its time budget with
   * pages left over. Reporting nothing made that indistinguishable from "this
   * site only has fifteen jobs", which is the question that prompted all of
   * this.
   */
  note?: string;
};

/** Pull one connected company and record the outcome on the source row. */
export async function syncSource(
  src: JobSourceRow,
  opts: { deadline?: number } = {}
): Promise<SyncResult> {
  const jobSource = jobSourceFor(src.kind);
  const [run] = await db
    .insert(ingestRuns)
    .values({ source: jobSource, board: `${src.companyName} (${src.token})`, sourceId: src.id })
    .returning();

  let nextCursor: number | undefined;
  let discovered: number | undefined;

  const out: SyncResult = {
    sourceId: src.id,
    company: src.companyName,
    kind: src.kind,
    fetched: 0,
    created: 0,
    updated: 0,
  };

  try {
    const fetched = await fetchSourceJobs(src, { deadline: opts.deadline });
    out.fetched = fetched.jobs.length;
    out.note = fetched.note;
    nextCursor = fetched.nextCursor;
    discovered = fetched.discovered;

    /*
     * Repair a name we got wrong.
     *
     * Citi connected as "Early Career" — a programme name lifted from one job
     * record — and an administrator could not find it in their own list. Now
     * that the employer is resolved across every record read, a source whose
     * stored name is a section heading corrects itself on the next sync.
     *
     * Only for auto-detected sources, and only when the stored name is one of
     * the names we should never have chosen. A name somebody typed is theirs.
     */
    if (fetched.employer && src.autoDetected && looksLikeSection(src.companyName)) {
      if (fetched.employer !== src.companyName) {
        await db
          .update(jobSources)
          .set({ companyName: fetched.employer })
          .where(eq(jobSources.id, src.id));
        out.company = fetched.employer;
        out.note = `Renamed from "${src.companyName}" to "${fetched.employer}" — the old name came from one job posting rather than the employer.`;
      }
    }
    for (const j of fetched.jobs) {
      try {
        const r = await upsertJob(j);
        if (r === "created") out.created++;
        else out.updated++;
      } catch (e) {
        console.error(`[sync] ${src.companyName} job ${j.externalId}:`, (e as Error).message);
      }
    }
  } catch (e) {
    out.error = (e as Error).message;
  }

  /*
   * Only advance the cursor on a run that actually got somewhere. Advancing it
   * after a failure would skip a section of the site nobody ever read.
   */
  const cursor = out.error ? undefined : nextCursor;
  const failed = Boolean(out.error);
  await db
    .update(jobSources)
    .set({
      lastRunAt: new Date(),
      lastJobCount: out.fetched,
      lastError: out.error ?? null,
      consecutiveFailures: failed ? sql`${jobSources.consecutiveFailures} + 1` : 0,
      totalImported: sql`${jobSources.totalImported} + ${out.created}`,
      ...(cursor === undefined ? {} : { crawlCursor: cursor }),
      ...(discovered === undefined ? {} : { lastDiscovered: discovered }),
      // three strikes and we stop hammering a broken endpoint
      status: failed ? (src.consecutiveFailures >= 2 ? "DISABLED" : "FAILING") : "OK",
      enabled: failed && src.consecutiveFailures >= 2 ? false : src.enabled,
    })
    .where(eq(jobSources.id, src.id));

  await db
    .update(ingestRuns)
    .set({
      fetched: out.fetched,
      created: out.created,
      updated: out.updated,
      error: out.error ?? null,
      finishedAt: new Date(),
    })
    .where(eq(ingestRuns.id, run.id));

  return out;
}

/** Sync every enabled connected company. Oldest-synced first. */
/** Headroom reserved for one more source before the deadline. */
export const PER_SOURCE_RESERVE_MS = 9_000;

export type SyncAllResult = {
  results: SyncResult[];
  /** Sources the clock ran out on. They sort first next time. */
  skipped: { id: string; companyName: string }[];
  truncated: boolean;
};

/**
 * SRC-015, second half.
 *
 * This loop had the same unbounded shape as ingestAll, and fixing only the
 * discovery half left the bug in place: this runs FIRST, so with enough
 * connected companies it consumed the whole function ceiling before discovery
 * got a single millisecond — and the response was still empty, because the
 * function was still killed. A partial fix to a timeout is not a fix; it just
 * moves which half of the work disappears.
 *
 * The ordering (least-recently-run first, nulls first) was already right, so
 * deferring the tail is safe: those sources lead the next run.
 */
export async function syncAllSources(
  opts: { limit?: number; deadline?: number } = {}
): Promise<SyncAllResult> {
  const rows = await db
    .select()
    .from(jobSources)
    .where(eq(jobSources.enabled, true))
    // SRC-016 — this line threw on every call.
    //
    // `asc(sql\`col nulls first\`)` renders as `order by asc(col nulls first)`,
    // which Postgres rejects outright: `syntax error at or near "asc"`. The
    // direction and the null placement are one clause in SQL, not a function
    // wrapping an expression, so both go in the fragment.
    //
    // Nothing caught it because nothing ever called this against a database:
    // the unit suites stub fetch and never open a connection, and the lifecycle
    // suite only asserted that /api/ingest REJECTS an unauthorised caller — it
    // never made an authorised one. See scripts/test-queries.mts.
    .orderBy(sql`${jobSources.lastRunAt} asc nulls first`)
    .limit(opts.limit ?? 200);

  const results: SyncResult[] = [];
  const skipped: { id: string; companyName: string }[] = [];

  for (const r of rows) {
    if (opts.deadline && Date.now() + PER_SOURCE_RESERVE_MS > opts.deadline) {
      skipped.push({ id: r.id, companyName: r.companyName });
      continue;
    }

    /*
     * Share the remaining time, rather than letting the first source spend it.
     *
     * A crawled careers site will use every second it is given — there is
     * always another category page. Without a per-source slice, one large
     * employer would starve every other source on the list, and the sources
     * behind it would be "deferred" every single night because they are always
     * behind the same greedy one.
     *
     * The slice is generous rather than equal: most sources are an API call and
     * return in under a second, handing their unused time back to whoever comes
     * next.
     */
    const remainingSources = rows.length - results.length - skipped.length;
    const perSource = opts.deadline
      ? Date.now() + Math.max(4_000, Math.floor((opts.deadline - Date.now()) / Math.max(1, remainingSources)))
      : undefined;

    results.push(await syncSource(r, { deadline: perSource }));
    await new Promise((res) => setTimeout(res, 250)); // be a polite client
  }

  if (skipped.length) {
    console.warn(
      `[sources] out of time — ${skipped.length} source(s) deferred: ` +
        skipped.map((s) => s.companyName).join(", ")
    );
  }
  return { results, skipped, truncated: skipped.length > 0 };
}

/** Sources that have never run, or last ran before the cutoff. */
export async function staleSources(olderThanHours = 6): Promise<JobSourceRow[]> {
  const cutoff = new Date(Date.now() - olderThanHours * 3600_000);
  return db
    .select()
    .from(jobSources)
    .where(
      and(
        eq(jobSources.enabled, true),
        or(isNull(jobSources.lastRunAt), sql`${jobSources.lastRunAt} < ${cutoff}`)
      )
    );
}

export async function listSources(): Promise<JobSourceRow[]> {
  return db.select().from(jobSources).orderBy(asc(jobSources.companyName));
}
