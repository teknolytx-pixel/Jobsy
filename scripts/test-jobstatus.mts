#!/usr/bin/env tsx
/**
 * FSD §8.1 / APP-007 / BR-013 / AC-013 — the job lifecycle.
 *
 * Pure tests: the transition table and the two predicates carry all the
 * judgement, and none of it needs a database.
 */
const {
  JOB_STATUSES,
  acceptsApplications,
  applyRefusalReason,
  canTransition,
  isPubliclyReadable,
  isVisible,
  transitionError,
} = await import("../src/lib/jobStatus");
type JobStatus = import("../src/lib/jobStatus").JobStatus;

let pass = 0,
  fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

console.log("\nJOB LIFECYCLE\n");

check("TC-JS-01 five states, as specified",
  JOB_STATUSES.length === 5, JOB_STATUSES.join(","));

check("TC-JS-02 only a published role is visible",
  JOB_STATUSES.filter(isVisible).join(",") === "PUBLISHED");

// The bug this whole feature exists for: a closed posting merely dropped out of
// the deck, and a direct POST /api/swipe still created an application.
check("TC-JS-03 a closed role refuses applications",
  acceptsApplications("CLOSED") === false);
check("TC-JS-04 a paused role refuses applications",
  acceptsApplications("PAUSED") === false);
check("TC-JS-05 a draft refuses applications",
  acceptsApplications("DRAFT") === false);
check("TC-JS-06 an archived role refuses applications",
  acceptsApplications("ARCHIVED") === false);
check("TC-JS-07 only a published role accepts them",
  JOB_STATUSES.filter(acceptsApplications).join(",") === "PUBLISHED");

// A closed role keeps its public link alive — candidates who applied still have
// a URL that resolves, and inbound links from job boards do not rot.
check("TC-JS-08 a closed role stays readable at its public URL",
  isPubliclyReadable("CLOSED") === true);
check("TC-JS-09 an archived role does not",
  isPubliclyReadable("ARCHIVED") === false);
check("TC-JS-10 a draft is not public",
  isPubliclyReadable("DRAFT") === false);

console.log("\nTRANSITIONS\n");

check("TC-JS-20 draft can be published", canTransition("DRAFT", "PUBLISHED"));
check("TC-JS-21 published can be paused", canTransition("PUBLISHED", "PAUSED"));
check("TC-JS-22 paused can be republished", canTransition("PAUSED", "PUBLISHED"));
check("TC-JS-23 closed can be reopened", canTransition("CLOSED", "PUBLISHED"));

// Going back to draft would hide a posting people have already applied to, and
// leave those applications pointing at something that claims never to have run.
check("TC-JS-24 a published role cannot return to draft",
  canTransition("PUBLISHED", "DRAFT") === false);
check("TC-JS-25 the refusal explains itself",
  /cannot go back to draft/i.test(transitionError("PUBLISHED", "DRAFT") ?? ""),
  transitionError("PUBLISHED", "DRAFT") ?? "");

// Archiving is terminal on purpose: un-archiving resurrects a role whose
// applicants have already been told it is over.
check("TC-JS-26 archiving is permanent",
  JOB_STATUSES.every((s) => s === "ARCHIVED" || !canTransition("ARCHIVED", s as JobStatus)));
check("TC-JS-27 the permanence is explained",
  /permanent/i.test(transitionError("ARCHIVED", "PUBLISHED") ?? ""),
  transitionError("ARCHIVED", "PUBLISHED") ?? "");

check("TC-JS-28 every state can be archived",
  JOB_STATUSES.filter((s) => s !== "ARCHIVED").every((s) => canTransition(s as JobStatus, "ARCHIVED")));

check("TC-JS-29 a no-op write is not an error",
  JOB_STATUSES.every((s) => canTransition(s as JobStatus, s as JobStatus)));
check("TC-JS-30 a legal transition reports no error",
  transitionError("PUBLISHED", "CLOSED") === null);

console.log("\nREFUSAL MESSAGES\n");

// A candidate reads these. "Job not found" would be a lie — the job exists, it
// just stopped taking people.
check("TC-JS-40 closed says closed",
  /closed/i.test(applyRefusalReason("CLOSED") ?? ""), applyRefusalReason("CLOSED") ?? "");
check("TC-JS-41 paused says on hold",
  /hold/i.test(applyRefusalReason("PAUSED") ?? ""), applyRefusalReason("PAUSED") ?? "");
check("TC-JS-42 a live role gives no refusal",
  applyRefusalReason("PUBLISHED") === null);
check("TC-JS-43 every refusing state has a message",
  JOB_STATUSES.filter((s) => !acceptsApplications(s as JobStatus))
    .every((s) => (applyRefusalReason(s as JobStatus) ?? "").length > 10));

console.log(`\n${pass} passed, ${fail} failed  —  job lifecycle\n`);
process.exit(fail ? 1 : 0);
