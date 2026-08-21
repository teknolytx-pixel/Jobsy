import type { ParsedEducation, ParsedResume, ParsedRole } from "./parse";

/**
 * RES-004 — build a resume from scratch.
 *
 * The thing worth saying about this file is what is NOT in it: a model.
 *
 * A resume built from a Jobsy profile is a template over data the candidate has
 * already given us — headline, skills, years, bio, availability, and the roles
 * a parsed upload produced. Rendering that as a document is layout, not
 * generation, and doing it deterministically buys three properties that a model
 * cannot: it cannot invent an employer, it produces the same document twice for
 * the same input, and it works with no API key, no rate limit and no cost.
 *
 * The AI polish in `rewrite.ts` sits ON TOP of this and is optional in the
 * strict sense — turn it off and the feature still works end to end.
 *
 * ── Deliberately absent fields ──
 *
 * Photo, date of birth, age, marital status, nationality and graduation year.
 * The upload parser already discards them (AC-6..AC-11); the builder must not
 * quietly reintroduce them from the profile. Graduation year is the one people
 * add back without thinking — it is a direct age proxy and the theory at issue
 * in Mobley v. Workday, so `education` here carries school and degree only.
 */

export type ResumeProfile = {
  name: string | null;
  email: string | null;
  headline: string | null;
  bio: string | null;
  location: string | null;
  skills: string[];
  yearsExp: number;
  availability: string | null;
  linkedin?: string | null;
  website?: string | null;
};

export type BuiltSection = {
  key: "summary" | "skills" | "experience" | "education" | "certifications";
  title: string;
  /** Rendered lines. Bullets carry no leading marker — the renderer adds it. */
  lines: string[];
  /**
   * Which of `lines` are role headings rather than bullets, by index.
   *
   * Stated rather than inferred. The first version let the renderer guess with
   * a regex for " — ", and the very first real profile broke it: a summary
   * reading "Frontend engineer who works close to data — dashboards, charting
   * internals…" was drawn as a job title. The builder is the only layer that
   * knows which line is which, so it is the layer that says so.
   */
  headings: number[];
  /** Empty sections are kept with a prompt rather than dropped silently, so the
   *  candidate can see what the document is missing and go fill it in. */
  empty: boolean;
  hint: string | null;
};

export type BuiltResume = {
  name: string;
  contact: string[];
  headline: string | null;
  sections: BuiltSection[];
  /** Fields the builder wanted and could not find. Drives the UI checklist. */
  missing: string[];
  /** Everything the document contains came from one of these. No invention. */
  provenance: ("profile" | "resume-upload")[];
};

const clean = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  return t.length ? t : null;
};

function contactLines(p: ResumeProfile): string[] {
  // Phone is absent on purpose — `parse.ts` types it as `null` and never keeps
  // one. A resume the candidate downloads and edits can have their number added
  // by them; storing it here would mean holding a direct identifier we have no
  // product reason to hold.
  return [clean(p.email), clean(p.location), clean(p.linkedin), clean(p.website)].filter(
    (x): x is string => Boolean(x)
  );
}

/**
 * Skills, grouped only by how strongly the profile asserts them.
 *
 * No proficiency levels, because the profile does not record any and inferring
 * "expert" from a match score would be putting a claim in the candidate's mouth
 * that they would then have to defend in an interview.
 */
function skillLines(skills: string[]): string[] {
  const uniq = [...new Set(skills.map((s) => s.trim()).filter(Boolean))];
  if (!uniq.length) return [];
  const perLine = 6;
  const out: string[] = [];
  for (let i = 0; i < uniq.length; i += perLine) {
    out.push(uniq.slice(i, i + perLine).join(" · "));
  }
  return out;
}

function roleLines(r: ParsedRole): string[] {
  const head = [clean(r.title) ?? "Role", clean(r.company)].filter(Boolean).join(" — ");
  const period = clean(r.period) ?? (r.current ? "Present" : null);
  const lines = [period ? `${head}  (${period})` : head];
  for (const b of r.bullets) {
    const t = clean(b);
    if (t) lines.push(t);
  }
  return lines;
}

function educationLine(e: ParsedEducation): string | null {
  const parts = [clean(e.degree), clean(e.field)].filter(Boolean).join(", ");
  const school = clean(e.institution);
  if (!parts && !school) return null;
  // No year. See the header note.
  return [parts, school].filter(Boolean).join(" — ");
}

export function buildResume(
  profile: ResumeProfile,
  parsed?: ParsedResume | null
): BuiltResume {
  const missing: string[] = [];
  const provenance: BuiltResume["provenance"] = ["profile"];
  if (parsed) provenance.push("resume-upload");

  const name = clean(profile.name) ?? "Your name";
  if (!clean(profile.name)) missing.push("name");

  const headline = clean(profile.headline) ?? clean(parsed?.headline ?? null);
  if (!headline) missing.push("headline");

  // The candidate's own words first. A parsed summary is their words too — it
  // came off their own document — so it is a legitimate fallback. Nothing else
  // is, which is why there is no third branch generating one.
  const summary = clean(profile.bio) ?? clean(parsed?.summary ?? null);
  if (!summary) missing.push("summary");

  const skills = profile.skills.length ? profile.skills : (parsed?.skills ?? []);
  if (!skills.length) missing.push("skills");

  const roles = parsed?.roles ?? [];
  if (!roles.length) missing.push("experience");

  const education = (parsed?.education ?? [])
    .map(educationLine)
    .filter((x): x is string => Boolean(x));

  const certifications = parsed?.certifications ?? [];

  const years = profile.yearsExp > 0 ? `${profile.yearsExp} years' experience` : null;
  const rawAvailability = clean(profile.availability);
  // Profiles store availability as a bare phrase — "4 weeks", "Immediately".
  // Sitting next to "8 years' experience" that reads as a second duration.
  const availability = rawAvailability
    ? /^(available|notice|immediate)/i.test(rawAvailability)
      ? rawAvailability
      : `available ${rawAvailability}`
    : null;

  const summaryLines = [summary, [years, availability].filter(Boolean).join(" · ") || null]
    .filter((x): x is string => Boolean(x));

  // Roles flatten into one list, so the heading positions have to be recorded
  // as they are produced — afterwards the information is gone.
  const experienceLines: string[] = [];
  const experienceHeadings: number[] = [];
  for (const r of roles) {
    const [head, ...bullets] = roleLines(r);
    experienceHeadings.push(experienceLines.length);
    experienceLines.push(head, ...bullets);
  }

  const sections: BuiltSection[] = [
    {
      key: "summary",
      title: "Summary",
      lines: summaryLines,
      headings: [],
      empty: summaryLines.length === 0,
      hint: summaryLines.length ? null : "Add a short bio to your profile and it appears here.",
    },
    {
      key: "skills",
      title: "Skills",
      lines: skillLines(skills),
      headings: [],
      empty: skills.length === 0,
      hint: skills.length ? null : "Add skills to your profile — they also drive your matches.",
    },
    {
      key: "experience",
      title: "Experience",
      lines: experienceLines,
      headings: experienceHeadings,
      empty: roles.length === 0,
      hint: roles.length
        ? null
        : "Upload a resume and Jobsy will read your roles out of it. Nothing is saved to your profile until you approve it.",
    },
    {
      key: "education",
      title: "Education",
      lines: education,
      headings: [],
      empty: education.length === 0,
      hint: education.length ? null : "Comes from an uploaded resume. Graduation years are never kept.",
    },
    {
      key: "certifications",
      title: "Certifications",
      lines: certifications.map((c) => c.trim()).filter(Boolean),
      headings: [],
      empty: certifications.length === 0,
      hint: null,
    },
  ];

  return {
    name,
    contact: contactLines(profile),
    headline,
    // A certifications section with nothing in it is noise rather than a
    // prompt — unlike experience, its absence is not a gap.
    sections: sections.filter((s) => s.key !== "certifications" || !s.empty),
    missing,
    provenance,
  };
}

// ─────────────────────────────────────────────────────────────
// Renderers
// ─────────────────────────────────────────────────────────────

/**
 * Plain text, and it is the primary format on purpose.
 *
 * Applicant tracking systems parse text reliably and multi-column PDF layouts
 * badly. A resume that looks handsome and is read wrong by the system standing
 * between the candidate and a human is a worse document than a plain one.
 */
export function toText(r: BuiltResume): string {
  const out: string[] = [r.name];
  if (r.headline) out.push(r.headline);
  if (r.contact.length) out.push(r.contact.join(" | "));

  for (const s of r.sections) {
    if (s.empty) continue;
    out.push("", s.title.toUpperCase(), "-".repeat(s.title.length));
    const heads = new Set(s.headings);
    s.lines.forEach((line, i) => {
      // A role heading is a heading in the text file too. Prefixing it with a
      // bullet is what makes a parsed resume list "Senior Engineer — Fintech Co"
      // as an accomplishment.
      out.push(heads.has(i) ? (i === 0 ? line : `\n${line}`) : `  - ${line}`);
    });
  }
  return out.join("\n");
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Single-column, print-friendly, no external assets. */
export function toHtml(r: BuiltResume): string {
  const body = r.sections
    .filter((s) => !s.empty)
    .map((s) => {
      const heads = new Set(s.headings);
      const items = s.lines
        .map((l, i) =>
          heads.has(i) ? `<li class="role">${esc(l)}</li>` : `<li>${esc(l)}</li>`
        )
        .join("");
      return `<section><h2>${esc(s.title)}</h2><ul>${items}</ul></section>`;
    })
    .join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(r.name)} — Resume</title>
<style>
  body{font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;max-width:44rem;margin:2rem auto;padding:0 1.25rem}
  h1{font-size:1.6rem;margin:0}
  .headline{color:#444;margin:.15rem 0 .35rem}
  .contact{color:#555;font-size:.9rem;margin-bottom:1.25rem}
  h2{font-size:.85rem;letter-spacing:.08em;text-transform:uppercase;color:#666;border-bottom:1px solid #ddd;padding-bottom:.2rem;margin:1.4rem 0 .5rem}
  ul{margin:0;padding-left:1.1rem}
  li{margin:.2rem 0}
  li.role{list-style:none;margin:.8rem 0 .25rem -1.1rem;font-weight:600}
  @media print{body{margin:0;max-width:none}}
</style></head><body>
<h1>${esc(r.name)}</h1>
${r.headline ? `<div class="headline">${esc(r.headline)}</div>` : ""}
${r.contact.length ? `<div class="contact">${esc(r.contact.join(" | "))}</div>` : ""}
${body}
</body></html>`;
}
