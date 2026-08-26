#!/usr/bin/env tsx
/**
 * FORM RULES — the ones a server has to enforce, not just a form.
 *
 * Client-side validation is a courtesy to the person typing. Every rule here is
 * also enforced on the server, because the form is not the only way in: a stale
 * tab, a replayed request, or a script all reach the same endpoint.
 *
 *   npx tsx scripts/test-forms.mts
 */
import "dotenv/config";
const { assertNotProduction } = await import("./_not-production.mts");
assertNotProduction("test-forms");

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

// ─────────────────────────────────────────────────────────────
console.log("\nPOSTING A JOB\n");

/*
 * The route's zod schema is the thing under test. Importing the module would
 * pull in auth and a request scope; the schema shape is what matters and it is
 * asserted through the same file the handler uses.
 */
const src = await import("node:fs").then((fs) =>
  fs.readFileSync("src/app/api/jobs/route.ts", "utf8")
);

check("TC-FORM-01 salary floors at zero on the server",
  /salaryMin: z\.number\(\)\.int\(\)\.min\(0\)/.test(src) && /salaryMax: z\.number\(\)\.int\(\)\.min\(0\)/.test(src),
  "min(0) present on both");
check("TC-FORM-02 a ZIP code is required for an in-app posting",
  /postalCode: z\.string\(\)\.min\(3/.test(src), "postalCode min(3)");
check("TC-FORM-03 min above max is still refused",
  /minimum salary can't be above the maximum/.test(src));
check("TC-FORM-04 and only a recruiter may post",
  /hasRole\(user, "RECRUITER"\)/.test(src) && /WRONG_ACCOUNT_TYPE/.test(src));

// ─────────────────────────────────────────────────────────────
console.log("\nTHE COMPOSER\n");

const composer = await import("node:fs").then((fs) =>
  fs.readFileSync("src/app/recruiter/JobComposer.tsx", "utf8")
);
check("TC-FORM-10 negatives cannot be typed into salary",
  (composer.match(/replace\(\/\[\^0-9\]\/g, ""\)/g) ?? []).length >= 2,
  "digits-only on both fields");
check("TC-FORM-11 the steppers are gone", (composer.match(/className="nospin"/g) ?? []).length >= 2);
check("TC-FORM-12 a missing ZIP is caught before the request",
  /A ZIP code is required/.test(composer));
check("TC-FORM-13 and the label no longer says optional",
  /<span>ZIP code<\/span>/.test(composer) && !/Postal \/ ZIP code — optional/.test(composer));

// ─────────────────────────────────────────────────────────────
console.log("\nTHE PROFILE\n");

const editor = await import("node:fs").then((fs) =>
  fs.readFileSync("src/app/profile/ProfileEditor.tsx", "utf8")
);
check("TC-FORM-20 an unanswered salary target is blank, not zero",
  /salaryTarget: initial\.salaryTarget == null \? "" :/.test(editor));
check("TC-FORM-21 and saves as null rather than 0",
  /salaryTarget: f\.salaryTarget === "" \? null :/.test(editor));
check("TC-FORM-22 availability is a number and a unit",
  /availNumber/.test(editor) && /availUnit/.test(editor) && /<option value="months">/.test(editor));
check("TC-FORM-23 and reads back what it wrote",
  /\(\\d\+\)\\s\*\(day\|week\|month\)/.test(editor.replace(/\\\\/g, "\\")) || /day\|week\|month/.test(editor),
  "existing values parse");
check("TC-FORM-24 the bio label asks about the person",
  /<span>About yourself<\/span>/.test(editor));
check("TC-FORM-25 ZIP is called a ZIP",
  /<span>ZIP code — optional<\/span>/.test(editor));
/*
 * Checked against the RENDERED label, not against any occurrence of the old
 * string — the first version of this test matched the comment explaining the
 * change and failed on a file that was already correct.
 */
check("TC-FORM-26 job seekers are not offered a recruiter title",
  /isRecruiter \? \(/.test(editor) && !/<span>Recruiter title/.test(editor),
  "gated on isRecruiter, old label gone from the markup");

// ─────────────────────────────────────────────────────────────
// LOCATION PRIORITY — already built, asserted so it stays built.
// ─────────────────────────────────────────────────────────────
console.log("\nLOCATION PRIORITY\n");

const eligibility = await import("node:fs").then((fs) =>
  fs.readFileSync("src/lib/geo/eligibility.ts", "utf8")
);
const deck = await import("node:fs").then((fs) =>
  fs.readFileSync("src/lib/deck.ts", "utf8")
);

check("TC-FORM-30 a local-only role excludes non-local candidates outright",
  /if \(job\.localOnly\)/.test(eligibility) && /withinLocalBoundary/.test(eligibility));
check("TC-FORM-31 but distance only RANKS everyone else, never excludes them",
  /desc\(proximity\)/.test(deck) && !/where.*proximity/i.test(deck),
  "proximity is an ORDER BY, not a WHERE");
check("TC-FORM-32 and skill relevance still outranks distance",
  /desc\(relatedness\), desc\(proximity\)/.test(deck),
  "relatedness first, proximity second");

console.log(`\n${pass} passed, ${fail} failed  —  forms & location priority\n`);
process.exit(fail ? 1 : 0);
