import { and, eq } from "drizzle-orm";
import { db, privacyRequests, type PrivacyRequestKind } from "@/db";
import { audit } from "./audit";

/**
 * LEGAL-001 — privacy request intake and SLA.
 *
 * Deliberately extends every right to every user in every state, rather than
 * gating on residence. Two reasons, one principled and one practical: giving
 * people different rights based on their address is hard to defend, and the
 * threshold question of whether Jobsy's candidates are "consumers" or exempt
 * "job applicants" under most state acts is genuinely unresolved. Building to
 * the conservative reading costs a little; being wrong costs the company.
 */

/** Statutory response windows. Opt-outs are faster everywhere that has them. */
export const SLA_DAYS: Record<PrivacyRequestKind, number> = {
  ACCESS: 45,
  EXPORT: 45,
  DELETE: 45,
  CORRECT: 45,
  OPT_OUT_PROFILING: 15,
  LIMIT_SENSITIVE: 15,
  // Colorado SB 26-189 requires an adverse-decision explanation within 30 days,
  // which is the binding constraint on human review.
  HUMAN_REVIEW: 30,
};

export type OpenArgs = {
  userId: string;
  kind: PrivacyRequestKind;
  jurisdiction?: string | null;
  detail?: string | null;
};

/**
 * Open a request and start its clock.
 *
 * The due date is computed at intake and stored, not derived at read time, so
 * a later change to SLA_DAYS cannot retroactively make an overdue request look
 * on time. That property matters precisely when someone is auditing you.
 */
export async function openRequest(a: OpenArgs): Promise<{ id: string; dueAt: Date }> {
  const days = SLA_DAYS[a.kind];
  const dueAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const [row] = await db
    .insert(privacyRequests)
    .values({
      userId: a.userId,
      kind: a.kind,
      jurisdiction: a.jurisdiction ?? null,
      detail: a.detail ?? null,
      dueAt,
    })
    .returning({ id: privacyRequests.id, dueAt: privacyRequests.dueAt });

  await audit({
    action: "privacy.request_created",
    actorId: a.userId,
    subjectType: "privacy_request",
    subjectId: row!.id,
    detail: { kind: a.kind, dueAt: dueAt.toISOString(), jurisdiction: a.jurisdiction },
  });

  return { id: row!.id, dueAt: row!.dueAt };
}

export async function completeRequest(
  id: string,
  outcome: string,
  actorId?: string
): Promise<void> {
  await db
    .update(privacyRequests)
    .set({ status: "COMPLETED", outcome, completedAt: new Date() })
    .where(eq(privacyRequests.id, id));
  await audit({
    action: "privacy.request_completed",
    actorId: actorId ?? null,
    subjectType: "privacy_request",
    subjectId: id,
    detail: { outcome },
  });
}

export async function denyRequest(id: string, reason: string, actorId?: string): Promise<void> {
  await db
    .update(privacyRequests)
    .set({ status: "DENIED", denialReason: reason, completedAt: new Date() })
    .where(eq(privacyRequests.id, id));
  await audit({
    action: "privacy.request_completed",
    actorId: actorId ?? null,
    subjectType: "privacy_request",
    subjectId: id,
    detail: { denied: true, reason },
  });
}

/** Is there already an open request of this kind? Prevents duplicate clocks. */
export async function hasOpenRequest(
  userId: string,
  kind: PrivacyRequestKind
): Promise<{ id: string; dueAt: Date } | null> {
  const rows = await db
    .select({ id: privacyRequests.id, dueAt: privacyRequests.dueAt, status: privacyRequests.status })
    .from(privacyRequests)
    .where(and(eq(privacyRequests.userId, userId), eq(privacyRequests.kind, kind)))
    .limit(10);
  const open = rows.find((r) => r.status === "RECEIVED" || r.status === "IN_PROGRESS");
  return open ? { id: open.id, dueAt: open.dueAt } : null;
}

/**
 * XPLAIN-003 AC-2 — Global Privacy Control.
 *
 * In California, Colorado, Connecticut, Delaware, Maryland, Minnesota, Montana,
 * Nebraska, New Hampshire, New Jersey, Oregon and Texas a GPC signal is a valid
 * opt-out that must be honoured. The detail most implementations miss is that
 * for a matching platform it has to reach the MATCHING pipeline, not just the
 * ad stack — there is no ad stack here, and the profiling is the product.
 */
export function gpcSignalled(req: Request): boolean {
  const h = req.headers.get("sec-gpc");
  return h === "1" || h?.toLowerCase() === "true";
}
