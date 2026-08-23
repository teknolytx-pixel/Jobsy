#!/usr/bin/env tsx
/**
 * RECRUITER SOURCING — every criterion, not just skills.
 *
 * ── The bug ──
 *
 * `recruiterDeck` chose its 400-row pool by SKILL COVERAGE alone, and applied
 * geography, sponsorship and work model afterwards, to whatever came back.
 *
 * Those are eligibility rules, not preferences. A candidate who needs
 * sponsorship for a role that does not offer it is not a weaker match — they
 * cannot take the job. But because the pool was chosen before anything checked,
 * a market full of skilled candidates who happen to be ineligible would fill
 * every slot, get discarded a moment later, and the one person who could
 * actually be hired was never fetched to be considered.
 *
 * This is the same failure the candidate deck had in v2.14 and the same one the
 * skill expansion fixed in v2.16, arriving from the third direction. Retrieval
 * has to know what scoring knows, and it has to know what ELIGIBILITY knows too.
 *
 * ── Why the fixtures are 450 ──
 *
 * The pool is 400. A fixture smaller than that never fills it, the trap never
 * springs, and the test passes against the unfixed code — the mistake corrected
 * in v2.15. 450 is chosen to exceed the pool, not for looks.
 */
import "dotenv/config";

const { db, jobs, companies, users, recruiterSwipes } = await import("../src/db");
const { recruiterDeck } = await import("../src/lib/deck");
const { inArray, like } = await import("drizzle-orm");

let pass = 0,
  fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const TAG = "reccrit-";
const now = Date.now();

async function cleanup() {
  const cos = await db.select({ id: companies.id }).from(companies).where(like(companies.slug, `${TAG}%`));
  if (cos.length) {
    const ids = cos.map((c) => c.id);
    const js = await db.select({ id: jobs.id }).from(jobs).where(inArray(jobs.companyId, ids));
    if (js.length) {
      await db.delete(recruiterSwipes).where(inArray(recruiterSwipes.jobId, js.map((j) => j.id)));
      await db.delete(jobs).where(inArray(jobs.companyId, ids));
    }
    await db.delete(companies).where(inArray(companies.id, ids));
  }
  await db.delete(users).where(like(users.email, `${TAG}%`));
}
await cleanup();

const [co] = await db
  .insert(companies)
  .values({ name: "Criteria Test Co", slug: `${TAG}co`, source: "JOBSY" })
  .returning();

const [rec] = await db
  .insert(users)
  .values({
    email: `${TAG}recruiter@example.com`,
    name: "Criteria Recruiter",
    role: "RECRUITER",
    emailVerified: true,
    profileReady: true,
    currentCountry: "US",
    skills: [],
  })
  .returning();

const jobRow = (o: {
  title: string;
  skills: string[];
  remote?: "ONSITE" | "HYBRID" | "REMOTE" | "ANY";
  sponsorship?: boolean | null;
  city?: string;
  state?: string;
}) => ({
  companyId: co.id,
  postedById: rec.id,
  title: o.title,
  description: `${o.title}. Requirements: ${o.skills.join(", ")}.`,
  location: `${o.city ?? "Austin"}, ${o.state ?? "TX"}`,
  countryCode: "US",
  stateProvince: o.state ?? "TX",
  city: o.city ?? "Austin",
  remote: o.remote ?? "ONSITE",
  employmentType: "Full-time",
  seniority: "Senior",
  salaryMin: 140,
  salaryMax: 190,
  skills: o.skills,
  requiredSkills: o.skills,
  sponsorshipAvailable: o.sponsorship ?? null,
  source: "JOBSY" as const,
  active: true,
  status: "PUBLISHED" as const,
  postedAt: new Date(now - 86_400_000),
});

const candidate = (o: {
  email: string;
  name: string;
  skills: string[];
  city?: string;
  state?: string;
  remotePref?: "ONSITE" | "HYBRID" | "REMOTE" | "ANY";
  requiresSponsorship?: boolean | null;
  ageDays?: number;
}) => ({
  email: o.email,
  name: o.name,
  role: "CANDIDATE" as const,
  emailVerified: true,
  profileReady: true,
  openToOffers: true,
  headline: "Senior Data Engineer",
  location: `${o.city ?? "Austin"}, ${o.state ?? "TX"}`,
  currentCountry: "US",
  currentStateProvince: o.state ?? "TX",
  currentCity: o.city ?? "Austin",
  skills: o.skills,
  yearsExp: 8,
  salaryTarget: 160,
  remotePref: o.remotePref ?? "ONSITE",
  requiresSponsorship: o.requiresSponsorship ?? null,
  updatedAt: new Date(now - (o.ageDays ?? 0) * 86_400_000),
});

const DATA = ["Databricks", "Spark", "Python", "SQL"];

// ═══════════════════════════════════════════════════════════════
console.log("\nVISA SPONSORSHIP\n");

const [noSponsorJob] = await db
  .insert(jobs)
  .values(jobRow({ title: "Data Engineer (no sponsorship)", skills: DATA, sponsorship: false }))
  .returning();

/**
 * 450 candidates with EXACTLY the right skills who cannot take this job.
 *
 * They are not weak matches. They are ineligible — the role states it does not
 * sponsor and they state they need it. Under the old query they were fetched
 * first (perfect coverage, recently active), filled the pool, and were then
 * thrown away.
 */
await db.insert(users).values(
  Array.from({ length: 450 }, (_, i) =>
    candidate({
      email: `${TAG}needs${i}@example.com`,
      name: `Needs Sponsorship ${i}`,
      skills: DATA,
      requiresSponsorship: true,
    })
  )
);

/** The one person who can actually be hired, and has not edited their profile in a while. */
await db.insert(users).values(
  candidate({
    email: `${TAG}authorized@example.com`,
    name: "Work Authorized",
    skills: DATA,
    requiresSponsorship: false,
    ageDays: 40,
  })
);

const sponsorDeck = await recruiterDeck(rec, noSponsorJob.id);
const sponsorNames = sponsorDeck.map((c) => c.name);

check("TC-RCRIT-01 the noise fixture exceeds the pool", 450 > 400);
check("TC-RCRIT-02 sourcing returns somebody", sponsorDeck.length > 0, `${sponsorDeck.length}`);
check("TC-RCRIT-10 the candidate who can take the job is found",
  sponsorNames.includes("Work Authorized"), sponsorNames.slice(0, 4).join(" | "));
check("TC-RCRIT-11 and nobody who needs sponsorship is shown",
  !sponsorNames.some((n) => n.startsWith("Needs Sponsorship")),
  sponsorNames.slice(0, 4).join(" | "));

// ═══════════════════════════════════════════════════════════════
console.log("\nLOCATION AND WORK MODEL\n");

await db.delete(users).where(like(users.email, `${TAG}needs%`));
await db.delete(users).where(like(users.email, `${TAG}authorized%`));

const [onsiteJob] = await db
  .insert(jobs)
  .values(
    jobRow({
      title: "Platform Engineer (Austin onsite)",
      skills: ["Kubernetes", "Terraform", "AWS", "Go"],
      remote: "ONSITE",
    })
  )
  .returning();

const PLATFORM = ["Kubernetes", "Terraform", "AWS", "Go"];

/**
 * 450 remote-only candidates in another metro, with exactly the right skills.
 *
 * The role is onsite in Austin, so the engine's hard filter excludes every one
 * of them. Same country, so the only narrowing the old query did let them all
 * through — and being recently active, they took the whole pool.
 */
await db.insert(users).values(
  Array.from({ length: 450 }, (_, i) =>
    candidate({
      email: `${TAG}remote${i}@example.com`,
      name: `Remote Elsewhere ${i}`,
      skills: PLATFORM,
      city: "Portland",
      state: "OR",
      remotePref: "REMOTE",
    })
  )
);

await db.insert(users).values(
  candidate({
    email: `${TAG}local@example.com`,
    name: "Local Onsite",
    skills: PLATFORM,
    city: "Austin",
    state: "TX",
    remotePref: "ONSITE",
    ageDays: 45,
  })
);

const localDeck = await recruiterDeck(rec, onsiteJob.id);
const localNames = localDeck.map((c) => c.name);

check("TC-RCRIT-20 the local candidate is found for an onsite role",
  localNames.includes("Local Onsite"), localNames.slice(0, 4).join(" | "));
check("TC-RCRIT-21 and ranks ahead of anyone unreachable",
  localNames.indexOf("Local Onsite") === 0 ||
    !localNames.slice(0, localNames.indexOf("Local Onsite")).some((n) => n.startsWith("Remote Elsewhere")),
  localNames.slice(0, 4).join(" | "));

// ═══════════════════════════════════════════════════════════════
console.log("\nPROXIMITY RANKING\n");

await db.delete(users).where(like(users.email, `${TAG}remote%`));
await db.delete(users).where(like(users.email, `${TAG}local%`));

const [hybridJob] = await db
  .insert(jobs)
  .values(jobRow({ title: "Analytics Engineer (Austin hybrid)", skills: DATA, remote: "HYBRID" }))
  .returning();

/** Same skills, same country, different city — reachable but not local. */
await db.insert(users).values(
  Array.from({ length: 450 }, (_, i) =>
    candidate({
      email: `${TAG}far${i}@example.com`,
      name: `Far City ${i}`,
      skills: DATA,
      city: "Chicago",
      state: "IL",
      remotePref: "ANY",
    })
  )
);
await db.insert(users).values(
  candidate({
    email: `${TAG}near@example.com`,
    name: "Same City",
    skills: DATA,
    city: "Austin",
    state: "TX",
    remotePref: "ANY",
    ageDays: 60,
  })
);

const proxDeck = await recruiterDeck(rec, hybridJob.id);
const proxNames = proxDeck.map((c) => c.name);

/**
 * Both groups are ELIGIBLE here — this is a ranking question, not a filter one.
 * Equal skills, so the only thing separating them is that one can be in the
 * office on a hybrid role and the others cannot.
 */
check("TC-RCRIT-30 a same-city candidate is reachable on a hybrid role",
  proxNames.includes("Same City"), proxNames.slice(0, 4).join(" | "));
check("TC-RCRIT-31 and outranks equally-skilled candidates in another metro",
  proxNames[0] === "Same City", proxNames.slice(0, 3).join(" | "));

await cleanup();
console.log(`\n${pass} passed, ${fail} failed  —  recruiter criteria\n`);
process.exit(fail ? 1 : 0);
