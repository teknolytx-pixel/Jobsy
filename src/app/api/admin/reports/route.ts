import { NextResponse } from "next/server";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db, jobs, reports, users } from "@/db";
import { requirePlatformAdmin, authErrorResponse, revokeSessions } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/**
 * ADMIN-005 — the moderation queue.
 *
 * AC-3 — every decision records who made it and why. A moderation log without
 * a rationale is a list of things that happened, not a record anyone can stand
 * behind when a decision is challenged.
 */
const DecideBody = z.object({
  reportId: z.string().min(1),
  action: z.enum(["NONE", "WARNED", "CONTENT_REMOVED", "SUSPENDED", "BANNED"]),
  status: z.enum(["REVIEWING", "ACTIONED", "DISMISSED"]),
  note: z.string().min(1).max(4000),
});

export async function GET(req: Request) {
  let admin;
  try {
    admin = await requirePlatformAdmin();
  } catch (e) {
    return authErrorResponse(e)!;
  }

  const status = new URL(req.url).searchParams.get("status") ?? "OPEN";
  const rows = await db
    .select()
    .from(reports)
    .where(eq(reports.status, status as never))
    .orderBy(desc(reports.createdAt))
    .limit(200);

  const now = Date.now();
  return NextResponse.json({
    reports: rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      // AC-5 — anything older than 48 hours is escalated visibly, so a queue
      // nobody is watching cannot look calm.
      ageHours: Math.round((now - r.createdAt.getTime()) / 3_600_000),
      escalated: now - r.createdAt.getTime() > 48 * 3_600_000,
    })),
  });
}

export async function PUT(req: Request) {
  const ip = clientIp(req);
  let admin;
  try {
    admin = await requirePlatformAdmin();
  } catch (e) {
    return authErrorResponse(e)!;
  }

  const parsed = DecideBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "A note explaining the decision is required" },
      { status: 400 }
    );
  }

  const rows = await db.select().from(reports).where(eq(reports.id, parsed.data.reportId)).limit(1);
  const report = rows[0];
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

  await db
    .update(reports)
    .set({
      status: parsed.data.status,
      action: parsed.data.action,
      resolvedById: admin.id,
      resolutionNote: parsed.data.note,
      resolvedAt: parsed.data.status === "REVIEWING" ? null : new Date(),
    })
    .where(eq(reports.id, report.id));

  // AC-2 — carry out what was decided, rather than only recording it.
  if (parsed.data.action === "CONTENT_REMOVED" && report.kind === "JOB") {
    await db.update(jobs).set({ active: false }).where(eq(jobs.id, report.targetId));
  }
  if (parsed.data.action === "SUSPENDED" || parsed.data.action === "BANNED") {
    const targetUserId =
      report.kind === "USER"
        ? report.targetId
        : ((report.snapshot as { target?: { postedById?: string; senderId?: string } } | null)
            ?.target?.postedById ??
          (report.snapshot as { target?: { senderId?: string } } | null)?.target?.senderId ??
          null);

    if (targetUserId) {
      await db
        .update(users)
        .set({ suspendedAt: new Date(), openToOffers: false, updatedAt: new Date() })
        .where(eq(users.id, targetUserId));
      await revokeSessions(targetUserId);
      await audit({
        action: "admin.user_suspended",
        actorId: admin.id,
        subjectType: "user",
        subjectId: targetUserId,
        detail: { reportId: report.id, action: parsed.data.action, note: parsed.data.note },
        ip,
      });
    }
  }

  await audit({
    action: "trust.report_resolved",
    actorId: admin.id,
    subjectType: "report",
    subjectId: report.id,
    detail: { action: parsed.data.action, status: parsed.data.status, note: parsed.data.note },
    ip,
  });

  return NextResponse.json({ ok: true });
}
