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

/**
 * How many skills count as REQUIRED on a posting with no stated requirements.
 *
 * Six, because that is roughly what a real job ad asks for when it bothers to
 * be specific, and because the skills arrive in evidence order so the first six
 * are the ones the description actually dwells on. Everything after is demoted
 * to preferred, not discarded.
 */
export const UNSTRUCTURED_REQUIRED = 6;

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
    /**
     * No parseable structure — about 980 of the corpus, because aggregator
     * feeds truncate the body and lose the "Requirements:" heading with it.
     *
     * ── Why only the first few are required ──
     *
     * This used to promote EVERY tagged skill to a hard requirement, up to
     * twelve. But a tagged skill on an unstructured posting is not a stated
     * requirement; it is a technology the description happened to mention, and
     * `extractSkills` will happily return a dozen from any well-written job ad.
     * Demanding all twelve is a bar no real person clears, so a genuinely
     * strong candidate scored like a weak one and the whole ingested corpus sat
     * artificially low.
     *
     * The tagged list is in evidence order (most-mentioned first, see
     * extractSkillEvidence), so the leading few really are what the posting is
     * about. The tail is demoted to preferred rather than dropped — it still
     * counts, at the lower weight, which is what "mentioned once near the
     * bottom" is worth.
     *
     * Note this can only RAISE scores on unstructured postings, and only for
     * candidates who match the leading skills. It does not help someone who
     * matches nothing: the required block still has to be earned.
     */
    const mined = extractSkills(text, 12);
    if (tagged.length) {
      required = tagged.slice(0, UNSTRUCTURED_REQUIRED);
      preferred = [
        ...tagged.slice(UNSTRUCTURED_REQUIRED),
        ...mined.filter((s) => !tagged.includes(s)),
      ];
    } else {
      required = mined.slice(0, UNSTRUCTURED_REQUIRED);
      preferred = mined.slice(UNSTRUCTURED_REQUIRED);
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
