import { normalizeSkill, normalizeSkills } from "../skills";
import type { BuiltResume, BuiltSection } from "./build";

/**
 * RES-005 — tailor a resume to a specific job.
 *
 * Also without a model, and this is the part that surprises people.
 *
 * "Tailoring" is usually sold as rewriting. What it actually is, done properly,
 * is SELECTION: a candidate has fifteen bullet points describing eight years of
 * work, a given posting cares about four of them, and tailoring means putting
 * those four at the top and cutting the ones that are noise for this role. That
 * is ranking against a requirements list — which this codebase already does
 * well, in the match engine, for exactly this pair of inputs.
 *
 * The property that follows is the one worth having: selection **cannot
 * fabricate**. Every sentence in a tailored resume is a sentence the candidate
 * wrote, in their own words, about work they actually did. The document is
 * reordered, not authored. Compare that with asking a model to "tailor my
 * resume to this job", which is an open invitation to invent the experience the
 * posting asks for.
 *
 * ── What is deliberately not done ──
 *
 * Keyword stuffing. It would be trivial to inject the posting's exact terms
 * into the summary to beat a naive ATS filter, and it is a bad trade: it
 * degrades the document for the human who reads it next, and it is a claim
 * about the candidate's experience that the candidate did not make.
 */

export type TailorJob = {
  title: string;
  description: string;
  skills: string[];
};

export type ScoredLine = {
  text: string;
  score: number;
  /** Which of the job's terms this line earned credit for. Shown to the
   *  candidate so a reordering is explicable rather than magic. */
  matched: string[];
};

export type TailoredSection = BuiltSection & {
  /** Lines the tailoring moved down or dropped, kept so nothing disappears
   *  without the candidate being able to see it and put it back. */
  deprioritised: string[];
};

export type TailoredResume = Omit<BuiltResume, "sections"> & {
  sections: TailoredSection[];
  job: { title: string };
  /** Job terms nothing in the resume speaks to. This is the honest half of
   *  tailoring: the gaps a reordering cannot close. */
  unaddressed: string[];
  /** Plain-language account of what was changed and why. */
  notes: string[];
};

/**
 * One comparable token.
 *
 * `normalizeSkill` resolves aliases — "JS" becomes "JavaScript" — but returns
 * the input unchanged when it does not recognise the word, which means an
 * unknown term keeps whatever casing it arrived with. "Rust" in a posting and
 * "rust" in a bullet would then never match, and the skills the alias table
 * does not know are precisely the ones where a miss is expensive. Folding case
 * afterwards costs nothing and closes that.
 */
const term = (raw: string): string => normalizeSkill(raw).toLowerCase();

/**
 * The terms a posting actually cares about.
 *
 * Its declared skills, plus its title words, normalised through the same alias
 * table the match engine uses so "JS" in a resume earns credit for
 * "JavaScript" in a posting.
 */
export function jobTerms(job: TailorJob): string[] {
  const fromSkills = normalizeSkills(job.skills).map((s) => s.toLowerCase());
  const fromTitle = job.title
    .split(/[^A-Za-z0-9+#.]+/)
    .filter((w) => w.length > 2)
    .map(term);
  return [...new Set([...fromSkills, ...fromTitle])].filter(Boolean);
}

function lineTerms(line: string): Set<string> {
  const words = line
    .split(/[^A-Za-z0-9+#.]+/)
    .filter((w) => w.length > 1)
    .map(term);
  return new Set(words);
}

/**
 * Score one bullet against the posting.
 *
 * Declared skills weigh more than title words because a title word like
 * "engineer" appears in nearly every line of nearly every engineering resume
 * and carries almost no signal.
 */
export function scoreLine(line: string, job: TailorJob): ScoredLine {
  const terms = lineTerms(line);
  // Lower-cased for the same reason `term()` exists: an unknown skill keeps its
  // input casing, and this set decides whether a match is worth 3 points or 1.
  const skills = new Set(normalizeSkills(job.skills).map((s) => s.toLowerCase()));
  const matched: string[] = [];
  let score = 0;

  for (const t of jobTerms(job)) {
    if (!terms.has(t)) continue;
    matched.push(t);
    score += skills.has(t) ? 3 : 1;
  }

  // A bullet with a number in it is evidence rather than assertion. Nudge it up
  // — this rewards the candidate for having quantified their own work, which is
  // the advice every resume guide gives and almost no tool acts on.
  if (/\d/.test(line)) score += 0.5;

  return { text: line, score, matched };
}

/**
 * How many bullets survive under each role.
 *
 * Cutting to the most relevant few is the entire value of tailoring; keeping
 * everything is just the original resume in a different order.
 */
export const MAX_BULLETS_PER_ROLE = 4;

function tailorExperience(section: BuiltSection, job: TailorJob): TailoredSection {
  const out: string[] = [];
  const outHeadings: number[] = [];
  const dropped: string[] = [];

  // Which lines are headings is stated by the builder, not guessed here. An
  // earlier version tested for " — " and would have treated any bullet
  // containing an em-dash as the start of a new employer, silently filing the
  // bullets after it under the wrong company.
  const headings = new Set(section.headings);

  // Walk role by role. Bullets are reordered WITHIN a role and never moved
  // between roles — a bullet under the wrong employer is a factual error, and
  // "most relevant first" is not worth creating one.
  let bucket: ScoredLine[] = [];
  const flush = () => {
    if (!bucket.length) return;
    const ranked = [...bucket].sort((a, b) => b.score - a.score);
    const keep = ranked.slice(0, MAX_BULLETS_PER_ROLE);
    // A bullet that matches nothing is only cut if there are better ones to
    // show; a role with three irrelevant bullets keeps them rather than
    // appearing as an empty employment entry, which reads as a red flag.
    const shown = keep.some((l) => l.score > 0) ? keep.filter((l) => l.score > 0 || keep.length <= 2) : keep;
    out.push(...shown.map((l) => l.text));
    dropped.push(...ranked.filter((l) => !shown.includes(l)).map((l) => l.text));
    bucket = [];
  };

  section.lines.forEach((line, i) => {
    if (headings.has(i)) {
      flush();
      outHeadings.push(out.length);
      out.push(line);
    } else {
      bucket.push(scoreLine(line, job));
    }
  });
  flush();

  return { ...section, lines: out, headings: outHeadings, deprioritised: dropped };
}

function tailorSkills(section: BuiltSection, job: TailorJob, allSkills: string[]): TailoredSection {
  const wanted = new Set(jobTerms(job));
  const relevant = allSkills.filter((s) => wanted.has(term(s)));
  const rest = allSkills.filter((s) => !wanted.has(term(s)));
  const ordered = [...relevant, ...rest];

  const perLine = 6;
  const lines: string[] = [];
  for (let i = 0; i < ordered.length; i += perLine) {
    lines.push(ordered.slice(i, i + perLine).join(" · "));
  }
  // Nothing is removed from the skills list. Dropping a real skill because one
  // posting does not ask for it makes the document worse everywhere else, and
  // the candidate downloads one file.
  return { ...section, lines, headings: [], deprioritised: [] };
}

export function tailorResume(
  resume: BuiltResume,
  job: TailorJob,
  allSkills: string[]
): TailoredResume {
  const notes: string[] = [];
  const sections = resume.sections.map((s): TailoredSection => {
    if (s.empty) return { ...s, deprioritised: [] };
    if (s.key === "experience") {
      const t = tailorExperience(s, job);
      if (t.deprioritised.length) {
        notes.push(
          `Moved ${t.deprioritised.length} bullet${t.deprioritised.length === 1 ? "" : "s"} out of Experience that this role doesn't ask about. Nothing was rewritten — every line still says what you wrote.`
        );
      }
      return t;
    }
    if (s.key === "skills") {
      const t = tailorSkills(s, job, allSkills);
      if (t.lines.join() !== s.lines.join()) {
        notes.push("Reordered your skills so the ones this posting names come first.");
      }
      return t;
    }
    return { ...s, deprioritised: [] };
  });

  // The gap list. Deliberately computed against the WHOLE resume, including the
  // lines tailoring moved down, so it never reports a gap that tailoring itself
  // created.
  const haystack = new Set<string>();
  for (const s of resume.sections) {
    for (const line of s.lines) for (const t of lineTerms(line)) haystack.add(t);
  }
  for (const s of allSkills) haystack.add(term(s));

  const unaddressed = jobTerms(job).filter((t) => !haystack.has(t));
  if (unaddressed.length) {
    notes.push(
      `This posting asks about ${unaddressed.length} thing${unaddressed.length === 1 ? "" : "s"} your resume doesn't mention. Tailoring can't fix that — only you can say whether you've done them.`
    );
  }
  if (!notes.length) notes.push("Your resume already lines up with this posting — nothing needed moving.");

  return { ...resume, sections, job: { title: job.title }, unaddressed, notes };
}
