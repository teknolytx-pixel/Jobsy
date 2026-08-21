#!/usr/bin/env tsx
/**
 * APP-003 / APP-004 / BR-011 / BR-012 — the application lifecycle.
 *
 * `application_events` existed unused since the schema was written, and status
 * was frozen at creation. The transitions below are the rules that were never
 * written down anywhere, because nothing could move an application at all.
 */
const {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABEL,
  canTransition,
  isValidReason,
  requiresReason,
  transitionError,
} = await import("../src/lib/applicationStatus");
type ApplicationStatus = import("../src/lib/applicationStatus").ApplicationStatus;

let pass = 0,
  fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

console.log("\nAPPLICATION LIFECYCLE\n");

check("TC-APS-01 six statuses", APPLICATION_STATUSES.length === 6, APPLICATION_STATUSES.join(","));
check("TC-APS-02 every status has a candidate-readable label",
  APPLICATION_STATUSES.every((s) => (APPLICATION_STATUS_LABEL[s as ApplicationStatus] ?? "").length > 3));

check("TC-APS-10 submitted can be viewed", canTransition("SUBMITTED", "VIEWED"));
check("TC-APS-11 viewed can move to interviewing", canTransition("VIEWED", "INTERVIEWING"));
check("TC-APS-12 interviewing can end either way",
  canTransition("INTERVIEWING", "HIRED") && canTransition("INTERVIEWING", "REJECTED"));

// Going backwards would let a recruiter un-view an application, which is a
// claim about the past rather than a state change.
check("TC-APS-13 interviewing cannot go back to viewed",
  canTransition("INTERVIEWING", "VIEWED") === false);
check("TC-APS-14 viewed cannot go back to submitted",
  canTransition("VIEWED", "SUBMITTED") === false);

// Jobsy never received these — the candidate applied on the employer's site.
// Claiming to know what happened next would be inventing a fact about someone's
// job search.
check("TC-APS-20 a redirected application is terminal",
  APPLICATION_STATUSES.every((s) => s === "REDIRECTED" || !canTransition("REDIRECTED", s as ApplicationStatus)));
check("TC-APS-21 and it says why",
  /own site/i.test(transitionError("REDIRECTED", "VIEWED") ?? ""),
  transitionError("REDIRECTED", "VIEWED") ?? "");

// Reopening a rejection would silently reactivate someone who was told they
// were out, with no notification. That is a new application, not an edit.
check("TC-APS-22 a rejection cannot be reopened",
  canTransition("REJECTED", "INTERVIEWING") === false);
check("TC-APS-23 nor can a hire",
  canTransition("HIRED", "REJECTED") === false);
check("TC-APS-24 both explain themselves",
  /can't be reopened/i.test(transitionError("REJECTED", "VIEWED") ?? "") &&
    /can't be reopened/i.test(transitionError("HIRED", "VIEWED") ?? ""));

check("TC-APS-25 a no-op is not an error",
  APPLICATION_STATUSES.every((s) => canTransition(s as ApplicationStatus, s as ApplicationStatus)));

console.log("\nREJECTION NEEDS A REASON\n");

check("TC-APS-30 rejecting requires one", requiresReason("REJECTED") === true);
check("TC-APS-31 nothing else does",
  APPLICATION_STATUSES.filter((s) => requiresReason(s as ApplicationStatus)).join(",") === "REJECTED");
check("TC-APS-32 a valid reason is accepted", isValidReason("SKILLS_GAP") === true);
check("TC-APS-33 prose is not a reason", isValidReason("didn't like them") === false);
check("TC-APS-34 nor is an empty one", isValidReason(null) === false && isValidReason(undefined) === false);

console.log(`\n${pass} passed, ${fail} failed  —  application lifecycle\n`);
process.exit(fail ? 1 : 0);
