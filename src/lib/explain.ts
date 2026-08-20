import { WEIGHTS, type MatchResult } from "./matching/engine";
import { NEVER_USED } from "./compliance/aedtContent";

/**
 * XPLAIN-001 — the explanation service.
 *
 * Why this is P0 and not a nicety: five separate regimes converge on wanting
 * the same artefact.
 *
 *   • Connecticut PA 26-15 — pre-decision notice naming the tool (Oct 2027)
 *   • Minnesota — the right to question a profiling result
 *   • Vermont — the right to an explanation
 *   • Colorado SB 26-189 — a plain-language adverse-decision explanation within
 *     30 days (Jan 2027)
 *   • California CPPA ADMT — the access right to the LOGIC (Jan 2027)
 *
 * One well-built explanation satisfies all five. Building it once, now, is
 * dramatically cheaper than retrofitting it five times — and the engine already
 * computes everything it needs, so this module is presentation, not new logic.
 *
 * AC-4: no internal identifiers, no raw floats, no debug output. A candidate
 * reads this, not an engineer.
 */

export type Explanation = {
  score: number;
  /** What the score would have been before any hard filter (MATCH-006). */
  rawScore: number;
  excluded: boolean;
  exclusionReason: string | null;
  /** 0–100. Whether the person can do the job at all, before logistics. */
  qualification: number;
  headline: string;
  components: {
    label: string;
    earned: number;
    available: number;
    /** One sentence a non-technical reader understands. */
    detail: string;
  }[];
  skills: {
    matched: string[];
    /** Credited through a related skill, naming which one earned it. */
    transferable: { skill: string; via: string | null; note: string }[];
    missing: string[];
  };
  reasons: string[];
  concerns: string[];
  /** MATCH-030 — stated to the candidate, not just kept as a code property. */
  neverUsed: string[];
  /** AC-6 — the disclaimer, as data so the UI cannot forget it. */
  disclaimer: string;
  /** AC-7 — proof the components reconcile to the score. */
  reconciles: boolean;
};

const pct = (n: number) => Math.round(n * 100) / 100;

const DISCLAIMER =
  "This score is a suggestion that helps order what you see. It does not accept or reject anyone. " +
  "Every decision to contact, interview, offer or hire is made by the employer.";

/**
 * Turn a MatchResult into something a person can read.
 *
 * Takes the already-computed result rather than re-scoring, so the explanation
 * can never drift from the score it explains — a class of bug that would be
 * invisible until someone compared the two in a complaint.
 */
export function explain(r: MatchResult): Explanation {
  const b = r.breakdown;
  const hasPreferred = r.requirements.preferred.length > 0;

  const components: Explanation["components"] = [
    {
      label: "Required skills",
      earned: pct(b.requiredSkills),
      available: hasPreferred ? WEIGHTS.requiredSkills : WEIGHTS.requiredSkills + WEIGHTS.preferredSkills,
      detail: describeSkills(r),
    },
    {
      label: "Preferred skills",
      earned: pct(b.preferredSkills),
      available: hasPreferred ? WEIGHTS.preferredSkills : 0,
      detail: hasPreferred
        ? "The 'nice to have' items in the posting."
        : "This posting doesn't list any 'nice to have' skills, so those points were folded into the required-skills score rather than given away.",
    },
    {
      label: "Experience",
      earned: pct(b.experience),
      available: WEIGHTS.experience,
      detail: describeExperience(r),
    },
    {
      label: "Compensation",
      earned: pct(b.compensation),
      available: WEIGHTS.compensation,
      detail:
        "How the compensation you're looking for lines up with the range in the posting. A target below the range is never penalised.",
    },
    {
      label: "Work style",
      earned: pct(b.workStyle),
      available: WEIGHTS.workStyle,
      detail:
        "Whether the role's remote, hybrid or onsite arrangement works for you, and whether a commute is feasible.",
    },
  ];

  const sum = components.reduce((a, c) => a + c.earned, 0);
  // Rounding at the component level can shift the total by a point; anything
  // larger means the breakdown and the score have genuinely diverged.
  const reconciles = Math.abs(sum - r.rawScore) <= 1.5;

  return {
    score: r.score,
    rawScore: r.rawScore,
    excluded: r.excluded,
    exclusionReason: r.exclusionReason,
    qualification: Math.round(r.qualification * 100),
    headline: headlineFor(r),
    components,
    skills: {
      matched: r.sharedSkills,
      transferable: r.transferableSkills.map((t) => ({
        skill: t.skill,
        via: t.via,
        note: t.via
          ? `Your experience with ${t.via} counts toward ${t.skill}.`
          : `Partially credited toward ${t.skill}.`,
      })),
      missing: r.missingSkills,
    },
    reasons: r.reasons,
    concerns: r.concerns,
    neverUsed: NEVER_USED,
    disclaimer: DISCLAIMER,
    reconciles,
  };
}

function headlineFor(r: MatchResult): string {
  if (r.excluded) {
    return r.exclusionReason ?? "This role isn't a fit for a structural reason.";
  }
  if (r.score >= 80) return "Strong fit — you meet most of what this role asks for.";
  if (r.score >= 60) return "Good fit — you meet a lot of what this role asks for.";
  if (r.score >= 40) return "Partial fit — there are some real gaps.";
  if (r.score >= 20) return "Weak fit — this role asks for a different background.";
  return "Not a fit — this role is looking for something quite different.";
}

function describeSkills(r: MatchResult): string {
  const req = r.requirements.required.length;
  const matched = r.sharedSkills.length;
  const transferable = r.transferableSkills.length;
  const missing = r.missingSkills.length;

  if (req === 0) {
    return "This posting doesn't list its requirements in a structured way, so we compared against the skills tagged on the role.";
  }
  const parts = [`The posting asks for ${req} thing${req === 1 ? "" : "s"}.`];
  if (matched) parts.push(`You have ${matched} of them directly.`);
  if (transferable) {
    parts.push(
      `${transferable} more ${transferable === 1 ? "is" : "are"} partly covered by closely related experience you already have.`
    );
  }
  if (missing) parts.push(`${missing} ${missing === 1 ? "isn't" : "aren't"} on your profile.`);
  return parts.join(" ");
}

function describeExperience(r: MatchResult): string {
  const min = r.requirements.minYears;
  if (min == null) {
    return "The posting doesn't state a minimum, so we used the seniority level instead. Not stating one is never held against you.";
  }
  return `The posting asks for at least ${min} year${min === 1 ? "" : "s"}. Falling short reduces this score in proportion; exceeding it doesn't reduce anything, though we'll flag significant over-qualification as something to be aware of.`;
}

/**
 * Explanation as plain text.
 *
 * Needed for the data export (AUTH-012 AC-5) and for the adverse-decision
 * notices Colorado requires in plain language — those cannot assume a browser.
 */
export function explanationToText(e: Explanation, context: { jobTitle: string; company: string }): string {
  const lines: string[] = [
    `WHY THIS MATCH — ${context.jobTitle} at ${context.company}`,
    "",
    `Score: ${e.score} out of 99`,
    e.headline,
    "",
  ];

  if (e.excluded && e.exclusionReason) {
    lines.push(`This role was filtered out: ${e.exclusionReason}`, "");
  }

  lines.push("HOW THE SCORE WAS MADE UP");
  for (const c of e.components) {
    lines.push(`  ${c.label}: ${c.earned} of ${c.available} points`);
    lines.push(`    ${c.detail}`);
  }
  lines.push("");

  if (e.skills.matched.length) {
    lines.push(`SKILLS YOU HAVE THAT THE ROLE ASKS FOR: ${e.skills.matched.join(", ")}`);
  }
  if (e.skills.transferable.length) {
    lines.push("RELATED EXPERIENCE THAT COUNTED:");
    for (const t of e.skills.transferable) lines.push(`  ${t.note}`);
  }
  if (e.skills.missing.length) {
    lines.push(`WHAT THE ROLE ASKS FOR THAT ISN'T ON YOUR PROFILE: ${e.skills.missing.join(", ")}`);
  }
  lines.push("");

  if (e.reasons.length) {
    lines.push("WHY THIS CAME UP FOR YOU:");
    for (const r of e.reasons) lines.push(`  • ${r}`);
    lines.push("");
  }
  if (e.concerns.length) {
    lines.push("WHAT MIGHT NOT WORK:");
    for (const c of e.concerns) lines.push(`  • ${c}`);
    lines.push("");
  }

  lines.push("WHAT WE NEVER USE TO WORK THIS OUT:");
  for (const n of e.neverUsed) lines.push(`  • ${n}`);
  lines.push("", e.disclaimer);

  return lines.join("\n");
}
