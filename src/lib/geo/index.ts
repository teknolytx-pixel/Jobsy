/**
 * FSD v1.1 §30 – §36 — geographic eligibility.
 *
 * Import from here, not from the individual files, so the module boundary the
 * MATCH-030 guard watches stays a single obvious thing: `@/lib/geo` belongs to
 * the eligibility layer (Stage 1 of §34) and never to the scoring engine.
 */
export * from "./countries";
export * from "./cities";
export * from "./postal";
export * from "./resolve";
export * from "./eligibility";
export * from "./adapt";
