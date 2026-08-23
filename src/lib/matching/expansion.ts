import { normalizeSkills } from "../skills";
import { neighbours } from "./taxonomy";

/**
 * SKILL EXPANSION — making retrieval agree with scoring.
 *
 * ── The bug this exists to close ──
 *
 * The match engine has always understood two things the database query did not:
 *
 *   ALIASES     "react.js" and "React" are one skill.
 *   ADJACENCY   Vue transfers to React at 0.55; PySpark to Databricks at 0.75.
 *
 * But a deck is built in two steps, and only the second step knew any of that.
 * Step one asked Postgres for a few hundred candidate rows; step two scored
 * them in TypeScript. Step one compared skill strings for exact equality.
 *
 * So a Vue developer's pool was chosen as though they had zero relevant skills:
 * every React job scored 0 at selection time, the pool filled with whatever was
 * newest, and the engine — which would have credited Vue at 0.55 — was handed a
 * pool that no longer contained the jobs it would have liked. The result is a
 * deck that looks random, which is exactly what was reported. The scoring was
 * never wrong. It was being asked the wrong question.
 *
 * This module produces the weighted skill set that lets the query rank by the
 * same notion of relatedness the engine scores by.
 *
 * ── Why this is retrieval and not scoring ──
 *
 * Worth being precise, because the distinction is a compliance one. Jobsy ranks
 * candidates for employers, so it is an Automated Employment Decision Tool
 * under NYC Local Law 144, and the audited artefact is the SCORING model in
 * engine.ts. Nothing here changes a score. Expansion decides which pairs get
 * scored at all — it can only ever ADD rows to the pool that exact matching
 * would have dropped. A pair that reaches the engine is scored by exactly the
 * same function, with exactly the same weights, as before.
 *
 * That is also why the top-skill weighting below is safe. Ordering a
 * candidate's own skills changes which jobs are fetched for them; it never
 * changes how a fetched job scores. If it did, a candidate would be penalised
 * for the order they happened to type things in, which is indefensible.
 */

export type WeightedSkill = { skill: string; weight: number };

/**
 * How much less the last of a candidate's skills counts than the first, when
 * deciding what to fetch.
 *
 * Deliberately the same 1.0 → 0.6 shape the engine uses for a posting's
 * required skills (engine.ts positionalWeight). A person listing twenty skills
 * is telling you something with the order; a person listing three is not, and
 * the shape barely moves across three.
 *
 * The floor is 0.6 and not 0: a skill someone bothered to list is never
 * irrelevant, it is just less central than the one they led with.
 */
const TAIL_FLOOR = 0.6;

/** Below this, an edge is noise and not worth a row in the query. */
const MIN_WEIGHT = 0.3;

/**
 * Bound on the expanded set, so one profile cannot produce an enormous query.
 * 40 skills (the profile cap) times a handful of neighbours each lands well
 * under this; it exists for the pathological case, not the normal one.
 */
const MAX_TERMS = 300;

function positionalWeight(index: number, total: number): number {
  if (total <= 1) return 1;
  return 1 - (index / (total - 1)) * (1 - TAIL_FLOOR);
}

/**
 * Expand a skill list into the weighted set of skills that should pull a row
 * into the pool.
 *
 * The candidate's own skills come back at their positional weight; skills
 * adjacent to them come back at `edge × positional`. Where two paths reach the
 * same skill the strongest wins — holding both Vue and Svelte should not make
 * React worth more than holding React, and taking the max rather than the sum
 * is what prevents that.
 *
 * @param skills  In priority order. For a candidate that is their profile
 *                order (CV parsing now sorts it by evidence); for a job it is
 *                required-then-preferred, which is already priority order.
 */
export function expandSkills(skills: string[]): WeightedSkill[] {
  const canon = normalizeSkills((skills ?? []).map((s) => s.trim()).filter(Boolean));
  if (!canon.length) return [];

  const best = new Map<string, number>();
  const put = (skill: string, weight: number) => {
    const k = skill.toLowerCase();
    if (weight < MIN_WEIGHT) return;
    if ((best.get(k) ?? 0) < weight) best.set(k, weight);
  };

  canon.forEach((skill, i) => {
    const pos = positionalWeight(i, canon.length);
    put(skill, pos);
    // One hop only, matching skillCredit(). Transitive chains decay into noise
    // fast and would let a pool be filled by skills nobody claimed.
    for (const n of neighbours(skill)) put(n.skill, n.weight * pos);
  });

  return [...best.entries()]
    .map(([skill, weight]) => ({ skill, weight }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_TERMS);
}

/**
 * The expansion as two parallel delimited strings, ready to bind into SQL.
 *
 * Passed as single text parameters and split server-side rather than bound as
 * arrays: the driver has to guess an element type for a JS array, and Postgres
 * rejects the guess for `= any(...)`. A delimited string has no such ambiguity
 * and is still fully parameterised — no value is ever concatenated into SQL.
 *
 * U+0001 is the delimiter because it cannot occur in a skill name.
 */
export const DELIM = "\u0001";

export function toSqlArrays(expanded: WeightedSkill[]): { names: string; weights: string } {
  return {
    names: expanded.map((e) => e.skill).join(DELIM),
    weights: expanded.map((e) => e.weight.toFixed(4)).join(DELIM),
  };
}
