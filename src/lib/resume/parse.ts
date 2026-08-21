import { normalizeSkills, extractSkills } from "../skills";

/**
 * RESUME-003 — structured resume parsing.
 *
 * Two properties matter more than accuracy here.
 *
 * 1. AC-6/7/8/9/10/11 — the DISCARD list. Date of birth, age, graduation year,
 *    photo, gender, marital status and nationality are never persisted, even
 *    when the resume states them plainly. Graduation year is the one people
 *    miss: it is a direct age proxy, and it is the theory at issue in
 *    Mobley v. Workday. So the education parser deliberately reads the school
 *    and the degree and throws the years away.
 *
 * 2. AC-4 — nothing here writes to the profile. Everything is a SUGGESTION the
 *    candidate approves field by field. A parser that silently overwrites a
 *    profile is a parser that silently makes people's profiles wrong.
 *
 * Every field carries a confidence (AC-2), and anything below 0.7 is shown for
 * confirmation rather than pre-checked (AC-3). Parsing is deterministic (AC-13)
 * — no model, no randomness, same input always the same output.
 */

export type ParsedRole = {
  title: string | null;
  company: string | null;
  /** Free-text as written. We do not normalise to a date range. */
  period: string | null;
  startYear: number | null;
  endYear: number | null;
  current: boolean;
  bullets: string[];
};

export type ParsedEducation = {
  institution: string | null;
  degree: string | null;
  field: string | null;
  // NOTE: no year. Deliberate — see AC-8.
};

export type ParsedResume = {
  contact: { email: string | null; phone: null; linkedin: string | null; website: string | null };
  headline: string | null;
  summary: string | null;
  skills: string[];
  roles: ParsedRole[];
  education: ParsedEducation[];
  certifications: string[];
  totalYearsExperience: number | null;
  /** What was found and deliberately thrown away, so the candidate can see it. */
  discarded: string[];
  language: "en" | "other" | "unknown";
};

export type Confidence = Record<string, number>;

export type ParseOutcome = {
  parsed: ParsedResume;
  confidence: Confidence;
  /** Fields below the 0.7 threshold — shown for confirmation, never pre-applied. */
  needsConfirmation: string[];
};

// ─────────────────────────────────────────────────────────────
// The discard list. Detected so we can TELL the candidate we ignored it,
// then dropped. Never returned as a field, never persisted.
// ─────────────────────────────────────────────────────────────
/**
 * Each pattern carries a removal STRATEGY, because the two cases differ.
 *
 *   LINE  — the whole line exists to state the prohibited value ("DOB: …",
 *           "Gender: …"). Dropping the line loses nothing legitimate.
 *   TOKEN — the prohibited value sits inside a line that also carries content
 *           we want. "BSc Computer Science, State University, graduated 2016"
 *           must keep the degree and the school and lose only the year.
 *
 * Getting this wrong in either direction is a real failure: too coarse and we
 * silently drop a candidate's education; too fine and an age proxy survives
 * into the profile.
 */
const DISCARD_PATTERNS: [RegExp, string, "LINE" | "TOKEN"][] = [
  [/\b(date of birth|d\.?o\.?b\.?|born on|birth\s?date)\b.*/i, "date of birth", "LINE"],
  [/\bage\s*[:\-]?\s*\d{1,2}\b/i, "age", "LINE"],
  [/\b(gender|sex)\s*[:\-]\s*(male|female|m|f|non-?binary)\b/i, "gender", "LINE"],
  [/\b(marital status|married|single|divorced|widowed)\s*[:\-]?/i, "marital status", "LINE"],
  [/\b(nationality|citizenship)\s*[:\-]/i, "nationality or citizenship", "LINE"],
  [/\b(race|ethnicity)\s*[:\-]/i, "race or ethnicity", "LINE"],
  [/\breligion\s*[:\-]/i, "religion", "LINE"],
  [/\bssn\b|\bsocial security\b/i, "a social security number", "LINE"],
  [/\b(passport|driver'?s? licen[cs]e)\s*(no|number|#)/i, "an identity document number", "LINE"],
  // TOKEN — these sit inside otherwise-useful lines.
  [/\b(graduated?|class of)\s*[:\-]?\s*(19|20)\d{2}\b/i, "graduation year", "TOKEN"],
  [/\b(photo|photograph|headshot)\s*[:\-]\s*\S+/i, "a photograph", "TOKEN"],
];

const SECTION_HEADS = {
  experience:
    /^\s*(work\s+)?(professional\s+)?(experience|employment|work\s+history|career\s+history|professional\s+background)\s*:?\s*$/i,
  education: /^\s*(education|academic(\s+background)?|qualifications?)\s*:?\s*$/i,
  skills: /^\s*(technical\s+)?(skills|technologies|core\s+competencies|competencies|tech\s+stack|expertise)\s*:?\s*$/i,
  summary: /^\s*(summary|profile|about( me)?|objective|professional\s+summary)\s*:?\s*$/i,
  certifications: /^\s*(certifications?|licen[cs]es?|awards?|accreditations?)\s*:?\s*$/i,
  projects: /^\s*(projects?|portfolio|publications?)\s*:?\s*$/i,
} as const;

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
const LINKEDIN_RE = /\b(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+\/?/i;
const URL_RE = /\bhttps?:\/\/[^\s)>\]]+/i;

/**
 * AC-12 — detect a non-English resume and flag it rather than garbage-parsing.
 *
 * Ratio of common English function words to total words. Crude, and correctly
 * so: the only decision it drives is "parse or ask the candidate to fill it in
 * themselves", and being cautious there costs a candidate two minutes while
 * being wrong writes nonsense into their profile.
 */
const EN_STOPWORDS = new Set([
  "the", "and", "of", "to", "in", "for", "with", "on", "at", "by", "from", "as",
  "an", "a", "is", "was", "were", "are", "be", "been", "that", "this", "which",
  "or", "but", "not", "have", "has", "had", "will", "would", "can", "could",
]);

function detectLanguage(text: string): "en" | "other" | "unknown" {
  const words = text.toLowerCase().match(/[a-zà-ÿ]{2,}/g) ?? [];
  if (words.length < 40) return "unknown";
  const hits = words.filter((w) => EN_STOPWORDS.has(w)).length;
  const ratio = hits / words.length;
  return ratio >= 0.05 ? "en" : "other";
}

/** Anything that reveals a period of years — captured, used, then discarded. */
const YEAR_RANGE_RE =
  /\b((?:19|20)\d{2})\s*(?:[-–—]|to|until)\s*((?:19|20)\d{2}|present|current|now)\b/i;

export function parseResume(text: string): ParseOutcome {
  const language = detectLanguage(text);
  const discarded = detectDiscarded(text);

  // Detecting a prohibited field is not enough — the LINE carrying it has to
  // leave the working text before any section parser can pick it up. Without
  // this, "Date of Birth: 12/03/1994" lands in whichever section it appears
  // under and the date survives into the output, which is exactly the thing
  // the discard list exists to prevent.
  const scrubbed = scrub(text);

  const lines = scrubbed.split("\n").map((l) => l.trim());
  const sections = splitSections(lines);

  const email = scrubbed.match(EMAIL_RE)?.[0] ?? null;
  const linkedin = scrubbed.match(LINKEDIN_RE)?.[0] ?? null;
  const website =
    scrubbed
      .match(new RegExp(URL_RE, "gi"))
      ?.find((u) => !/linkedin\.com/i.test(u)) ?? null;

  const summary = sections.summary.join(" ").trim() || null;

  // Author-listed skills win; otherwise mine the whole document, which is what
  // extractSkills already does well for job descriptions.
  const listedSkills = sections.skills.length
    ? normalizeSkills(splitSkillList(sections.skills.join("\n")))
    : [];
  const skills = listedSkills.length ? listedSkills : extractSkills(scrubbed);

  const roles = parseRoles(sections.experience);
  const education = parseEducation(sections.education);
  const certifications = sections.certifications
    .filter((l) => l.length > 3 && l.length < 200)
    .map((l) => l.replace(/^[•·▪◦*\-–—]\s*/, "").trim())
    .slice(0, 20);

  const totalYearsExperience = computeYears(roles);
  const headline = deriveHeadline(roles, summary);

  const parsed: ParsedResume = {
    // AC-6 — no phone number. It is contactable personal data we have no use
    // for: matching never uses it, and post-match contact goes through email.
    contact: { email, phone: null, linkedin, website },
    headline,
    summary,
    skills,
    roles,
    education,
    certifications,
    totalYearsExperience,
    discarded,
    language,
  };

  const confidence = scoreConfidence(parsed, sections, language);
  const needsConfirmation = Object.entries(confidence)
    .filter(([, c]) => c < 0.7)
    .map(([k]) => k);

  return { parsed, confidence, needsConfirmation };
}

// ─────────────────────────────────────────────────────────────
// sections
// ─────────────────────────────────────────────────────────────
type Sections = Record<keyof typeof SECTION_HEADS, string[]>;

function splitSections(lines: string[]): Sections {
  const out: Sections = {
    experience: [], education: [], skills: [], summary: [], certifications: [], projects: [],
  };
  let current: keyof Sections | null = null;

  for (const line of lines) {
    if (!line) continue;
    let matched = false;
    for (const [key, re] of Object.entries(SECTION_HEADS) as [keyof Sections, RegExp][]) {
      if (re.test(line)) {
        current = key;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    if (current) out[current].push(line);
    // Lines before any recognised heading are contact details and a name — we
    // deliberately do not try to extract the name (MATCH-030: never used).
  }
  return out;
}

function splitSkillList(s: string): string[] {
  return s
    .split(/[,;|•·▪◦\n]|\s{3,}/)
    .map((t) => t.replace(/^[-–—*]\s*/, "").trim())
    .filter((t) => t.length > 1 && t.length < 40);
}

// ─────────────────────────────────────────────────────────────
// experience
// ─────────────────────────────────────────────────────────────
function parseRoles(lines: string[]): ParsedRole[] {
  const roles: ParsedRole[] = [];
  let current: ParsedRole | null = null;

  for (const line of lines) {
    const isBullet = /^[•·▪◦*\-–—]\s+/.test(line);
    const range = line.match(YEAR_RANGE_RE);

    if (!isBullet && (range || looksLikeRoleHeader(line))) {
      if (current) roles.push(current);
      const endRaw = range?.[2] ?? null;
      const isCurrent = Boolean(endRaw && /present|current|now/i.test(endRaw));
      current = {
        ...splitTitleAndCompany(
          line
            .replace(YEAR_RANGE_RE, "")
            // Removing "2021 - Present" from "Senior Engineer (2021 - Present)"
            // leaves "Senior Engineer ()". The brackets held the dates and are
            // now empty, so they go too — otherwise every title parsed from the
            // most common header format carries a stray "()" into the profile.
            .replace(/[([{]\s*[)\]}]/g, "")
            .replace(/[|,·–—-]\s*$/, "")
            .trim()
        ),
        period: range?.[0] ?? null,
        startYear: range ? Number(range[1]) : null,
        // AC-5 — "Present" resolves against today, so total experience is
        // computed against the real current year rather than left open.
        endYear: isCurrent ? new Date().getFullYear() : endRaw ? Number(endRaw) : null,
        current: isCurrent,
        bullets: [],
      };
      continue;
    }

    if (current && isBullet) {
      current.bullets.push(line.replace(/^[•·▪◦*\-–—]\s+/, "").trim());
    } else if (current && current.bullets.length === 0 && !current.company && looksLikeCompany(line)) {
      // A continuation line right after the header is SOMETIMES the company.
      current.company = line;
    } else if (current) {
      /**
       * An unmarked line under a role is an achievement, not rubbish.
       *
       * This branch did not exist, and everything that reached it was silently
       * dropped. That matters more than it sounds: Word keeps list formatting
       * in numbering.xml rather than in the text, so bullet points exported
       * from Word usually arrive as plain paragraphs with no •, -, or * in
       * them at all. For those CVs — a large share of real ones — every
       * achievement under every job was discarded, and the resume builder
       * rendered job titles with nothing underneath them.
       */
      current.bullets.push(line);
    }
  }
  if (current) roles.push(current);
  return roles.slice(0, 30);
}

function looksLikeRoleHeader(line: string): boolean {
  if (line.length < 4 || line.length > 140) return false;
  if (/^[•·▪◦*]/.test(line)) return false;
  return /\b(engineer|developer|manager|director|analyst|designer|consultant|lead|architect|scientist|specialist|coordinator|administrator|officer|associate|intern|president|founder|head of|vp|principal|staff)\b/i.test(
    line
  );
}

/**
 * Is this continuation line the employer, or the first achievement?
 *
 * The old code assumed employer, always. That is right for the two-line layout
 * ("Senior Engineer" / "Fintech Co") and wrong for the far more common one
 * where the header already names the company and the next line is a bullet —
 * in which case the first thing the candidate actually did got filed as their
 * employer's name.
 *
 * A company name is short, and it is not a sentence.
 */
function looksLikeCompany(line: string): boolean {
  if (line.length > 60) return false;
  if (/[.!?]$/.test(line)) return false;
  // Past-tense openers are how achievement bullets start, with or without a
  // bullet character in front of them.
  if (
    /^(built|led|ran|owned|managed|designed|shipped|drove|grew|reduced|improved|created|launched|delivered|developed|worked|wrote|migrated|implemented|maintained|architected|scaled|automated|refactored|supported|coordinated|analy[sz]ed|organised|organized|collaborated|partnered|responsible)\b/i.test(
      line
    )
  ) {
    return false;
  }
  return true;
}

function splitTitleAndCompany(s: string): { title: string | null; company: string | null } {
  const parts = s.split(/\s+(?:at|@|[|·–—])\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return { title: parts[0]!, company: parts[1]! };

  /**
   * "Senior Engineer, Fintech Co" — the single most common role-header format
   * in the world, and the separator list above did not include a comma.
   *
   * It cannot be split blindly: plenty of titles contain a comma of their own
   * ("Engineer, Payments Platform"). So the split only happens on the LAST
   * comma, and only when what follows reads like an organisation rather than
   * more of the title — short, and not starting lowercase.
   */
  const comma = s.lastIndexOf(",");
  if (comma > 0) {
    const left = s.slice(0, comma).trim();
    const right = s.slice(comma + 1).trim();
    if (left && right && right.length <= 45 && /^[A-Z0-9]/.test(right)) {
      return { title: left, company: right };
    }
  }

  return { title: s || null, company: null };
}

/**
 * AC-5 — total experience, EXCLUDING overlaps.
 *
 * Summing role durations double-counts concurrent work and produces obviously
 * wrong totals for anyone who has ever contracted or held two roles at once.
 * Merging the intervals first is the difference between "14 years" and the
 * truthful "9".
 */
function computeYears(roles: ParsedRole[]): number | null {
  const spans = roles
    .filter((r): r is ParsedRole & { startYear: number } => r.startYear != null)
    .map((r) => [r.startYear, r.endYear ?? r.startYear] as [number, number])
    .filter(([a, b]) => b >= a && a >= 1950 && b <= new Date().getFullYear() + 1)
    .sort((x, y) => x[0] - y[0]);

  if (!spans.length) return null;

  let total = 0;
  let [curStart, curEnd] = spans[0]!;
  for (const [s, e] of spans.slice(1)) {
    if (s <= curEnd) {
      curEnd = Math.max(curEnd, e);
    } else {
      total += curEnd - curStart;
      [curStart, curEnd] = [s, e];
    }
  }
  total += curEnd - curStart;
  return Math.max(0, Math.min(60, total));
}

function deriveHeadline(roles: ParsedRole[], summary: string | null): string | null {
  const first = roles.find((r) => r.title);
  if (first?.title) {
    return first.company ? `${first.title} at ${first.company}` : first.title;
  }
  if (summary) {
    const sentence = summary.split(/(?<=[.!?])\s/)[0]?.trim();
    if (sentence && sentence.length <= 120) return sentence;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// education — school and degree only. NO YEARS. See AC-8.
// ─────────────────────────────────────────────────────────────
const DEGREE_RE =
  /\b(ph\.?d|doctorate|m\.?b\.?a|m\.?sc?|master'?s?|b\.?sc?|b\.?a|bachelor'?s?|b\.?eng|m\.?eng|associate'?s?|diploma|certificate)\b/i;

function parseEducation(lines: string[]): ParsedEducation[] {
  const out: ParsedEducation[] = [];
  for (const raw of lines) {
    // Strip every year before anything else touches the line, so a graduation
    // year cannot survive into a field by accident.
    const line = raw.replace(/\b(19|20)\d{2}\b/g, "").replace(/\s{2,}/g, " ").trim();
    if (line.length < 4) continue;

    const degreeMatch = line.match(DEGREE_RE);
    const institution =
      line.match(/\b([A-Z][A-Za-z.'&-]*(?:\s+(?:of|and|the))?\s*)+(University|College|Institute|School|Academy|Polytechnic)\b/)?.[0] ??
      (degreeMatch ? null : line.slice(0, 120));

    if (!degreeMatch && !institution) continue;

    const field =
      line.match(/\b(?:in|of)\s+([A-Z][A-Za-z\s&]{2,50})/)?.[1]?.trim().replace(/[,.]$/, "") ?? null;

    out.push({
      institution: institution?.trim() || null,
      degree: degreeMatch?.[0] ?? null,
      field,
    });
    if (out.length >= 10) break;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// discard detection + confidence
// ─────────────────────────────────────────────────────────────
/**
 * Remove every line carrying a prohibited field.
 *
 * Line-granular rather than match-granular on purpose: "DOB: 12/03/1994" and
 * "Age: 31" are whole lines whose only content is the prohibited value, and
 * removing just the matched token would leave a dangling "DOB:" plus a date.
 */
function scrub(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      let out = line;
      for (const [re, , strategy] of DISCARD_PATTERNS) {
        if (!re.test(out)) continue;
        if (strategy === "LINE") return "";
        out = out.replace(new RegExp(re.source, "gi"), "").replace(/\s{2,}/g, " ").replace(/,\s*,/g, ",");
      }
      return out.replace(/[,;\s]+$/, "").trim();
    })
    .join("\n");
}

function detectDiscarded(text: string): string[] {
  const found = new Set<string>();
  for (const [re, label] of DISCARD_PATTERNS) {
    if (re.test(text)) found.add(label);
  }
  return [...found];
}

/**
 * Confidence per field.
 *
 * Anchored to structural evidence rather than a guess: a skills list found
 * under an explicit "Skills" heading is high confidence; the same skills mined
 * from prose are not. Anything below 0.7 is surfaced for confirmation.
 */
function scoreConfidence(p: ParsedResume, s: Sections, language: string): Confidence {
  const c: Confidence = {};

  c.email = p.contact.email ? 0.98 : 0;
  c.linkedin = p.contact.linkedin ? 0.95 : 0;
  c.summary = p.summary ? (s.summary.length ? 0.9 : 0.5) : 0;

  c.skills = p.skills.length === 0 ? 0 : s.skills.length ? Math.min(0.95, 0.7 + p.skills.length * 0.02) : 0.55;

  const withDates = p.roles.filter((r) => r.startYear != null).length;
  c.roles =
    p.roles.length === 0
      ? 0
      : Math.min(0.95, 0.5 + (withDates / p.roles.length) * 0.4 + (s.experience.length ? 0.1 : 0));

  c.totalYearsExperience = p.totalYearsExperience == null ? 0 : withDates >= 2 ? 0.85 : 0.6;
  c.education = p.education.length ? (s.education.length ? 0.85 : 0.5) : 0;
  c.headline = p.headline ? (p.roles[0]?.title ? 0.8 : 0.45) : 0;
  c.certifications = p.certifications.length ? 0.8 : 0;

  // A non-English resume degrades everything: the section headings and role
  // keywords this parser relies on are English.
  if (language === "other") {
    for (const k of Object.keys(c)) c[k] = Math.min(c[k]!, 0.4);
  }

  return c;
}

/**
 * AC-4 — the profile patch a candidate may APPROVE.
 *
 * Returns only the fields they ticked, and only ones above the confidence
 * threshold or explicitly confirmed. Nothing here writes anything; the caller
 * applies it after the candidate says so.
 */
export function toProfilePatch(
  outcome: ParseOutcome,
  approved: string[]
): Partial<{ headline: string; bio: string; skills: string[]; yearsExp: number }> {
  const { parsed } = outcome;
  const patch: Record<string, unknown> = {};
  const ok = (field: string) => approved.includes(field);

  // These caps must match PATCH /api/profile exactly, and until now they did
  // not: headline was clipped at 200 against the profile's 140, bio at 5000
  // against 2000, skills at 50 against 40. Nothing caught it because nothing
  // ever called this function — the moment a candidate approved a long headline
  // the profile write would have failed validation with an error naming a field
  // they never typed into.
  if (ok("headline") && parsed.headline) patch.headline = parsed.headline.slice(0, 140);
  if (ok("summary") && parsed.summary) patch.bio = parsed.summary.slice(0, 2000);
  if (ok("skills") && parsed.skills.length) patch.skills = parsed.skills.slice(0, 40);
  if (ok("totalYearsExperience") && parsed.totalYearsExperience != null) {
    patch.yearsExp = parsed.totalYearsExperience;
  }
  return patch as Partial<{ headline: string; bio: string; skills: string[]; yearsExp: number }>;
}
