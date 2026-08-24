import { and, count, eq, isNotNull, sql } from "drizzle-orm";
import {
  candidateSources,
  db,
  sourcedCandidates,
  type CandidateSourceKind,
  type CandidateSourceRow,
} from "@/db";
import { extractSkills } from "@/lib/skills";
import { NotContracted, fetchCandidates, type SourcedPerson } from "./providers";

/**
 * IMPORTING PEOPLE, AND THE RULES THAT COME WITH THEM.
 *
 * Three rules are enforced here rather than remembered elsewhere, because a
 * rule that lives in someone's head is not a rule.
 *
 *   1. An imported person is INVISIBLE. They are not a user, they are not in
 *      the matching pool, and no scoring runs against them. `sourced_candidates`
 *      is a separate table for exactly this reason — the deck queries `users`,
 *      so invisibility is structural rather than a WHERE clause anyone could
 *      forget.
 *
 *   2. SUPPRESSION IS PERMANENT. Somebody who objected, or asked to be erased,
 *      must not reappear on the next sync because their record still sits in the
 *      employer's ATS. This is the single most common way a deletion request
 *      gets quietly undone, and the check below is what prevents it.
 *
 *   3. EVERY ROW NAMES ITS BASIS. A record that cannot say why we are allowed to
 *      hold it is a record we should not have. It is a column, not a comment.
 */

export type ImportResult = {
  sourceId: string;
  label: string;
  kind: CandidateSourceKind;
  fetched: number;
  created: number;
  updated: number;
  /** Skipped because the person previously objected. Worth reporting, always. */
  suppressed: number;
  error?: string;
  note?: string;
};

/** Everything a recruiter can do nothing about, said once. */
const describe = (e: unknown): string =>
  e instanceof NotContracted ? `Not connected — ${e.needs}` : (e as Error).message;

/**
 * Turn whatever the ATS gave us into the columns we keep.
 *
 * Skills are read from the tags the employer applied AND from the CV text when
 * we have it, because ATS tags are famously sparse — a candidate is tagged
 * "senior" and nothing else. Reading the CV is the same extraction the rest of
 * Jobsy already uses, so a sourced candidate is described in the same vocabulary
 * as a registered one and can be compared with them later without a translation
 * layer nobody maintains.
 */
export function toRow(p: SourcedPerson): {
  skills: string[];
  headline: string | null;
} {
  const fromText = p.resumeText ? extractSkills(p.resumeText) : [];
  const tagged = (p.skills ?? []).map((s) => s.trim()).filter(Boolean);
  const merged = [...new Set([...tagged, ...fromText])].slice(0, 40);
  return { skills: merged, headline: p.headline?.slice(0, 200) ?? null };
}

/**
 * Pull one source and write what it returns.
 *
 * Resumable in the same way the job sources are: a run stops on its deadline,
 * records where it stopped, and the next continues. An employer with fifteen
 * thousand historical applicants is not a one-request job.
 */
export async function importFromSource(
  src: CandidateSourceRow,
  opts: { deadline?: number } = {}
): Promise<ImportResult> {
  const out: ImportResult = {
    sourceId: src.id,
    label: src.label,
    kind: src.kind,
    fetched: 0,
    created: 0,
    updated: 0,
    suppressed: 0,
  };

  let nextCursor = src.syncCursor;

  try {
    const page = await fetchCandidates(src.kind, src.secret ?? "", src.token, {
      deadline: opts.deadline,
      startOffset: src.syncCursor,
    });
    out.fetched = page.people.length;
    nextCursor = page.nextOffset;
    if (!page.complete) {
      out.note = `Read ${page.people.length} so far; the next sync resumes from here.`;
    }

    for (const person of page.people) {
      if (!person.externalId) continue;

      const existing = (
        await db
          .select({
            id: sourcedCandidates.id,
            state: sourcedCandidates.state,
            suppressedAt: sourcedCandidates.suppressedAt,
          })
          .from(sourcedCandidates)
          .where(
            and(
              eq(sourcedCandidates.sourceId, src.id),
              eq(sourcedCandidates.externalId, person.externalId)
            )
          )
          .limit(1)
      )[0];

      /*
       * Rule 2, and the reason it is checked before anything is written.
       *
       * The person is still in the employer's ATS — we do not control that and
       * should not. What we control is whether their record here comes back to
       * life every six hours after they asked us to remove it.
       */
      if (existing?.suppressedAt) {
        out.suppressed++;
        continue;
      }

      const { skills, headline } = toRow(person);
      const values = {
        firstName: person.firstName?.slice(0, 120) ?? null,
        lastName: person.lastName?.slice(0, 120) ?? null,
        email: person.email?.toLowerCase().slice(0, 255) ?? null,
        phone: person.phone?.slice(0, 60) ?? null,
        headline,
        location: person.location?.slice(0, 160) ?? null,
        skills,
        resumeText: person.resumeText?.slice(0, 20_000) ?? null,
        resumeUrl: person.resumeUrl ?? null,
        preferredChannel: person.preferredChannel ?? null,
        preferredHandle: person.preferredHandle ?? null,
        updatedAt: new Date(),
      };

      if (existing) {
        /*
         * Refresh the facts, never the state.
         *
         * A candidate who has been notified, or has claimed their profile, must
         * not be dragged back to IMPORTED because their ATS record was touched.
         * Their standing with us is ours to track; only the employer's facts
         * about them come from the ATS.
         */
        await db.update(sourcedCandidates).set(values).where(eq(sourcedCandidates.id, existing.id));
        out.updated++;
      } else {
        await db.insert(sourcedCandidates).values({
          sourceId: src.id,
          companyId: src.companyId,
          externalId: person.externalId.slice(0, 191),
          lawfulBasis: src.lawfulBasis,
          state: "IMPORTED",
          ...values,
        });
        out.created++;
      }
    }
  } catch (e) {
    out.error = describe(e);
  }

  const failed = Boolean(out.error);
  await db
    .update(candidateSources)
    .set({
      lastRunAt: new Date(),
      lastError: out.error ?? null,
      lastCount: out.fetched,
      totalImported: sql`${candidateSources.totalImported} + ${out.created}`,
      // Only move the cursor on a run that got somewhere; advancing after a
      // failure would skip people nobody ever read.
      ...(failed ? {} : { syncCursor: nextCursor }),
      status: failed ? "FAILING" : "OK",
    })
    .where(eq(candidateSources.id, src.id));

  return out;
}

/**
 * What an operator needs to see to know whether this is working — or whether
 * they are sitting on a pile of people nobody has been told about.
 *
 * The last number is the one that matters. A large `imported` with a zero
 * `notified` is not a successful import; it is an unmet obligation, and the
 * screen says so.
 */
export type CandidateStats = {
  total: number;
  imported: number;
  notified: number;
  claimed: number;
  suppressed: number;
  withEmail: number;
  withPreferredChannel: number;
};

export async function candidateStats(companyId?: string): Promise<CandidateStats> {
  const where = companyId ? eq(sourcedCandidates.companyId, companyId) : undefined;
  const [row] = await db
    .select({
      total: count(),
      imported: sql<number>`sum(case when ${sourcedCandidates.state} = 'IMPORTED' then 1 else 0 end)::int`,
      notified: sql<number>`sum(case when ${sourcedCandidates.state} = 'NOTIFIED' then 1 else 0 end)::int`,
      claimed: sql<number>`sum(case when ${sourcedCandidates.state} = 'CLAIMED' then 1 else 0 end)::int`,
      suppressed: sql<number>`sum(case when ${sourcedCandidates.state} = 'SUPPRESSED' then 1 else 0 end)::int`,
      withEmail: sql<number>`sum(case when ${sourcedCandidates.email} is not null then 1 else 0 end)::int`,
      withPreferredChannel: sql<number>`sum(case when ${sourcedCandidates.preferredChannel} is not null then 1 else 0 end)::int`,
    })
    .from(sourcedCandidates)
    .where(where);

  return {
    total: row?.total ?? 0,
    imported: row?.imported ?? 0,
    notified: row?.notified ?? 0,
    claimed: row?.claimed ?? 0,
    suppressed: row?.suppressed ?? 0,
    withEmail: row?.withEmail ?? 0,
    withPreferredChannel: row?.withPreferredChannel ?? 0,
  };
}

/** Per-source rollup, so a broken connection is visible rather than averaged away. */
export async function sourceRollup(): Promise<
  (CandidateSourceRow & { held: number })[]
> {
  const rows = await db
    .select({
      src: candidateSources,
      held: sql<number>`(select count(*)::int from ${sourcedCandidates}
                          where ${sourcedCandidates.sourceId} = ${candidateSources.id})`,
    })
    .from(candidateSources)
    .orderBy(candidateSources.label);
  return rows.map((r) => ({ ...r.src, held: r.held }));
}

/** Candidates still owed an Article 14 notice, oldest first. */
export async function awaitingNotice(limit = 200) {
  return db
    .select()
    .from(sourcedCandidates)
    .where(and(eq(sourcedCandidates.state, "IMPORTED"), isNotNull(sourcedCandidates.email)))
    .orderBy(sourcedCandidates.importedAt)
    .limit(limit);
}
