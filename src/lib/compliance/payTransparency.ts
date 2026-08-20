import {
  detectJurisdiction,
  type Jurisdiction,
  type Locality,
  type StateCode,
} from "./jurisdiction";

/**
 * LEGAL-002 — pay transparency posting controls.
 *
 * Two jurisdictions impose a duty on the PLATFORM, not just the employer:
 *
 *   • Illinois — 820 ILCS 112/10(b-25) makes an "engaged" third party
 *     independently liable, with one affirmative defence: the employer never
 *     supplied the data. That is why `employerSuppliedPay` is logged on every
 *     submission. The log IS the defence.
 *
 *   • New York City — NYCHRL § 8-102 defines "employment agency" as anyone
 *     "undertaking to procure employees or opportunities to work", and the NYC
 *     Commission on Human Rights has filed salary-transparency complaints
 *     against Indeed and ZipRecruiter. This is live enforcement against exactly
 *     this product category.
 *
 * Nearly every other regime that reaches third parties keys on employer CONSENT
 * — Washington's statute excludes a solicitation "digitally replicated and
 * published without an employer's consent"; Colorado's INFO #9A, Delaware and
 * Columbus say the same. Hence `jobs.consent_source`: employer-submitted
 * postings are gated, crawled postings are labelled.
 *
 * ⚠️ Verified August 2026. Effective dates below carry future dates and the law
 * moves — re-verify against JOBSY-US-LEGAL-SURVEY §4 before relying on it.
 */

export type Rule = {
  /** Human-readable citation, shown to the recruiter when a post is blocked. */
  cite: string;
  /** Minimum employee count that triggers the duty; 1 means all employers. */
  threshold: number;
  /** Whether a general benefits description is also required. */
  benefitsRequired: boolean;
  /** ISO date the duty begins. Rules with a future date are not yet enforced. */
  effective: string;
  /** Whether the statute or guidance reaches third-party platforms. */
  reachesPlatform: "YES" | "NO" | "UNSETTLED";
  note?: string;
};

export const STATE_RULES: Partial<Record<StateCode, Rule>> = {
  CA: { cite: "Cal. Lab. Code § 432.3 (SB 1162, as amended by SB 642)", threshold: 15, benefitsRequired: false, effective: "2023-01-01", reachesPlatform: "UNSETTLED" },
  CO: { cite: "C.R.S. § 8-5-201 (Equal Pay for Equal Work Act)", threshold: 1, benefitsRequired: true, effective: "2021-01-01", reachesPlatform: "NO", note: "CDLE INFO #9A: covers only posts the employer makes or has another party make." },
  CT: { cite: "C.G.S. § 31-40z, as amended by H.B. 5003", threshold: 1, benefitsRequired: true, effective: "2026-10-01", reachesPlatform: "UNSETTLED", note: "Converts from disclosure-on-request to a full posting mandate on 1 Oct 2026." },
  DE: { cite: "H.S. 2 for H.B. 105", threshold: 26, benefitsRequired: true, effective: "2027-09-26", reachesPlatform: "NO" },
  DC: { cite: "D.C. Law 25-138 (Wage Transparency Omnibus Amendment Act)", threshold: 1, benefitsRequired: false, effective: "2024-06-30", reachesPlatform: "UNSETTLED", note: "Healthcare benefits must be disclosed before the first interview." },
  HI: { cite: "Act 203 (SB 1057), HRS § 378-2.3", threshold: 50, benefitsRequired: false, effective: "2024-01-01", reachesPlatform: "UNSETTLED" },
  IL: { cite: "820 ILCS 112/10(b-25)", threshold: 15, benefitsRequired: true, effective: "2025-01-01", reachesPlatform: "YES", note: "Third party independently liable unless it shows the employer never supplied the data." },
  ME: { cite: "L.D. 54 / P.L. 2025 ch. 771", threshold: 10, benefitsRequired: false, effective: "2026-07-29", reachesPlatform: "YES", note: "Covers postings made directly by the employer or indirectly through a third party." },
  MD: { cite: "Wage Range Transparency Act", threshold: 1, benefitsRequired: true, effective: "2024-10-01", reachesPlatform: "YES", note: "Covers postings 'directly or through a third party' and repostings." },
  MA: { cite: "Ch. 141, Acts of 2024 (Salary Range Transparency Act)", threshold: 25, benefitsRequired: false, effective: "2025-10-29", reachesPlatform: "UNSETTLED" },
  MN: { cite: "Minn. Stat. § 181.173", threshold: 30, benefitsRequired: true, effective: "2025-01-01", reachesPlatform: "YES", note: "Open-ended ranges are prohibited." },
  NJ: { cite: "P.L. 2024 c.91 (Pay & Benefit Transparency Act)", threshold: 10, benefitsRequired: true, effective: "2025-06-01", reachesPlatform: "NO", note: "Proposed rules exempt aggregators that collect postings without employer involvement." },
  NY: { cite: "N.Y. Lab. Law § 194-b", threshold: 4, benefitsRequired: false, effective: "2023-09-17", reachesPlatform: "YES", note: "Binds an 'employer, employment agency, employee, or agent thereof'. NYSDOL: not liable for postings scraped without authorization." },
  VT: { cite: "Act 155 (H.704), 21 V.S.A.", threshold: 5, benefitsRequired: false, effective: "2025-07-01", reachesPlatform: "UNSETTLED" },
  VA: { cite: "Va. Code § 40.1-28.7:12", threshold: 1, benefitsRequired: false, effective: "2026-07-01", reachesPlatform: "UNSETTLED", note: "Benefits are NOT required. Private right of action." },
  WA: { cite: "RCW 49.58.110, as amended by SB 5408", threshold: 15, benefitsRequired: true, effective: "2023-01-01", reachesPlatform: "YES", note: "Excludes a solicitation digitally replicated and published without the employer's consent." },
};

export const LOCALITY_RULES: Partial<Record<Locality, Rule>> = {
  NYC: { cite: "NYCHRL § 8-107(32) (Local Law 32 of 2022)", threshold: 4, benefitsRequired: false, effective: "2022-11-01", reachesPlatform: "YES", note: "Employment agencies are covered regardless of size. CCHR has filed complaints against Indeed and ZipRecruiter." },
  WESTCHESTER_NY: { cite: "Westchester County Laws § 700.03", threshold: 1, benefitsRequired: false, effective: "2022-11-06", reachesPlatform: "UNSETTLED" },
  ITHACA_NY: { cite: "Ithaca City Code § 215-3(F)", threshold: 4, benefitsRequired: false, effective: "2022-09-01", reachesPlatform: "UNSETTLED" },
  ALBANY_COUNTY_NY: { cite: "Albany County Local Law (2022)", threshold: 1, benefitsRequired: false, effective: "2022-01-01", reachesPlatform: "UNSETTLED" },
  JERSEY_CITY_NJ: { cite: "Jersey City Ord. 22-045, Mun. Code § 148-4.1", threshold: 5, benefitsRequired: true, effective: "2022-04-13", reachesPlatform: "YES", note: "Applies to employers, employment agencies, or agents of an employer." },
  CLEVELAND_OH: { cite: "Cleveland Ord. No. 104-2025", threshold: 15, benefitsRequired: false, effective: "2025-10-27", reachesPlatform: "YES", note: "Applies to any employment agency operating on the employer's behalf. 90-day cure." },
  COLUMBUS_OH: { cite: "Columbus Ord. 2898-2025", threshold: 15, benefitsRequired: false, effective: "2027-01-01", reachesPlatform: "NO", note: "Expressly excludes postings published without employer consent." },
  // Cincinnati and Toledo are salary-history ordinances with pay-scale-on-request.
  // They have never required a range in a posting, and are deliberately absent.
};

/**
 * States with no posting mandate but which some sources wrongly list.
 * Kept explicit so nobody "fixes" the omission.
 */
export const NOT_POSTING_MANDATES: Partial<Record<StateCode, string>> = {
  NV: "NRS § 613.133 is disclosure-on-request after an interview, not a posting mandate.",
  RI: "R.I. Gen. Laws § 28-6-22(c) is disclosure at hire or on request, not a posting mandate.",
};

export type PayCheckInput = {
  location: string | null | undefined;
  remote?: string | null;
  salaryMin: number | null | undefined;
  salaryMax: number | null | undefined;
  benefitsDescription?: string | null;
  /** Employer headcount, if known. Unknown is treated as covered — see below. */
  employeeCount?: number | null;
  /** Employer-submitted postings are gated; crawled postings are labelled. */
  consentSource?: "EMPLOYER_SUBMITTED" | "CRAWLED";
  /** Override for testing time-dependent rules. */
  now?: Date;
};

export type PayCheckResult = {
  /** True when this posting may be published as-is. */
  ok: boolean;
  /** Rules in force for this location today. */
  applicable: { scope: string; rule: Rule }[];
  /** Machine-readable reasons for a block. */
  problems: ("SALARY_RANGE_REQUIRED" | "BENEFITS_REQUIRED" | "RANGE_INVALID")[];
  /** One paragraph a recruiter can act on. */
  message: string | null;
  jurisdiction: Jurisdiction;
};

const hasRange = (min: number | null | undefined, max: number | null | undefined) =>
  typeof min === "number" && typeof max === "number" && min > 0 && max > 0;

/**
 * Decide whether a posting may be published.
 *
 * Two deliberate choices, both erring toward compliance:
 *
 *  1. A REMOTE role is treated as covered by every posting-mandate state whose
 *     rule is in force, because a remote US role can be performed from any of
 *     them. Practitioners read the statutes that way and it is the safe reading.
 *
 *  2. An unknown employee count is treated as MEETING the threshold. Most of
 *     these thresholds are low (Colorado and Maryland reach a single employee),
 *     and the failure mode of asking a recruiter for a salary range they did not
 *     have to give is trivial next to the failure mode of publishing an unlawful
 *     posting.
 */
export function checkPayTransparency(input: PayCheckInput): PayCheckResult {
  const now = input.now ?? new Date();
  const jur = detectJurisdiction(input.location, input.remote);
  const consent = input.consentSource ?? "EMPLOYER_SUBMITTED";

  const inForce = (r: Rule) => new Date(r.effective) <= now;
  const meetsThreshold = (r: Rule) =>
    input.employeeCount == null || input.employeeCount >= r.threshold;

  const applicable: { scope: string; rule: Rule }[] = [];

  if (jur.remoteNationwide) {
    // Remote could be performed anywhere — every in-force state rule applies.
    for (const [code, rule] of Object.entries(STATE_RULES)) {
      if (inForce(rule) && meetsThreshold(rule)) applicable.push({ scope: code, rule });
    }
  } else {
    if (jur.state) {
      const rule = STATE_RULES[jur.state];
      if (rule && inForce(rule) && meetsThreshold(rule)) {
        applicable.push({ scope: jur.state, rule });
      }
    }
    if (jur.locality) {
      const rule = LOCALITY_RULES[jur.locality];
      if (rule && inForce(rule) && meetsThreshold(rule)) {
        applicable.push({ scope: jur.locality, rule });
      }
    }
  }

  // Crawled postings are never blocked. We did not author them, the employer did
  // not submit them to us, and most third-party provisions turn on exactly that.
  // They are labelled at render time instead — see LEGAL-002 AC-4.
  if (consent === "CRAWLED" || applicable.length === 0) {
    return {
      ok: true,
      applicable,
      problems: [],
      message: null,
      jurisdiction: jur,
    };
  }

  const problems: PayCheckResult["problems"] = [];

  if (!hasRange(input.salaryMin, input.salaryMax)) {
    problems.push("SALARY_RANGE_REQUIRED");
  } else if (input.salaryMin! > input.salaryMax!) {
    problems.push("RANGE_INVALID");
  }

  const needsBenefits = applicable.some((a) => a.rule.benefitsRequired);
  if (needsBenefits && !(input.benefitsDescription ?? "").trim()) {
    problems.push("BENEFITS_REQUIRED");
  }

  if (problems.length === 0) {
    return { ok: true, applicable, problems, message: null, jurisdiction: jur };
  }

  return {
    ok: false,
    applicable,
    problems,
    message: explain(problems, applicable, jur),
    jurisdiction: jur,
  };
}

function explain(
  problems: PayCheckResult["problems"],
  applicable: { scope: string; rule: Rule }[],
  jur: Jurisdiction
): string {
  const cites = [...new Set(applicable.map((a) => a.rule.cite))];
  const shown = cites.slice(0, 3);
  const more = cites.length - shown.length;

  const where = jur.remoteNationwide
    ? "This role is listed as remote, so it may be performed in states that require pay disclosure"
    : `Roles in this location are covered by pay transparency law`;

  const asks: string[] = [];
  if (problems.includes("SALARY_RANGE_REQUIRED")) {
    asks.push("a good-faith salary range (both a minimum and a maximum)");
  }
  if (problems.includes("RANGE_INVALID")) {
    asks.push("a valid range — the minimum cannot be above the maximum");
  }
  if (problems.includes("BENEFITS_REQUIRED")) {
    asks.push("a general description of the benefits and any other compensation");
  }

  return (
    `${where}. Before this posting can be published it needs ${asks.join(", and ")}. ` +
    `Applicable law: ${shown.join("; ")}${more > 0 ? `, and ${more} more` : ""}. ` +
    `This is a legal requirement in the role's jurisdiction, not a Jobsy preference.`
  );
}

/** LEGAL-002 AC-4 — the label shown on a crawled posting with no pay data. */
export function crawledPayLabel(job: {
  salaryMin: number | null;
  salaryMax: number | null;
  sourceUrl: string | null;
}): string | null {
  if (hasRange(job.salaryMin, job.salaryMax)) return null;
  return job.sourceUrl
    ? "Salary not disclosed by the employer — see the original posting."
    : "Salary not disclosed by the employer.";
}
