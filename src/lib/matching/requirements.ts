import { extractSkills, normalizeSkills } from "../skills";

/**
 * REQUIREMENT EXTRACTION
 *
 * A job description is not a flat bag of skills. It has structure that every
 * human reader uses and the old engine ignored entirely:
 *
 *   "Requirements: 5+ years of React and TypeScript.
 *    Nice to have: Kubernetes, GraphQL."
 *
 * React and TypeScript are the job. Kubernetes is a bonus. Scoring them equally
 * means a Kubernetes expert with no React outranks a React expert with no
 * Kubernetes — precisely backwards.
 *
 * This is regex-and-heuristics, not an LLM, for three reasons: it costs nothing
 * per job (we ingest thousands), it's deterministic so the same job always
 * scores the same way, and it can be read line-by-line by a bias auditor.
 */

export type Requirements = {
  required: string[];
  preferred: string[];
  /** Minimum years the posting explicitly asks for, if it names one. */
  minYears: number | null;
  /** Phrases that should exclude rather than downrank. */
  dealbreakers: Dealbreaker[];
  /** True when we found real "required" structure rather than guessing. */
  structured: boolean;
};

export type Dealbreaker =
  | { kind: "CLEARANCE"; detail: string }
  | { kind: "WORK_AUTH"; detail: string }
  | { kind: "ONSITE_ONLY"; detail: string }
  | { kind: "LICENSE"; detail: string };

/** Headings that introduce hard requirements. */
const REQUIRED_HEADINGS =
  /(?:^|\n)\s*(?:what (?:you|we)(?:'ll| will)? need|requirements?|qualifications?|must[- ]haves?|minimum qualifications?|basic qualifications?|you have|about you|who you are|we(?:'|’)re looking for)\s*:?\s*(?:\n|$)/i;

/** Headings that introduce optional extras. */
const PREFERRED_HEADINGS =
  /(?:^|\n)\s*(?:nice[- ]to[- ]haves?|preferred qualifications?|bonus(?: points)?|plus(?:es)?|would be(?: a)? plus|desirable|good to have|icing on the cake|extra credit)\s*:?\s*(?:\n|$)/i;

/** Headings that end a requirements block (benefits, EEO boilerplate, etc). */
const TERMINATOR_HEADINGS =
  /(?:^|\n)\s*(?:benefits?|perks?|what we offer|compensation|salary|our (?:values|mission)|equal opportunity|about (?:us|the company)|how to apply|interview process)\s*:?\s*(?:\n|$)/i;

function sliceSection(text: string, start: RegExp, stops: RegExp[]): string | null {
  const m = start.exec(text);
  if (!m) return null;
  const from = m.index + m[0].length;
  const rest = text.slice(from);

  let end = rest.length;
  for (const stop of stops) {
    const s = stop.exec(rest);
    if (s && s.index < end) end = s.index;
  }
  return rest.slice(0, end);
}

/**
 * "5+ years", "at least 3 years", "minimum of 7 years", "3-5 years".
 * Takes the SMALLEST figure found — postings often mention a higher number for
 * a different, more senior track in the same text, and over-reading the
 * requirement silently excludes qualified people.
 */
export function extractMinYears(text: string): number | null {
  const hits: number[] = [];
  const patterns = [
    /(\d{1,2})\s*\+?\s*(?:-|–|to)?\s*(?:\d{1,2})?\s*years?(?:'|’)?\s+(?:of\s+)?(?:relevant\s+|professional\s+|industry\s+|hands[- ]on\s+)?experience/gi,
    /(?:at least|minimum(?: of)?|min\.?)\s+(\d{1,2})\s*\+?\s*years?/gi,
    /(\d{1,2})\s*\+\s*years?/gi,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const n = Number(m[1]);
      // 25+ is almost always a typo or a company age, not a requirement
      if (Number.isFinite(n) && n > 0 && n <= 25) hits.push(n);
    }
  }
  if (!hits.length) return null;
  return Math.min(...hits);
}

const DEALBREAKER_RULES: [RegExp, Dealbreaker["kind"]][] = [
  [/\b(?:active\s+)?(?:security\s+)?clearance\b|\bts\/sci\b|\bpolygraph\b/i, "CLEARANCE"],
  [
    /\b(?:must be|only)\s+(?:a\s+)?(?:us|u\.s\.)\s+citizen|no\s+(?:visa\s+)?sponsorship|not\s+able\s+to\s+sponsor|without\s+sponsorship/i,
    "WORK_AUTH",
  ],
  [/\b(?:100%|fully)\s+onsite\b|\bno\s+remote\b|\bonsite\s+only\b/i, "ONSITE_ONLY"],
  [/\b(?:must (?:have|hold)|requires?)\s+(?:a\s+)?(?:valid\s+)?(?:cdl|rn|cpa|pe|bar|medical)\s+licen[cs]e/i, "LICENSE"],
];

export function extractDealbreakers(text: string): Dealbreaker[] {
  const out: Dealbreaker[] = [];
  const seen = new Set<string>();
  for (const [re, kind] of DEALBREAKER_RULES) {
    const m = re.exec(text);
    if (m && !seen.has(kind)) {
      seen.add(kind);
      // keep a short quote so the UI can show WHY someone was excluded
      const at = Math.max(0, m.index - 40);
      out.push({ kind, detail: text.slice(at, m.index + m[0].length + 40).trim() });
    }
  }
  return out;
}

/**
 * Split a job into required vs preferred skills.
 *
 * Falls back sensibly: if the posting has no recognisable structure (very
 * common on aggregator feeds, which truncate the body), everything the author
 * tagged is treated as required and the caller is told via `structured: false`
 * so it can weight the result less confidently.
 */
export function parseRequirements(job: {
  title: string;
  description: string;
  skills: string[];
  /** MATCH-002 — what the recruiter actually said, when they said it. */
  requiredSkills?: string[] | null;
  preferredSkills?: string[] | null;
}): Requirements {
  const text = job.description ?? "";
  const tagged = normalizeSkills(job.skills ?? []);

  /**
   * Authored beats inferred, always.
   *
   * Everything below this block is guesswork about prose — good guesswork, and
   * still the only option for the ~980 jobs ingested from feeds. But when a
   * recruiter has ticked "must have" against React and "nice to have" against
   * GraphQL, reading their description to work that out is not just wasted
   * effort, it is capable of contradicting them. A person who states a
   * requirement should not be overruled by a heading parser.
   */
  const authoredRequired = normalizeSkills(job.requiredSkills ?? []);
  if (authoredRequired.length) {
    const req = new Set(authoredRequired);
    // Stated in both lists — required wins, same rule as the inferred path.
    const authoredPreferred = normalizeSkills(job.preferredSkills ?? []).filter((s) => !req.has(s));
    return {
      required: authoredRequired.slice(0, 12),
      // Anything over the cap is demoted rather than dropped, so a recruiter
      // who lists fifteen requirements still has all fifteen counted — just not
      // all at full weight.
      preferred: [...authoredPreferred, ...authoredRequired.slice(12)],
      minYears: extractMinYears(text),
      dealbreakers: extractDealbreakers(text),
      structured: true,
    };
  }

  const requiredSection = sliceSection(text, REQUIRED_HEADINGS, [
    PREFERRED_HEADINGS,
    TERMINATOR_HEADINGS,
  ]);
  const preferredSection = sliceSection(text, PREFERRED_HEADINGS, [TERMINATOR_HEADINGS]);

  const fromRequired = requiredSection ? extractSkills(requiredSection, 15) : [];
  const fromPreferred = preferredSection ? extractSkills(preferredSection, 15) : [];

  // A skill named in BOTH sections is required — the stronger claim wins.
  const preferredSet = new Set(fromPreferred);
  for (const s of fromRequired) preferredSet.delete(s);

  let required = fromRequired;
  let preferred = [...preferredSet];
  const structured = fromRequired.length > 0;

  if (!structured) {
    // No parseable structure. Anything explicitly tagged on the job is the best
    // evidence we have; skills mined from prose are weaker, so demote those.
    const mined = extractSkills(text, 12);
    if (tagged.length) {
      required = tagged;
      preferred = mined.filter((s) => !tagged.includes(s));
    } else {
      required = mined.slice(0, 6);
      preferred = mined.slice(6);
    }
  } else {
    // Tagged skills that the prose didn't surface are still real requirements.
    for (const t of tagged) {
      if (!required.includes(t) && !preferred.includes(t)) required.push(t);
    }
  }

  // Guard against a pathological posting listing 30 "required" skills, which
  // would make every real human score badly.
  if (required.length > 12) {
    preferred = [...preferred, ...required.slice(12)];
    required = required.slice(0, 12);
  }

  return {
    required,
    preferred,
    minYears: extractMinYears(text),
    dealbreakers: extractDealbreakers(text),
    structured,
  };
}
