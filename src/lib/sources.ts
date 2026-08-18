import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import {
  db,
  ingestRuns,
  jobSources,
  type JobSourceRow,
  type SourceKind,
} from "@/db";
import { detectSource, type Detection, type DetectionFailure } from "./discovery";
import { ATS_LABEL, ATS_SOURCE, fetchCompanyJobs, type AtsKind } from "./providers/ats";
import { fetchJsonLdJobs, fetchXmlFeedJobs } from "./providers/universal";
import type { NormalizedJob } from "./providers/types";
import { upsertJob } from "./ingest";

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
  XML_FEED: "XML job feed",
};

const isAts = (k: SourceKind): k is AtsKind => k !== "JSONLD" && k !== "XML_FEED";

/** Fetch every job a connected source currently exposes. */
export function fetchSourceJobs(src: Pick<JobSourceRow, "kind" | "token" | "companyName">): Promise<NormalizedJob[]> {
  if (isAts(src.kind)) return fetchCompanyJobs(src.kind, src.token, src.companyName);
  if (src.kind === "JSONLD") return fetchJsonLdJobs(src.token, src.companyName);
  return fetchXmlFeedJobs(src.token, src.companyName);
}

/** The `jobs.source` value rows from this connector should carry. */
export const jobSourceFor = (k: SourceKind) =>
  isAts(k) ? ATS_SOURCE[k] : k === "JSONLD" ? ("CAREER_SITE" as const) : ("XML_FEED" as const);

// ─────────────────────────────────────────────────────────────
// CONNECT
// ─────────────────────────────────────────────────────────────
export type ConnectResult =
  | { ok: true; source: JobSourceRow; detection: Detection; imported: number; alreadyExisted: boolean }
  | { ok: false; error: string; suggestions: string[] };

/**
 * Paste a careers URL → detect → save → immediately pull, so the person who
 * connected it sees their jobs land instead of being told to wait for a cron.
 */
export async function connectByUrl(rawUrl: string, addedById?: string): Promise<ConnectResult> {
  const detected = await detectSource(rawUrl);
  if (detected.kind === null) {
    const f = detected as DetectionFailure;
    return { ok: false, error: f.reason, suggestions: f.suggestions };
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
};

/** Pull one connected company and record the outcome on the source row. */
export async function syncSource(src: JobSourceRow): Promise<SyncResult> {
  const jobSource = jobSourceFor(src.kind);
  const [run] = await db
    .insert(ingestRuns)
    .values({ source: jobSource, board: `${src.companyName} (${src.token})`, sourceId: src.id })
    .returning();

  const out: SyncResult = {
    sourceId: src.id,
    company: src.companyName,
    kind: src.kind,
    fetched: 0,
    created: 0,
    updated: 0,
  };

  try {
    const jobs = await fetchSourceJobs(src);
    out.fetched = jobs.length;
    for (const j of jobs) {
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

  const failed = Boolean(out.error);
  await db
    .update(jobSources)
    .set({
      lastRunAt: new Date(),
      lastJobCount: out.fetched,
      lastError: out.error ?? null,
      consecutiveFailures: failed ? sql`${jobSources.consecutiveFailures} + 1` : 0,
      totalImported: sql`${jobSources.totalImported} + ${out.created}`,
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
export async function syncAllSources(limit = 200): Promise<SyncResult[]> {
  const rows = await db
    .select()
    .from(jobSources)
    .where(eq(jobSources.enabled, true))
    .orderBy(asc(sql`${jobSources.lastRunAt} nulls first`))
    .limit(limit);

  const results: SyncResult[] = [];
  for (const r of rows) {
    results.push(await syncSource(r));
    await new Promise((res) => setTimeout(res, 250)); // be a polite client
  }
  return results;
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
