import { NextResponse } from "next/server";
import { and, count, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db, emailLogs, jobSources, resumes } from "@/db";
import { requirePlatformAdmin, authErrorResponse } from "@/lib/auth";
import { assess, currentConfig } from "@/lib/health";

export const dynamic = "force-dynamic";

/**
 * NFR-010 — the operational health of the things that fail quietly.
 *
 * Everything reported here is invisible from a page load. Email that is not
 * configured still returns 202 to the person requesting a password reset;
 * a job source that has been erroring for a week still leaves the site full of
 * older jobs; a reset link pointing at the wrong domain still says "sent".
 */

/** How far back to look. Long enough to see a pattern, short enough to be now. */
const WINDOW_DAYS = 7;

export async function GET(req: Request) {
  let admin;
  try {
    admin = await requirePlatformAdmin();
  } catch (e) {
    return authErrorResponse(e)!;
  }

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);

  const [byStatus, sources, resumeRows] = await Promise.all([
    db
      .select({ status: emailLogs.status, n: count() })
      .from(emailLogs)
      .where(gte(emailLogs.createdAt, since))
      .groupBy(emailLogs.status),
    db
      .select({ name: jobSources.companyName, error: jobSources.lastError })
      .from(jobSources)
      .where(and(isNotNull(jobSources.lastError), eq(jobSources.enabled, true)))
      .limit(20),
    db
      .select({
        total: count(),
        failed: sql<number>`sum(case when ${resumes.parseStatus} in ('MANUAL','FAILED') then 1 else 0 end)::int`,
      })
      .from(resumes)
      .where(gte(resumes.createdAt, since)),
  ]);

  const n = (s: string) => byStatus.find((r) => r.status === s)?.n ?? 0;

  /**
   * The hosts this deployment actually answers on.
   *
   * Vercel supplies VERCEL_URL for the deployment and VERCEL_PROJECT_PRODUCTION_URL
   * for the production alias. Comparing NEXT_PUBLIC_APP_URL against these is
   * what catches a reset link addressed to a site this code is not running on —
   * which is not hypothetical here, since two Vercel projects point at this
   * repository and only one of them is current.
   */
  const expectedHosts = [
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
    new URL(req.url).host,
  ].filter((h): h is string => Boolean(h));

  const findings = assess({
    email: {
      sent: n("SENT"),
      failed: n("FAILED"),
      loggedOnly: n("LOGGED_ONLY"),
      suppressed: n("SUPPRESSED"),
      queued: n("QUEUED"),
    },
    failingSources: sources.map((s) => ({ name: s.name ?? "source", error: s.error ?? "" })),
    resumeParseFailures: resumeRows[0]?.failed ?? 0,
    resumeUploads: resumeRows[0]?.total ?? 0,
    config: currentConfig(expectedHosts),
  });

  return NextResponse.json({
    windowDays: WINDOW_DAYS,
    findings,
    counts: {
      emailSent: n("SENT"),
      emailFailed: n("FAILED"),
      emailLoggedOnly: n("LOGGED_ONLY"),
      emailSuppressed: n("SUPPRESSED"),
      emailQueued: n("QUEUED"),
      failingSources: sources.length,
      resumeUploads: resumeRows[0]?.total ?? 0,
      resumeParseFailures: resumeRows[0]?.failed ?? 0,
    },
    checkedBy: admin.email,
  });
}
