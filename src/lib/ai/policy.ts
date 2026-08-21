/**
 * RES-005 / RES-007 / NFR-002 — WHICH model is allowed to see WHICH text.
 *
 * Its own module, with no imports, for the same reason `rejectionReasons.ts`
 * is: this table has to be readable from a client component, from the API
 * layer, and from a test that runs with no database and no network. It is also
 * the file a data-protection reviewer will ask to see, and a file that imports
 * nothing is a file you can hand someone.
 *
 * ── The problem this exists to solve ──
 *
 * Both free tiers are genuinely free, and they are not equivalent. Groq's terms
 * say inputs are not used to train models. Google's *free* Gemini tier says the
 * opposite in plain language: submissions are used to improve Google's
 * products, and human reviewers may read them. That difference does not matter
 * for a job description — the employer published it to the world. It matters
 * enormously for a resume, which is the most personal document in this product
 * and typically the only place a candidate has written about their own career
 * in their own words.
 *
 * So "use both" is implemented as: both providers are wired, both do real work,
 * and the routing is by what the text IS rather than by which key happens to be
 * set. A provider that trains on its inputs never receives candidate content.
 *
 * ── The escape hatch ──
 *
 * Google's PAID tier does not train on submissions. `GEMINI_PAID_TIER=true`
 * flips Gemini's posture and makes it eligible for candidate content as a
 * fallback behind Groq. That is a billing decision with a data-protection
 * consequence, which is exactly the kind of decision that should be one
 * explicit environment variable rather than a code change.
 */

/**
 * What the text is, not how secret it feels.
 *
 * The distinction that matters legally is whether a natural person can be
 * identified from it and whether they authored it about themselves.
 */
export const SENSITIVITIES = ["CANDIDATE_CONTENT", "EMPLOYER_PUBLIC"] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

export const SENSITIVITY_NOTE: Record<Sensitivity, string> = {
  CANDIDATE_CONTENT:
    "Written by a candidate about themselves — resume text, summary, bio. Personal data under GDPR Art. 4(1).",
  EMPLOYER_PUBLIC:
    "Published by an employer to the open web — job descriptions, company blurbs. Not personal data.",
};

export const AI_PROVIDERS = ["groq", "gemini"] as const;
export type AiProviderName = (typeof AI_PROVIDERS)[number];

export type ProviderPosture = {
  name: AiProviderName;
  /**
   * Does this provider use submitted content to train or improve its models?
   *
   * This single boolean is the whole gate. It is stated per provider rather
   * than inferred, because the answer comes from a terms-of-service page and
   * changes when that page changes — not from anything observable in code.
   */
  trainsOnInput: boolean;
  /** Cited so the claim above can be checked rather than trusted. */
  basis: string;
};

/**
 * The posture table.
 *
 * `paidGemini` is passed in rather than read from env so this function stays
 * pure and the test suite can exercise both worlds without setting variables.
 */
export function postures(paidGemini: boolean): Record<AiProviderName, ProviderPosture> {
  return {
    groq: {
      name: "groq",
      trainsOnInput: false,
      basis: "Groq terms: customer inputs and outputs are not used to train Groq models.",
    },
    gemini: {
      name: "gemini",
      trainsOnInput: !paidGemini,
      basis: paidGemini
        ? "Google AI paid tier: prompts and responses are not used to improve Google products."
        : "Google AI free tier: submissions ARE used to improve Google products and may be human-reviewed.",
    },
  };
}

/**
 * The rule, in one line, deliberately not spread across the codebase.
 *
 * Everything else in this file is bookkeeping around this sentence: content a
 * candidate wrote about themselves may not go to a provider that trains on it.
 */
export function mayHandle(p: ProviderPosture, s: Sensitivity): boolean {
  if (s === "CANDIDATE_CONTENT") return p.trainsOnInput === false;
  return true;
}

/**
 * Why a provider was refused, in words that belong in an incident write-up
 * rather than a stack trace.
 */
export function refusalReason(p: ProviderPosture, s: Sensitivity): string | null {
  if (mayHandle(p, s)) return null;
  return `${p.name} is not eligible for ${s}: ${p.basis}`;
}

/**
 * Preference order WITHIN the providers that are allowed.
 *
 * Groq first everywhere. For candidate content that is a requirement; for
 * employer text it is a latency choice — Groq's inference is fast enough to
 * stay comfortably inside a 60-second serverless ceiling, and Gemini backs it
 * up when Groq rate-limits, which on a free tier it will.
 */
const PREFERENCE: AiProviderName[] = ["groq", "gemini"];

export type RoutingInput = {
  sensitivity: Sensitivity;
  /** Which providers actually have a key configured. */
  configured: AiProviderName[];
  paidGemini: boolean;
};

export type Routing = {
  /** In order. The first is tried, the rest are fallbacks. */
  eligible: AiProviderName[];
  /** Configured but refused, with the reason. Surfaced, never silent. */
  refused: { provider: AiProviderName; reason: string }[];
};

export function route(input: RoutingInput): Routing {
  const table = postures(input.paidGemini);
  const configured = PREFERENCE.filter((p) => input.configured.includes(p));

  const eligible: AiProviderName[] = [];
  const refused: { provider: AiProviderName; reason: string }[] = [];

  for (const name of configured) {
    const p = table[name];
    const why = refusalReason(p, input.sensitivity);
    if (why) refused.push({ provider: name, reason: why });
    else eligible.push(name);
  }

  return { eligible, refused };
}

/**
 * The sub-processor disclosure, generated from the same table that enforces the
 * routing.
 *
 * A privacy policy that is written by hand drifts from what the code does. This
 * one cannot: if a provider is added or a posture changes, this text changes
 * with it. Naming sub-processors is required under GDPR Art. 28(2) and is the
 * kind of statement that must be true rather than approximately true.
 */
export function subProcessorDisclosure(input: {
  configured: AiProviderName[];
  paidGemini: boolean;
}): string[] {
  const table = postures(input.paidGemini);
  return PREFERENCE.filter((p) => input.configured.includes(p)).map((name) => {
    const p = table[name];
    const scope = mayHandle(p, "CANDIDATE_CONTENT")
      ? "resume and profile text you ask us to rewrite, and job-description text"
      : "job-description text published by employers only — never your resume or profile";
    const label = name === "groq" ? "Groq, Inc." : "Google LLC (Google AI)";
    return `${label} — used for: ${scope}. ${p.basis}`;
  });
}
