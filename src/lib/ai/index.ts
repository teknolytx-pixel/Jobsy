import {
  AI_PROVIDERS,
  route,
  subProcessorDisclosure,
  type AiProviderName,
  type Sensitivity,
} from "./policy";

/**
 * The AI layer — two providers, one gate.
 *
 * Nothing in this file decides what may be sent where. That lives in
 * `policy.ts`, which imports nothing and is tested on its own; this file only
 * carries out the routing decision, calls the chosen HTTP API, and falls back
 * to the next eligible provider when one fails.
 *
 * ── Everything here is optional ──
 *
 * With no keys set, `runAi()` returns null and every caller has a working
 * deterministic path. That is a hard requirement, not a courtesy: the resume
 * builder, the gap analysis and the tailoring all function with no model at
 * all, and the AI polish is the only feature that degrades. A product whose
 * core breaks when a free tier rate-limits is a product that breaks.
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Model choices, both on the free tier.
 *
 * Small instruction-tuned models on purpose. The work here is rephrasing a
 * sentence someone else wrote and extracting fields from a job description —
 * neither benefits from a larger model, and both benefit from finishing inside
 * a 60-second serverless ceiling.
 */
const GROQ_MODEL = process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile";
const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash";

function key(p: AiProviderName): string | undefined {
  const raw = p === "groq" ? process.env.GROQ_API_KEY : process.env.GEMINI_API_KEY;
  return raw && raw.trim() ? raw.trim() : undefined;
}

export function paidGemini(): boolean {
  return (process.env.GEMINI_PAID_TIER ?? "").toLowerCase() === "true";
}

export function configuredProviders(): AiProviderName[] {
  return AI_PROVIDERS.filter((p) => Boolean(key(p)));
}

export function aiEnabled(): boolean {
  return configuredProviders().length > 0;
}

/** The privacy-policy text, derived from the live configuration. */
export function disclosure(): string[] {
  return subProcessorDisclosure({ configured: configuredProviders(), paidGemini: paidGemini() });
}

export type AiRequest = {
  /** What the text IS. Decides which providers may see it. */
  sensitivity: Sensitivity;
  system: string;
  user: string;
  /** Hard cap — every task here produces a sentence or a small object. */
  maxTokens?: number;
  /** 0 for extraction. Low but non-zero for rewriting. */
  temperature?: number;
  /** Wall-clock budget. Well under the 60s Vercel Hobby ceiling. */
  timeoutMs?: number;
};

export type AiResult = {
  text: string;
  provider: AiProviderName;
  model: string;
  ms: number;
};

export type AiOutcome = {
  result: AiResult | null;
  /** Every provider tried and why it did not answer. Never swallowed. */
  attempts: { provider: AiProviderName; ok: boolean; note: string }[];
  /** Configured providers the policy refused for this sensitivity. */
  refused: { provider: AiProviderName; reason: string }[];
};

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fn(ac.signal);
  } finally {
    clearTimeout(t);
  }
}

async function callGroq(req: AiRequest, apiKey: string, signal: AbortSignal): Promise<string> {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: req.temperature ?? 0.2,
      max_tokens: req.maxTokens ?? 400,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = body.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("groq: no content in response");
  return text;
}

async function callGemini(req: AiRequest, apiKey: string, signal: AbortSignal): Promise<string> {
  // The key goes in a header rather than the query string so it cannot end up
  // in an access log or a proxy trace.
  const res = await fetch(`${GEMINI_URL}/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    signal,
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: "user", parts: [{ text: req.user }] }],
      generationConfig: {
        temperature: req.temperature ?? 0.2,
        maxOutputTokens: req.maxTokens ?? 400,
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
  if (!text) throw new Error("gemini: no content in response");
  return text;
}

/**
 * Run a task on the first eligible provider that answers.
 *
 * Returns an outcome rather than throwing, because every caller has a
 * deterministic fallback and none of them should be taking down a request over
 * a rate-limited free tier.
 */
export async function runAi(req: AiRequest): Promise<AiOutcome> {
  const { eligible, refused } = route({
    sensitivity: req.sensitivity,
    configured: configuredProviders(),
    paidGemini: paidGemini(),
  });

  const attempts: AiOutcome["attempts"] = [];

  for (const provider of eligible) {
    const apiKey = key(provider);
    if (!apiKey) continue;
    const started = Date.now();
    try {
      const text = await withTimeout(req.timeoutMs ?? 20_000, (signal) =>
        provider === "groq"
          ? callGroq(req, apiKey, signal)
          : callGemini(req, apiKey, signal)
      );
      attempts.push({ provider, ok: true, note: "ok" });
      return {
        result: {
          text: text.trim(),
          provider,
          model: provider === "groq" ? GROQ_MODEL : GEMINI_MODEL,
          ms: Date.now() - started,
        },
        attempts,
        refused,
      };
    } catch (e) {
      // Fall through to the next eligible provider. This is the whole point of
      // running two: a free tier that 429s should cost a slower response, not
      // a failed feature.
      attempts.push({ provider, ok: false, note: (e as Error).message.slice(0, 200) });
    }
  }

  return { result: null, attempts, refused };
}

export { type Sensitivity, type AiProviderName };
