/**
 * BR-011 / AC-014 / CAND-006 — why a recruiter passed on a candidate.
 *
 * Its own module, deliberately, and with no imports.
 *
 * These constants are needed in three places that cannot share code freely: the
 * database schema, the API validator, and a `"use client"` component. Declaring
 * them in src/lib/swipe.ts meant the recruiter deck imported that file into the
 * browser bundle — and swipe.ts imports the database client, so the whole ORM
 * and connection layer followed it into the client build. The landing page
 * stopped rendering entirely.
 *
 * ── Why the list is closed ──
 *
 * Every value names something about the ROLE or the WORK. There is no "other"
 * and no free-text field, and that is the point rather than an omission: an
 * open box on a rejection is where unlawful reasoning gets written down, and
 * prose can be neither aggregated nor audited. A fixed vocabulary can be — so a
 * recruiter whose passes cluster suspiciously is a query, not a rumour.
 *
 * Adding a value here is a compliance decision, not a copy change.
 */
export const REJECTION_REASONS = [
  "SKILLS_GAP",
  "EXPERIENCE_LEVEL",
  "COMPENSATION_MISMATCH",
  "WORK_MODEL_MISMATCH",
  "LOCATION_MISMATCH",
  "ROLE_FILLED",
  "NOT_A_FIT_FOR_THIS_ROLE",
] as const;

export type RejectionReason = (typeof REJECTION_REASONS)[number];

export const REJECTION_REASON_LABEL: Record<RejectionReason, string> = {
  SKILLS_GAP: "Missing skills this role requires",
  EXPERIENCE_LEVEL: "Experience level doesn't match the role",
  COMPENSATION_MISMATCH: "Compensation expectations don't align",
  WORK_MODEL_MISMATCH: "Remote/onsite arrangement doesn't work",
  LOCATION_MISMATCH: "Location doesn't work for this role",
  ROLE_FILLED: "Role is filled or on hold",
  NOT_A_FIT_FOR_THIS_ROLE: "Not the right fit for this role",
};
