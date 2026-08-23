#!/usr/bin/env tsx
/**
 * WHERE THE JOBS COME FROM — and what each idle source is waiting for.
 *
 *   npm run sources-status
 *
 * Ten providers are wired into this codebase. Which of them actually run is
 * decided entirely by whether a credential is present, and that is invisible
 * from the site: a deployment pulling from two remote-only boards looks exactly
 * like one pulling from ten, just with fewer jobs and no explanation.
 *
 * So this prints the real state — read from the SAME `isConfigured()` the
 * ingestion run uses, not from a list maintained alongside it — plus, for each
 * source that is off, the exact variable name and where to get the value.
 *
 * Run it against the deployment you care about. Locally it reads .env; on the
 * server, `vercel env pull` first or run it in a deployment shell, because the
 * answer is about THAT environment's variables and nothing else.
 */
import "dotenv/config";

const { ALL_PROVIDERS, activeProviders } = await import("../src/lib/providers");
const { env } = await import("../src/lib/env");

/**
 * What unlocks each source, in the words a person needs to act on.
 *
 * Deliberately separate from the provider objects: this is operator guidance
 * that changes when a vendor changes their signup flow, and it has no business
 * inside the code that parses their responses.
 */
const UNLOCK: Record<string, { vars: string[]; where: string; cost: string; covers?: string }> = {
  JSEARCH: {
    vars: ["RAPIDAPI_KEY"],
    where: "rapidapi.com → search 'JSearch' (publisher: letscrape) → Subscribe to Test → Basic",
    cost: "Free tier ~200 requests/month. JSEARCH_MONTHLY_BUDGET must match your plan.",
    covers: "Indeed, LinkedIn, Glassdoor, ZipRecruiter, Monster, company career sites",
  },
  JOOBLE: {
    vars: ["JOOBLE_API_KEY"],
    where: "jooble.org/api/about → request a free key (email form, usually same day)",
    cost: "Free",
    covers: "Indeed, Monster, CareerBuilder aggregate",
  },
  CAREERJET: {
    vars: ["CAREERJET_AFFID"],
    where: "partners.careerjet.com → sign up → affiliate ID is issued immediately",
    cost: "Free",
    covers: "multi-board aggregate, strong outside the US",
  },
  ADZUNA: {
    vars: ["ADZUNA_APP_ID", "ADZUNA_APP_KEY"],
    where: "developer.adzuna.com → register → both values on your dashboard",
    cost: "Free tier, generous limits",
    covers: "aggregated boards across 20 countries",
  },
  GREENHOUSE: {
    vars: ["GREENHOUSE_BOARDS"],
    where: "No key. Comma-separated company board tokens, e.g. GREENHOUSE_BOARDS=stripe,figma",
    cost: "Free, public endpoints",
    covers: "those companies' own postings, first-hand and complete",
  },
  LEVER: {
    vars: ["LEVER_BOARDS"],
    where: "No key. Comma-separated company slugs, e.g. LEVER_BOARDS=netflix,plaid",
    cost: "Free, public endpoints",
    covers: "those companies' own postings",
  },
  ASHBY: {
    vars: ["ASHBY_BOARDS"],
    where: "No key. Comma-separated company slugs, e.g. ASHBY_BOARDS=linear,ramp",
    cost: "Free, public endpoints",
    covers: "those companies' own postings",
  },
  REMOTIVE: { vars: [], where: "Keyless — on unless ENABLE_KEYLESS_BOARDS=false", cost: "Free" },
  ARBEITNOW: { vars: [], where: "Keyless — on unless ENABLE_KEYLESS_BOARDS=false", cost: "Free" },
  LINKEDIN: {
    vars: [],
    where:
      "NOT AVAILABLE. Job ingestion needs LinkedIn Talent Solutions, which is partner-gated and " +
      "closed to new applicants. Scraping LinkedIn breaks their terms and is not an option here. " +
      "LinkedIn postings reach Jobsy through JSearch instead.",
    cost: "—",
  },
};

const missing = (vars: string[]) => vars.filter((v) => !process.env[v]?.trim());

const on = new Set(activeProviders().map((p) => p.source));

console.log("\nJOB SOURCES\n");

const running: string[] = [];
const idle: string[] = [];

for (const p of ALL_PROVIDERS) {
  const u = UNLOCK[p.source];
  const live = on.has(p.source);
  (live ? running : idle).push(p.source);

  console.log(`  ${live ? "ON " : "off"}  ${p.label}`);
  if (u?.covers) console.log(`       covers: ${u.covers}`);

  if (!live) {
    const need = u ? missing(u.vars) : [];
    if (p.source === "LINKEDIN") {
      console.log(`       ${u.where}`);
    } else if (need.length) {
      console.log(`       set: ${need.join(" + ")}`);
      console.log(`       get it: ${u?.where ?? "—"}`);
      if (u?.cost) console.log(`       cost: ${u.cost}`);
    } else {
      // Credential present but the provider still reports itself unconfigured.
      // Worth saying loudly: it means the value is set to something empty or
      // otherwise unusable, which no amount of re-adding the variable will fix.
      console.log(`       ⚠ variables are set but the provider reports itself off — check for an empty value`);
    }
  }
  console.log("");
}

console.log(`  ${running.length} of ${ALL_PROVIDERS.length} sources running: ${running.join(", ") || "none"}`);
if (idle.length) console.log(`  idle: ${idle.join(", ")}`);

/**
 * The single highest-value thing to fix, named explicitly.
 *
 * Every other source is additive. JSearch is the one that carries Indeed,
 * ZipRecruiter, Glassdoor and Monster in one credential, so listing it among
 * nine equals would understate it.
 */
if (!on.has("JSEARCH")) {
  console.log(
    `\n  → Indeed / ZipRecruiter / Glassdoor / Monster all arrive through JSearch.\n` +
      `    One variable, RAPIDAPI_KEY, switches all four on.`
  );
}

if (!env.cronSecret) {
  console.log(
    `\n  ⚠ CRON_SECRET is not set. In production the nightly ingestion endpoint\n` +
      `    refuses to run without it, so no source will pull on a schedule\n` +
      `    however many keys are configured.`
  );
}

console.log("");
process.exit(0);
