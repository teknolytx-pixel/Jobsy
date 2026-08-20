/**
 * TRUST-004 — discriminatory content screening for job postings.
 *
 * Why this is a launch blocker and not a nice-to-have:
 *
 * Title VII § 704(b) and ADEA § 4(e) make it unlawful for an EMPLOYMENT AGENCY
 * to print or publish a job notice indicating a protected-class preference. And
 * "employment agency" under Title VII § 701(c) / ADEA § 11(c) means anyone
 * *regularly* undertaking, *with or without compensation*, to procure employees
 * or opportunities to work. Payment is irrelevant. Success is irrelevant.
 *
 * EEOC guidance holds that a publisher becomes liable where it "exercises
 * control over discriminatory job listings rather than merely printing them" —
 * and a matching algorithm is control. In September 2019 the EEOC issued
 * reasonable-cause determinations against seven employers for limiting the
 * audience of social-media job ads by sex or age.
 *
 * So: the posting form screens before publication. A high-confidence hit blocks
 * with an explanation and an edit path — never a silent publish, and never a
 * silent drop.
 */

export type Protected =
  | "AGE"
  | "SEX"
  | "NATIONAL_ORIGIN"
  | "CITIZENSHIP"
  | "DISABILITY"
  | "RELIGION"
  | "FAMILY_STATUS"
  | "RACE"
  | "VETERAN";

export type Confidence = "HIGH" | "LOW";

export type Finding = {
  category: Protected;
  confidence: Confidence;
  /** The literal text that matched, for the recruiter to find and fix. */
  matched: string;
  /** Why this is a problem, in one sentence a non-lawyer understands. */
  why: string;
  /** A concrete replacement, where one exists. */
  suggestion?: string;
};

type Pattern = {
  re: RegExp;
  category: Protected;
  confidence: Confidence;
  why: string;
  suggestion?: string;
};

/**
 * Ordering note: every pattern is tested, not just the first match, because a
 * posting can be problematic in several ways at once and a recruiter should
 * see all of them in one pass rather than fixing them one round trip at a time.
 */
const PATTERNS: Pattern[] = [
  // ── AGE (ADEA). The most common category by a wide margin. ──
  {
    re: /\b(recent|new)\s+(grad(uate)?s?|college\s+grad(uate)?s?)\s+(only|preferred|required)\b/i,
    category: "AGE",
    confidence: "HIGH",
    why: "Restricting a role to recent graduates is age discrimination under the ADEA — it excludes candidates over 40 who have the same skills.",
    suggestion: "Describe the experience level instead: “0–2 years of experience”.",
  },
  {
    re: /\b(digital native|born digital)\b/i,
    category: "AGE",
    confidence: "HIGH",
    why: "“Digital native” is a well-recognised proxy for age and has been cited in EEOC charges.",
    suggestion: "Name the actual skill: “comfortable learning new software quickly”.",
  },
  {
    re: /\b(young|youthful)\s+(and\s+)?(energetic|dynamic|team|professional|hungry)\b/i,
    category: "AGE",
    confidence: "HIGH",
    why: "Describing the team or the candidate as “young” signals an age preference.",
    suggestion: "Describe the working style: “fast-moving team”.",
  },
  {
    re: /\b(must be|candidates?\s+must be|applicants?\s+must be)\s+(under|younger than|no older than|below)\s+\d{2}\b/i,
    category: "AGE",
    confidence: "HIGH",
    why: "An explicit maximum age is a direct ADEA violation.",
  },
  {
    re: /\b(no more than|maximum of|at most)\s+\d{1,2}\s*(\+)?\s*years?\s+(of\s+)?experience\b/i,
    category: "AGE",
    confidence: "HIGH",
    why: "Capping years of experience screens out older workers and is treated as an age proxy.",
    suggestion: "State a minimum instead, and leave the maximum open.",
  },
  {
    re: /\b(graduat(ed|ion)\s+(year|date|between|after|in)\s*[:\-]?\s*(19|20)\d{2})\b/i,
    category: "AGE",
    confidence: "HIGH",
    why: "Graduation year is a direct proxy for age — this is the theory at issue in Mobley v. Workday.",
  },
  {
    re: /\b(digital|tech)\s+(savvy|savviness)\s+millennials?\b|\bmillennials?\s+(only|preferred)\b|\bgen\s?z\s+(only|preferred)\b/i,
    category: "AGE",
    confidence: "HIGH",
    why: "Naming a generation is naming an age group.",
  },

  // ── SEX ──
  {
    re: /\b(salesman|salesmen|waitress|waiter\s+girl|hostess|handyman|foreman|repairman|deliveryman|cameraman|draftsman|stewardess|barmaid|busboy)\b/i,
    category: "SEX",
    confidence: "HIGH",
    why: "Gendered job titles indicate a sex preference.",
    suggestion:
      "Use the neutral form: salesperson, server, host, handyperson, supervisor, technician, delivery driver, camera operator, drafter, flight attendant, bartender, busser.",
  },
  {
    re: /\b(he|she)\s+(will|must|should)\s+(be|have|possess)\b/i,
    category: "SEX",
    confidence: "LOW",
    why: "A gendered pronoun for the successful candidate can read as a sex preference.",
    suggestion: "Use “you” or “the successful candidate”.",
  },
  {
    re: /\b(male|female)\s+(candidates?|applicants?|only|preferred|required)\b|\b(candidates?|applicants?)\s+must be\s+(male|female)\b/i,
    category: "SEX",
    confidence: "HIGH",
    why: "An explicit sex preference violates Title VII absent a documented bona fide occupational qualification.",
  },

  // ── CITIZENSHIP / NATIONAL ORIGIN (IRCA 8 U.S.C. § 1324b) ──
  {
    re: /\b(must be|only)\s+(a\s+)?(us|u\.s\.|american)\s+citizens?\b/i,
    category: "CITIZENSHIP",
    confidence: "HIGH",
    why: "Requiring US citizenship is citizenship-status discrimination under IRCA 8 U.S.C. § 1324b unless a law, regulation or government contract specifically requires it.",
    suggestion:
      "If the requirement is real, say “must be authorized to work in the US without sponsorship”, and record the legal basis. If a clearance is genuinely required, say so directly.",
  },
  {
    re: /\b(green\s?card|permanent resident)\s+(holders?\s+)?only\b|\bno\s+(visa|h-?1b|opt|cpt)\b/i,
    category: "CITIZENSHIP",
    confidence: "HIGH",
    why: "Excluding candidates by immigration status category is citizenship-status discrimination.",
    suggestion: "Ask only whether the candidate requires sponsorship.",
  },
  {
    re: /\b(native|native-level)\s+english\s+speakers?\s*(only|required|preferred)?\b/i,
    category: "NATIONAL_ORIGIN",
    confidence: "HIGH",
    why: "“Native speaker” is a proxy for national origin. Fluency, not nativeness, is the lawful requirement.",
    suggestion: "Say “fluent professional English” or name the specific proficiency needed.",
  },
  {
    re: /\bno\s+accents?\b|\bwithout\s+an?\s+accent\b/i,
    category: "NATIONAL_ORIGIN",
    confidence: "HIGH",
    why: "Accent requirements are national-origin discrimination unless the accent materially interferes with job performance.",
  },

  // ── DISABILITY ──
  {
    re: /\b(no|without)\s+(disabilit(y|ies)|handicaps?|medical\s+conditions?)\b|\bable-?bodied\b/i,
    category: "DISABILITY",
    confidence: "HIGH",
    why: "Excluding candidates with disabilities violates the ADA.",
    suggestion:
      "State the essential functions of the job instead, so candidates can assess it for themselves.",
  },
  {
    re: /\bmust be able to (lift|carry)\b/i,
    category: "DISABILITY",
    confidence: "LOW",
    why: "A physical requirement is lawful only if it is an essential function of the job. Make sure it genuinely is.",
    suggestion: "Tie it to the essential function: “lifting is required because…”.",
  },
  {
    re: /\b(perfect|excellent)\s+(health|physical\s+condition)\b|\bno\s+health\s+(issues|problems)\b/i,
    category: "DISABILITY",
    confidence: "HIGH",
    why: "General health requirements screen out candidates with disabilities and are not job-related.",
  },

  // ── RELIGION ──
  {
    re: /\b(christian|muslim|jewish|hindu|buddhist|catholic|protestant|mormon)\s+(candidates?|applicants?)\s+(only|preferred)\b|\bmust be\s+(a\s+)?(christian|muslim|jewish|hindu|buddhist|catholic)\b/i,
    category: "RELIGION",
    confidence: "HIGH",
    why: "A religious preference violates Title VII outside the narrow religious-organisation exemption.",
  },

  // ── FAMILY / MARITAL STATUS ──
  {
    re: /\b(no|without)\s+(children|kids|dependants?|dependents?)\b|\b(single|unmarried|childless)\s+(candidates?|applicants?)\s+(only|preferred)\b/i,
    category: "FAMILY_STATUS",
    confidence: "HIGH",
    why: "Family and marital status are protected in many states and this also creates a sex-discrimination inference.",
  },
  {
    re: /\bnot\s+(planning|intending)\s+to\s+(have\s+children|start\s+a\s+family)\b|\bno\s+(maternity|pregnancy)\b/i,
    category: "FAMILY_STATUS",
    confidence: "HIGH",
    why: "Pregnancy and family planning are protected under the Pregnancy Discrimination Act.",
  },

  // ── RACE ──
  {
    re: /\b(white|black|asian|hispanic|latino|caucasian)\s+(candidates?|applicants?)\s+(only|preferred)\b/i,
    category: "RACE",
    confidence: "HIGH",
    why: "An explicit racial preference is a direct Title VII violation.",
  },
  {
    re: /\bgood\s+cultural\s+fit\s*[—–-]\s*(must|should)\s+look\b/i,
    category: "RACE",
    confidence: "HIGH",
    why: "Appearance-based “culture fit” language invites race, age and disability discrimination claims.",
  },

  // ── VETERAN STATUS ──
  {
    re: /\bno\s+veterans?\b|\bveterans?\s+need\s+not\s+apply\b/i,
    category: "VETERAN",
    confidence: "HIGH",
    why: "Veteran status is protected under USERRA and many state laws.",
  },
];

export type ScreenResult = {
  /** True when nothing HIGH-confidence was found and the post may publish. */
  ok: boolean;
  findings: Finding[];
  /** HIGH-confidence findings — these block. */
  blocking: Finding[];
  /** LOW-confidence findings — advisory only, logged, publication permitted. */
  advisory: Finding[];
};

/**
 * Screen a posting.
 *
 * Deliberately a curated pattern list rather than a model. Three reasons: a
 * recruiter can be shown exactly which words triggered the block and why, which
 * a model cannot do; the list is reviewable by counsel, which a model is not;
 * and it is deterministic, so the same posting is treated the same way every
 * time. The trade-off is that it will miss novel phrasings — which is what
 * TRUST-002 reporting and ADMIN-005 moderation are for.
 */
export function screenPosting(fields: {
  title?: string | null;
  description?: string | null;
  perks?: string[] | null;
}): ScreenResult {
  const text = [fields.title ?? "", fields.description ?? "", ...(fields.perks ?? [])].join("\n");

  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (const p of PATTERNS) {
    // Fresh regex per test — a shared /g/ regex carries lastIndex between calls
    // and silently skips matches on the second posting screened.
    const re = new RegExp(p.re.source, p.re.flags.includes("i") ? "gi" : "g");
    for (const m of text.matchAll(re)) {
      const matched = m[0].trim();
      const key = `${p.category}:${matched.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        category: p.category,
        confidence: p.confidence,
        matched,
        why: p.why,
        suggestion: p.suggestion,
      });
    }
  }

  const blocking = findings.filter((f) => f.confidence === "HIGH");
  const advisory = findings.filter((f) => f.confidence === "LOW");
  return { ok: blocking.length === 0, findings, blocking, advisory };
}

/** A message the recruiter can act on without needing a lawyer to read it. */
export function explainScreen(r: ScreenResult): string {
  if (r.blocking.length === 0) return "";
  const lines = r.blocking.map(
    (f) => `• “${f.matched}” — ${f.why}${f.suggestion ? ` ${f.suggestion}` : ""}`
  );
  return (
    `This posting can't be published yet. Job advertisements may not indicate a preference ` +
    `based on a protected characteristic, and Jobsy is treated as an employment agency under ` +
    `federal law, so we're responsible for what we publish as well as you.\n\n` +
    `${lines.join("\n")}\n\n` +
    `Edit the posting and try again. If one of these is a genuine bona fide occupational ` +
    `qualification, contact us and we'll review and document it.`
  );
}
