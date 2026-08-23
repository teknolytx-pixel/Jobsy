import { sql } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * IS THE DATABASE THE SAME VERSION AS THE CODE?
 *
 * ── Why this is worth a query ──
 *
 * A missed migration does not look like an outage. It looks like one feature
 * being broken. Everything else keeps working, so nobody suspects the database,
 * and the failure surfaces as whatever the driver happens to say — which, for a
 * missing enum value, is a paragraph of SQL.
 *
 * That is exactly what happened when JSONLD_CRAWL shipped: detection worked,
 * the save failed, and the only clue anywhere was `invalid input value for enum
 * source_kind` buried on the cause of a wrapped error.
 *
 * ── Why enums specifically ──
 *
 * Because they are the cheap half of the problem and the half that fails
 * silently. A missing COLUMN usually breaks every query against that table, so
 * it announces itself; a missing enum VALUE breaks only the rows that use it,
 * which may be none until somebody connects the right kind of careers page.
 *
 * The check is one query against pg_enum and compares it with the enum
 * definitions the code was compiled with, so it stays correct as new values are
 * added without anyone remembering this file exists.
 */

export type Drift = { type: string; missing: string[] };

type PgEnumLike = { enumName: string; enumValues: readonly string[] };

const isPgEnum = (v: unknown): v is PgEnumLike =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as PgEnumLike).enumName === "string" &&
  Array.isArray((v as PgEnumLike).enumValues);

/** Every enum the code defines, from the schema module itself. */
export function declaredEnums(): PgEnumLike[] {
  const seen = new Map<string, PgEnumLike>();
  for (const v of Object.values(schema)) {
    if (isPgEnum(v)) seen.set(v.enumName, v);
  }
  return [...seen.values()];
}

/**
 * Compare what the code declares with what the database holds.
 *
 * Pure, so the comparison can be tested without a database — the query is the
 * uninteresting half.
 */
export function compareEnums(
  declared: PgEnumLike[],
  actual: Map<string, Set<string>>
): Drift[] {
  const out: Drift[] = [];
  for (const e of declared) {
    const have = actual.get(e.enumName);
    // A type the database has never heard of is a much larger drift than a
    // missing value, and it is not this check's business to guess at it: every
    // query touching it fails loudly already.
    if (!have) continue;
    const missing = e.enumValues.filter((v) => !have.has(v));
    if (missing.length) out.push({ type: e.enumName, missing: [...missing] });
  }
  return out;
}

/** Enum values the code knows and this database does not. Empty is healthy. */
export async function enumDrift(): Promise<Drift[]> {
  const rows = await db.execute<{ typname: string; enumlabel: string }>(sql`
    select t.typname, e.enumlabel
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public'
  `);

  const actual = new Map<string, Set<string>>();
  for (const r of rows.rows) {
    if (!actual.has(r.typname)) actual.set(r.typname, new Set());
    actual.get(r.typname)!.add(r.enumlabel);
  }
  return compareEnums(declaredEnums(), actual);
}
