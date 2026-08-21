#!/usr/bin/env tsx
/**
 * BR-006 / AC-006 / §10.1a — sponsorship compatibility.
 *
 * The exclusion rule is one line. Everything worth testing here is about when
 * the rule must NOT fire, because that is where the legal exposure sits: under
 * IRCA (8 U.S.C. § 1324b) it is unlawful to discriminate on citizenship status,
 * and treating an unanswered question as "needs sponsorship" is precisely an
 * inference about immigration status drawn from silence.
 */
const { checkSponsorship, isSponsorshipEligible } = await import("../src/lib/authorization");

let pass = 0,
  fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const v = (job: boolean | null | undefined, cand: boolean | null | undefined) =>
  checkSponsorship({ jobSponsorshipAvailable: job, candidateRequiresSponsorship: cand });

console.log("\nSPONSORSHIP ELIGIBILITY\n");

// The only exclusion in the entire rule.
check("TC-SPON-01 needs sponsorship + role does not sponsor → excluded",
  v(false, true).eligible === false, v(false, true).reason);

check("TC-SPON-02 needs sponsorship + role sponsors → eligible",
  v(true, true).eligible === true);
check("TC-SPON-03 no sponsorship needed + role does not sponsor → eligible",
  v(false, false).eligible === true);
check("TC-SPON-04 no sponsorship needed + role sponsors → eligible",
  v(true, false).eligible === true);

console.log("\nSILENCE IS NOT AN ANSWER\n");

// This block is the legal core. Every one of these must stay eligible.
check("TC-SPON-10 candidate has not answered → never excluded",
  v(false, null).eligible === true, v(false, null).reason);
check("TC-SPON-11 candidate field undefined → never excluded",
  v(false, undefined).eligible === true);
check("TC-SPON-12 employer said 'prefer not to state' → never excluded",
  v(null, true).eligible === true, v(null, true).reason);
check("TC-SPON-13 employer field undefined → never excluded",
  v(undefined, true).eligible === true);
check("TC-SPON-14 neither side answered → eligible",
  v(null, null).eligible === true);

// Exhaustive: of the nine combinations, exactly one excludes.
{
  const states: (boolean | null)[] = [true, false, null];
  const excluded = states.flatMap((j) => states.map((c) => ({ j, c, e: !isSponsorshipEligible({
    jobSponsorshipAvailable: j, candidateRequiresSponsorship: c }) })))
    .filter((x) => x.e);
  check("TC-SPON-15 exactly one of nine combinations excludes",
    excluded.length === 1, excluded.map((x) => `job=${x.j}/cand=${x.c}`).join(", "));
  check("TC-SPON-16 and it is the stated-incompatible one",
    excluded[0]?.j === false && excluded[0]?.c === true);
}

console.log("\nHOW THE REFUSAL IS WORDED\n");

// A candidate reads this. It must describe the ROLE, not the person — "you are
// not authorized to work here" is both wrong and the kind of sentence that
// turns a lawful policy into a discrimination complaint.
{
  const r = v(false, true).reason.toLowerCase();
  check("TC-SPON-20 names what the role offers", /role/.test(r) && /sponsor/.test(r), r);
  check("TC-SPON-21 says nothing about the person",
    !/\byou\b|\byour\b|\bcandidate\b/.test(r), r);
  // "Visa sponsorship" is the right name for the thing an employer offers, and
  // avoiding the word would make the sentence vaguer, not safer. What must
  // never appear is the candidate's STATUS — a category, a nationality, or the
  // suggestion that the refusal is about who they are.
  check("TC-SPON-22 never names a status category",
    !/(visa type|visa category|visa status|work permit|citizen|nationality|immigra)/.test(r), r);
}

// Every reason string, eligible or not, has to survive that same test: they are
// all shown to somebody.
{
  const states: (boolean | null)[] = [true, false, null];
  const all = states.flatMap((j) => states.map((c) => v(j, c).reason.toLowerCase()));
  check("TC-SPON-23 no reason string mentions citizenship or visa category",
    all.every((r) => !/(visa type|visa category|citizen|nationality|immigra)/.test(r)));
}

console.log(`\n${pass} passed, ${fail} failed  —  sponsorship eligibility\n`);
process.exit(fail ? 1 : 0);
