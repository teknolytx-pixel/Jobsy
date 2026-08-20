import { and, eq } from "drizzle-orm";
import { db, aedtNotices } from "@/db";
import { CURRENT_AEDT_NOTICE } from "../legalVersions";
import { audit } from "../audit";
import { buildNotice } from "./aedtContent";

/**
 * XPLAIN-002 — persistence for the AEDT notice.
 *
 * The notice CONTENT lives in ./aedtContent, which has no database dependency,
 * so it can be unit-tested and rendered without one. This module is only the
 * part that touches storage.
 */

export * from "./aedtContent";

/**
 * Record that the notice was delivered.
 *
 * Idempotent per (user, jurisdiction, version) so a re-render does not create
 * duplicate rows, and so the ORIGINAL delivery timestamp is preserved — which
 * is the one that matters for NYC's 10-business-day lead.
 */
export async function deliverAedtNotice(
  userId: string,
  jurisdiction: string | null | undefined,
  locality?: string | null
): Promise<void> {
  const notice = buildNotice(jurisdiction, { locality });
  try {
    await db
      .insert(aedtNotices)
      .values({
        userId,
        jurisdiction: notice.jurisdiction,
        noticeVersion: notice.version,
        usableFrom: notice.usableFrom,
      })
      .onConflictDoNothing();
    await audit({
      action: "legal.aedt_notice_delivered",
      actorId: userId,
      subjectType: "user",
      subjectId: userId,
      detail: { jurisdiction: notice.jurisdiction, version: notice.version, cites: notice.cites },
    });
  } catch (e) {
    console.error("[aedt] notice log failed:", (e as Error).message);
  }
}

/**
 * NYC AC-2 — has the 10-business-day lead elapsed?
 *
 * Returns true when there is no lead requirement, which is every jurisdiction
 * except NYC today. Callers use this to decide whether a screening-tier
 * assessment may run, not whether a suggestion may be shown.
 */
export async function noticePeriodSatisfied(userId: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(aedtNotices)
    .where(and(eq(aedtNotices.userId, userId), eq(aedtNotices.noticeVersion, CURRENT_AEDT_NOTICE)));
  if (rows.length === 0) return false;
  return rows.every((r) => !r.usableFrom || r.usableFrom.getTime() <= Date.now());
}
