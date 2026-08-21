/**
 * Seeds enough real-shaped data to exercise both swipe directions immediately.
 *   npm run seed
 *
 * Live jobs come from `npm run ingest` — this seeds the people and the three
 * natively-posted jobs, plus pre-seeded swipes so a match fires on the very
 * first right-swipe in each mode.
 */
import "dotenv/config";
import { and, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import {
  candidateSwipes,
  companies,
  db,
  jobs,
  notificationPrefs,
  recruiterSwipes,
  users,
  type RemotePref,
} from "../src/db";
import { resolveLocation } from "../src/lib/geo/resolve";
import { UNKNOWN_COUNTRY } from "../src/lib/geo/countries";

/**
 * v1.1 — the seed has to place people and postings on the map.
 *
 * Geographic eligibility is a hard gate that fails closed (GEO-006), so a user
 * or job with no country is invisible rather than merely unranked. The seed
 * predated that rule and kept writing free text only, which meant a freshly
 * seeded environment came up with an empty recruiter deck and looked broken —
 * every demo candidate silently ineligible. Deriving the structured columns
 * from the same free-text string keeps one source of truth in the fixtures.
 */
function geoFor(location: string | null | undefined) {
  const r = resolveLocation(location);
  if (r.country === UNKNOWN_COUNTRY) return null;
  return { country: r.country, stateProvince: r.stateProvince, city: r.city };
}

/**
 * ADMIN-007 — the production guard.
 *
 * Demo accounts with a published password on a live public URL are an open
 * door. This script refused to notice that, so it now refuses to run against
 * anything that looks like production unless someone explicitly says otherwise.
 *
 * The password itself is generated per-run rather than hardcoded, so even a
 * local seed does not create a credential that is the same on every machine.
 */
function assertNotProduction() {
  const url = process.env.DATABASE_URL ?? "";
  const looksProd =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production" ||
    /neon\.tech|amazonaws|render\.com|supabase|\.rds\./i.test(url);

  if (looksProd && process.env.ALLOW_PROD_SEED !== "yes-i-am-sure") {
    console.error(
      "\n  REFUSING TO SEED\n\n" +
        "  This DATABASE_URL looks like a hosted/production database, and seeding\n" +
        "  would create demo accounts with a known password on a live deployment.\n\n" +
        "  If you genuinely mean to do this, set:\n" +
        "      ALLOW_PROD_SEED=yes-i-am-sure\n\n" +
        "  Then delete every @demo.jobsy account before anyone else can reach it.\n"
    );
    process.exit(1);
  }
}
assertNotProduction();

/**
 * AC-3 — a generated password, printed once. Not a constant anyone can look up
 * in the repository and try against a live deployment.
 */
const PW = process.env.SEED_PASSWORD ?? `demo-${randomBytes(9).toString("base64url")}`;

type C = {
  email: string; name: string; headline: string; location: string; remotePref: RemotePref;
  yearsExp: number; salaryTarget: number; availability: string; skills: string[]; bio: string;
};

const CANDIDATES: C[] = [
  { email: "amara@demo.jobsy", name: "Amara Osei", headline: "Senior Frontend Engineer", location: "Austin, TX", remotePref: "HYBRID", yearsExp: 7, salaryTarget: 165, availability: "2 weeks", skills: ["React", "TypeScript", "GraphQL", "Design Systems", "Testing"], bio: "Led design-system consolidation at a 300-person fintech — 40% less CSS, 2x faster feature delivery. Happiest in the messy middle between design and engineering." },
  { email: "diego@demo.jobsy", name: "Diego Marchetti", headline: "Data Viz / Frontend Engineer", location: "Lisbon, PT", remotePref: "REMOTE", yearsExp: 6, salaryTarget: 150, availability: "Immediately", skills: ["D3.js", "React", "TypeScript", "SQL", "Data Modeling", "Data Visualization"], bio: "Built charting internals for two BI startups. I care an unreasonable amount about axis tick placement." },
  { email: "rachel@demo.jobsy", name: "Rachel Nguyen", headline: "Full Stack Engineer (AI)", location: "Brooklyn, NY", remotePref: "ANY", yearsExp: 4, salaryTarget: 155, availability: "1 month", skills: ["Node.js", "React", "Python", "LLM APIs", "SQL"], bio: "Shipped three LLM features from prototype to GA last year. Comfortable owning eval harnesses and prompt regressions, not just the glue code." },
  { email: "samuel@demo.jobsy", name: "Samuel Boateng", headline: "Platform / SRE Engineer", location: "Chicago, IL", remotePref: "HYBRID", yearsExp: 9, salaryTarget: 172, availability: "6 weeks", skills: ["Kubernetes", "Go", "AWS", "Terraform", "Observability"], bio: "Ran the platform team for 120 microservices. Strong opinions about paging humans at 3am, most of them 'do not'." },
  { email: "lena@demo.jobsy", name: "Lena Fischer", headline: "Product Designer", location: "Austin, TX", remotePref: "HYBRID", yearsExp: 5, salaryTarget: 135, availability: "3 weeks", skills: ["Figma", "Design Systems", "Prototyping", "User Research", "Accessibility"], bio: "Research-led designer. I will show you the interview clip that killed your favorite feature idea, kindly." },
  { email: "omar@demo.jobsy", name: "Omar Haddad", headline: "ML Engineer, Healthcare", location: "Boston, MA", remotePref: "REMOTE", yearsExp: 8, salaryTarget: 195, availability: "2 months", skills: ["Python", "PyTorch", "MLOps", "AWS", "Machine Learning"], bio: "Clinical NLP in production under HIPAA. Published, but far prouder of the boring monitoring dashboard that caught model drift." },
  { email: "priyanka@demo.jobsy", name: "Priyanka Shah", headline: "Backend Engineer, Payments", location: "Denver, CO", remotePref: "REMOTE", yearsExp: 5, salaryTarget: 158, availability: "1 month", skills: ["Go", "SQL", "Kafka", "AWS", "Distributed Systems"], bio: "Double-entry ledgers and idempotency keys are my love language. Previously on a team moving $2B/yr." },
  { email: "tobias@demo.jobsy", name: "Tobias Lund", headline: "Analytics Engineer", location: "Oslo, NO", remotePref: "REMOTE", yearsExp: 4, salaryTarget: 120, availability: "Immediately", skills: ["SQL", "dbt", "Snowflake", "Python", "Data Modeling"], bio: "I turn 200-line spreadsheets that run a business into models the business can actually trust." },
  { email: "grace@demo.jobsy", name: "Grace Okonkwo", headline: "Engineering Manager, Web", location: "Jersey City, NJ", remotePref: "HYBRID", yearsExp: 11, salaryTarget: 215, availability: "6 weeks", skills: ["React", "Leadership", "Recruiting", "Architecture", "TypeScript"], bio: "Grew two teams from 5 to 14 without losing the people who were there first. Still review PRs on Fridays." },
  { email: "kai@demo.jobsy", name: "Kai Sorensen", headline: "Mobile Engineer", location: "Seattle, WA", remotePref: "HYBRID", yearsExp: 5, salaryTarget: 145, availability: "3 weeks", skills: ["React Native", "TypeScript", "iOS", "Android", "Testing"], bio: "Shipped a 900k-MAU fitness app through three OS migrations. Animation nerd, crash-rate obsessive." },
  { email: "marisol@demo.jobsy", name: "Marisol Vega", headline: "Solutions Architect", location: "Dallas, TX", remotePref: "ANY", yearsExp: 10, salaryTarget: 180, availability: "1 month", skills: ["AWS", "Architecture", "Presales", "Kubernetes", "SQL"], bio: "The person sales brings when the customer says 'but will it work with our 1998 mainframe'. It usually can." },
  { email: "ben@demo.jobsy", name: "Ben Whitaker", headline: "Junior Software Engineer", location: "Boston, MA", remotePref: "ONSITE", yearsExp: 1, salaryTarget: 105, availability: "Immediately", skills: ["JavaScript", "React", "Python", "SQL"], bio: "Career switcher from clinical lab work. Six months into my first engineering role and reading everything." },
];

async function upsertUser(v: Parameters<typeof users.$inferInsert extends never ? never : never> | typeof users.$inferInsert) {
  // AUTH-006 — seeded accounts arrive verified. They exist to be logged into,
  // and the verification email would go to a @demo.jobsy address nobody reads.
  const g = geoFor((v as { location?: string | null }).location);
  const withDefaults = {
    ...v,
    emailVerified: true,
    ...(g
      ? {
          currentCountry: g.country,
          currentStateProvince: g.stateProvince,
          currentCity: g.city,
          searchCountry: g.country,
        }
      : {}),
  };
  const [row] = await db
    .insert(users)
    .values(withDefaults)
    .onConflictDoUpdate({
      target: users.email,
      set: { ...withDefaults, updatedAt: new Date() },
    })
    .returning();

  // NOTIF-001 — every user needs preferences and an unsubscribe token, or the
  // unsubscribe link in their first email has nothing to look up.
  await db
    .insert(notificationPrefs)
    .values({ userId: row.id, unsubscribeTokenHash: createHash("sha256").update(randomBytes(32)).digest("hex") })
    .onConflictDoNothing();

  return row;
}

async function main() {
  const hash = await bcrypt.hash(PW, 10);

  const [northwind] = await db
    .insert(companies)
    .values({ name: "Northwind Analytics", slug: "northwind-analytics", source: "JOBSY" })
    .onConflictDoUpdate({ target: companies.slug, set: { name: "Northwind Analytics" } })
    .returning();

  const recruiter = await upsertUser({
    email: "recruiter@demo.jobsy", name: "Priya Raman", passwordHash: hash, role: "RECRUITER",
    title: "Talent Partner", companyId: northwind.id, profileReady: true, openToOffers: false,
    headline: "Talent Partner at Northwind Analytics", location: "Austin, TX", skills: [],
  });

  const me = await upsertUser({
    email: "candidate@demo.jobsy", name: "Sai Konda", passwordHash: hash, role: "CANDIDATE",
    headline: "Senior Frontend / Data Viz Engineer", location: "Austin, TX", remotePref: "ANY",
    yearsExp: 8, salaryTarget: 160, availability: "4 weeks", profileReady: true, openToOffers: true,
    skills: ["React", "TypeScript", "D3.js", "SQL", "Design Systems", "Data Modeling"],
    bio: "Frontend engineer who works close to data — dashboards, charting internals, and the design systems that keep them consistent.",
  });

  const others = [];
  for (const c of CANDIDATES) {
    others.push(
      await upsertUser({ ...c, passwordHash: hash, role: "CANDIDATE", profileReady: true, openToOffers: true })
    );
  }

  const jobSpecs = [
    {
      title: "Senior Frontend Engineer", location: "Austin, TX", remote: "HYBRID" as RemotePref,
      seniority: "Senior", salaryMin: 150, salaryMax: 185, applyMethod: "EASY" as const, applyUrl: null,
      skills: ["React", "TypeScript", "GraphQL", "Design Systems", "Testing"],
      perks: ["Equity 0.15%", "$3k learning budget", "4-day onsite optional"],
      description:
        "Own the analytics workspace used by 40k daily users. You will lead the design-system rewrite and mentor two mid-level engineers. We ship weekly, we write things down, and we do not do performance theatre.",
    },
    {
      title: "Product Designer", location: "Austin, TX", remote: "HYBRID" as RemotePref,
      seniority: "Mid", salaryMin: 120, salaryMax: 150, applyMethod: "EASY" as const, applyUrl: null,
      skills: ["Figma", "Design Systems", "Prototyping", "User Research"],
      perks: ["Equity", "Design conference budget"],
      description:
        "Partner with two squads on the dashboard rebuild. You own research through shipped pixels — nobody hands you a spec here.",
    },
    {
      title: "Data Visualization Engineer", location: "San Francisco, CA", remote: "REMOTE" as RemotePref,
      seniority: "Senior", salaryMin: 160, salaryMax: 200, applyMethod: "EXTERNAL" as const,
      applyUrl: "https://www.linkedin.com/jobs/",
      skills: ["D3.js", "React", "TypeScript", "SQL", "Data Modeling"],
      perks: ["Fully remote", "Equity refresh"],
      description:
        "Build the charting engine behind our BI product — from the render layer to the query planner hints that make it fast. This one takes applications through our own LinkedIn posting.",
    },
  ];

  const jobRows = [];
  for (const base of jobSpecs) {
    const g = geoFor(base.location);
    const spec = {
      ...base,
      ...(g ? { countryCode: g.country, stateProvince: g.stateProvince, city: g.city } : {}),
    };
    const found = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.title, spec.title), eq(jobs.postedById, recruiter.id)))
      .limit(1);

    if (found[0]) {
      const [u] = await db.update(jobs).set(spec).where(eq(jobs.id, found[0].id)).returning();
      jobRows.push(u);
    } else {
      const [c] = await db
        .insert(jobs)
        .values({ ...spec, source: "JOBSY", companyId: northwind.id, postedById: recruiter.id })
        .returning();
      jobRows.push(c);
    }
  }

  // ---- pre-seed swipes so a match fires immediately in BOTH directions ----

  // (a) The recruiter already liked YOU for Product Designer + Data Viz.
  for (const j of [jobRows[1], jobRows[2]]) {
    await db
      .insert(recruiterSwipes)
      .values({ jobId: j.id, candidateId: me.id, recruiterId: recruiter.id, direction: "LIKE", score: 80 })
      .onConflictDoUpdate({
        target: [recruiterSwipes.jobId, recruiterSwipes.candidateId],
        set: { direction: "LIKE" },
      });
  }

  // (b) Amara + Diego already swiped right on Senior Frontend Engineer.
  const amara = others.find((o) => o.email === "amara@demo.jobsy")!;
  const diego = others.find((o) => o.email === "diego@demo.jobsy")!;
  for (const c of [amara, diego]) {
    await db
      .insert(candidateSwipes)
      .values({ candidateId: c.id, jobId: jobRows[0].id, direction: "LIKE", score: 88 })
      .onConflictDoUpdate({
        target: [candidateSwipes.candidateId, candidateSwipes.jobId],
        set: { direction: "LIKE" },
      });
  }

  console.log(`
✅ Seeded.

  Candidate login   candidate@demo.jobsy / ${PW}
  Recruiter login   recruiter@demo.jobsy / ${PW}

  ${jobRows.length} native job posts · ${others.length + 1} candidates

  Instant-match shortcuts:
    · As the candidate, right-swipe "Product Designer" or "Data Visualization Engineer"
    · As the recruiter on "Senior Frontend Engineer", right-swipe Amara Osei or Diego Marchetti

  Now pull real live jobs:  npm run ingest
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .then(() => process.exit(0));
