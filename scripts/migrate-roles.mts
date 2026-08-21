#!/usr/bin/env tsx
/**
 * AUTH-002 — retire the BOTH role from existing data.
 *
 * BOTH was never chosen by anyone. It was manufactured: `POST /api/jobs`
 * promoted a CANDIDATE to BOTH rather than refusing the request, and accepting
 * a company invitation did the same. Those promotions are gone, so any BOTH row
 * still in the database is a record of the bug, not of a decision.
 *
 * Each one is resolved by what the account actually did:
 *
 *   posted a job or belongs to a company  →  RECRUITER
 *   everything else                       →  CANDIDATE
 *
 * That is the honest reading. Someone who posted a role was behaving as an
 * employer whatever the enum said, and demoting them to CANDIDATE would hide
 * their own postings from them.
 *
 * The enum VALUE stays in the Postgres type. Removing a value requires
 * recreating the type and rewriting every dependent column, which is a real
 * outage risk on a live database to delete a string nothing writes any more.
 *
 *   npx tsx scripts/migrate-roles.mts           # report only
 *   npx tsx scripts/migrate-roles.mts --apply   # write
 */
import "dotenv/config";

const { db, users, jobs } = await import("../src/db");
const { eq, sql } = await import("drizzle-orm");

const APPLY = process.argv.includes("--apply");

const both = await db
  .select({ id: users.id, email: users.email, companyId: users.companyId })
  .from(users)
  .where(sql`${users.role} = 'BOTH'`);

if (!both.length) {
  console.log("\nNo BOTH accounts. Nothing to do.\n");
  process.exit(0);
}

console.log(
  APPLY
    ? `\nResolving ${both.length} BOTH account(s) (WRITING)…\n`
    : `\nResolving ${both.length} BOTH account(s) (DRY RUN — pass --apply to write)…\n`
);

let toRecruiter = 0;
let toCandidate = 0;

for (const u of both) {
  const [posted] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(eq(jobs.postedById, u.id));

  const isEmployer = (posted?.n ?? 0) > 0 || Boolean(u.companyId);
  const next = isEmployer ? "RECRUITER" : "CANDIDATE";
  const why = isEmployer
    ? `${posted?.n ?? 0} posting(s)${u.companyId ? ", in a company" : ""}`
    : "no postings, no company";

  console.log(`  ${u.email.padEnd(34)} → ${next.padEnd(10)} (${why})`);
  isEmployer ? toRecruiter++ : toCandidate++;

  if (APPLY) {
    await db
      .update(users)
      .set({ role: next, updatedAt: new Date() })
      .where(eq(users.id, u.id));
  }
}

console.log(
  `\n  ${toRecruiter} → RECRUITER, ${toCandidate} → CANDIDATE` +
    (APPLY ? "\n" : "\n\nNothing was written. Re-run with --apply.\n")
);
process.exit(0);
