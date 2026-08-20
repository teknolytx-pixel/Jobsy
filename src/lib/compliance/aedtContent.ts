import { CURRENT_AEDT_NOTICE } from "../legalVersions";
import type { StateCode } from "./jurisdiction";
import { WEIGHTS } from "../matching/engine";

/**
 * XPLAIN-002 — Automated Employment Decision Tool notice.
 *
 * Five separate regimes want a version of the same disclosure. Rather than
 * building five notices, this module builds one and layers the jurisdiction-
 * specific additions on top. The delivery is logged per user per jurisdiction
 * because proving the notice was given is the whole obligation.
 *
 * ⚠️ Verified August 2026. Illinois' implementing rules were withdrawn on
 * 2 June 2026 and have not been re-filed, so the statutory duty is in force
 * while the form of a compliant notice is unsettled. Connecticut and Colorado
 * carry future compliance dates. Re-verify against JOBSY-US-LEGAL-SURVEY §3.
 */

export type NoticeRule = {
  cite: string;
  effective: string;
  /** Business days the notice must precede use. NYC is the only one today. */
  leadBusinessDays: number;
  /** Extra paragraphs appended to the base notice for this jurisdiction. */
  additions: string[];
};

export const NOTICE_RULES: Partial<Record<StateCode | "NYC", NoticeRule>> = {
  NYC: {
    cite: "NYC Local Law 144 of 2021; NYC Admin. Code §§ 20-870–874",
    effective: "2023-07-05",
    leadBusinessDays: 10,
    additions: [
      "Because you may be considered for a role located in New York City, we are giving you this notice at least 10 business days before any automated employment decision tool is used to assess you.",
      "The qualifications and characteristics assessed are: the skills listed in the job posting, the number of years of experience the posting requires, the compensation range the posting states, and the work-location arrangement the posting requires. Nothing else is assessed.",
      "You may request an alternative selection process, or a reasonable accommodation for a disability, by contacting us. We will not treat you worse for asking.",
    ],
  },
  IL: {
    cite: "775 ILCS 5/2-102(L) (HB 3773, P.A. 103-0804)",
    effective: "2026-01-01",
    leadBusinessDays: 0,
    additions: [
      "We use artificial intelligence in connection with employment opportunities, as described above.",
      "We do not use ZIP code, or any other geographic identifier, as a proxy for race, ethnicity, national origin, or any other protected class. Location is used only to work out whether a role's work-location requirement is compatible with yours.",
    ],
  },
  CO: {
    cite: "Colorado SB 26-189 (Automated Decision-Making Technology)",
    effective: "2027-01-01",
    leadBusinessDays: 0,
    additions: [
      "This notice is given before any automated decision-making technology is used in connection with a consequential decision about you.",
      "If an automated process contributes to an adverse decision about you, we will tell you within 30 days, explain in plain language what role the technology played, tell you how to ask us for more information, and set out your rights.",
      "You may ask a person to review any adverse automated outcome. That person has the authority to change it.",
    ],
  },
  CT: {
    cite: "Connecticut Public Act 26-15 (CART Act)",
    effective: "2027-10-01",
    leadBusinessDays: 0,
    additions: [
      "The technology deployed is the Jobsy matching engine.",
      "Its purpose is to suggest matches between candidates and job opportunities, as described above.",
      "The categories of personal data it processes are: the skills you listed, the years of experience you stated, the compensation you said you were looking for, the work-location arrangement you said you wanted, and the city or metropolitan area you gave. The source of every one of these is information you entered into your own Jobsy profile.",
    ],
  },
  CA: {
    cite: "11 Cal. Code Regs. §§ 7150–7157, 7200–7221 (CPPA ADMT); 2 Cal. Code Regs. § 11008 et seq. (FEHA ADS)",
    effective: "2027-01-01",
    leadBusinessDays: 0,
    additions: [
      "This also serves as the pre-use notice required by California's automated decisionmaking technology regulations.",
      "You have the right to opt out of automated ranking, and the right to access information about how the technology reached its output for you. Both are available in your account settings, and we honour Global Privacy Control signals from your browser as an opt-out.",
    ],
  },
  MN: {
    cite: "Minn. Stat. ch. 325M",
    effective: "2025-07-31",
    leadBusinessDays: 0,
    additions: [
      "You have the right to question the result of automated profiling, be told the reason for it, review the personal data used, correct that data, and ask us to run the assessment again.",
    ],
  },
  VT: {
    cite: "Vermont S.71 (VDPOSA)",
    effective: "2028-01-01",
    leadBusinessDays: 0,
    additions: [
      "You have the right to an explanation of any automated profiling decision affecting your access to employment, and the right to contest it.",
    ],
  },
};

/** The five factors, as percentages, read from the engine so they cannot drift. */
const factorLines = () => [
  `Required skills stated in the job posting, compared against the skills in your profile — ${WEIGHTS.requiredSkills}%`,
  `Preferred ("nice to have") skills — ${WEIGHTS.preferredSkills}%`,
  `Years of experience, against any minimum the posting states — ${WEIGHTS.experience}%`,
  `Compensation expectations, against the range the posting gives — ${WEIGHTS.compensation}%`,
  `Work-location preference — remote, hybrid or onsite — and whether a commute is feasible — ${WEIGHTS.workStyle}%`,
];

/**
 * MATCH-030 — the exclusion list, stated to the candidate.
 *
 * This is not marketing copy. It is a commitment the code keeps: the matching
 * function's input type cannot carry any of these fields, and
 * scripts/check-prohibited-inputs.mts fails the build if a reference appears.
 */
export const NEVER_USED = [
  "Your name",
  "Your photograph",
  "The school or university you attended",
  "Your graduation year",
  "Your date of birth or your age",
  "Your gender or gender identity",
  "Your race, ethnicity or national origin",
  "Your religion",
  "Your disability status",
  "Your citizenship or immigration status",
  "Your marital, family or veteran status",
  "Your street address or ZIP code",
  "Any inference of any of the above",
];

export type Notice = {
  version: string;
  jurisdiction: string;
  /** Sections, in order, ready to render. */
  sections: { heading: string; body: string[] }[];
  /** Citations for the jurisdiction-specific rules applied. */
  cites: string[];
  /** Set when the notice must precede use — NYC's 10 business days. */
  usableFrom: Date | null;
};

/** Add N business days, skipping Saturdays and Sundays. */
function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from);
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

/** Build the notice text for a jurisdiction. */
export function buildNotice(
  jurisdiction: string | null | undefined,
  opts?: { locality?: string | null; now?: Date }
): Notice {
  const now = opts?.now ?? new Date();
  const keys: (StateCode | "NYC")[] = [];
  if (opts?.locality === "NYC") keys.push("NYC");
  if (jurisdiction) keys.push(jurisdiction as StateCode);

  const rules = keys
    .map((k) => [k, NOTICE_RULES[k]] as const)
    .filter((p): p is [StateCode | "NYC", NoticeRule] => Boolean(p[1]))
    .filter(([, r]) => new Date(r.effective) <= now);

  const lead = Math.max(0, ...rules.map(([, r]) => r.leadBusinessDays), 0);

  const sections: Notice["sections"] = [
    {
      heading: "We use software to suggest matches",
      body: [
        "Jobsy uses an automated matching system — we call it the Jobsy matching engine — to suggest which job opportunities may suit you, and which candidates may suit a role.",
        "It compares the requirements stated in a job posting against what you put in your profile, and produces a score from 1 to 99 together with a written explanation. It weighs five things:",
        ...factorLines().map((l) => `• ${l}`),
        "It also gives partial credit for closely related skills. If a role asks for React and you have Vue, you get partial credit, and we tell you so.",
      ],
    },
    {
      heading: "What it never uses",
      body: [
        "The matching engine does not use, and is not permitted to use, any of the following:",
        ...NEVER_USED.map((n) => `• ${n}`),
        "Location is used only to work out whether a role's work-location requirement is compatible with yours. This is enforced in our code, not only in this policy: the matching function cannot receive these fields, and an automated check runs on every change to confirm it.",
      ],
    },
    {
      heading: "It does not decide anything",
      body: [
        "The score does not accept or reject anyone. It orders suggestions. Every decision to contact, interview, offer or hire is made by the employer, using their own judgement and their own process.",
      ],
    },
    {
      heading: "Your rights",
      body: [
        "See the explanation. Every match carries a \"Why this match?\" explanation you can open at any time.",
        "Opt out of automated ranking. Turn it off in Account Settings → Privacy. We also honour Global Privacy Control signals from your browser. If you opt out you will still see job opportunities, ordered another way, and we will tell you how. We will not treat you worse for opting out.",
        "Ask a person to review an adverse outcome. That person has the authority to change it.",
        "Correct your information and ask us to run the assessment again.",
        "Request an alternative process, or an accommodation for a disability.",
      ],
    },
  ];

  for (const [, rule] of rules) {
    if (rule.additions.length) {
      sections.push({ heading: "Additional rights where you are", body: rule.additions });
    }
  }

  return {
    version: CURRENT_AEDT_NOTICE,
    jurisdiction: opts?.locality === "NYC" ? "NYC" : (jurisdiction ?? "US"),
    sections,
    cites: rules.map(([, r]) => r.cite),
    usableFrom: lead > 0 ? addBusinessDays(now, lead) : null,
  };
}
