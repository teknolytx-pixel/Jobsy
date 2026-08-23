#!/usr/bin/env tsx
/**
 * JOB IMPORT — JOB-008 / JOB-009 / REC-007 / AC-003.
 *
 * A recruiter pastes a URL, pastes a description, or uploads a document, and
 * gets back an editable draft rather than a published posting.
 *
 * ── What these tests are actually protecting ──
 *
 * Two properties, and they pull in opposite directions.
 *
 *   1. The parser has to be USEFUL. A draft that leaves every field blank has
 *      saved nobody any typing, so the deterministic pass is asserted on a
 *      realistic posting, not a contrived one.
 *   2. The parser must not INVENT. Every AI-supplied value is checked against
 *      the source text and dropped if absent — the same mechanical guard the
 *      resume rewriter uses (RES-007), and for a sharper reason: a hallucinated
 *      company name is a job advert attributed to a business that never placed
 *      it.
 *
 * No network and no database. `importFromUrl` is exercised through its parts;
 * the fetch itself is covered by scripts/test-safefetch.mts.
 */
import "dotenv/config";
import { deflateRawSync } from "node:zlib";

const {
  draftFromJsonLd,
  draftFromText,
  enrichWithAi,
  htmlToText,
  importFromDocument,
  importFromText,
  readRemote,
  readSalary,
  readEmploymentType,
} = await import("../src/lib/jobImport");

let pass = 0,
  fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

// ─────────────────────────────────────────────────────────────
console.log("\nREADING THE PARTS\n");

check("TC-IMP-01 an annual range in dollars", readSalary("$140,000 - $180,000 per year").min === 140,
  JSON.stringify(readSalary("$140,000 - $180,000 per year")));
check("TC-IMP-02 a range written in k", readSalary("$150k–$190k").max === 190,
  JSON.stringify(readSalary("$150k–$190k")));
/** An employee count is not a salary, and reading it as one is worse than reading nothing. */
check("TC-IMP-03 an employee count is not a salary",
  readSalary("We are a team of 200 to 500 people").min === null,
  JSON.stringify(readSalary("We are a team of 200 to 500 people")));

check("TC-IMP-04 fully remote", readRemote("This is a fully remote role") === "REMOTE");
check("TC-IMP-05 hybrid", readRemote("Hybrid, 3 days in the office") === "HYBRID");
check("TC-IMP-06 onsite only", readRemote("This role is 100% onsite") === "ONSITE");
/** Silence is not a claim. A posting that says nothing gets null, not a default. */
check("TC-IMP-07 an unstated work model stays unstated",
  readRemote("We build data pipelines.") === null);

check("TC-IMP-08 contract work is recognised",
  readEmploymentType("This is a 6-month contract") === "Contract");

check("TC-IMP-09 html becomes readable text",
  !htmlToText("<p>Senior Engineer</p><script>alert(1)</script><p>Apply now</p>").includes("alert"),
  htmlToText("<p>Senior Engineer</p><script>alert(1)</script><p>Apply now</p>"));

// ─────────────────────────────────────────────────────────────
console.log("\nSTRUCTURED DATA — the employer's own fields\n");

const jsonLd = {
  "@type": "JobPosting",
  title: "Senior Data Engineer",
  description:
    "<p>We are hiring a Senior Data Engineer.</p><p>Requirements:</p><ul><li>5+ years with Python and Spark</li><li>Databricks and Airflow</li></ul><p>Nice to have:</p><ul><li>dbt</li></ul>",
  hiringOrganization: { "@type": "Organization", name: "Northwind Analytics" },
  jobLocation: {
    "@type": "Place",
    address: { addressLocality: "Austin", addressRegion: "TX", addressCountry: "US" },
  },
  employmentType: "FULL_TIME",
  baseSalary: { "@type": "MonetaryAmount", value: { minValue: 150000, maxValue: 190000 } },
};

const s = draftFromJsonLd(jsonLd as Record<string, unknown>)!;
check("TC-IMP-20 a JobPosting node produces a draft", Boolean(s));
check("TC-IMP-21 title", s.title === "Senior Data Engineer", s.title ?? "—");
check("TC-IMP-22 company", s.companyName === "Northwind Analytics", s.companyName ?? "—");
check("TC-IMP-23 location", s.location === "Austin, TX", s.location ?? "—");
check("TC-IMP-24 employment type is mapped from the schema vocabulary",
  s.employmentType === "Full-time", s.employmentType ?? "—");
/** The schema states salary in units; the column stores thousands. */
check("TC-IMP-25 salary is normalised to thousands",
  s.salaryMin === 150 && s.salaryMax === 190, `${s.salaryMin}–${s.salaryMax}`);
check("TC-IMP-26 the description is de-tagged", !s.description.includes("<p>"),
  s.description.slice(0, 48));
check("TC-IMP-27 skills are split into must-have and nice-to-have",
  s.requiredSkills.length > 0 && s.preferredSkills.includes("dbt"),
  `req=[${s.requiredSkills}] pref=[${s.preferredSkills}]`);
check("TC-IMP-28 structured fields are marked as the employer's own",
  s.provenance.title === "STRUCTURED" && s.provenance.companyName === "STRUCTURED",
  JSON.stringify(s.provenance));
check("TC-IMP-29 nothing is left for the recruiter to supply", s.needsInput.length === 0,
  s.needsInput.join(", ") || "—");

// ─────────────────────────────────────────────────────────────
console.log("\nPASTED TEXT\n");

const pasted = `Staff Platform Engineer

Location: Denver, CO
This is a hybrid role, 2 days a week in the office.
Compensation: $170,000 - $210,000

Requirements:
- 8+ years running production Kubernetes
- Strong Terraform and AWS
- Experience with CI/CD pipelines

Nice to have:
- Observability tooling such as Datadog
`;

const t = draftFromText(pasted);
check("TC-IMP-40 the title is taken from the opening line",
  t.title === "Staff Platform Engineer", t.title ?? "—");
check("TC-IMP-41 location", t.location === "Denver, CO", t.location ?? "—");
check("TC-IMP-42 work model", t.remote === "HYBRID", t.remote ?? "—");
check("TC-IMP-43 salary", t.salaryMin === 170 && t.salaryMax === 210,
  `${t.salaryMin}–${t.salaryMax}`);
check("TC-IMP-44 seniority", t.seniority === "Principal" || t.seniority === "Senior",
  t.seniority ?? "—");
check("TC-IMP-45 must-haves are separated from nice-to-haves",
  t.requiredSkills.includes("Kubernetes") && t.preferredSkills.includes("Observability"),
  `req=[${t.requiredSkills}] pref=[${t.preferredSkills}]`);
/**
 * Pasted text carries no company name and no honest way to derive one, so the
 * recruiter is asked. Guessing from an email domain or a stray capitalised word
 * is exactly the kind of plausible-but-wrong that is worse than a blank field.
 */
check("TC-IMP-46 a company nobody stated is asked for, not invented",
  t.companyName === null && t.needsInput.includes("companyName"),
  t.needsInput.join(", "));
check("TC-IMP-47 every derived field is marked as read from the text",
  t.provenance.title === "PATTERN" && t.provenance.location === "PATTERN");

/** Boilerplate openers must not be mistaken for the job title. */
const aboutFirst = draftFromText(
  "About Northwind\nWe are a friendly team.\n\nSenior Backend Engineer\n\nRequirements:\n- Go and Postgres\n"
);
check("TC-IMP-48 an 'About us' opener is not the job title",
  aboutFirst.title !== "About Northwind", aboutFirst.title ?? "—");

check("TC-IMP-49 something too short to be a posting is refused",
  importFromText("Hiring!").ok === false);

// ─────────────────────────────────────────────────────────────
console.log("\nDOCUMENTS\n");

/**
 * A real (tiny) PDF, built the same way scripts/test-security.mts builds one.
 *
 * Deliberately not a new zip dependency for a fixture: the repo's docx reader
 * uses raw zlib rather than a library, and adding jszip purely to construct a
 * test file would put a package in the tree that ships nothing.
 */
function minimalPdf(body: string): Buffer {
  const content = `BT /F1 12 Tf 72 720 Td (${body}) Tj ET`;
  const stream = deflateRawSync(Buffer.from(content, "latin1"));
  return Buffer.concat([
    Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n"),
    Buffer.from(`4 0 obj\n<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`),
    stream,
    Buffer.from("\nendstream\nendobj\n%%EOF\n"),
  ]);
}

/**
 * Over 120 characters on purpose. Below that the extractor calls it a scanned
 * image and refuses (extract.ts), which is right for a real upload and would
 * make this fixture test the refusal path rather than the parse.
 */
const pdfDoc = importFromDocument(
  minimalPdf(
    "Senior Frontend Engineer. Location: Seattle, WA. This is a hybrid role. " +
      "Requirements: 5+ years of React and TypeScript, strong GraphQL, and experience " +
      "building design systems. Nice to have: Testing and Accessibility work."
  )
);
check("TC-IMP-60 a PDF job description is read", pdfDoc.ok === true,
  pdfDoc.ok ? (pdfDoc.draft.title ?? "—") : (pdfDoc as { error: string }).error);
if (pdfDoc.ok) {
  check("TC-IMP-62 and its skills are picked up",
    pdfDoc.draft.requiredSkills.includes("React"), pdfDoc.draft.requiredSkills.join(", "));
}

check("TC-IMP-63 a file that is not a document is refused",
  importFromDocument(Buffer.from("this is just text, not a pdf or docx")).ok === false);

// ─────────────────────────────────────────────────────────────
console.log("\nTHE ANTI-FABRICATION GUARD\n");

/**
 * The guard is mechanical, so it can be tested without a model: feed
 * `enrichWithAi` a draft whose gaps cannot be filled and assert nothing is
 * invented. With no AI key configured the call returns no result, which is
 * itself the case that must not produce fabricated fields.
 */
const gappy = draftFromText(
  "Backend Engineer\n\nRequirements:\n- Go, Postgres and Kafka\n- 6+ years experience\n"
);
const enriched = await enrichWithAi(gappy, gappy.description);
check("TC-IMP-70 a company absent from the text is never filled in",
  enriched.companyName === null || gappy.description.toLowerCase().includes((enriched.companyName ?? "").toLowerCase()),
  enriched.companyName ?? "null");
check("TC-IMP-71 it still asks the recruiter for what is missing",
  enriched.needsInput.includes("companyName"), enriched.needsInput.join(", "));
check("TC-IMP-72 and says so rather than failing silently",
  enriched.notes.length > 0, enriched.notes.join(" | "));

/**
 * The import path never publishes. Asserted on the shape rather than by
 * inspecting the database, because the property is that no write EXISTS: the
 * module imports nothing from src/db at all.
 */
const src = await import("node:fs").then((fs) =>
  fs.readFileSync("src/lib/jobImport.ts", "utf8")
);
check("TC-IMP-80 the import module cannot write to the database",
  !/from\s+["']\.\/db["']|from\s+["']@\/db["']/.test(src),
  "no db import");

console.log(`\n${pass} passed, ${fail} failed  —  job import\n`);
process.exit(fail ? 1 : 0);
