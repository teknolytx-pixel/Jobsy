#!/usr/bin/env tsx
/**
 * Unit suite for the compliance modules.
 *
 * Maps to the QA matrix: TC-LEGAL-002-*, TC-TRUST-004-*, TC-LOC-001-*,
 * TC-XPLAIN-002-*. Every case here corresponds to a numbered acceptance
 * criterion in the PRD, and the failure message names it.
 */
import assert from "node:assert/strict";

// Dynamic import, matching the convention in test-matching.mts. A .mts entry is
// true ESM while the app's .ts modules transpile to CJS, so a static named
// import fails to link — destructuring a dynamic import interops correctly.
const { detectJurisdiction, stateOf } = await import("../src/lib/compliance/jurisdiction");
const { checkPayTransparency, crawledPayLabel } = await import(
  "../src/lib/compliance/payTransparency"
);
const { screenPosting, explainScreen } = await import("../src/lib/compliance/contentScreen");
const { buildNotice, NEVER_USED } = await import("../src/lib/compliance/aedtContent");
const { screenForScam } = await import("../src/lib/compliance/scamScreen");

let pass = 0;
let fail = 0;
const failures: string[] = [];

function t(id: string, name: string, fn: () => void) {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    failures.push(`${id}  ${name}\n      ${(e as Error).message.split("\n")[0]}`);
  }
}

const NOW = new Date("2026-08-19T00:00:00Z");

// ═══════════════════════════════════════════════════════════════
// LOC-001 / jurisdiction detection
// ═══════════════════════════════════════════════════════════════
t("TC-LOC-001-01", "two-letter state code", () => {
  assert.equal(stateOf("Austin, TX"), "TX");
});
t("TC-LOC-001-02", "full state name", () => {
  assert.equal(stateOf("somewhere in California"), "CA");
});
t("TC-LOC-001-03", "city implies state", () => {
  assert.equal(stateOf("Seattle"), "WA");
});
t("TC-LOC-001-04", "metro alias resolves", () => {
  assert.equal(stateOf("San Francisco Bay Area"), "CA");
});
t("TC-LOC-001-05", "NYC locality detected alongside state", () => {
  const j = detectJurisdiction("New York, NY");
  assert.equal(j.state, "NY");
  assert.equal(j.locality, "NYC");
});
t("TC-LOC-001-06", "unknown location is unknown, never a mismatch", () => {
  const j = detectJurisdiction("Somewhere Made Up");
  assert.equal(j.state, null);
  assert.equal(j.unknown, true);
});
t("TC-LOC-001-07", "empty location does not throw", () => {
  assert.equal(detectJurisdiction("").unknown, true);
  assert.equal(detectJurisdiction(null).unknown, true);
});
t("TC-LOC-001-08", "'IN' inside Indianapolis is not read as Indiana's code", () => {
  // Word-bounded matching: the substring must not win over the city lookup.
  assert.equal(stateOf("Indianapolis"), "IN");
  assert.equal(stateOf("Working in a startup"), null);
});
t("TC-LOC-001-09", "longest city match wins — Kansas City, MO not Kansas", () => {
  assert.equal(stateOf("Kansas City, MO"), "MO");
});
t("TC-LOC-001-10", "remote flag is carried through", () => {
  assert.equal(detectJurisdiction("Austin, TX", "REMOTE").remoteNationwide, true);
  assert.equal(detectJurisdiction("Austin, TX", "ONSITE").remoteNationwide, false);
});
t("TC-LOC-001-11", "Jersey City resolves to the locality, not just NJ", () => {
  const j = detectJurisdiction("Jersey City, NJ");
  assert.equal(j.state, "NJ");
  assert.equal(j.locality, "JERSEY_CITY_NJ");
});
t("TC-LOC-001-12", "Washington DC is DC, not Washington State", () => {
  assert.equal(stateOf("Washington, DC"), "DC");
});

// ═══════════════════════════════════════════════════════════════
// LEGAL-002 / pay transparency
// ═══════════════════════════════════════════════════════════════
const noPay = { salaryMin: null, salaryMax: null, now: NOW };

t("TC-LEGAL-002-01", "California blocked without a range", () => {
  const r = checkPayTransparency({ location: "San Francisco, CA", ...noPay });
  assert.equal(r.ok, false);
  assert.ok(r.problems.includes("SALARY_RANGE_REQUIRED"));
  assert.match(r.message!, /432\.3/);
});
t("TC-LEGAL-002-02", "Colorado blocked", () => {
  assert.equal(checkPayTransparency({ location: "Denver, CO", ...noPay }).ok, false);
});
t("TC-LEGAL-002-03", "Illinois blocked", () => {
  assert.equal(checkPayTransparency({ location: "Chicago, IL", ...noPay }).ok, false);
});
t("TC-LEGAL-002-04", "New York blocked", () => {
  assert.equal(checkPayTransparency({ location: "Buffalo, NY", ...noPay }).ok, false);
});
t("TC-LEGAL-002-05", "Washington requires a benefits description too", () => {
  const r = checkPayTransparency({
    location: "Seattle, WA",
    salaryMin: 120,
    salaryMax: 160,
    now: NOW,
  });
  assert.equal(r.ok, false);
  assert.ok(r.problems.includes("BENEFITS_REQUIRED"));
});
t("TC-LEGAL-002-06", "Washington passes with range AND benefits", () => {
  const r = checkPayTransparency({
    location: "Seattle, WA",
    salaryMin: 120,
    salaryMax: 160,
    benefitsDescription: "Medical, dental, 401k with 4% match, 20 days PTO.",
    now: NOW,
  });
  assert.equal(r.ok, true);
});
t("TC-LEGAL-002-07", "Minnesota requires benefits", () => {
  const r = checkPayTransparency({
    location: "Minneapolis, MN",
    salaryMin: 100,
    salaryMax: 130,
    now: NOW,
  });
  assert.ok(r.problems.includes("BENEFITS_REQUIRED"));
});
t("TC-LEGAL-002-08", "Connecticut in force from 1 Oct 2026, not before", () => {
  const before = checkPayTransparency({
    location: "Hartford, CT",
    ...noPay,
    now: new Date("2026-09-30T00:00:00Z"),
  });
  const after = checkPayTransparency({
    location: "Hartford, CT",
    ...noPay,
    now: new Date("2026-10-01T00:00:00Z"),
  });
  assert.equal(before.ok, true, "CT should not bite before 1 Oct 2026");
  assert.equal(after.ok, false, "CT should bite from 1 Oct 2026");
});
t("TC-LEGAL-002-09", "Virginia in force from 1 Jul 2026", () => {
  assert.equal(checkPayTransparency({ location: "Richmond, VA", ...noPay }).ok, false);
  assert.equal(
    checkPayTransparency({
      location: "Richmond, VA",
      ...noPay,
      now: new Date("2026-06-30T00:00:00Z"),
    }).ok,
    true
  );
});
t("TC-LEGAL-002-10", "Maine in force from 29 Jul 2026", () => {
  assert.equal(checkPayTransparency({ location: "Portland, ME", ...noPay }).ok, false);
});
t("TC-LEGAL-002-11", "Delaware NOT in force until Sep 2027", () => {
  assert.equal(checkPayTransparency({ location: "Wilmington, DE", ...noPay }).ok, true);
});
t("TC-LEGAL-002-12", "NYC locality rule applies on top of NY", () => {
  const r = checkPayTransparency({ location: "New York, NY", ...noPay });
  assert.equal(r.ok, false);
  const scopes = r.applicable.map((a) => a.scope);
  assert.ok(scopes.includes("NY"), "state rule");
  assert.ok(scopes.includes("NYC"), "locality rule");
});
t("TC-LEGAL-002-13", "remote role is covered — could be performed in a covered state", () => {
  const r = checkPayTransparency({ location: "Remote, US", remote: "REMOTE", ...noPay });
  assert.equal(r.ok, false);
  assert.ok(r.applicable.length > 5, "many state rules apply to a nationwide remote role");
  assert.match(r.message!, /remote/i);
});
t("TC-LEGAL-002-14", "Texas permits no range", () => {
  assert.equal(checkPayTransparency({ location: "Austin, TX", ...noPay }).ok, true);
});
t("TC-LEGAL-002-15", "Nevada is disclosure-on-request, NOT a posting mandate", () => {
  assert.equal(
    checkPayTransparency({ location: "Las Vegas, NV", ...noPay }).ok,
    true,
    "regression: NV must not be treated as a posting mandate"
  );
});
t("TC-LEGAL-002-16", "Rhode Island is not a posting mandate", () => {
  assert.equal(checkPayTransparency({ location: "Providence, RI", ...noPay }).ok, true);
});
t("TC-LEGAL-002-17", "Cincinnati is not a posting mandate", () => {
  assert.equal(checkPayTransparency({ location: "Cincinnati, OH", ...noPay }).ok, true);
});
t("TC-LEGAL-002-18", "crawled postings are labelled, never blocked", () => {
  const r = checkPayTransparency({
    location: "San Francisco, CA",
    ...noPay,
    consentSource: "CRAWLED",
  });
  assert.equal(r.ok, true, "a crawled posting is the employer's content, not ours");
});
t("TC-LEGAL-002-19", "crawled label names the missing data and links out", () => {
  const label = crawledPayLabel({ salaryMin: null, salaryMax: null, sourceUrl: "https://x.test/j" });
  assert.match(label!, /not disclosed by the employer/i);
  assert.match(label!, /original posting/i);
});
t("TC-LEGAL-002-20", "crawled label absent when pay IS present", () => {
  assert.equal(crawledPayLabel({ salaryMin: 100, salaryMax: 140, sourceUrl: null }), null);
});
t("TC-LEGAL-002-21", "inverted range is caught", () => {
  const r = checkPayTransparency({ location: "Chicago, IL", salaryMin: 200, salaryMax: 100, benefitsDescription: "Health", now: NOW });
  assert.ok(r.problems.includes("RANGE_INVALID"));
});
t("TC-LEGAL-002-22", "employee count below the threshold exempts", () => {
  // Massachusetts is 25+; a 10-person employer is outside it.
  const r = checkPayTransparency({ location: "Boston, MA", ...noPay, employeeCount: 10 });
  assert.equal(r.ok, true);
});
t("TC-LEGAL-002-23", "unknown employee count is treated as covered", () => {
  const r = checkPayTransparency({ location: "Boston, MA", ...noPay, employeeCount: null });
  assert.equal(r.ok, false, "erring toward compliance when headcount is unknown");
});
t("TC-LEGAL-002-24", "Colorado reaches a single employee", () => {
  const r = checkPayTransparency({ location: "Boulder, CO", ...noPay, employeeCount: 1 });
  assert.equal(r.ok, false);
});
t("TC-LEGAL-002-25", "the message names the law, not just the requirement", () => {
  const r = checkPayTransparency({ location: "Chicago, IL", ...noPay });
  assert.match(r.message!, /820 ILCS/);
  assert.match(r.message!, /legal requirement/i);
});

// ═══════════════════════════════════════════════════════════════
// TRUST-004 / discriminatory content
// ═══════════════════════════════════════════════════════════════
const jd = (description: string, title = "Software Engineer") => ({ title, description, perks: [] });

t("TC-TRUST-004-01", "'recent graduates only' blocks", () => {
  const r = screenPosting(jd("Recent graduates only. Join our team."));
  assert.equal(r.ok, false);
  assert.equal(r.blocking[0]!.category, "AGE");
});
t("TC-TRUST-004-02", "'digital native' blocks", () => {
  assert.equal(screenPosting(jd("Looking for a digital native to own social.")).ok, false);
});
t("TC-TRUST-004-03", "'young and energetic' blocks", () => {
  assert.equal(screenPosting(jd("We are a young and energetic team.")).ok, false);
});
t("TC-TRUST-004-04", "explicit maximum age blocks", () => {
  assert.equal(screenPosting(jd("Candidates must be under 35 years old.")).ok, false);
});
t("TC-TRUST-004-05", "capped years of experience blocks as an age proxy", () => {
  assert.equal(screenPosting(jd("No more than 5 years experience please.")).ok, false);
});
t("TC-TRUST-004-06", "graduation year requirement blocks", () => {
  assert.equal(screenPosting(jd("Graduated between 2018 and 2022 preferred.")).ok, false);
});
t("TC-TRUST-004-07", "gendered job title is flagged with a neutral suggestion", () => {
  const r = screenPosting(jd("We need a salesman for the west region."));
  assert.equal(r.ok, false);
  assert.equal(r.blocking[0]!.category, "SEX");
  assert.match(r.blocking[0]!.suggestion!, /salesperson/i);
});
t("TC-TRUST-004-08", "explicit sex preference blocks", () => {
  assert.equal(screenPosting(jd("Female candidates preferred for this role.")).ok, false);
});
t("TC-TRUST-004-09", "'must be a US citizen' blocks with the IRCA rationale", () => {
  const r = screenPosting(jd("Applicants must be a US citizen."));
  assert.equal(r.ok, false);
  assert.equal(r.blocking[0]!.category, "CITIZENSHIP");
  assert.match(r.blocking[0]!.why, /1324b/);
});
t("TC-TRUST-004-10", "'no visa sponsorship' phrasing that excludes by status blocks", () => {
  assert.equal(screenPosting(jd("Green card holders only. No H-1B.")).ok, false);
});
t("TC-TRUST-004-11", "'native English speakers only' blocks", () => {
  const r = screenPosting(jd("Native English speakers only."));
  assert.equal(r.ok, false);
  assert.equal(r.blocking[0]!.category, "NATIONAL_ORIGIN");
});
t("TC-TRUST-004-12", "disability exclusion blocks", () => {
  assert.equal(screenPosting(jd("Must be able-bodied for this position.")).ok, false);
});
t("TC-TRUST-004-13", "religious preference blocks", () => {
  assert.equal(screenPosting(jd("Christian candidates preferred.")).ok, false);
});
t("TC-TRUST-004-14", "family status exclusion blocks", () => {
  assert.equal(screenPosting(jd("Single candidates preferred, no children.")).ok, false);
});
t("TC-TRUST-004-15", "racial preference blocks", () => {
  assert.equal(screenPosting(jd("White candidates preferred.")).ok, false);
});
t("TC-TRUST-004-16", "veteran exclusion blocks", () => {
  assert.equal(screenPosting(jd("No veterans need apply.")).ok, false);
});
t("TC-TRUST-004-17", "a clean posting passes", () => {
  const r = screenPosting(
    jd(
      "We are hiring a Senior Frontend Engineer. Requirements: 5+ years with React and TypeScript. " +
        "Nice to have: GraphQL. Benefits: medical, dental, 401k. We are an equal opportunity employer."
    )
  );
  assert.equal(r.ok, true, `unexpected blocks: ${JSON.stringify(r.blocking)}`);
});
t("TC-TRUST-004-18", "lifting requirement is ADVISORY, not blocking", () => {
  const r = screenPosting(jd("Must be able to lift 50 lbs — this is a warehouse role."));
  assert.equal(r.ok, true, "a genuine physical requirement must not be blocked outright");
  assert.equal(r.advisory.length, 1);
  assert.equal(r.advisory[0]!.category, "DISABILITY");
});
t("TC-TRUST-004-19", "gendered pronoun is advisory", () => {
  const r = screenPosting(jd("He will be responsible for the roadmap."));
  assert.equal(r.ok, true);
  assert.equal(r.advisory[0]!.category, "SEX");
});
t("TC-TRUST-004-20", "the explanation names the phrase and suggests a fix", () => {
  const r = screenPosting(jd("Recent graduates only."));
  const msg = explainScreen(r);
  assert.match(msg, /Recent graduates only/);
  assert.match(msg, /employment agency/i);
  assert.match(msg, /0–2 years|0-2 years/);
});
t("TC-TRUST-004-21", "regex state does not leak between calls", () => {
  // A shared /g/ regex carries lastIndex and silently misses the second
  // posting. This is the test that catches that class of bug.
  const bad = jd("Recent graduates only.");
  const a = screenPosting(bad);
  const b = screenPosting(bad);
  assert.equal(a.blocking.length, b.blocking.length);
  assert.equal(b.ok, false);
});
t("TC-TRUST-004-22", "multiple problems are all reported in one pass", () => {
  const r = screenPosting(jd("Recent graduates only. Must be a US citizen. Salesman wanted."));
  const cats = new Set(r.blocking.map((f) => f.category));
  assert.ok(cats.size >= 3, `expected several categories, got ${[...cats].join(",")}`);
});
t("TC-TRUST-004-23", "title is screened as well as description", () => {
  assert.equal(screenPosting({ title: "Salesman", description: "A perfectly normal description of the role that goes on for a while." }).ok, false);
});
t("TC-TRUST-004-24", "perks are screened", () => {
  const r = screenPosting({ title: "Engineer", description: "Normal description here.", perks: ["Young and energetic team"] });
  assert.equal(r.ok, false);
});

// ═══════════════════════════════════════════════════════════════
// TRUST-003 / scam heuristics
// ═══════════════════════════════════════════════════════════════
t("TC-TRUST-003-01", "training fee is flagged", () => {
  assert.equal(screenForScam("A one-time training fee applies.").suspicious, true);
});
t("TC-TRUST-003-02", "gift cards are flagged", () => {
  assert.equal(screenForScam("Purchase gift cards for the client.").suspicious, true);
});
t("TC-TRUST-003-03", "cryptocurrency is flagged", () => {
  assert.equal(screenForScam("Payment made in bitcoin weekly.").suspicious, true);
});
t("TC-TRUST-003-04", "bank details request is flagged", () => {
  assert.equal(screenForScam("Send your routing number to begin.").suspicious, true);
});
t("TC-TRUST-003-05", "SSN request is flagged", () => {
  assert.equal(screenForScam("Provide your social security number up front.").suspicious, true);
});
t("TC-TRUST-003-06", "implausible earnings claim is flagged", () => {
  assert.equal(screenForScam("Earn $900 per day from home!").suspicious, true);
});
t("TC-TRUST-003-07", "an ordinary posting is not flagged", () => {
  assert.equal(
    screenForScam("Senior Engineer. Competitive salary, equity, and full benefits.").suspicious,
    false
  );
});
t("TC-TRUST-003-08", "the signal is named, not just a boolean", () => {
  const r = screenForScam("A registration fee of $50 is required.");
  assert.ok(r.signals.length > 0);
  assert.match(r.signals[0]!, /fee/i);
});

// ═══════════════════════════════════════════════════════════════
// XPLAIN-002 / AEDT notice
// ═══════════════════════════════════════════════════════════════
t("TC-XPLAIN-002-01", "base notice describes the five factors", () => {
  const n = buildNotice(null);
  const text = JSON.stringify(n.sections);
  for (const factor of ["Required skills", "Preferred", "Years of experience", "Compensation", "Work-location"]) {
    assert.ok(text.includes(factor), `missing factor: ${factor}`);
  }
});
t("TC-XPLAIN-002-02", "base notice lists every prohibited input", () => {
  const text = JSON.stringify(buildNotice(null).sections);
  for (const n of NEVER_USED) {
    assert.ok(text.includes(n), `notice omits: ${n}`);
  }
});
t("TC-XPLAIN-002-03", "notice states it does not decide anything", () => {
  const text = JSON.stringify(buildNotice(null).sections);
  assert.match(text, /does not accept or reject anyone/);
});
t("TC-XPLAIN-002-04", "NYC notice sets a 10-business-day lead", () => {
  const n = buildNotice("NY", { locality: "NYC", now: new Date("2026-08-19T00:00:00Z") });
  assert.ok(n.usableFrom, "NYC requires a lead period");
  // 10 business days from Wed 19 Aug 2026 lands on Wed 2 Sep.
  assert.equal(n.usableFrom!.toISOString().slice(0, 10), "2026-09-02");
});
t("TC-XPLAIN-002-05", "NYC lead skips weekends", () => {
  const n = buildNotice("NY", { locality: "NYC", now: new Date("2026-08-19T00:00:00Z") });
  const days = (n.usableFrom!.getTime() - Date.parse("2026-08-19T00:00:00Z")) / 86_400_000;
  assert.equal(days, 14, "10 business days spans 14 calendar days across two weekends");
});
t("TC-XPLAIN-002-06", "NYC notice names the qualifications assessed", () => {
  const text = JSON.stringify(buildNotice("NY", { locality: "NYC" }).sections);
  assert.match(text, /qualifications and characteristics assessed/i);
  assert.match(text, /alternative selection process/i);
});
t("TC-XPLAIN-002-07", "Illinois notice is in force and bans ZIP as a proxy", () => {
  const n = buildNotice("IL");
  const text = JSON.stringify(n.sections);
  assert.match(text, /ZIP code/);
  assert.ok(n.cites.some((c) => /775 ILCS/.test(c)));
});
t("TC-XPLAIN-002-08", "Illinois has no lead period", () => {
  assert.equal(buildNotice("IL").usableFrom, null);
});
t("TC-XPLAIN-002-09", "Connecticut not yet in force in Aug 2026", () => {
  const n = buildNotice("CT", { now: new Date("2026-08-19T00:00:00Z") });
  assert.equal(n.cites.length, 0, "CT AEDT disclosures start 1 Oct 2027");
});
t("TC-XPLAIN-002-10", "Connecticut names the trade name once in force", () => {
  const n = buildNotice("CT", { now: new Date("2027-10-01T00:00:00Z") });
  const text = JSON.stringify(n.sections);
  assert.match(text, /Jobsy matching engine/);
  assert.match(text, /categories of personal data/i);
  assert.match(text, /source of every one of these/i);
});
t("TC-XPLAIN-002-11", "Colorado not yet in force in Aug 2026", () => {
  assert.equal(buildNotice("CO", { now: new Date("2026-08-19T00:00:00Z") }).cites.length, 0);
});
t("TC-XPLAIN-002-12", "Colorado 30-day adverse notice once in force", () => {
  const text = JSON.stringify(buildNotice("CO", { now: new Date("2027-01-01T00:00:00Z") }).sections);
  assert.match(text, /within 30 days/);
  assert.match(text, /authority to change it/);
});
t("TC-XPLAIN-002-13", "California ADMT rights once in force", () => {
  const text = JSON.stringify(buildNotice("CA", { now: new Date("2027-01-01T00:00:00Z") }).sections);
  assert.match(text, /Global Privacy Control/);
});
t("TC-XPLAIN-002-14", "Minnesota right to question is in force now", () => {
  const text = JSON.stringify(buildNotice("MN").sections);
  assert.match(text, /question the result/i);
});
t("TC-XPLAIN-002-15", "an uncovered state still gets the base notice", () => {
  const n = buildNotice("TX");
  assert.ok(n.sections.length >= 4);
  assert.equal(n.cites.length, 0);
});
t("TC-XPLAIN-002-16", "notice carries a version", () => {
  assert.match(buildNotice(null).version, /^\d+\.\d+$/);
});

// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// FSD §8.1 — drafts must not become a hole through pay transparency
// ═══════════════════════════════════════════════════════════════
//
// Creating a DRAFT deliberately skips the pay check, because the obligation
// attaches to an ADVERTISED posting and refusing to save an unfinished one
// enforces nothing. That makes the publish-time check load-bearing: these
// assert the rules a draft has to clear on the way out, and that skipping them
// at save time does not weaken them.

t("TC-DRAFT-01", "an unpriced posting still fails the check that runs at publish", () => {
  const r = checkPayTransparency({ location: "Denver, CO", ...noPay });
  assert.equal(r.ok, false, "a Colorado role with no range must not be publishable");
  assert.ok(r.problems.includes("SALARY_RANGE_REQUIRED"));
});

t("TC-DRAFT-02", "an unknown employee count applies the rule rather than exempting", () => {
  // employeeCount is not stored on a job, so a draft published later supplies
  // no count. Unknown must be strict — a missing fact cannot create an
  // exemption, or every draft would publish by simply omitting the number.
  const unknown = checkPayTransparency({ location: "New York, NY", employeeCount: null, ...noPay });
  assert.equal(unknown.ok, false, "unknown size must be treated as in scope");
});

t("TC-DRAFT-03", "a genuinely small employer is still exempt when it says so", () => {
  const tiny = checkPayTransparency({ location: "New York, NY", employeeCount: 1, ...noPay });
  const unknown = checkPayTransparency({ location: "New York, NY", employeeCount: null, ...noPay });
  assert.ok(
    tiny.applicable.length < unknown.applicable.length,
    "stating a small headcount must narrow scope relative to unknown"
  );
});

t("TC-DRAFT-04", "a fully priced posting passes, so drafts are publishable", () => {
  const ok = checkPayTransparency({
    location: "Denver, CO", salaryMin: 120, salaryMax: 160,
    benefitsDescription: "Health, dental, 401k match, 20 days PTO.", now: NOW,
  });
  assert.equal(ok.ok, true, ok.message ?? "");
});

console.log(`\n${pass} passed, ${fail} failed  —  compliance suite\n`);
if (fail) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
