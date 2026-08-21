/**
 * FSD §8.1 / APP-007 / BR-013 / AC-013 — the job lifecycle.
 *
 * A posting used to be a boolean: `jobs.active`, true or false. That collapsed
 * five distinct situations into two, and the one it collapsed most damagingly
 * was the difference between "stop showing this" and "stop accepting people".
 * Nothing checked the flag at apply time, so a direct `POST /api/swipe` against
 * a job the employer had closed still created an application — the posting had
 * merely dropped out of the deck.
 *
 * `active` is kept and is now DERIVED from status (see `isVisible`), so the
 * eleven existing call sites that ask "should this appear anywhere" keep
 * working unchanged. Status is the source of truth; active is its shadow.
 */

export const JOB_STATUSES = [
  "DRAFT",
  "PUBLISHED",
  "PAUSED",
  "CLOSED",
  "ARCHIVED",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * What each state means, in the employer's words rather than the schema's.
 * These strings are shown in the UI, so they are the definition people will
 * actually act on.
 */
export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  DRAFT: "Draft — only you can see it",
  PUBLISHED: "Live — visible and accepting applications",
  PAUSED: "Paused — hidden, applications on hold",
  CLOSED: "Closed — still readable, no new applications",
  ARCHIVED: "Archived — hidden everywhere",
};

/** Appears in candidate decks, the XML feed, and public listings. */
export function isVisible(status: JobStatus): boolean {
  return status === "PUBLISHED";
}

/**
 * Accepts new applications.
 *
 * Deliberately identical to isVisible today, and deliberately a SEPARATE
 * function. BR-012 says application state and matching state are independent,
 * and the moment CLOSED is allowed to stay in a deck — which is a plausible
 * product decision — these two answers diverge. Writing one function for both
 * would make that change a search-and-replace instead of a one-line edit.
 */
export function acceptsApplications(status: JobStatus): boolean {
  return status === "PUBLISHED";
}

/** Readable at its public /j/<id> URL. A closed role keeps its link alive. */
export function isPubliclyReadable(status: JobStatus): boolean {
  return status === "PUBLISHED" || status === "CLOSED";
}

/**
 * Legal transitions.
 *
 * Not every pair makes sense, and an un-modelled lifecycle is how a posting
 * ends up back in DRAFT after people have already applied to it. ARCHIVED is
 * terminal: un-archiving would resurrect a role whose applicants have long
 * since been told it was over.
 */
const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  DRAFT: ["PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["PAUSED", "CLOSED", "ARCHIVED"],
  PAUSED: ["PUBLISHED", "CLOSED", "ARCHIVED"],
  CLOSED: ["PUBLISHED", "ARCHIVED"],
  ARCHIVED: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  if (from === to) return true; // a no-op write is not an error
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionError(from: JobStatus, to: JobStatus): string | null {
  if (canTransition(from, to)) return null;
  if (from === "ARCHIVED") {
    return "This posting is archived. Archiving is permanent — create a new posting instead.";
  }
  if (to === "DRAFT") {
    return "A posting cannot go back to draft once it has been published. Pause or close it instead.";
  }
  return `A ${from.toLowerCase()} posting cannot become ${to.toLowerCase()}.`;
}

/** Why an application was refused, in language a candidate should read. */
export function applyRefusalReason(status: JobStatus): string | null {
  if (acceptsApplications(status)) return null;
  switch (status) {
    case "CLOSED":
      return "This role has closed and is no longer accepting applications.";
    case "PAUSED":
      return "This role is on hold and is not accepting applications right now.";
    case "DRAFT":
      return "This role has not been published yet.";
    default:
      return "This role is no longer available.";
  }
}
