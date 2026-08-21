/**
 * SRC-014 — demand-driven ingestion.
 *
 * The aggregators are query-based: you ask for "machine learning engineer in
 * usa" and you get back what Google for Jobs, Indeed, LinkedIn and the rest are
 * carrying for that phrase. Until now those phrases were a hardcoded list of
 * five, written when the platform had no users. The consequence is the obvious
 * one: an ML engineer signs up, and the corpus contains almost nothing for
 * them, because nobody ever asked the aggregators for it.
 *
 * This module derives the phrases from the people actually on the platform, so
 * supply follows demand instead of following a constant someone typed once.
 *
 * ── Why this is not a matching feature ──
 *
 * It shapes WHICH JOBS EXIST IN THE DATABASE. It never touches which candidate
 * sees which job — that is the eligibility layer and the scoring engine, and
 * neither of them imports this file. A phrase derived from aggregate demand is
 * a purchasing decision about supply, not a judgement about a person.
 *
 * ── Why the threshold exists ──
 *
 * With one ML engineer registered, "machine learning engineer in germany" is
 * not an aggregate — it is that person, and the job table becomes a public
 * record of what they are looking for, readable by anyone with database access.
 * So a phrase has to be shared by MIN_CANDIDATES distinct people before it is
 * ever sent to a third party. Below that, the static fallback runs instead.
 * This costs a little coverage early on and is not negotiable.
 */
// Relative, not aliased: this module is imported by a test that runs outside
// Next's resolver, and `@/` is a tsconfig path Next provides.
import { countryName, toCountryCode, UNKNOWN_COUNTRY } from "./geo/countries";

/** A phrase must be shared by this many distinct candidates to be queried. */
export const MIN_CANDIDATES = 3;

/** Upper bound on queries per run. Each one is a paid API call and 250ms. */
export const MAX_QUERIES = 12;

/**
 * Used when live demand is too thin to clear the threshold — a brand-new
 * install, or a platform whose candidates are too varied to form a group.
 * Deliberately broad: this is the "we do not know yet" case, so it should
 * cover the widest common roles rather than guess at a niche.
 */
export const FALLBACK_QUERIES = [
  "software engineer in usa",
  "frontend engineer in usa",
  "data engineer in usa",
  "machine learning engineer in usa",
  "product designer in usa",
];

/**
 * Seniority is stripped before grouping. The aggregators return every level for
 * a role phrase anyway, and Jobsy ranks seniority itself downstream — so
 * keeping it would split "senior ML engineer" and "ML engineer" into two
 * buckets that each fall under the threshold, and query neither.
 */
const SENIORITY =
  /^(?:junior|jr\.?|entry[- ]level|associate|mid(?:[- ]level)?|senior|sr\.?|staff|principal|lead|head of|vp of|director of|chief)\s+/i;

/** Trailing domain qualifiers: "ML Engineer, Healthcare" → "ML Engineer". */
const QUALIFIER = /[,(].*$/;

const EXPANSIONS: Record<string, string> = {
  "ml engineer": "machine learning engineer",
  "ai engineer": "artificial intelligence engineer",
  "ml/ai engineer": "machine learning engineer",
  "ai/ml engineer": "machine learning engineer",
  "swe": "software engineer",
  "sre": "site reliability engineer",
  "pm": "product manager",
  "fe engineer": "frontend engineer",
  "be engineer": "backend engineer",
};

/**
 * Reduce a free-text title or headline to a stable role phrase, or null if
 * there is nothing usable. Returning null is the right answer far more often
 * than a bad guess: a junk phrase costs a paid API call and returns nothing.
 */
export function roleTerm(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.replace(QUALIFIER, " ").toLowerCase();
  s = s.replace(/[^a-z0-9/+.\s-]/g, " ").replace(/\s+/g, " ").trim();
  // Strip seniority repeatedly: "senior staff engineer" → "engineer".
  for (let i = 0; i < 3 && SENIORITY.test(s); i++) s = s.replace(SENIORITY, "");
  s = s.trim();
  if (EXPANSIONS[s]) s = EXPANSIONS[s];
  const words = s.split(" ").filter(Boolean);
  if (words.length === 0 || words.length > 5) return null;
  // A single word is only a role if it is one of the ones that genuinely is.
  if (words.length === 1 && !["engineer", "designer", "developer", "analyst", "scientist", "manager", "architect", "recruiter"].includes(words[0])) {
    return null;
  }
  return words.join(" ");
}

export type DemandQuery = {
  /** "machine learning engineer" */
  role: string;
  /** ISO alpha-2, or null when the group spans countries. */
  country: string | null;
  /** Distinct candidates behind this phrase. Never fewer than MIN_CANDIDATES. */
  candidates: number;
};

/**
 * The live demand signal: role phrases shared by at least MIN_CANDIDATES
 * candidates who are open to offers, paired with the country they are
 * searching in.
 */
export async function demandSignal(): Promise<DemandQuery[]> {
  // Imported lazily so the pure half of this module — the normalisation and
  // rendering that carry all the judgement — can be unit-tested without a
  // database connection, and so importing it never opens a pool by surprise.
  const { and, eq, isNull } = await import("drizzle-orm");
  const { db, users } = await import("@/db");

  const rows = await db
    .select({
      title: users.title,
      headline: users.headline,
      searchCountry: users.searchCountry,
      currentCountry: users.currentCountry,
      location: users.location,
    })
    .from(users)
    .where(
      and(
        eq(users.role, "CANDIDATE"),
        eq(users.openToOffers, true),
        eq(users.profileReady, true),
        isNull(users.deletedAt)
      )
    );

  const buckets = new Map<string, DemandQuery>();
  for (const r of rows) {
    const role = roleTerm(r.title) ?? roleTerm(r.headline);
    if (!role) continue;

    const code = toCountryCode(r.searchCountry ?? r.currentCountry ?? "");
    const country = code === UNKNOWN_COUNTRY ? null : code;

    const key = `${role}|${country ?? ""}`;
    const found = buckets.get(key);
    if (found) found.candidates++;
    else buckets.set(key, { role, country, candidates: 1 });
  }

  return [...buckets.values()]
    .filter((b) => b.candidates >= MIN_CANDIDATES)
    .sort((a, b) => b.candidates - a.candidates || a.role.localeCompare(b.role))
    .slice(0, MAX_QUERIES);
}

/**
 * The two query shapes the aggregators take.
 *   PHRASE — JSearch: one string, "machine learning engineer in united states"
 *   PIPE   — Jooble, Careerjet, Adzuna: "keywords|location"
 */
export type QueryShape = "PHRASE" | "PIPE";

export function renderQuery(d: DemandQuery, shape: QueryShape): string {
  const where = d.country ? countryName(d.country).toLowerCase() : "";
  return shape === "PIPE" ? `${d.role}|${where}` : where ? `${d.role} in ${where}` : d.role;
}

/**
 * Render the demand signal in the form a given aggregator expects, falling back
 * when demand is too thin to clear the threshold.
 */
export async function demandQueries(
  shape: QueryShape = "PHRASE",
  fallback: string[] = FALLBACK_QUERIES,
  limit: number = MAX_QUERIES
): Promise<string[]> {
  const cap = Math.max(1, Math.min(limit, MAX_QUERIES));
  let signal: DemandQuery[];
  try {
    signal = await demandSignal();
  } catch (err) {
    // Ingestion must not fail because the demand lookup did. A stale corpus is
    // recoverable; a cron job that dies leaves the corpus stale AND silent.
    console.warn("[demand] falling back to the static query list:", err);
    return fallback.slice(0, cap);
  }
  if (!signal.length) return fallback.slice(0, cap);

  return signal.slice(0, cap).map((d) => renderQuery(d, shape));
}

/**
 * How many queries one run may spend against a metered provider.
 *
 * Divided over 31 days rather than 30, and floored, so the month can only ever
 * come in UNDER the plan. The alternative — spend freely and stop when the
 * provider says no — means ingestion silently dies partway through every month,
 * which reads as "the site stopped working" rather than "the quota ran out".
 *
 * A budget too small for even one query still yields one: a provider that is
 * configured but never called is worse than one that runs once a day.
 */
export function queriesPerRun(monthlyBudget: number, daysInMonth = 31): number {
  if (!Number.isFinite(monthlyBudget) || monthlyBudget <= 0) return 1;
  return Math.max(1, Math.min(MAX_QUERIES, Math.floor(monthlyBudget / daysInMonth)));
}
