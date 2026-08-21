/**
 * APP-003 / APP-004 / BR-012 — the application lifecycle.
 *
 * `application_events` has existed since the schema was written — with
 * `fromStatus`, `toStatus`, `actorId` and `note` — and **nothing has ever
 * written a row to it**. Status was frozen at creation: an application was
 * SUBMITTED or REDIRECTED forever, no API could move it, and the recruiter saw
 * a count and a one-off email rather than a list.
 *
 * The consequence for a candidate is the one that matters. `/applied` showed a
 * status that could never change, so "did anyone look at this?" was
 * unanswerable — which is the single most common complaint about applying for
 * jobs anywhere, and the product had the table to fix it and never wired it up.
 *
 * ── Independent of matching (BR-012) ──
 *
 * These statuses describe an APPLICATION. A match is a separate thing with its
 * own lifecycle, and moving one must never move the other: a recruiter can
 * reject an application from someone they are still talking to, and a match can
 * go quiet without the application changing.
 */
import { REJECTION_REASONS, type RejectionReason } from "./rejectionReasons";

export const APPLICATION_STATUSES = [
  "SUBMITTED",
  "REDIRECTED",
  "VIEWED",
  "INTERVIEWING",
  "REJECTED",
  "HIRED",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** Shown to the candidate on /applied. Written to be read by them, not by us. */
export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = {
  SUBMITTED: "Submitted",
  REDIRECTED: "Applied on the company site",
  VIEWED: "Viewed by the employer",
  INTERVIEWING: "Interviewing",
  REJECTED: "Not moving forward",
  HIRED: "Hired",
};

/**
 * Transitions a RECRUITER may make.
 *
 * REDIRECTED is terminal and has no outgoing edges on purpose: the candidate
 * applied on the employer's own site, so Jobsy does not know what happened next
 * and must not pretend to. Claiming "viewed" for an application we never
 * received would be inventing a fact about someone's job search.
 *
 * HIRED and REJECTED are terminal too. Reopening a rejection would mean a
 * candidate who was told "not moving forward" silently becomes active again
 * with no notification — if a decision is reversed, that is a new application.
 */
const TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  SUBMITTED: ["VIEWED", "INTERVIEWING", "REJECTED", "HIRED"],
  VIEWED: ["INTERVIEWING", "REJECTED", "HIRED"],
  INTERVIEWING: ["REJECTED", "HIRED"],
  REDIRECTED: [],
  REJECTED: [],
  HIRED: [],
};

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionError(
  from: ApplicationStatus,
  to: ApplicationStatus
): string | null {
  if (canTransition(from, to)) return null;
  if (from === "REDIRECTED") {
    return "This candidate applied on your own site, so Jobsy can't track its progress.";
  }
  if (from === "REJECTED" || from === "HIRED") {
    return `This application is already marked "${APPLICATION_STATUS_LABEL[from]}" and can't be reopened.`;
  }
  return `An application can't go from ${APPLICATION_STATUS_LABEL[from].toLowerCase()} to ${APPLICATION_STATUS_LABEL[to].toLowerCase()}.`;
}

/**
 * BR-011 again, in the other place a rejection happens.
 *
 * Passing on a candidate in the deck already requires a job-related reason.
 * Rejecting their application is the same act with higher stakes — they
 * actually applied — so it takes the same fixed vocabulary rather than a free
 * text box, and for the same reason: prose cannot be audited.
 */
export function requiresReason(to: ApplicationStatus): boolean {
  return to === "REJECTED";
}

export function isValidReason(r: string | null | undefined): r is RejectionReason {
  return typeof r === "string" && (REJECTION_REASONS as readonly string[]).includes(r);
}
