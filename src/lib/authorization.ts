/**
 * BR-006 / AC-006 / §10.1a — sponsorship compatibility, as a Stage-1 gate.
 *
 * ── Why this file is not in src/lib/matching ──
 *
 * `check-prohibited-inputs.mts` forbids the tokens `authorizedToWork` and
 * `requiresSponsorship` anywhere the scoring engine can reach, because
 * citizenship-status discrimination is unlawful under IRCA, 8 U.S.C. § 1324b.
 * That guard is correct and stays. The spec's eligibility rule therefore lives
 * out here beside src/lib/geo, in the layer that decides WHICH pairs are
 * considered — never in the layer that decides how strong a considered pair is.
 *
 * ── What this compares, and what it must never compare ──
 *
 * Two facts, both volunteered, neither of them about a person's nationality:
 *
 *   the ROLE:      does this employer sponsor for this position?
 *   the CANDIDATE: will you need sponsorship, now or in the future?
 *
 * That pairing is the standard lawful question. DOJ's Immigrant and Employee
 * Rights guidance permits asking whether sponsorship will be required, and
 * permits an employer with a uniform no-sponsorship policy to decline on that
 * basis. What is unlawful — and what this module is shaped to make impossible —
 * is preferring one immigration STATUS over another: no visa category, no
 * country of citizenship, no "citizens only" toggle exists anywhere in the
 * schema, and none may be added.
 *
 * ── Why it fails OPEN ──
 *
 * Geography (GEO-006) fails CLOSED: a posting that will not say where the work
 * happens reaches nobody. This rule is the opposite, and deliberately so.
 *
 * Silence here is not a fact about a person, and treating it as one converts
 * "declined to answer" into "assumed to need sponsorship" — an inference about
 * immigration status drawn from a blank field, which is the exact harm § 1324b
 * exists to prevent. A pair is excluded only when BOTH sides have stated
 * something and those two statements are incompatible.
 */

export type SponsorshipInputs = {
  /**
   * The employer's answer. `null` means "prefer not to state", which is a real
   * option in the composer and must behave as unstated, not as "no".
   */
  jobSponsorshipAvailable: boolean | null | undefined;
  /**
   * The candidate's answer to "will you require sponsorship, now or in the
   * future?". `null` means unanswered.
   */
  candidateRequiresSponsorship: boolean | null | undefined;
};

export type SponsorshipVerdict = {
  eligible: boolean;
  rule: "BR-006";
  /**
   * Phrased in terms of what the ROLE offers, never what the person is. A
   * candidate reading this should learn a fact about the posting.
   */
  reason: string;
};

const ok = (reason: string): SponsorshipVerdict => ({ eligible: true, rule: "BR-006", reason });

export function checkSponsorship(i: SponsorshipInputs): SponsorshipVerdict {
  const needs = i.candidateRequiresSponsorship;
  const offers = i.jobSponsorshipAvailable;

  // Unanswered on either side — no comparison is possible, so none is made.
  if (needs === null || needs === undefined) {
    return ok("Sponsorship needs not stated.");
  }
  if (offers === null || offers === undefined) {
    return ok("This role does not state whether sponsorship is available.");
  }

  if (needs && offers === false) {
    return {
      eligible: false,
      rule: "BR-006",
      reason: "This role does not offer visa sponsorship.",
    };
  }

  return ok(needs ? "This role offers visa sponsorship." : "No sponsorship required for this role.");
}

export function isSponsorshipEligible(i: SponsorshipInputs): boolean {
  return checkSponsorship(i).eligible;
}
