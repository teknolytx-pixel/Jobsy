/**
 * Wipe transactional state (swipes, applications, matches, messages, emails)
 * and any test accounts, so the demo — and the e2e suite — start clean.
 *
 *   npm run reset
 *
 * Leaves ingested jobs alone; run `npm run ingest` separately.
 */
import "dotenv/config";
import { like, ne, or } from "drizzle-orm";
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
  recruiterSwipes,
  users,
} from "../src/db";

async function main() {
  // messages cascade from matches, but be explicit about ordering anyway
  await db.delete(messages);
  await db.delete(matches);
  await db.delete(applications);
  await db.delete(candidateSwipes);
  await db.delete(recruiterSwipes);
  await db.delete(emailLogs);

  // connected companies and everything they pulled in — native Jobsy posts stay
  await db.delete(jobSources);
  await db.delete(ingestRuns);
  const wiped = await db.delete(jobs).where(ne(jobs.source, "JOBSY")).returning({ id: jobs.id });

  // accounts created by the e2e suite
  const removed = await db
    .delete(users)
    .where(or(like(users.email, "tester%@demo.jobsy"), like(users.email, "e2e-%")))
    .returning({ id: users.id });

  console.log(
    `✅ Reset — swipes, applications, matches, messages and email log cleared` +
      `; ${wiped.length} ingested job(s) and all connected companies removed` +
      (removed.length ? `; ${removed.length} test account(s) removed` : "")
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .then(() => process.exit(0));
