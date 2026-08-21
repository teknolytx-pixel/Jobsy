import { runAi } from "../ai";
import { safeRewrite, type FabricationCheck } from "./fabrication";

/**
 * RES-005 (the generative half) — polish sentences the candidate already wrote.
 *
 * Everything else in the resume feature is deterministic. This is the one place
 * a model is genuinely the right tool: turning "was responsible for the
 * deployment pipeline and also did some on-call" into "Owned the deployment
 * pipeline and on-call rotation" is a language judgement, and no rule table
 * makes it well.
 *
 * Three constraints hold it in place, and they matter more than the prompt.
 *
 *  1. SENSITIVITY. Resume prose is CANDIDATE_CONTENT, so `policy.ts` will only
 *     route it to a provider that does not train on its inputs. On the default
 *     configuration that means Groq handles this and Gemini never sees it.
 *
 *  2. VERIFICATION, not instruction. The prompt says do not invent — and then
 *     `fabrication.ts` checks whether it did, mechanically, and throws the
 *     rewrite away if so. The prompt is a hint; the check is the control. This
 *     is the only reason RES-007 is a claim we can actually make.
 *
 *  3. FALLBACK. No key, rate limit, timeout, refusal, or failed check all land
 *     in the same place: the candidate's original sentence. The feature
 *     degrades to "your resume, as you wrote it", which is never a broken
 *     state.
 */

const SYSTEM = [
  "You edit resume bullet points. You do not write them.",
  "",
  "Rules, in order of importance:",
  "1. Never add a fact. No numbers, percentages, dates, employers, tools, or",
  "   technologies that are not already in the input. If the input has no",
  "   metric, the output has no metric.",
  "2. Never make a claim stronger than the input. 'Helped build' does not",
  "   become 'built'. 'Contributed to' does not become 'led'.",
  "3. Keep it one line, and no longer than the input.",
  "4. Start with a concrete past-tense verb. Cut filler like 'responsible for',",
  "   'tasked with', 'various', 'utilized'.",
  "5. Return the rewritten line only. No preamble, no quotes, no alternatives.",
  "",
  "If the input is already good, return it unchanged. That is a correct answer.",
].join("\n");

export type RewrittenLine = {
  original: string;
  text: string;
  applied: boolean;
  /** Populated when a rewrite came back and was REJECTED. Logged, not shown —
   *  a candidate does not need to see the sentence we refused to give them. */
  rejected: FabricationCheck | null;
  provider: string | null;
};

/**
 * How many lines one request may polish.
 *
 * Bounded because this runs inside a serverless function on a 60-second
 * ceiling, and because a free-tier rate limit spent on forty bullets is a rate
 * limit not available for the next candidate.
 */
export const MAX_LINES = 12;

/**
 * Polish one line.
 *
 * Sequential rather than batched on purpose: one line per request means the
 * model sees no other context to borrow a fact from. Batching bullets into a
 * single prompt is how "Kubernetes" migrates from the third bullet into the
 * first, and that migration would pass a per-line fabrication check run against
 * the wrong source.
 */
export async function polishLine(line: string): Promise<RewrittenLine> {
  const src = line.trim();
  if (src.length < 12) {
    return { original: src, text: src, applied: false, rejected: null, provider: null };
  }

  const outcome = await runAi({
    sensitivity: "CANDIDATE_CONTENT",
    system: SYSTEM,
    user: src,
    temperature: 0.2,
    maxTokens: 120,
    timeoutMs: 12_000,
  });

  if (!outcome.result) {
    return { original: src, text: src, applied: false, rejected: null, provider: null };
  }

  // Models like to wrap a single answer in quotes or a bullet marker even when
  // told not to. Stripping that is formatting, not content.
  const candidate = outcome.result.text
    .replace(/^["'`\s*•\-–]+/, "")
    .replace(/["'`\s]+$/, "")
    .split("\n")[0]
    .trim();

  const { text, applied, check } = safeRewrite(src, candidate);
  return {
    original: src,
    text,
    applied,
    rejected: applied ? null : check,
    provider: outcome.result.provider,
  };
}

export type PolishReport = {
  lines: RewrittenLine[];
  /** Counted for the admin surface: a rising rejection rate is the signal that
   *  a model or a prompt has drifted, and it is invisible without this. */
  stats: { total: number; applied: number; rejected: number; skipped: number };
  provider: string | null;
  /** Set when no model was available. The UI says so rather than pretending the
   *  unchanged text was a considered decision. */
  unavailable: boolean;
};

export async function polishLines(input: string[]): Promise<PolishReport> {
  const slice = input.slice(0, MAX_LINES);
  const lines: RewrittenLine[] = [];
  for (const l of slice) lines.push(await polishLine(l));

  const applied = lines.filter((l) => l.applied).length;
  const rejected = lines.filter((l) => l.rejected).length;
  const provider = lines.find((l) => l.provider)?.provider ?? null;

  return {
    lines,
    stats: {
      total: lines.length,
      applied,
      rejected,
      skipped: lines.length - applied - rejected,
    },
    provider,
    unavailable: provider === null,
  };
}
