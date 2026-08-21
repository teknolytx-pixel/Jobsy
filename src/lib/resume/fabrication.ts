/**
 * RES-007 — "AI shall not invent qualifications."
 *
 * That requirement is one sentence in the FSD and it is the hardest one in the
 * document, because inventing plausible detail is the *default* behaviour of a
 * language model. Asked to improve "managed the deployment pipeline", a model
 * will happily return "reduced deployment time by 40% across 12 microservices."
 * That reads better. It is also a fabricated claim on a legal document that a
 * candidate will be asked about in an interview, and they will not know where
 * it came from.
 *
 * A prompt saying "do not invent anything" is a request, not a control. This
 * module is the control: every AI-rewritten sentence is checked against the
 * text it came from, and any rewrite that introduces a new fact is DISCARDED
 * and the original is kept. The candidate never sees the fabricated version.
 *
 * ── What counts as a fact ──
 *
 * Not every new word is an invention — "led" for "was responsible for" is
 * exactly the improvement we want. What cannot appear from nowhere is anything
 * checkable:
 *
 *   numbers      "40%", "12", "$2M", "3x"     — the classic resume fabrication
 *   years        1998–2035                     — dates of employment
 *   proper nouns "Kubernetes", "Goldman Sachs" — tools and employers
 *   acronyms     "AWS", "SOC2"                 — credentials and platforms
 *
 * A rewrite that contains only facts already present in the source is a
 * rephrasing. One that contains a fact the source does not is a fabrication,
 * regardless of how reasonable it sounds. That test is mechanical, which is the
 * point — it does not depend on a model's judgement about its own output.
 *
 * Deterministic and import-free, so it is testable with no key and no network.
 */

export type FabricationCheck = {
  ok: boolean;
  /** Facts in the rewrite with no basis in the source. */
  invented: string[];
  /** Why it was rejected, for the audit log — not shown to the candidate. */
  reason: string | null;
};

/** Words that are capitalised for grammar, not because they name something. */
const SENTENCE_STARTERS = new Set([
  "a","an","the","and","or","but","if","when","while","after","before","during",
  "led","built","drove","owned","managed","designed","shipped","ran","grew",
  "reduced","improved","created","launched","delivered","developed","worked",
  "this","that","these","those","i","we","my","our","in","on","at","for","to",
  "with","from","by","as","of","also","then","new","also","across","over",
]);

/**
 * Numbers that carry no claim.
 *
 * "24/7" and "one" are not achievements, and flagging them turns the guard into
 * noise that gets switched off. The magnitudes that matter on a resume are the
 * ones a hiring manager would ask you to substantiate.
 */
const HARMLESS_NUMBERS = new Set(["0", "1", "2", "24", "7", "one", "two", "first", "second"]);

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9%$.+]/g, "");
}

/** Numbers, percentages, money, multipliers. */
export function extractNumbers(text: string): string[] {
  const out: string[] = [];
  const re = /(?:[$€£]\s?)?\d[\d,.]*\s?(?:%|k\b|m\b|bn?\b|x\b)?/gi;
  for (const m of text.match(re) ?? []) {
    const t = m.trim();
    const bare = t.replace(/[^0-9]/g, "");
    if (!bare) continue;
    if (HARMLESS_NUMBERS.has(bare) && !/[%$kmbx]/i.test(t)) continue;
    out.push(normalise(t));
  }
  return out;
}

/** Four-digit years in a plausible employment range. */
export function extractYears(text: string): string[] {
  return (text.match(/\b(19[5-9]\d|20[0-4]\d)\b/g) ?? []).map(normalise);
}

/**
 * Proper nouns and acronyms — the things a resume names.
 *
 * Capitalised mid-sentence words, plus all-caps runs of 2–6 letters anywhere.
 * Crude on purpose: a false positive costs one discarded rewrite, a false
 * negative puts an invented employer on someone's resume.
 */
export function extractNames(text: string): string[] {
  const out = new Set<string>();

  for (const acr of text.match(/\b[A-Z][A-Z0-9]{1,5}\b/g) ?? []) {
    out.add(normalise(acr));
  }

  // Split into sentences so the first word of each is exempt from the
  // capitalisation signal — it tells us about punctuation, not about naming.
  for (const sentence of text.split(/(?<=[.!?;])\s+|\n+/)) {
    const words = sentence.trim().split(/\s+/);
    words.forEach((raw, i) => {
      const w = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9+#.]+$/g, "");
      if (w.length < 2) return;
      if (!/^[A-Z]/.test(w)) return;
      if (i === 0 && !/[A-Z]{2}/.test(w)) return; // sentence-initial, not an acronym
      if (SENTENCE_STARTERS.has(w.toLowerCase())) return;
      out.add(normalise(w));
    });
  }

  return [...out];
}

/**
 * Every checkable fact in a piece of text.
 *
 * Exported so a test can assert on the extraction itself — a guard whose
 * extractor is wrong is a guard that passes everything.
 */
export function facts(text: string): Set<string> {
  return new Set([...extractNumbers(text), ...extractYears(text), ...extractNames(text)]);
}

/**
 * How much longer a rewrite may be than its source.
 *
 * Length is a proxy for invention that catches what fact-extraction misses:
 * unquantified padding ("demonstrating strong leadership and a commitment to
 * excellence") adds no extractable fact and no information either. 1.6 leaves
 * room for genuinely clearer phrasing while refusing a paragraph grown from a
 * fragment.
 */
export const MAX_GROWTH = 1.6;

export function checkRewrite(source: string, rewrite: string): FabricationCheck {
  const src = facts(source);
  const invented = [...facts(rewrite)].filter((f) => !src.has(f));

  if (invented.length) {
    return {
      ok: false,
      invented,
      reason: `Rewrite introduced ${invented.length} fact(s) absent from the source: ${invented.join(", ")}`,
    };
  }

  const srcLen = source.trim().length;
  if (srcLen > 0 && rewrite.trim().length > srcLen * MAX_GROWTH) {
    return {
      ok: false,
      invented: [],
      reason: `Rewrite grew from ${srcLen} to ${rewrite.trim().length} characters (limit ${Math.floor(srcLen * MAX_GROWTH)}).`,
    };
  }

  if (!rewrite.trim()) {
    return { ok: false, invented: [], reason: "Rewrite was empty." };
  }

  return { ok: true, invented: [], reason: null };
}

/**
 * Apply a rewrite only if it survives the check.
 *
 * The fallback is the CANDIDATE'S OWN SENTENCE, which is always a safe answer:
 * the worst outcome of a rejected rewrite is that their resume reads exactly as
 * they wrote it.
 */
export function safeRewrite(
  source: string,
  rewrite: string | null | undefined
): { text: string; applied: boolean; check: FabricationCheck | null } {
  if (!rewrite || !rewrite.trim()) {
    return { text: source, applied: false, check: null };
  }
  const check = checkRewrite(source, rewrite);
  return check.ok
    ? { text: rewrite.trim(), applied: true, check }
    : { text: source, applied: false, check };
}
