import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import {
  db,
  applications,
  candidateSwipes,
  companies,
  jobs,
  matches,
  messages,
  notificationPrefs,
  privacyRequests,
  recruiterSwipes,
  resumes,
  users,
} from "@/db";
import { sendEmail, jobExpiryWarningTemplate } from "./email";
import { deleteObject } from "./storage";
import { sweepRateLimits } from "./ratelimit";
import { audit } from "./audit";
import { env } from "./env";

/**
 * Nightly maintenance, run from the same cron as ingestion.
 *
 * Each task is independent and each is wrapped, because a failure in one must
 * not stop the others. Purging deleted accounts is a legal obligation; letting
 * it be skipped because a job-expiry email bounced would be a bad trade.
 */

export type MaintenanceReport = {
  expiryWarningsSent: number;
  jobsAutoExpired: number;
  accountsPurged: number;
  resumeFilesRemoved: number;
  invitationsExpired: number;
  rateLimitRowsSwept: number;
  overduePrivacyRequests: number;
  errors: string[];
};

/** JOB-003 AC-2 — postings go stale at 60 days, with a warning at 53. */
const EXPIRE_AFTER_DAYS = 60;
const WARN_AT_DAYS = 53;

/** AUTH-012 AC-2 — personal data is erased within 30 days of a deletion request. */
const PURGE_AFTER_DAYS = 30;

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

export async function runMaintenance(): Promise<MaintenanceReport> {
  const report: MaintenanceReport = {
    expiryWarningsSent: 0,
    jobsAutoExpired: 0,
    accountsPurged: 0,
    resumeFilesRemoved: 0,
    invitationsExpired: 0,
    rateLimitRowsSwept: 0,
    overduePrivacyRequests: 0,
    errors: [],
  };

  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      report.errors.push(`${name}: ${(e as Error).message}`);
      console.error(`[maintenance] ${name} failed:`, e);
    }
  };

  await step("expiryWarnings", async () => {
    report.expiryWarningsSent = await sendExpiryWarnings();
  });
  await step("autoExpire", async () => {
    report.jobsAutoExpired = await autoExpireJobs();
  });
  await step("purge", async () => {
    const r = await purgeDeletedAccounts();
    report.accountsPurged = r.accounts;
    report.resumeFilesRemoved = r.files;
  });
  await step("rateLimits", async () => {
    report.rateLimitRowsSwept = await sweepRateLimits();
  });
  await step("overdue", async () => {
    report.overduePrivacyRequests = await flagOverdueRequests();
  });

  return report;
}

/**
 * JOB-003 AC-3 — warn before closing.
 *
 * Only JOBSY-posted jobs. An ingested job's lifecycle belongs to the employer's
 * ATS; closing it here would fight the next sync.
 */
async function sendExpiryWarnings(): Promise<number> {
  const stale = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      postedById: jobs.postedById,
      email: users.email,
      name: users.name,
      lastConfirmedAt: jobs.lastConfirmedAt,
    })
    .from(jobs)
    .innerJoin(users, eq(jobs.postedById, users.id))
    .where(
      and(
        eq(jobs.source, "JOBSY"),
        eq(jobs.active, true),
        isNull(jobs.expiryWarnedAt),
        lt(sql`coalesce(${jobs.lastConfirmedAt}, ${jobs.postedAt})`, daysAgo(WARN_AT_DAYS))
      )
    )
    .limit(200);

  for (const job of stale) {
    await sendEmail(
      jobExpiryWarningTemplate({
        to: job.email,
        recruiterName: job.name,
        jobTitle: job.title,
        confirmUrl: `${env.appUrl}/jobs?confirm=${job.id}`,
        closeUrl: `${env.appUrl}/jobs?close=${job.id}`,
        daysLeft: EXPIRE_AFTER_DAYS - WARN_AT_DAYS,
      })
    );
    await db.update(jobs).set({ expiryWarnedAt: new Date() }).where(eq(jobs.id, job.id));
  }
  return stale.length;
}

/**
 * JOB-003 AC-2 — close what nobody confirmed.
 *
 * This is not housekeeping. Illinois requires a current job order before
 * advertising, Texas prohibits advertising without a verified one with a
 * treble-damages private right of action, and New York's ghost-jobs bill names
 * third-party platforms directly. An unconfirmed 60-day-old posting is the
 * exact fact pattern those laws describe.
 */
async function autoExpireJobs(): Promise<number> {
  const expired = await db
    .update(jobs)
    .set({ active: false })
    .where(
      and(
        eq(jobs.source, "JOBSY"),
        eq(jobs.active, true),
        lt(sql`coalesce(${jobs.lastConfirmedAt}, ${jobs.postedAt})`, daysAgo(EXPIRE_AFTER_DAYS))
      )
    )
    .returning({ id: jobs.id });

  for (const j of expired) {
    await audit({
      action: "job.auto_expired",
      subjectType: "job",
      subjectId: j.id,
      detail: { reason: `no confirmation in ${EXPIRE_AFTER_DAYS} days` },
    });
  }
  return expired.length;
}

/**
 * AUTH-012 — erase, for real.
 *
 * Deliberately NOT a row delete. Deleting the users row would cascade away the
 * match rows, and the counterparty's conversation would vanish mid-thread with
 * no explanation. AC-4 asks for the opposite: the thread survives and the other
 * person sees "Former Jobsy user".
 *
 * So the row is anonymised in place — every identifying field overwritten, the
 * email replaced with an opaque tombstone that keeps the unique index happy,
 * and the resume files removed from storage.
 */
async function purgeDeletedAccounts(): Promise<{ accounts: number; files: number }> {
  const due = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        isNotNull(users.deletionRequestedAt),
        isNull(users.deletedAt),
        eq(users.legalHold, false),
        lt(users.deletionRequestedAt, daysAgo(PURGE_AFTER_DAYS))
      )
    )
    .limit(100);

  let files = 0;

  for (const { id } of due) {
    // Storage first. A DB row that says "purged" while the PDF is still in the
    // bucket is the worst of both worlds.
    const docs = await db.select().from(resumes).where(eq(resumes.userId, id));
    for (const doc of docs) {
      await deleteObject(doc.storageKey);
      files++;
    }

    await db.transaction(async (tx) => {
      await tx.delete(resumes).where(eq(resumes.userId, id));
      await tx.delete(candidateSwipes).where(eq(candidateSwipes.candidateId, id));
      await tx.delete(recruiterSwipes).where(eq(recruiterSwipes.recruiterId, id));
      await tx.delete(applications).where(eq(applications.candidateId, id));
      await tx.delete(messages).where(eq(messages.senderId, id));
      await tx.delete(notificationPrefs).where(eq(notificationPrefs.userId, id));

      // AC-3 — the row survives so matches and threads stay coherent, but
      // nothing on it identifies a person any more.
      await tx
        .update(users)
        .set({
          email: `deleted-${id}@deleted.invalid`,
          name: "Former Jobsy user",
          passwordHash: null,
          image: null,
          headline: null,
          bio: null,
          location: null,
          availability: null,
          skills: [],
          salaryTarget: null,
          linkedinSub: null,
          linkedinLinkedAt: null,
          authorizedToWork: null,
          requiresSponsorship: null,
          workAuthConsentAt: null,
          jurisdiction: null,
          openToOffers: false,
          profileReady: false,
          emailVerified: false,
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, id));
    });

    await audit({
      action: "privacy.account_deleted",
      subjectType: "user",
      subjectId: id,
      detail: { resumeFilesRemoved: docs.length },
    });

    await db
      .update(privacyRequests)
      .set({ status: "COMPLETED", outcome: "Personal data erased", completedAt: new Date() })
      .where(and(eq(privacyRequests.userId, id), eq(privacyRequests.kind, "DELETE")));
  }

  return { accounts: due.length, files };
}

/**
 * ADMIN-006 AC-2 — surface anything past its statutory due date.
 *
 * Counting rather than acting: a human has to service these. What this
 * guarantees is that nobody can claim they did not know.
 */
async function flagOverdueRequests(): Promise<number> {
  const overdue = await db
    .select({ id: privacyRequests.id, kind: privacyRequests.kind, dueAt: privacyRequests.dueAt })
    .from(privacyRequests)
    .where(and(eq(privacyRequests.status, "RECEIVED"), lt(privacyRequests.dueAt, new Date())));

  if (overdue.length) {
    console.error(
      `[maintenance] ${overdue.length} privacy request(s) are past their statutory due date:`,
      overdue.map((r) => `${r.kind} due ${r.dueAt.toISOString()}`).join(", ")
    );
  }
  return overdue.length;
}

/** Used by tests to reach the internals without exporting them broadly. */
export const __internals = { sendExpiryWarnings, autoExpireJobs, purgeDeletedAccounts };
