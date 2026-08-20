/**
 * Wipe transactional state (swipes, applications, matches, messages, emails)
 * and any test accounts, so the demo — and the e2e suite — start clean.
 *
 *   npm run reset
 *
 * Leaves ingested jobs alone; run `npm run ingest` separately.
 */
import "dotenv/config";
import { inArray, like, ne, or } from "drizzle-orm";
import {
  applications,
  candidateSwipes,
  db,
  emailLogs,
  ingestRuns,
  jobSources,
  jobs,
  matches,
  messages,
  privacyRequests,
  rateLimits,
  recruiterSwipes,
  reports,
  users,
  companies,
} from "../src/db";

async function main() {
  // messages cascade from matches, but be explicit about ordering anyway
  await db.delete(messages);
  await db.delete(matches);
  await db.delete(applications);
  await db.delete(candidateSwipes);
  await db.delete(recruiterSwipes);
  await db.delete(emailLogs);
  await db.delete(reports);
  await db.delete(privacyRequests);

  /**
   * AUTH-009 — clear the rate-limit counters.
   *
   * This resets TEST STATE; it does not weaken the control. Every test run
   * makes dozens of signups and logins from one loopback address, which
   * correctly trips the per-IP limiter and then makes the next run fail for a
   * reason that has nothing to do with what is being tested. The limiter itself
   * is asserted directly by TC-AUTH-009-* in the security and lifecycle suites,
   * against a single dedicated source IP.
   *
   * Guarded, because truncating this table in production would hand an attacker
   * a clean slate.
   */
  const looksProd =
    process.env.NODE_ENV === "production" ||
    /neon\.tech|amazonaws|render\.com|supabase/i.test(process.env.DATABASE_URL ?? "");
  if (looksProd) {
    console.error("Refusing to reset against what looks like a production database.");
    process.exit(1);
  }
  await db.delete(rateLimits);

  // connected companies and everything they pulled in — native Jobsy posts stay
  await db.delete(jobSources);
  await db.delete(ingestRuns);
  const wiped = await db.delete(jobs).where(ne(jobs.source, "JOBSY")).returning({ id: jobs.id });

  /**
   * Accounts, postings and companies created by the e2e suites.
   *
   * Order matters, and getting it wrong is a foreign-key error rather than a
   * silent one:
   *
   *   1. Postings first. `jobs.posted_by_id` is ON DELETE SET NULL, so deleting
   *      the account alone leaves an ownerless JOBSY posting behind. The next
   *      run then finds two identically-titled cards in the deck and a
   *      swipe-advances assertion fails for a reason unrelated to swiping.
   *   2. Accounts next.
   *   3. Companies LAST, and only after clearing any remaining `users.company_id`
   *      reference — that column has no cascade, so a surviving reference blocks
   *      the delete outright.
   */
  const testAccounts = await db
    .select({ id: users.id })
    .from(users)
    .where(or(like(users.email, "tester%@demo.jobsy"), like(users.email, "e2e-%")));

  const testCompanies = await db
    .select({ id: companies.id })
    .from(companies)
    .where(like(companies.name, "%E2E %"));

  let orphanedJobs = 0;
  if (testAccounts.length || testCompanies.length) {
    const userIds = testAccounts.map((u) => u.id);
    const companyIds = testCompanies.map((c) => c.id);
    const dropped = await db
      .delete(jobs)
      .where(
        or(
          userIds.length ? inArray(jobs.postedById, userIds) : undefined,
          companyIds.length ? inArray(jobs.companyId, companyIds) : undefined
        )
      )
      .returning({ id: jobs.id });
    orphanedJobs = dropped.length;
  }

  const removed = await db
    .delete(users)
    .where(or(like(users.email, "tester%@demo.jobsy"), like(users.email, "e2e-%")))
    .returning({ id: users.id });

  let droppedCompanies = 0;
  if (testCompanies.length) {
    const companyIds = testCompanies.map((c) => c.id);
    // Release any remaining reference before the delete can succeed.
    await db.update(users).set({ companyId: null }).where(inArray(users.companyId, companyIds));
    const gone = await db
      .delete(companies)
      .where(inArray(companies.id, companyIds))
      .returning({ id: companies.id });
    droppedCompanies = gone.length;
  }

  console.log(
    `✅ Reset — swipes, applications, matches, messages and email log cleared` +
      `, rate limits reset` +
      `; ${wiped.length} ingested job(s) and all connected companies removed` +
      (removed.length
        ? `; ${removed.length} test account(s), ${orphanedJobs} test posting(s) and ${droppedCompanies} test company/companies removed`
        : "")
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .then(() => process.exit(0));
