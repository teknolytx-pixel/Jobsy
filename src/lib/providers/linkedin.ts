import { type JobProvider, type NormalizedJob, ProviderNotAvailableError } from "./types";

/**
 * LinkedIn Talent Solutions adapter — DELIBERATELY INERT.
 *
 * This file exists so that the day a LinkedIn partnership is granted, the only
 * change needed is filling in fetchBoard() and adding "LINKEDIN" to the active
 * provider registry. Nothing else in Jobsy knows or cares where a job came from.
 *
 * Why it cannot be implemented today
 * ──────────────────────────────────
 * Verified against learn.microsoft.com/linkedin (Aug 2026):
 *
 *  • Job Posting API — the docs carry an explicit banner: "We are currently not
 *    accepting new partnerships for LinkedIn's Job Posting API." Access is
 *    limited to approved ATS vendors and job distributors under a signed API
 *    agreement, arranged through a LinkedIn relationship manager.
 *
 *  • Recruiter System Connect — enterprise partnership only. It syncs an ATS
 *    with LinkedIn Recruiter; it does NOT expose candidate search. It surfaces
 *    only candidates a licensed recruiter has manually exported, or who replied
 *    to an InMail. It also requires prior Job Posting API development.
 *
 *  • Apply Connect — the path LinkedIn now redirects applicants to. Requires the
 *    END CUSTOMER to hold a LinkedIn Recruiter Corporate or Professional
 *    Services licence. Suitable once Jobsy is selling to licensed employers.
 *
 *  • Sales Navigator (SNAP) — closed to new partners.
 *
 *  • LinkedIn Premium / Recruiter Lite grant ZERO API access. They are UI seats.
 *
 * Do not "solve" this by scraping. LinkedIn sued Proxycurl — the largest
 * LinkedIn data API, ~$10M ARR — in January 2025; it shut down rather than
 * litigate against Microsoft. Scraped profile data would also make Jobsy's own
 * GDPR/CCPA position indefensible, since candidates never consented to being in
 * your database.
 *
 * The supported path to LinkedIn inventory:
 *   1. Reach revenue/logo scale with aggregator + ATS inventory (what ships today).
 *   2. Apply: https://business.linkedin.com/talent-solutions/ats-partners/partner-application
 *   3. On approval, implement fetchBoard() below and register the provider.
 */
export const linkedinTalentProvider: JobProvider = {
  source: "LINKEDIN",
  label: "LinkedIn Talent Solutions (partner-gated)",

  isConfigured: () => false,
  boards: () => [],

  async fetchBoard(): Promise<NormalizedJob[]> {
    throw new ProviderNotAvailableError(
      "LINKEDIN",
      "LinkedIn Talent Solutions requires an approved partnership. LinkedIn is not " +
        "accepting new Job Posting API partners. Sign In with LinkedIn (OIDC) is wired " +
        "up separately in src/lib/auth.ts and works today. See README → LinkedIn."
    );
  },
};
