import { and, eq, lt, ne, sql } from "drizzle-orm";
import { companies, db, ingestRuns, jobs } from "@/db";
import { activeProviders, type JobProvider, type NormalizedJob } from "./providers";

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
  await db.insert(jobs).values(values).onConflictDoNothing({
    target: [jobs.source, jobs.externalId],
  });
  return "created";
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
export async function ingestAll(): Promise<IngestSummary[]> {
  const providers = activeProviders();
  if (!providers.length) {
    console.warn("[ingest] no query providers configured — connected companies still sync");
    return [];
  }

  const out: IngestSummary[] = [];
  for (const p of providers) {
    for (const board of p.boards()) {
      out.push(await runBoard(p, board));
      await new Promise((r) => setTimeout(r, 250)); // be a polite client
    }
  }
  return out;
}

/** Retire postings a provider has stopped returning. */
export async function deactivateStale(olderThanHours = 72): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 3600_000);
  const res = await db
    .update(jobs)
    .set({ active: false })
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
