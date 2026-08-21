import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { applicationEvents, applications, db, jobs } from "@/db";
import { AuthError, authErrorResponse, requireRole } from "@/lib/auth";
import { audit, safeDetail } from "@/lib/audit";
import {
  APPLICATION_STATUSES,
  canTransition,
  isValidReason,
  requiresReason,
  transitionError,
  type ApplicationStatus,
} from "@/lib/applicationStatus";
import { REJECTION_REASONS } from "@/lib/rejectionReasons";

export const dynamic = "force-dynamic";

const Body = z.object({
  status: z.enum(APPLICATION_STATUSES),
  /** BR-011 — required when moving to REJECTED. Fixed vocabulary, not prose. */
  reason: z.enum(REJECTION_REASONS).optional(),
});

/**
 * APP-004 / ADM-003 — move an application, and record that it moved.
 *
 * The `application_events` table has existed unused since the schema was
 * written. Writing to it is what turns "the status changed" into "who changed
 * it, when, from what, and why" — which is the difference between a product
 * that can answer a candidate's question and one that cannot.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireRole("RECRUITER");
    const { id } = await ctx.params;

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid status.", allowed: APPLICATION_STATUSES },
        { status: 400 }
      );
    }

    const rows = await db
      .select({ app: applications, job: jobs })
      .from(applications)
      .innerJoin(jobs, eq(applications.jobId, jobs.id))
      .where(eq(applications.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return NextResponse.json({ error: "Application not found" }, { status: 404 });
    if (row.job.postedById !== me.id && !me.isPlatformAdmin) {
      return NextResponse.json({ error: "Not your job post" }, { status: 403 });
    }

    const from = row.app.status as ApplicationStatus;
    const to = parsed.data.status;

    if (!canTransition(from, to)) {
      return NextResponse.json(
        { error: transitionError(from, to), code: "ILLEGAL_TRANSITION" },
        { status: 400 }
      );
    }

    // Rejecting an application is the same act as passing in the deck, with
    // higher stakes — this person actually applied. Same fixed vocabulary.
    if (requiresReason(to) && !isValidReason(parsed.data.reason)) {
      return NextResponse.json(
        {
          error: "Choose a job-related reason before rejecting an application.",
          code: "REJECTION_REASON_REQUIRED",
          allowed: REJECTION_REASONS,
        },
        { status: 400 }
      );
    }

    if (from !== to) {
      await db.update(applications).set({ status: to }).where(eq(applications.id, id));
      await db.insert(applicationEvents).values({
        applicationId: id,
        fromStatus: from,
        toStatus: to,
        actorId: me.id,
        // The enum value, not free text. A note field that accepts prose on a
        // rejection is where unlawful reasoning gets written down.
        note: parsed.data.reason ?? null,
      });
      await audit({
        action: "application.status_changed",
        actorId: me.id,
        subjectType: "application",
        subjectId: id,
        detail: safeDetail({ from, to, reason: parsed.data.reason ?? null }),
      });
    }

    return NextResponse.json({ ok: true, status: to, changed: from !== to });
  } catch (e) {
    const status = e instanceof AuthError ? 401 : 400;
    return authErrorResponse(e) ?? NextResponse.json({ error: (e as Error).message }, { status });
  }
}
