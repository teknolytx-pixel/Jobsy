import type { MatchResult } from "../matching/engine";

/**
 * RES-006 — "identify missing or weak skills."
 *
 * This one was already built and never shown to anyone.
 *
 * `matchScore()` returns `missingSkills`, `transferableSkills` and `concerns`
 * on every single match it computes, and has since the engine was written. The
 * recruiter deck uses them. The candidate — the person whose skills they
 * describe, and the only person who can act on them — has never seen them.
 * This file is the translation layer, not a new analysis.
 *
 * ── Why the direction of address matters ──
 *
 * The same fact has two very different renderings. To a recruiter,
 * `missingSkills: ["kubernetes"]` means "this candidate lacks Kubernetes". To
 * the candidate it means "this posting asks for Kubernetes and your profile
 * doesn't mention it" — which is a different claim, because the most common
 * cause of a missing skill in this product is an incomplete profile rather than
 * an incomplete career. Writing it the first way tells people they are
 * unqualified when what is actually true is that they under-filled a form.
 *
 * So every line below is phrased as a fact about the POSTING and the PROFILE,
 * never as a judgement about the person.
 */

export type GapSeverity = "BLOCKING" | "IMPORTANT" | "MINOR";

export type ResumeGap = {
  severity: GapSeverity;
  /** What to show. Second person, about the document, never about the person. */
  title: string;
  detail: string;
  /** The concrete next action, or null when there isn't an honest one. */
  action: string | null;
  /** Which skill this concerns, when it concerns one. Drives the UI chips. */
  skill: string | null;
};

export type GapReport = {
  /** Carried through so advice can be traced to the model that produced it. */
  modelVersion: string;
  score: number;
  gaps: ResumeGap[];
  /** The good news, stated first in the UI. People act on advice they trust,
   *  and a report that is only deficits reads as a rejection letter. */
  strengths: string[];
};

const title = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export function gapReport(m: MatchResult, jobTitle: string): GapReport {
  const gaps: ResumeGap[] = [];
  const strengths: string[] = [];

  if (m.sharedSkills.length) {
    strengths.push(
      `Your profile already names ${m.sharedSkills.length} thing${m.sharedSkills.length === 1 ? "" : "s"} this role asks for: ${m.sharedSkills.map(title).join(", ")}.`
    );
  }

  /**
   * Transferable skills are the most useful thing the engine knows and the
   * least obvious to a candidate. Someone with Vue who keeps getting shown
   * React roles has no idea the system is crediting them for it — and that
   * credit is exactly what belongs in their resume summary, in their words.
   */
  for (const t of m.transferableSkills) {
    if (!t.via) continue;
    gaps.push({
      severity: "MINOR",
      skill: t.skill,
      title: `${title(t.skill)} — counted through ${title(t.via)}`,
      detail: `This role asks for ${title(t.skill)}. Your ${title(t.via)} experience is close enough that it's carrying partial credit.`,
      action: `If you've actually used ${title(t.skill)}, add it — partial credit becomes full credit. If you haven't, say so plainly in your summary; adjacent experience is a real answer.`,
    });
  }

  /**
   * A missing skill is reported as a question, not a verdict, because this
   * product cannot tell the difference between "hasn't done it" and "didn't
   * list it" — and gets that wrong in the candidate's favour far more often
   * than against them.
   */
  for (const s of m.missingSkills) {
    gaps.push({
      severity: m.excluded ? "BLOCKING" : "IMPORTANT",
      skill: s,
      title: `${title(s)} isn't in your profile`,
      detail: `The ${jobTitle} posting names ${title(s)}. Nothing in your skills or resume mentions it.`,
      action: `If you've used ${title(s)}, add it to your skills — that alone will change how you rank. If you haven't, this is a real gap worth naming rather than working around.`,
    });
  }

  /**
   * Engine concerns are about fit — compensation, work model, seniority — and
   * are passed through nearly verbatim. They are not resume problems and must
   * not be dressed up as ones: no amount of rewriting fixes a salary band.
   */
  for (const c of m.concerns) {
    gaps.push({
      severity: "IMPORTANT",
      skill: null,
      title: "Worth knowing before you apply",
      detail: c,
      action: null,
    });
  }

  if (m.excluded && m.exclusionReason) {
    gaps.unshift({
      severity: "BLOCKING",
      skill: null,
      title: "This role is filtered out for you",
      detail: m.exclusionReason,
      action: null,
    });
  }

  return { modelVersion: m.modelVersion, score: m.score, gaps, strengths };
}

/**
 * The version that is not about one job.
 *
 * Run across every posting a candidate has been shown, the same data answers a
 * better question than "why did I not match this role" — namely "what one thing
 * would change the most outcomes". A skill absent from one posting is noise; a
 * skill absent from thirty is a career decision.
 */
export function aggregateGaps(
  reports: { jobTitle: string; result: MatchResult }[],
  limit = 6
): { skill: string; postings: number; share: number; example: string }[] {
  const counts = new Map<string, { n: number; example: string }>();
  for (const r of reports) {
    for (const s of r.result.missingSkills) {
      const prev = counts.get(s);
      counts.set(s, { n: (prev?.n ?? 0) + 1, example: prev?.example ?? r.jobTitle });
    }
  }
  const total = Math.max(1, reports.length);
  return [...counts.entries()]
    .map(([skill, v]) => ({
      skill,
      postings: v.n,
      share: Math.round((v.n / total) * 100),
      example: v.example,
    }))
    .sort((a, b) => b.postings - a.postings || a.skill.localeCompare(b.skill))
    .slice(0, limit);
}
