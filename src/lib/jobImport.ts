import { extract } from "./resume/extract";
import { findJsonLdJobPostings } from "./discovery";
import { safeFetch } from "./safeFetch";
import { extractSkills, inferSeniority, normalizeSkills } from "./skills";
import { parseRequirements } from "./matching/requirements";
import { runAi } from "./ai";

/**
 * JOB-008 / JOB-009 / REC-007 / AC-003 — importing a posting the recruiter did
 * not type.
 *
 * Three ways in, one way out. A URL, a pasted description, or an uploaded
 * document all become the SAME draft object, which the recruiter then reviews
 * field by field before anything is created.
 *
 * ── This is not the existing URL ingestion ──
 *
 * `src/lib/sources.ts` already accepts a URL, and does something different on
 * purpose: it recognises a whole ATS or careers board and subscribes to it, so
 * every posting on that board flows in nightly as `source != "JOBSY"`. Those
 * rows are deliberately not editable (`INGESTED_NOT_EDITABLE`) because they are
 * somebody else's copy, refreshed on a schedule — editing one would be undone
 * by the next sync.
 *
 * This is the single-posting case: "here is the job I am hiring for, read it
 * so I do not have to retype it." The result is the recruiter's OWN posting,
 * fully editable, attributed to them, and never written until they say so.
 *
 * ── Nothing here publishes ──
 *
 * `importJob` returns a draft and touches no table. Creation still goes through
 * `POST /api/jobs`, which means every compliance screen — the ghost-job
 * attestation, pay-transparency rules, the prohibited-content check — applies
 * exactly as it does to a hand-typed posting. An import path that wrote
 * directly to `jobs` would be a way around all of them, so there isn't one.
 */

export type JobDraft = {
  title: string | null;
  companyName: string | null;
  location: string | null;
  remote: "ONSITE" | "HYBRID" | "REMOTE" | "ANY" | null;
  employmentType: string | null;
  seniority: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  description: string;
  requiredSkills: string[];
  preferredSkills: string[];
  /** Where each field came from, so the UI can show what was guessed. */
  provenance: Record<string, FieldSource>;
  /** Anything we could not determine and the recruiter must supply. */
  needsInput: string[];
  notes: string[];
};

/**
 * How confident to be about a field, and therefore how to present it.
 *
 * STRUCTURED is a schema.org JobPosting the employer published for exactly this
 * purpose — as close to authoritative as an import gets. PATTERN is our own
 * deterministic reading of the prose. AI is a model's reading, kept as its own
 * category and never silently merged with the other two, because a recruiter
 * checking a field deserves to know which of those produced it.
 */
export type FieldSource = "STRUCTURED" | "PATTERN" | "AI";

const MAX_DESCRIPTION = 20_000;

/** Strip tags and collapse whitespace, keeping paragraph breaks. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Salary figures, normalised to thousands the way the schema stores them.
 *
 * ── Every accepted range must carry a MONEY SIGNAL ──
 *
 * A currency symbol, a `k` suffix, or a salary word immediately before it. The
 * first version of this matched any "N to M" and duly read "a team of 200 to
 * 500 people" as a $200k–$500k salary — a number that would then be shown to
 * candidates, matched on, and used to decide who sees the posting.
 *
 * A magnitude check alone does not save you, because plenty of head-counts,
 * user counts and funding figures land squarely in salary range. Requiring the
 * text to actually be talking about money is the only reading that holds, and
 * a blank salary a recruiter fills in beats a confident wrong one.
 */
export function readSalary(text: string): { min: number | null; max: number | null } {
  const t = text.replace(/,/g, "");
  const SEP = String.raw`\s*(?:-|–|—|to|up to)\s*`;
  const patterns = [
    // $140000 - $180000  /  $150k – $190k
    new RegExp(String.raw`\$\s*(\d{2,7})\s*(k)?${SEP}\$?\s*(\d{2,7})\s*(k)?`, "i"),
    // 150k - 190k, with no symbol but an explicit unit
    new RegExp(String.raw`\b(\d{2,4})\s*(k)${SEP}(\d{2,4})\s*(k)\b`, "i"),
    // salary / compensation / base pay: 140000 - 180000
    new RegExp(
      String.raw`(?:salary|compensation|base pay|pay range|base salary)\D{0,16}?(\d{2,7})\s*(k)?${SEP}(\d{2,7})\s*(k)?`,
      "i"
    ),
  ];
  const toK = (n: number) => (n >= 1000 ? Math.round(n / 1000) : n);

  for (const re of patterns) {
    const m = re.exec(t);
    if (!m) continue;
    const lo = toK(Number(m[1]) * (m[2]?.toLowerCase() === "k" ? 1000 : 1));
    const hi = toK(Number(m[3]) * (m[4]?.toLowerCase() === "k" ? 1000 : 1));
    if (lo > 0 && hi >= lo && hi <= 2000) return { min: lo, max: hi };
  }
  return { min: null, max: null };
}

/** Work model, only when the text actually says so. */
export function readRemote(text: string): JobDraft["remote"] {
  const t = text.toLowerCase();
  if (/\b(fully remote|100% remote|remote[- ]first|work from home|wfh)\b/.test(t)) return "REMOTE";
  if (/\bhybrid\b/.test(t)) return "HYBRID";
  if (/\b(on[- ]?site only|100% onsite|fully on[- ]?site|in[- ]office)\b/.test(t)) return "ONSITE";
  if (/\bremote\b/.test(t)) return "REMOTE";
  return null;
}

export function readEmploymentType(text: string): string | null {
  const t = text.toLowerCase();
  if (/\b(full[- ]time|permanent|fte)\b/.test(t)) return "Full-time";
  if (/\b(part[- ]time)\b/.test(t)) return "Part-time";
  if (/\b(contract|contractor|c2c|w2 contract|freelance)\b/.test(t)) return "Contract";
  if (/\b(intern|internship)\b/.test(t)) return "Internship";
  if (/\b(temporary|temp role)\b/.test(t)) return "Temporary";
  return null;
}

const EMPLOYMENT_FROM_SCHEMA: Record<string, string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
  CONTRACTOR: "Contract",
  TEMPORARY: "Temporary",
  INTERN: "Internship",
  VOLUNTEER: "Volunteer",
  PER_DIEM: "Contract",
  OTHER: "Full-time",
};

const str = (v: unknown): string | null => {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (Array.isArray(v) && v.length) return str(v[0]);
  return null;
};

/**
 * Build a draft from a schema.org JobPosting node.
 *
 * This is the best case and worth taking seriously: the employer published
 * these fields deliberately, in a machine-readable format, so nothing has to be
 * guessed from prose.
 */
export function draftFromJsonLd(node: Record<string, unknown>): JobDraft | null {
  const title = str(node.title);
  if (!title) return null;

  const org = node.hiringOrganization as Record<string, unknown> | undefined;
  const loc = node.jobLocation as Record<string, unknown> | undefined;
  const addr = (Array.isArray(loc) ? loc[0] : loc)?.address as Record<string, unknown> | undefined;
  const locality = str(addr?.addressLocality);
  const region = str(addr?.addressRegion);
  const country = str(addr?.addressCountry);
  const location = [locality, region ?? country].filter(Boolean).join(", ") || null;

  const rawDesc = str(node.description) ?? "";
  const description = htmlToText(rawDesc).slice(0, MAX_DESCRIPTION);

  const salaryNode = (node.baseSalary as Record<string, unknown> | undefined)?.value as
    | Record<string, unknown>
    | undefined;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const rawMin = num(salaryNode?.minValue);
  const rawMax = num(salaryNode?.maxValue);
  const toK = (n: number | null) => (n === null ? null : n >= 1000 ? Math.round(n / 1000) : n);
  const structuredMin = toK(rawMin);
  const structuredMax = toK(rawMax);

  const empRaw = str(node.employmentType);
  const employmentType = empRaw
    ? (EMPLOYMENT_FROM_SCHEMA[empRaw.toUpperCase().replace(/[\s-]/g, "_")] ?? empRaw)
    : null;

  const remote =
    node.jobLocationType === "TELECOMMUTE" ? "REMOTE" : readRemote(`${title} ${description}`);

  const prov: Record<string, FieldSource> = { title: "STRUCTURED", description: "STRUCTURED" };
  if (org) prov.companyName = "STRUCTURED";
  if (location) prov.location = "STRUCTURED";
  if (employmentType) prov.employmentType = "STRUCTURED";
  if (structuredMin !== null || structuredMax !== null) prov.salary = "STRUCTURED";
  if (remote) prov.remote = node.jobLocationType === "TELECOMMUTE" ? "STRUCTURED" : "PATTERN";

  const fallback = structuredMin === null && structuredMax === null ? readSalary(description) : null;
  if (fallback && (fallback.min !== null || fallback.max !== null)) prov.salary = "PATTERN";

  return withSkills({
    title,
    companyName: str(org?.name),
    location,
    remote,
    employmentType,
    seniority: inferSeniority(title, description),
    salaryMin: structuredMin ?? fallback?.min ?? null,
    salaryMax: structuredMax ?? fallback?.max ?? null,
    description,
    requiredSkills: [],
    preferredSkills: [],
    provenance: prov,
    needsInput: [],
    notes: ["Read from the employer's own structured job data."],
  });
}

/**
 * Build a draft from free text — a pasted description or an extracted document.
 *
 * Everything here is a deterministic read of the prose, which is why the
 * provenance is PATTERN throughout: it is our inference, not the employer's
 * assertion, and the recruiter is being asked to check it.
 */
export function draftFromText(text: string): JobDraft {
  const description = text.trim().slice(0, MAX_DESCRIPTION);
  const firstLines = description.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 6);

  /**
   * The title is the first line that reads like one.
   *
   * A pasted posting almost always opens with it, but "About Acme" and "We're
   * hiring!" open some too — so a line only qualifies if it is short, is not a
   * sentence, and is not obvious boilerplate.
   */
  const titleLine =
    firstLines.find(
      (l) =>
        l.length >= 3 &&
        l.length <= 90 &&
        !/[.!?]$/.test(l) &&
        !/^(about|we|our|the company|who we are|join us|hi\b|hello\b)/i.test(l)
    ) ?? null;

  const salary = readSalary(description);
  const remote = readRemote(description);
  const employmentType = readEmploymentType(description);

  /**
   * Case-INSENSITIVE on the keyword, case-sensitive on the value.
   *
   * The label is written "Location:" far more often than "location:", and the
   * first version of this had no `i` flag, so the single most common spelling
   * of the most common label never matched. The value still has to start with a
   * capital, because that is what distinguishes a place name from the rest of
   * the sentence.
   */
  const locationMatch =
    /\b(?:location|based in|office in)\s*[:\-]?\s*([A-Z][A-Za-z .'-]+(?:,\s*[A-Za-z .'-]+){0,2})/i.exec(
      description
    );

  const prov: Record<string, FieldSource> = { description: "PATTERN" };
  if (titleLine) prov.title = "PATTERN";
  if (locationMatch) prov.location = "PATTERN";
  if (remote) prov.remote = "PATTERN";
  if (employmentType) prov.employmentType = "PATTERN";
  if (salary.min !== null) prov.salary = "PATTERN";

  return withSkills({
    title: titleLine,
    companyName: null,
    location: locationMatch?.[1]?.trim() ?? null,
    remote,
    employmentType,
    seniority: titleLine ? inferSeniority(titleLine, description) : inferSeniority("", description),
    salaryMin: salary.min,
    salaryMax: salary.max,
    description,
    requiredSkills: [],
    preferredSkills: [],
    provenance: prov,
    needsInput: [],
    notes: [],
  });
}

/**
 * Fill in the skills split using the SAME parser the match engine uses.
 *
 * Deliberately not a second implementation. If import derived required and
 * preferred differently from `parseRequirements`, a recruiter would review one
 * set of skills and be matched on another — and the discrepancy would be
 * invisible to both sides.
 */
function withSkills(d: JobDraft): JobDraft {
  const tagged = extractSkills(d.description, 14);
  const reqs = parseRequirements({
    title: d.title ?? "",
    description: d.description,
    skills: tagged,
  });
  const draft: JobDraft = {
    ...d,
    requiredSkills: normalizeSkills(reqs.required).slice(0, 20),
    preferredSkills: normalizeSkills(reqs.preferred).slice(0, 20),
  };
  if (draft.requiredSkills.length) draft.provenance.requiredSkills = "PATTERN";
  if (draft.preferredSkills.length) draft.provenance.preferredSkills = "PATTERN";
  if (reqs.structured) {
    draft.notes.push("The posting had a stated requirements section, so the must-have split is its own.");
  }
  return finalise(draft);
}

/** Name every field the recruiter still has to supply. */
function finalise(d: JobDraft): JobDraft {
  const needs: string[] = [];
  if (!d.title) needs.push("title");
  if (!d.companyName) needs.push("companyName");
  if (!d.location) needs.push("location");
  if (!d.description || d.description.length < 20) needs.push("description");
  return { ...d, needsInput: needs };
}

/**
 * Ask a model for the fields the deterministic pass could not find.
 *
 * ── The anti-fabrication rule ──
 *
 * Every value the model returns must appear VERBATIM in the source text, or it
 * is discarded. Checked mechanically here rather than requested in the prompt,
 * for the same reason the resume rewriter checks its output (RES-007): a prompt
 * asking a model not to invent things is a wish, and a string comparison is a
 * guarantee. A hallucinated company name on a job posting is not a cosmetic
 * error — it is a posting attributed to a business that never advertised it.
 *
 * Sensitivity is EMPLOYER_PUBLIC: this is a job advert the employer published
 * to the world. It is the one place in this product where that classification
 * is correct, and the only reason the second provider is reachable at all.
 */
export async function enrichWithAi(draft: JobDraft, sourceText: string): Promise<JobDraft> {
  const wanted = draft.needsInput.filter((f) => f !== "description");
  if (!wanted.length) return draft;

  const outcome = await runAi({
    sensitivity: "EMPLOYER_PUBLIC",
    system:
      "You extract fields from job postings. Reply with ONLY a JSON object, no prose. " +
      "Every value MUST be copied verbatim from the posting. If the posting does not state a " +
      'field, use null. Never guess, never infer, never expand abbreviations.',
    user:
      `Extract these fields as JSON: ${wanted.join(", ")}.\n\n` +
      `Posting:\n${sourceText.slice(0, 6000)}`,
    maxTokens: 300,
    temperature: 0,
  });

  if (!outcome.result) {
    return {
      ...draft,
      notes: [...draft.notes, "AI extraction was unavailable, so blank fields are left for you."],
    };
  }

  let parsed: Record<string, unknown>;
  try {
    const m = /\{[\s\S]*\}/.exec(outcome.result.text);
    parsed = m ? (JSON.parse(m[0]) as Record<string, unknown>) : {};
  } catch {
    return { ...draft, notes: [...draft.notes, "AI returned something unreadable; ignored."] };
  }

  const hay = sourceText.toLowerCase();
  const out = { ...draft, provenance: { ...draft.provenance }, notes: [...draft.notes] };
  const rejected: string[] = [];

  for (const field of wanted) {
    const raw = parsed[field];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const value = raw.trim();
    // THE GUARD. Not in the source, not used.
    if (!hay.includes(value.toLowerCase())) {
      rejected.push(field);
      continue;
    }
    if (field === "title") out.title = value;
    else if (field === "companyName") out.companyName = value;
    else if (field === "location") out.location = value;
    else continue;
    out.provenance[field] = "AI";
  }

  if (rejected.length) {
    out.notes.push(
      `Discarded AI values for ${rejected.join(", ")} — they did not appear in the posting.`
    );
  }
  return finalise(out);
}

export type ImportOutcome =
  | { ok: true; draft: JobDraft; from: "URL_STRUCTURED" | "URL_TEXT" | "TEXT" | "DOCUMENT" }
  | { ok: false; error: string; code: string };

/** Import from a pasted job description. */
export function importFromText(text: string): ImportOutcome {
  const clean = (text ?? "").trim();
  if (clean.length < 40) {
    return {
      ok: false,
      code: "TOO_SHORT",
      error: "That's too short to read as a job posting. Paste the full description.",
    };
  }
  return { ok: true, draft: draftFromText(clean), from: "TEXT" };
}

/** Import from an uploaded description document. */
export function importFromDocument(buf: Buffer): ImportOutcome {
  const ex = extract(buf);
  if (ex.status !== "OK" || !ex.text.trim()) {
    return {
      ok: false,
      code: "UNREADABLE",
      // The extractor already phrases its refusals for a person to act on
      // (password-protected, scanned image, wrong file type). Reaching past
      // that to write a worse generic message would lose the one detail that
      // tells them what to do differently.
      error:
        ex.note ??
        "Couldn't read that file. PDF and Word (.docx) work; a scanned image does not.",
    };
  }
  return { ok: true, draft: draftFromText(ex.text), from: "DOCUMENT" };
}

/**
 * Import from a URL.
 *
 * Fetched through `safeFetch`, which is the SSRF guard — it resolves the host
 * and refuses private and link-local addresses, follows redirects manually so
 * a public URL cannot bounce to an internal one, and caps the body. A recruiter
 * pasting a URL is asking this server to make a request on their behalf, which
 * is exactly the shape of attack that guard exists for.
 */
export async function importFromUrl(url: string): Promise<ImportOutcome> {
  const res = await safeFetch(url);
  if (!res.ok) return { ok: false, code: res.code, error: res.reason };

  const html = res.body;

  // Structured data first — it is the employer's own machine-readable version.
  for (const node of findJsonLdJobPostings(html)) {
    const draft = draftFromJsonLd(node);
    if (draft) return { ok: true, draft, from: "URL_STRUCTURED" };
  }

  const text = htmlToText(html);
  if (text.length < 200) {
    return {
      ok: false,
      code: "NO_CONTENT",
      error:
        "That page had almost no readable text — it may need JavaScript to render. " +
        "Copy the description and paste it instead.",
    };
  }
  const draft = draftFromText(text);
  draft.notes.push("No structured job data on that page, so the fields were read from the text.");
  return { ok: true, draft, from: "URL_TEXT" };
}
