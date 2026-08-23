import type { RoleFamily } from "./taxonomy";

/**
 * CONFIDENCE — how much the match score can be trusted.
 *
 * ── The problem it solves ──
 *
 * `matchScore` always returns a number. It returns one for a candidate with
 * fifteen skills, a parsed CV, stated experience and a salary target, and it
 * returns one for a candidate with three skills and nothing else. Both come back
 * as, say, 78%, and nothing distinguishes them.
 *
 * They are not the same claim. The first rests on evidence; the second rests
 * substantially on defaults, because the engine has to put SOMETHING in the
 * gaps:
 *
 *   • unknown compensation scores 0.6 of the band rather than zero, since most
 *     ingested postings hide pay and punishing them would bury the whole corpus;
 *   • an unclassifiable role family scores 0.8 rather than excluding;
 *   • unstated sponsorship is treated as eligible, failing open;
 *   • an unstated experience requirement falls back to the seniority band.
 *
 * Every one of those is the right default. Together they mean a score can be
 * most of the way to plausible while resting on almost nothing, and the person
 * reading it cannot tell.
 *
 * ── What it must never do ──
 *
 * Change the score. Not scale it, not cap it, not reorder by it.
 *
 * That is a deliberate refusal and worth being explicit about, because
 * multiplying the two is the obvious move. Confidence measures how COMPLETE
 * somebody's profile is, and profile completeness is not merit — it tracks how
 * much time a person has had, how comfortable they are writing about
 * themselves, and whether they own a CV in a format we can parse. Ranking on it
 * would systematically bury people for reasons that have nothing to do with
 * whether they can do the job, and it would do so invisibly.
 *
 * So it is reported beside the score and never folded into it. A confident 40%
 * is still a bad match; an uncertain 90% is still worth a look. The number's
 * job is to tell the reader which kind of 78% they are looking at.
 *
 * Because it is not a ranking input it is not part of the audited model, and
 * MODEL_VERSION does not move when these weights change. If confidence ever
 * starts influencing order, that stops being true on the same day.
 */

export type ConfidenceBand = "HIGH" | "MEDIUM" | "LOW";

export type ConfidenceSignal = {
  key: string;
  /** Did we actually know this, or was a default used? */
  known: boolean;
  /** The most this signal can contribute. */
  weight: number;
  /**
   * What it actually contributed.
   *
   * Separate from `weight` because two signals are GRADED rather than boolean —
   * five skills is worth more than three and less than ten — and folding that
   * into a single field meant the sum had to special-case those keys by name.
   * Storing both makes the arithmetic one line and the special cases visible
   * where they are decided rather than where they are added up.
   */
  earned: number;
  /** Said plainly, for the explanation surface. */
  note: string;
  /** Which party can fix it. Nobody can act on "the posting is vague". */
  fixableBy: "CANDIDATE" | "RECRUITER" | "NOBODY";
};

export type ConfidenceResult = {
  /** 0..100 — the share of available evidence we actually had. */
  score: number;
  band: ConfidenceBand;
  signals: ConfidenceSignal[];
  /** The unmet signals worth acting on, strongest first. */
  improve: { note: string; fixableBy: ConfidenceSignal["fixableBy"] }[];
};

export type ConfidenceInput = {
  candidate: {
    skillCount: number;
    hasHeadline: boolean;
    hasBio: boolean;
    yearsExpStated: boolean;
    salaryTargetStated: boolean;
    locationStated: boolean;
  };
  job: {
    /** True when a real "Requirements:" section was parsed, not mined from prose. */
    requirementsStructured: boolean;
    /** True when the recruiter authored the must-have / nice-to-have split. */
    skillsAuthored: boolean;
    salaryStated: boolean;
    minYearsStated: boolean;
    sponsorshipStated: boolean;
    locationResolved: boolean;
  };
  match: {
    /** Skills credited at 1.0 — held outright. */
    exactHits: number;
    /** Skills credited through adjacency — an inference, not a claim. */
    transferableHits: number;
    requiredCount: number;
    jobFamily: RoleFamily;
    candidateFamily: RoleFamily;
  };
};

/**
 * Weights.
 *
 * Roughly balanced between the two sides, because a confident match needs both
 * — a perfectly filled profile against a posting scraped from three lines of
 * prose is still a guess, and the reverse is equally true. Skill evidence
 * carries the most, since it is what the score is mostly made of.
 */
const W = {
  candSkills: 16,
  candHeadline: 4,
  candBio: 3,
  candYears: 7,
  candSalary: 5,
  candLocation: 5,

  jobStructured: 14,
  jobAuthoredSkills: 8,
  jobSalary: 8,
  jobMinYears: 5,
  jobSponsorship: 4,
  jobLocation: 5,

  /** How much of the skill credit was held outright rather than inferred. */
  exactness: 12,
  /** Both professions identifiable — the multiplier is otherwise a shrug. */
  familyKnown: 4,
} as const;

const TOTAL = Object.values(W).reduce((a, b) => a + b, 0);

/**
 * Bands.
 *
 * Three, not five. The number exists to answer "can I lean on this?", and a
 * scale fine enough to distinguish 61 from 67 invites exactly the false
 * precision the score is meant to warn against.
 */
export function bandFor(score: number): ConfidenceBand {
  if (score >= 70) return "HIGH";
  if (score >= 45) return "MEDIUM";
  return "LOW";
}

export function confidenceFor(i: ConfidenceInput): ConfidenceResult {
  const c = i.candidate;
  const j = i.job;
  const m = i.match;

  /**
   * Skills are graded rather than boolean. Three skills is enough to compute a
   * score and not enough to trust one; the profile cap is 40 and eight is
   * where a profile stops being a sketch.
   */
  const skillEvidence = c.skillCount >= 8 ? 1 : c.skillCount >= 5 ? 0.7 : c.skillCount >= 3 ? 0.4 : 0;

  /**
   * The share of credited skills held outright.
   *
   * Adjacency is the engine working as designed — Vue really does transfer to
   * React — but it is our inference about a person, not something they claimed.
   * A match built entirely on transfers is a weaker claim than one built on
   * skills they actually listed, and should say so.
   *
   * No credited skills at all leaves this at zero rather than one: there is no
   * evidence to be confident ABOUT.
   */
  const credited = m.exactHits + m.transferableHits;
  const exactness = credited > 0 ? m.exactHits / credited : 0;

  const familyKnown = m.jobFamily !== "UNKNOWN" && m.candidateFamily !== "UNKNOWN";

  /** Boolean signal: all or nothing. */
  const bool = (
    key: string,
    known: boolean,
    weight: number,
    note: string,
    fixableBy: ConfidenceSignal["fixableBy"]
  ): ConfidenceSignal => ({ key, known, weight, earned: known ? weight : 0, note, fixableBy });

  /** Graded signal: earns a fraction of its weight. */
  const graded = (
    key: string,
    fraction: number,
    weight: number,
    note: string,
    fixableBy: ConfidenceSignal["fixableBy"]
  ): ConfidenceSignal => ({
    key,
    // "Known" is reserved for a signal we would not nag about. A graded signal
    // near the top of its range is not a gap worth reporting.
    known: fraction >= 0.75,
    weight,
    earned: weight * fraction,
    note,
    fixableBy,
  });

  const signals: ConfidenceSignal[] = [
    graded("candSkills", skillEvidence, W.candSkills,
      c.skillCount === 0
        ? "No skills on the profile"
        : `Only ${c.skillCount} skills listed — more makes matching sharper`,
      "CANDIDATE"),
    bool("candYears", c.yearsExpStated, W.candYears,
      "Years of experience not stated, so seniority is inferred", "CANDIDATE"),
    bool("candSalary", c.salaryTargetStated, W.candSalary,
      "No salary target, so pay fit is assumed rather than checked", "CANDIDATE"),
    bool("candLocation", c.locationStated, W.candLocation,
      "No location, so commute and work model can't be judged", "CANDIDATE"),
    bool("candHeadline", c.hasHeadline, W.candHeadline, "No headline", "CANDIDATE"),
    bool("candBio", c.hasBio, W.candBio, "No summary", "CANDIDATE"),

    bool("jobStructured", j.requirementsStructured, W.jobStructured,
      "The posting has no stated requirements section, so its must-haves were read from the prose",
      "RECRUITER"),
    bool("jobAuthoredSkills", j.skillsAuthored, W.jobAuthoredSkills,
      "Required and preferred skills were inferred rather than stated", "RECRUITER"),
    bool("jobSalary", j.salaryStated, W.jobSalary,
      "The posting states no salary range, so pay fit is a neutral guess", "RECRUITER"),
    bool("jobMinYears", j.minYearsStated, W.jobMinYears,
      "The posting names no experience requirement", "RECRUITER"),
    bool("jobSponsorship", j.sponsorshipStated, W.jobSponsorship,
      "The posting doesn't say whether it sponsors visas", "RECRUITER"),
    bool("jobLocation", j.locationResolved, W.jobLocation,
      "The posting's location couldn't be resolved to a place", "RECRUITER"),

    graded("exactness", exactness, W.exactness,
      credited === 0
        ? "No skills in common — the score rests on other factors"
        : "Much of the skill match is through related skills rather than exact ones",
      "CANDIDATE"),
    bool("familyKnown", familyKnown, W.familyKnown,
      "One side's profession couldn't be identified from the title or skills", "NOBODY"),
  ];

  const earned = signals.reduce((a, s) => a + s.earned, 0);
  const score = Math.round((earned / TOTAL) * 100);

  /**
   * What to fix, biggest first — and only things somebody can act on.
   *
   * Capped at three. A list of eleven shortcomings is not advice, it is a
   * verdict, and the point of this number is to be actionable rather than
   * damning.
   */
  const improve = signals
    .filter((s) => !s.known && s.fixableBy !== "NOBODY")
    // Ranked by what is actually LOST, not by the signal's maximum. A graded
    // signal sitting at 70% of a large weight has less left on the table than a
    // boolean one worth slightly less and earning nothing.
    .sort((a, b) => b.weight - b.earned - (a.weight - a.earned))
    .slice(0, 3)
    .map((s) => ({ note: s.note, fixableBy: s.fixableBy }));

  return { score, band: bandFor(score), signals, improve };
}
