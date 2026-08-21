import { db, auditLog } from "@/db";

/**
 * LEGAL-012 / TRUST-008 — append-only audit trail.
 *
 * Written for every compliance-relevant event: terms acceptance, AEDT notice
 * delivery, privacy requests, profiling opt-outs, human-review requests and
 * outcomes, admin access to personal data, recruiter searches, and security
 * events.
 *
 * Rows are never updated and never deleted. If something needs correcting, a
 * new row records the correction — an audit log you can edit is not evidence.
 */

export type AuditAction =
  // security
  | "auth.login.success"
  | "auth.login.failed"
  | "auth.signup"
  | "auth.logout"
  | "auth.email_verified"
  | "auth.password_reset_requested"
  | "auth.password_reset_completed"
  | "auth.password_changed"
  | "auth.sessions_revoked"
  | "auth.rate_limited"
  | "auth.permission_denied"
  // compliance
  | "legal.terms_accepted"
  | "legal.aedt_notice_delivered"
  | "privacy.request_created"
  | "privacy.request_completed"
  | "privacy.profiling_opt_out"
  | "privacy.profiling_opt_in"
  | "privacy.export_generated"
  | "privacy.account_deleted"
  | "review.requested"
  | "review.decided"
  // moderation
  | "trust.report_filed"
  | "trust.report_resolved"
  | "trust.user_blocked"
  | "trust.user_unblocked"
  | "trust.posting_screened"
  | "trust.posting_blocked"
  // admin
  | "admin.user_viewed"
  | "admin.user_suspended"
  | "admin.user_unsuspended"
  | "admin.source_forced"
  | "admin.messages_viewed"
  // business
  | "company.created"
  | "company.verified"
  | "company.member_invited"
  | "company.member_joined"
  | "company.member_removed"
  | "job.created"
  | "job.updated"
  // ADM-003 / NFR-004 — application events were entirely absent from the audit
  // log. Account, company and job changes were recorded; the thing candidates
  // most often ask about was not.
  | "application.status_changed"
  | "job.closed"
  | "job.attested"
  | "job.auto_expired"
  | "search.candidates";

export type AuditArgs = {
  action: AuditAction;
  actorId?: string | null;
  subjectType?: string;
  subjectId?: string;
  detail?: Record<string, unknown>;
  ip?: string | null;
};

/**
 * Never throws. An audit write failing must not fail the operation it is
 * describing — a user must still be able to reset their password when the log
 * table is unavailable. Failures are surfaced loudly on stderr instead.
 */
export async function audit(a: AuditArgs): Promise<void> {
  try {
    await db.insert(auditLog).values({
      actorId: a.actorId ?? null,
      action: a.action,
      subjectType: a.subjectType ?? null,
      subjectId: a.subjectId ?? null,
      detail: a.detail ?? null,
      ip: a.ip ?? null,
    });
  } catch (e) {
    console.error("[audit] WRITE FAILED", a.action, (e as Error).message);
  }
}

/**
 * Strip anything that must never reach a log line.
 *
 * Applied to every `detail` payload assembled from a request body. Passwords,
 * tokens and cookies in an audit log turn the compliance control into the
 * breach.
 */
const FORBIDDEN = /password|token|secret|cookie|authorization|session|ssn|resume_text/i;

export function safeDetail(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (FORBIDDEN.test(k)) {
      out[k] = "[redacted]";
    } else if (typeof v === "string" && v.length > 500) {
      out[k] = `${v.slice(0, 500)}…[truncated]`;
    } else {
      out[k] = v;
    }
  }
  return out;
}
