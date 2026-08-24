import { allOrFail } from "@/lib/allOrFail";
import { NextResponse } from "next/server";
import { and, count, desc, eq, lt, sql } from "drizzle-orm";
import { db, aedtNotices, auditLog, privacyRequests, reports, users } from "@/db";
import { requirePlatformAdmin, authErrorResponse } from "@/lib/auth";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * ADMIN-006 — the compliance console.
 *
 * One screen that answers the questions a regulator, an auditor, or a nervous
 * founder actually asks: what has been requested, what is overdue, who was told
 * what, and who looked at whose data.
 */
export async function GET(req: Request) {
  let admin;
  try {
    admin = await requirePlatformAdmin();
  } catch (e) {
    return authErrorResponse(e)!;
  }

  const now = new Date();

  const [open, overdue, noticeCount, openReports, escalatedReports, optOuts] = await allOrFail([
    db
      .select()
      .from(privacyRequests)
      .where(eq(privacyRequests.status, "RECEIVED"))
      .orderBy(privacyRequests.dueAt)
      .limit(200),
    db
      .select({ n: count() })
      .from(privacyRequests)
      .where(and(eq(privacyRequests.status, "RECEIVED"), lt(privacyRequests.dueAt, now))),
    db.select({ n: count() }).from(aedtNotices),
    db.select({ n: count() }).from(reports).where(eq(reports.status, "OPEN")),
    db
      .select({ n: count() })
      .from(reports)
      .where(
        and(
          eq(reports.status, "OPEN"),
          lt(reports.createdAt, new Date(now.getTime() - 48 * 3_600_000))
        )
      ),
    db.select({ n: count() }).from(users).where(eq(users.profilingOptOut, true)),
  ]);

  // AC-6 — reading the console is itself an access to personal data, so it is
  // logged like any other.
  await audit({
    action: "admin.user_viewed",
    actorId: admin.id,
    subjectType: "compliance_console",
    detail: { openRequests: open.length },
  });

  return NextResponse.json({
    privacyRequests: {
      open: open.map((r) => ({
        id: r.id,
        kind: r.kind,
        jurisdiction: r.jurisdiction,
        requestedAt: r.requestedAt.toISOString(),
        dueAt: r.dueAt.toISOString(),
        daysRemaining: Math.floor((r.dueAt.getTime() - now.getTime()) / 86_400_000),
        overdue: r.dueAt < now,
      })),
      overdueCount: overdue[0]?.n ?? 0,
    },
    aedtNoticesDelivered: noticeCount[0]?.n ?? 0,
    profilingOptOuts: optOuts[0]?.n ?? 0,
    moderation: {
      open: openReports[0]?.n ?? 0,
      escalated: escalatedReports[0]?.n ?? 0,
    },
    notes: [
      "Access, deletion and correction requests are due within 45 days. Opt-outs within 15. Human review within 30 — Colorado's adverse-decision window is the binding constraint.",
      "Overdue requests are a compliance failure, not a backlog. Service them first.",
    ],
  });
}

/** AC-5 — AEDT notice delivery, queryable by user and jurisdiction. */
export async function POST(req: Request) {
  let admin;
  try {
    admin = await requirePlatformAdmin();
  } catch (e) {
    return authErrorResponse(e)!;
  }

  const body = (await req.json().catch(() => ({}))) as { userId?: string; jurisdiction?: string };

  const clauses = [];
  if (body.userId) clauses.push(eq(aedtNotices.userId, body.userId));
  if (body.jurisdiction) clauses.push(eq(aedtNotices.jurisdiction, body.jurisdiction));

  const rows = await db
    .select()
    .from(aedtNotices)
    .where(clauses.length ? and(...clauses) : sql`true`)
    .orderBy(desc(aedtNotices.deliveredAt))
    .limit(500);

  await audit({
    action: "admin.user_viewed",
    actorId: admin.id,
    subjectType: "aedt_notices",
    detail: { filter: body, results: rows.length },
  });

  return NextResponse.json({
    notices: rows.map((r) => ({
      userId: r.userId,
      jurisdiction: r.jurisdiction,
      version: r.noticeVersion,
      deliveredAt: r.deliveredAt.toISOString(),
      usableFrom: r.usableFrom?.toISOString() ?? null,
      leadSatisfied: !r.usableFrom || r.usableFrom <= new Date(),
    })),
  });
}
