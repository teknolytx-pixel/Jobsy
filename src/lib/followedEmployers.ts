import { eq, sql } from "drizzle-orm";
import { db, followedEmployers, type FollowedEmployerRow } from "@/db";
import { activeProviders, ALL_PROVIDERS } from "./providers";
import type { NormalizedJob } from "./providers/types";
import { upsertJob } from "./ingest";

/**
 * FOLLOWING AN EMPLOYER THROUGH THE JOB BOARDS.
 *
 * ── Why this is not a workaround ──
 *
 * Some large employers' careers sites cannot be read by anything that is not a
 * browser. The jobs arrive after the page loads, there is no feed, no
 * schema.org data, no sitemap of jobs. Parsing harder does not help, because
 * there is nothing in the document to parse; the only technical answer is to
 * execute the site's JavaScript, which a sixty-second serverless function
 * cannot do.
 *
 * Those same jobs are, however, already indexed by Indeed, LinkedIn and
 * Glassdoor, and Jobsy already licenses aggregators that resell those indexes.
 * So we ask the boards for the employer by name. Same jobs, licensed data, and
 * it works on any large employer immediately, without their cooperation.
 *
 * ── The honest trade ──
 *
 * The aggregator may lag the careers site by a day, and will miss roles the
 * employer never syndicated. That is a worse instrument in one respect and a
 * far better one in another: it works today, on Infosys and Wipro and everyone
 * like them, rather than never.
 *
 * ── Why the name match is strict ──
 *
 * A query for "Infosys" returns jobs AT Infosys and also jobs at agencies
 * recruiting FOR Infosys, plus anything whose description happens to mention
 * them. Importing those under the employer's name would be worse than
 * importing nothing: a candidate would swipe on a role believing it is with a
 * company it is not with. So results are filtered on the employer field, not
 * the query, and a near-miss is dropped rather than guessed at.
 */

/**
 * The providers that answer a free-text query.
 *
 * The ATS providers take a board slug — "stripe", "acme|wd5|Careers" — and
 * handing one an employer name would fetch a board that does not exist. They
 * are excluded by name rather than by trying and failing.
 */
export const QUERY_SOURCES = ["JSEARCH", "JOOBLE", "CAREERJET", "ADZUNA", "REMOTIVE", "ARBEITNOW"] as const;

/** Which of them are usable right now, and which are missing a credential. */
export function employerSearchProviders(): { live: string[]; needsKey: string[] } {
  const relevant = ALL_PROVIDERS.filter((p) => (QUERY_SOURCES as readonly string[]).includes(p.source));
  const live = activeProviders()
    .filter((p) => (QUERY_SOURCES as readonly string[]).includes(p.source))
    .map((p) => p.label);
  const liveSources = new Set(
    activeProviders().map((p) => p.source)
  );
  return {
    live,
    needsKey: relevant.filter((p) => !liveSources.has(p.source)).map((p) => p.label),
  };
}

/**
 * Is this job actually AT the employer we followed?
 *
 * Normalised rather than compared literally, because the boards are
 * inconsistent about suffixes: "Infosys", "Infosys Limited", "Infosys BPM",
 * "INFOSYS LTD". All of those are the employer. "Infosys Consulting Partners
 * LLC" recruiting for them is not, and the containment check is one-directional
 * to keep it out — the RESULT's name must start with the followed name, not
 * merely contain it somewhere.
 */
export function isSameEmployer(followed: string, resultName: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[.,]/g, "")
      .replace(/\b(inc|llc|ltd|limited|corp|corporation|plc|gmbh|pvt|private|co)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const a = norm(followed);
  const b = norm(resultName);
  if (!a || !b) return false;
  if (a === b) return true;
  // "infosys bpm" starts with "infosys" — a division, still the employer.
  return b.startsWith(`${a} `);
}

export type FollowResult = {
  id: string;
  name: string;
  fetched: number;
  matched: number;
  created: number;
  updated: number;
  error?: string;
  /** Which boards answered, so a zero is attributable. */
  providers: string[];
};

/** Pull one followed employer from every configured query provider. */
export async function syncFollowedEmployer(
  row: FollowedEmployerRow,
  opts: { deadline?: number } = {}
): Promise<FollowResult> {
  const out: FollowResult = {
    id: row.id,
    name: row.name,
    fetched: 0,
    matched: 0,
    created: 0,
    updated: 0,
    providers: [],
  };

  const providers = activeProviders().filter((p) =>
    (QUERY_SOURCES as readonly string[]).includes(p.source)
  );

  if (!providers.length) {
    out.error =
      "No job-board provider is configured. Add an aggregator API key " +
      "(RAPIDAPI_KEY for JSearch, or ADZUNA_APP_ID and ADZUNA_APP_KEY) and this will start working.";
  }

  const collected: NormalizedJob[] = [];
  for (const p of providers) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    try {
      const jobs = await p.fetchBoard(row.name);
      out.fetched += jobs.length;
      out.providers.push(p.label);
      collected.push(...jobs.filter((j) => isSameEmployer(row.name, j.companyName)));
    } catch (e) {
      // One board being down is not a failed follow; the others still answered.
      console.warn(`[follow] ${row.name} via ${p.label}:`, (e as Error).message);
    }
  }

  /*
   * Deduplicate before writing. The same posting reaches us through several
   * aggregators — they all index Indeed — and upserting each one separately
   * would spend three writes to land one row.
   */
  const seen = new Set<string>();
  const unique = collected.filter((j) => {
    const key = `${j.title.toLowerCase()}|${j.location.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  out.matched = unique.length;

  for (const j of unique) {
    try {
      const r = await upsertJob({ ...j, companyName: row.name });
      if (r === "created") out.created++;
      else out.updated++;
    } catch (e) {
      console.error(`[follow] ${row.name} ${j.externalId}:`, (e as Error).message);
    }
  }

  await db
    .update(followedEmployers)
    .set({
      lastRunAt: new Date(),
      lastError: out.error ?? null,
      lastCount: out.matched,
      totalImported: sql`${followedEmployers.totalImported} + ${out.created}`,
    })
    .where(eq(followedEmployers.id, row.id));

  return out;
}

/** Every followed employer, oldest-synced first so none is starved. */
export async function syncFollowedEmployers(
  opts: { deadline?: number } = {}
): Promise<FollowResult[]> {
  const rows = await db
    .select()
    .from(followedEmployers)
    .where(eq(followedEmployers.enabled, true))
    .orderBy(sql`${followedEmployers.lastRunAt} asc nulls first`)
    .limit(50);

  const results: FollowResult[] = [];
  for (const r of rows) {
    if (opts.deadline && Date.now() + 5_000 > opts.deadline) break;
    results.push(await syncFollowedEmployer(r, opts));
  }
  return results;
}

export async function listFollowedEmployers(): Promise<FollowedEmployerRow[]> {
  return db.select().from(followedEmployers).orderBy(followedEmployers.name);
}

/** Follow an employer, and pull immediately so the result is visible now. */
export async function followEmployer(
  name: string,
  opts: { careersUrl?: string; addedById?: string } = {}
): Promise<{ row: FollowedEmployerRow; result: FollowResult }> {
  const clean = name.trim().slice(0, 160);
  const [created] = await db
    .insert(followedEmployers)
    .values({ name: clean, careersUrl: opts.careersUrl ?? null, addedById: opts.addedById ?? null })
    .onConflictDoNothing()
    .returning();

  const row =
    created ??
    (
      await db
        .select()
        .from(followedEmployers)
        .where(sql`lower(${followedEmployers.name}) = ${clean.toLowerCase()}`)
        .limit(1)
    )[0];

  return { row, result: await syncFollowedEmployer(row, { deadline: Date.now() + 45_000 }) };
}
