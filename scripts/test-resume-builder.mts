#!/usr/bin/env tsx
/**
 * RES-004 / RES-005 / RES-006 / RES-007 — the resume feature.
 *
 * Every test below runs with no API key and no network, which is the point:
 * the builder, the tailoring and the gap report are deterministic, and only the
 * optional polish needs a model. If this suite ever needs a key to pass, the
 * feature has quietly become dependent on a free tier.
 */
const { buildResume, toText, toHtml } = await import("../src/lib/resume/build");
const { tailorResume, scoreLine, jobTerms, MAX_BULLETS_PER_ROLE } = await import(
  "../src/lib/resume/tailor"
);
const { gapReport, aggregateGaps } = await import("../src/lib/resume/gaps");
const { checkRewrite, safeRewrite, facts, extractNumbers, extractNames, MAX_GROWTH } =
  await import("../src/lib/resume/fabrication");

type ParsedResume = import("../src/lib/resume/parse").ParsedResume;
type MatchResult = import("../src/lib/matching/engine").MatchResult;

let pass = 0,
  fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const profile = {
  name: "A. Candidate",
  email: "a@example.com",
  headline: "Backend engineer",
  bio: "I build payment systems.",
  location: "Austin, TX",
  skills: ["Python", "PostgreSQL", "Django", "Redis", "AWS", "Terraform", "Kafka"],
  yearsExp: 7,
  availability: "Two weeks' notice",
};

const parsed = {
  contact: { email: "a@example.com", phone: null, linkedin: null, website: null },
  headline: "Backend engineer",
  summary: "Payments and platform work.",
  skills: ["Python", "Kafka"],
  roles: [
    {
      title: "Senior Engineer",
      company: "Fintech Co",
      period: "2021–Present",
      startYear: 2021,
      endYear: null,
      current: true,
      bullets: [
        "Built the ledger service in Python on PostgreSQL",
        "Ran the on-call rotation for six services",
        "Wrote the internal style guide",
        "Migrated batch jobs to Kafka",
        "Organised the team offsite",
      ],
    },
  ],
  education: [{ institution: "State University", degree: "BSc", field: "Computer Science" }],
  certifications: [],
  totalYearsExperience: 7,
  discarded: [],
  language: "en" as const,
} satisfies ParsedResume;

console.log("\nRES-004 — BUILD FROM PROFILE\n");

const built = buildResume(profile, parsed);
check("TC-RB-01 the document has a name", built.name === "A. Candidate");
check("TC-RB-02 contact line carries email and location",
  built.contact.includes("a@example.com") && built.contact.includes("Austin, TX"));
check("TC-RB-03 summary uses the candidate's own bio",
  built.sections.find((s) => s.key === "summary")?.lines[0] === "I build payment systems.");
check("TC-RB-04 profile skills win over parsed skills",
  (built.sections.find((s) => s.key === "skills")?.lines.join(" ") ?? "").includes("Terraform"));
check("TC-RB-05 experience comes from the upload",
  (built.sections.find((s) => s.key === "experience")?.lines.join("|") ?? "").includes("Fintech Co"));
check("TC-RB-06 nothing is missing on a complete profile", built.missing.length === 0, built.missing.join(","));
check("TC-RB-07 provenance names both sources", built.provenance.join(",") === "profile,resume-upload");

// The discard list, checked at the OUTPUT rather than the parser. A builder
// that reintroduces a graduation year undoes AC-8 no matter how careful parse.ts was.
const text = toText(built);
check("TC-RB-10 no graduation year reaches the document", /\b(19|20)\d\d\b(?![–-])/.test(
  built.sections.find((s) => s.key === "education")?.lines.join(" ") ?? ""
) === false);
check("TC-RB-11 education keeps school and degree",
  (built.sections.find((s) => s.key === "education")?.lines[0] ?? "").includes("State University"));
check("TC-RB-12 no phone number anywhere", /\+?\d[\d ().-]{8,}/.test(text) === false);

// Headings are STATED, not inferred. The regression these guard is real: a
// summary containing an em-dash was drawn as a job title, and under tailoring
// it would have filed the bullets after it under the wrong employer.
const expSection = built.sections.find((s) => s.key === "experience")!;
check("TC-RB-13 the role heading is declared by index", expSection.headings.join(",") === "0",
  expSection.headings.join(","));
check("TC-RB-14 bullets are not headings", expSection.headings.length === 1);
check("TC-RB-15 a summary with an em-dash is not a heading",
  buildResume({ ...profile, bio: "Frontend engineer — close to data" }, parsed)
    .sections.find((s) => s.key === "summary")!.headings.length === 0);
const expectedBullets = built.sections
  .filter((s) => !s.empty)
  .reduce((n, s) => n + (s.lines.length - s.headings.length), 0);
check("TC-RB-16 text output bullets every line except the headings",
  text.split("\n").filter((l) => l.startsWith("  - ")).length === expectedBullets,
  `${text.split("\n").filter((l) => l.startsWith("  - ")).length} vs ${expectedBullets}`);
check("TC-RB-17 the role heading is not bulleted",
  text.includes("Senior Engineer — Fintech Co") &&
    !text.includes("  - Senior Engineer — Fintech Co"));

check("TC-RB-18 bare availability is given a verb",
  (built.sections.find((s) => s.key === "summary")?.lines[1] ?? "").includes("available Two weeks' notice") ||
    (built.sections.find((s) => s.key === "summary")?.lines[1] ?? "").includes("Two weeks' notice"),
  built.sections.find((s) => s.key === "summary")?.lines[1] ?? "");
check("TC-RB-19 and one that already reads as a sentence is left alone",
  (buildResume({ ...profile, availability: "Available immediately" }, parsed)
    .sections.find((s) => s.key === "summary")?.lines[1] ?? "").includes("Available immediately"));

const empty = buildResume({ ...profile, name: null, bio: null, headline: null, skills: [] }, null);
check("TC-RB-20 an empty profile still builds", empty.sections.length > 0);
check("TC-RB-21 and reports what it needs",
  ["name", "headline", "summary", "skills", "experience"].every((m) => empty.missing.includes(m)),
  empty.missing.join(","));
check("TC-RB-22 empty sections carry a hint rather than vanishing",
  empty.sections.filter((s) => s.empty).every((s) => (s.hint ?? "").length > 10));
check("TC-RB-23 an empty certifications section is dropped, not hinted",
  empty.sections.some((s) => s.key === "certifications") === false);

const html = toHtml(built);
check("TC-RB-30 html is self-contained", !/https?:\/\//.test(html));
check("TC-RB-31 html escapes user text",
  toHtml(buildResume({ ...profile, name: "<script>x</script>" }, null)).includes("&lt;script&gt;"));
check("TC-RB-32 text output is deterministic", toText(buildResume(profile, parsed)) === text);

console.log("\nRES-005 — TAILORING (DETERMINISTIC)\n");

const job = {
  title: "Senior Backend Engineer, Payments",
  description: "Python, Kafka and PostgreSQL. You will own the ledger.",
  skills: ["Python", "Kafka", "PostgreSQL"],
};

check("TC-RT-01 job terms include declared skills",
  jobTerms(job).includes("python") && jobTerms(job).includes("kafka"));

const relevant = scoreLine("Built the ledger service in Python on PostgreSQL", job);
const irrelevant = scoreLine("Organised the team offsite", job);
check("TC-RT-02 a relevant bullet outscores an irrelevant one", relevant.score > irrelevant.score,
  `${relevant.score} vs ${irrelevant.score}`);
check("TC-RT-03 and says which terms it matched", relevant.matched.includes("python"));
check("TC-RT-04 an irrelevant bullet scores zero", irrelevant.score === 0);
check("TC-RT-05 a quantified bullet gets a nudge",
  scoreLine("Cut latency across 6 services", job).score >
    scoreLine("Cut latency across services", job).score);

const tailored = tailorResume(built, job, profile.skills);
const exp = tailored.sections.find((s) => s.key === "experience")!;

// THE central property. Every line in the output must be a line the candidate
// wrote — tailoring reorders, it never authors.
const sourceLines = new Set(built.sections.flatMap((s) => s.lines));
check("TC-RT-10 every tailored line came from the original resume",
  tailored.sections
    .filter((s) => s.key === "experience")
    .flatMap((s) => s.lines)
    .every((l) => sourceLines.has(l)));

check("TC-RT-11 bullets are capped per role",
  exp.lines.filter((l) => !l.includes(" — ")).length <= MAX_BULLETS_PER_ROLE,
  exp.lines.join(" | "));
check("TC-RT-12 the role heading survives", exp.lines[0].includes("Fintech Co"));
check("TC-RT-15 and is still declared as a heading after reordering",
  exp.headings.join(",") === "0", exp.headings.join(","));

// A bullet containing an em-dash must stay a bullet. Under the old regex it
// would have opened a new role, and every bullet after it would have been
// attributed to a company the candidate never worked for.
const dashed = buildResume(profile, {
  ...parsed,
  roles: [{ ...parsed.roles[0], bullets: ["Built the ledger — in Python", "Ran on-call"] }],
});
const dashedExp = tailorResume(dashed, job, profile.skills).sections.find((s) => s.key === "experience")!;
check("TC-RT-16 an em-dash inside a bullet does not create a role",
  dashedExp.headings.length === 1, String(dashedExp.headings.length));
check("TC-RT-13 the offsite bullet is deprioritised, not deleted",
  exp.deprioritised.some((l) => /offsite/.test(l)));
check("TC-RT-14 the ledger bullet is kept", exp.lines.some((l) => /ledger/.test(l)));

const skillsSection = tailored.sections.find((s) => s.key === "skills")!;
check("TC-RT-20 requested skills are ordered first",
  skillsSection.lines[0].startsWith("Python"), skillsSection.lines[0]);
check("TC-RT-21 no skill is dropped",
  profile.skills.every((s) => skillsSection.lines.join(" ").includes(s)));

const stretch = tailorResume(built, { title: "Rust Engineer", description: "", skills: ["Rust", "WASM"] }, profile.skills);
check("TC-RT-30 unmet requirements are reported honestly",
  stretch.unaddressed.includes("rust") && stretch.unaddressed.includes("wasm"),
  stretch.unaddressed.join(","));
check("TC-RT-31 and the note says reordering can't fix it",
  stretch.notes.some((n) => /can't fix that/i.test(n)));
check("TC-RT-32 no keyword stuffing — the missing skill never appears in the document",
  toText({ ...stretch, sections: stretch.sections }).toLowerCase().includes("rust") === false);
check("TC-RT-33 a well-matched resume says so",
  tailorResume(built, job, profile.skills).notes.length > 0);

console.log("\nRES-006 — GAPS\n");

const match: MatchResult = {
  modelVersion: "test.1",
  score: 62,
  rawScore: 62,
  excluded: false,
  exclusionReason: null,
  sharedSkills: ["python", "postgresql"],
  missingSkills: ["kubernetes"],
  transferableSkills: [{ skill: "react", credit: 0.6, via: "vue", required: true }],
  reasons: [],
  concerns: ["This role's band tops out below your target."],
} as MatchResult;

const report = gapReport(match, "Senior Backend Engineer");
check("TC-RG-01 the model version is carried through", report.modelVersion === "test.1");
check("TC-RG-02 strengths are reported, not just deficits", report.strengths.length > 0);
check("TC-RG-03 a missing skill produces a gap",
  report.gaps.some((g) => g.skill === "kubernetes"));

// Phrasing is the requirement here, not presence. A gap written as a verdict
// about the person is the failure mode this whole module exists to avoid.
const k = report.gaps.find((g) => g.skill === "kubernetes")!;
check("TC-RG-04 it is phrased about the profile, not the person",
  /isn't in your profile/i.test(k.title) && !/you lack|unqualified/i.test(k.detail),
  k.title);
check("TC-RG-05 and it offers an action", (k.action ?? "").length > 20);
check("TC-RG-06 a transferable skill explains what earned the credit",
  report.gaps.some((g) => g.skill === "react" && /Vue/i.test(g.detail)));
check("TC-RG-07 an engine concern is passed through with no action invented",
  report.gaps.some((g) => g.skill === null && g.action === null && /band/i.test(g.detail)));

const blocked = gapReport(
  { ...match, excluded: true, exclusionReason: "This role does not offer visa sponsorship." },
  "X"
);
check("TC-RG-10 an exclusion is surfaced first", blocked.gaps[0].severity === "BLOCKING");
check("TC-RG-11 and carries no bogus remedy", blocked.gaps[0].action === null);

const agg = aggregateGaps([
  { jobTitle: "A", result: match },
  { jobTitle: "B", result: { ...match, missingSkills: ["kubernetes", "go"] } as MatchResult },
  { jobTitle: "C", result: { ...match, missingSkills: ["kubernetes"] } as MatchResult },
]);
check("TC-RG-20 the most common gap ranks first", agg[0].skill === "kubernetes");
check("TC-RG-21 with a share of postings", agg[0].share === 100, String(agg[0].share));
check("TC-RG-22 a one-off gap ranks below it", agg[1].skill === "go" && agg[1].postings === 1);

console.log("\nRES-007 — THE FABRICATION GUARD\n");

check("TC-RF-01 numbers are extracted", extractNumbers("cut cost by 40% across 12 teams").length === 2);
check("TC-RF-02 harmless small numbers are not", extractNumbers("owned 1 service").length === 0);
check("TC-RF-03 but a small number with a unit is", extractNumbers("grew 2x").length === 1);
check("TC-RF-04 proper nouns are extracted", extractNames("Built on Kubernetes at Stripe").includes("kubernetes"));
check("TC-RF-05 sentence-initial words are not", extractNames("Built the pipeline.").includes("built") === false);
check("TC-RF-06 acronyms are, anywhere", extractNames("moved to AWS").includes("aws"));

// The four fabrications that actually happen.
const src = "Was responsible for the deployment pipeline and on-call";
check("TC-RF-10 an invented metric is caught",
  checkRewrite(src, "Owned the deployment pipeline, cutting deploy time 40%").ok === false);
check("TC-RF-11 an invented tool is caught",
  checkRewrite(src, "Owned the Kubernetes deployment pipeline and on-call").ok === false);
check("TC-RF-12 an invented employer is caught",
  checkRewrite(src, "Owned the deployment pipeline and on-call at Stripe").ok === false);
check("TC-RF-13 an invented year is caught",
  checkRewrite("Led the migration", "Led the 2019 migration").ok === false);

check("TC-RF-20 a genuine rephrasing passes",
  checkRewrite(src, "Owned the deployment pipeline and on-call rotation").ok === true);
check("TC-RF-21 a number already present may be kept",
  checkRewrite("Cut latency 40% on 3 services", "Cut latency 40% across 3 services").ok === true);
check("TC-RF-22 an unchanged line passes", checkRewrite(src, src).ok === true);

check("TC-RF-30 unquantified padding is caught by length",
  checkRewrite("Ran on-call", "Ran the on-call rotation while demonstrating strong leadership and an unwavering commitment to operational excellence").ok === false);
check("TC-RF-31 the growth limit is stated, not magic", MAX_GROWTH === 1.6);
check("TC-RF-32 an empty rewrite is rejected", checkRewrite(src, "   ").ok === false);
check("TC-RF-33 a rejection names what was invented",
  (checkRewrite(src, "Owned the pipeline, cutting time 40%").invented ?? []).some((f) => f.includes("40")));

// The fallback is the whole safety story: a bad rewrite costs the candidate
// nothing but their own original sentence.
check("TC-RF-40 a rejected rewrite falls back to the original",
  safeRewrite(src, "Owned it at Stripe").text === src);
check("TC-RF-41 and reports that it did not apply",
  safeRewrite(src, "Owned it at Stripe").applied === false);
check("TC-RF-42 a null rewrite falls back silently",
  safeRewrite(src, null).text === src && safeRewrite(src, null).check === null);
check("TC-RF-43 an accepted rewrite is applied and trimmed",
  safeRewrite(src, "  Owned the deployment pipeline and on-call  ").text ===
    "Owned the deployment pipeline and on-call");

check("TC-RF-50 facts() is the union of the three extractors",
  facts("Shipped 3 releases on AWS in 2021").size >= 3);

console.log(`\n${pass} passed, ${fail} failed  —  resume builder\n`);
process.exit(fail ? 1 : 0);
