#!/usr/bin/env tsx
/**
 * REGISTRATION — what we ask for, and what we refuse to do with it.
 *
 * Two things are worth testing here and they are not the happy path.
 *
 * The first is that a recruiter's account never carries the fields the MATCHER
 * reads. `skills` and `requiresSponsorship` describe a job seeker; on a
 * recruiter they are meaningless, and meaningless data in a scored field is how
 * a person ends up in a deck they were never supposed to be in.
 *
 * The second is the sponsorship question itself. It asks "will you need
 * sponsorship" — a fact about the job — and must never become a proxy for
 * citizenship, national origin or immigration status, which are protected and
 * which IRCA forbids screening on. The column stores one boolean and nothing
 * else; this suite asserts the shape stays that way.
 *
 *   npx tsx scripts/test-registration.mts
 */
import "dotenv/config";
const { assertNotProduction } = await import("./_not-production.mts");
assertNotProduction("test-registration");

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const { eq, like } = await import("drizzle-orm");
const { db, users, companies, companyMembers, rateLimits } = await import("../src/db");

/**
 * Over HTTP, against a running server, rather than by importing the handler.
 *
 * Calling a Next route handler directly throws the moment it touches cookies —
 * `setSessionCookie` needs a request scope that only the server provides. A
 * test that stubbed that away would be testing a different function from the
 * one users reach, and signup's whole job is to hand back a session.
 *
 * Start the app first:  npm run build && npm start
 */
const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";
const post = (body: Record<string, unknown>) =>
  fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

try {
  const ping = await fetch(`${BASE}/api/auth/signup`, { method: "POST", body: "{}" });
  if (!ping) throw new Error("no response");
} catch {
  console.log(`\n  ⚠ No server at ${BASE} — start one with \`npm run build && npm start\`.\n`);
  process.exit(0);
}

const stamp = Date.now();

/**
 * Signups are rate-limited to five per hour per IP — a real protection, and one
 * this suite would otherwise trip halfway through and report as a validation
 * failure. Clearing the counter between phases keeps the suite testing
 * REGISTRATION; TC-REG-40 covers the limiter itself, deliberately, at the end.
 */
const clearLimits = () => db.delete(rateLimits);

await clearLimits();

// ─────────────────────────────────────────────────────────────
console.log("\nCANDIDATE\n");

const candEmail = `cand-${stamp}@example.com`;
const r1 = await post({
  email: candEmail, password: "a-good-password", firstName: "Ada", lastName: "Lovelace",
  phone: "+1 555 0100", role: "CANDIDATE", acceptedTerms: true,
  skills: ["Python", " PySpark ", ""], requiresSponsorship: true,
});
const d1 = await r1.json();
check("TC-REG-01 a candidate can register in one request", r1.status === 201, `${r1.status} ${d1.error ?? ""}`);

const [cand] = await db.select().from(users).where(eq(users.email, candEmail));
check("TC-REG-02 the name is stored in parts and as a display string",
  cand.firstName === "Ada" && cand.lastName === "Lovelace" && cand.name === "Ada Lovelace",
  `${cand.firstName}/${cand.lastName}/${cand.name}`);
check("TC-REG-03 phone is kept", cand.phone === "+1 555 0100", cand.phone ?? "none");
check("TC-REG-04 skills are trimmed and emptied entries dropped",
  cand.skills.join(",") === "Python,PySpark", cand.skills.join(","));
check("TC-REG-05 the sponsorship answer is stored as a plain boolean",
  cand.requiresSponsorship === true, String(cand.requiresSponsorship));
check("TC-REG-06 and nothing else about status is recorded",
  !Object.keys(cand).some((k) => /citizen|nationality|visa|immigration|country_of_origin/i.test(k)),
  Object.keys(cand).filter((k) => /citizen|visa/i.test(k)).join(",") || "clean");
check("TC-REG-07 a candidate is sent to onboarding", d1.next === "/onboarding", d1.next);

/** Not answering is allowed, and means "not stated" rather than "no". */
const shy = `shy-${stamp}@example.com`;
await post({ email: shy, password: "a-good-password", firstName: "Sam", lastName: "Shy",
  role: "CANDIDATE", acceptedTerms: true });
const [shyUser] = await db.select().from(users).where(eq(users.email, shy));
check("TC-REG-08 declining to answer is not a No",
  shyUser.requiresSponsorship === null, String(shyUser.requiresSponsorship));

await clearLimits();

// ─────────────────────────────────────────────────────────────
console.log("\nRECRUITER\n");

const recEmail = `rec-${stamp}@example.com`;
const r2 = await post({
  email: recEmail, password: "a-good-password", firstName: "Ravi", lastName: "Rao",
  phone: "+1 555 0200", role: "RECRUITER", acceptedTerms: true,
  companyName: `Test Widgets ${stamp}`, companyAdmin: true,
  // Sent deliberately: a hostile or careless client can post these.
  skills: ["Python"], requiresSponsorship: true,
});
const d2 = await r2.json();
check("TC-REG-10 a recruiter can register", r2.status === 201, `${r2.status} ${d2.error ?? ""}`);

const [rec] = await db.select().from(users).where(eq(users.email, recEmail));
check("TC-REG-11 a recruiter carries NO skills, even when sent",
  rec.skills.length === 0, rec.skills.join(","));
check("TC-REG-12 nor a sponsorship answer, even when sent",
  rec.requiresSponsorship === null, String(rec.requiresSponsorship));
check("TC-REG-13 the company is created and attached", Boolean(rec.companyId), rec.companyId ?? "none");
check("TC-REG-14 and they can post immediately", d2.next === "/jobs", d2.next);

const seats = await db.select().from(companyMembers).where(eq(companyMembers.userId, rec.id));
check("TC-REG-15 whoever registers a company administers it",
  seats[0]?.seatRole === "COMPANY_ADMIN", seats[0]?.seatRole ?? "none");

/** An independent recruiter needs no company, and must not be given a fake one. */
const soloEmail = `solo-${stamp}@example.com`;
const r3 = await post({
  email: soloEmail, password: "a-good-password", firstName: "Sol", lastName: "Solo",
  role: "RECRUITER", acceptedTerms: true,
});
const d3 = await r3.json();
const [solo] = await db.select().from(users).where(eq(users.email, soloEmail));
check("TC-REG-20 an independent recruiter registers without a company",
  r3.status === 201 && solo.companyId === null, `${r3.status}, company ${solo.companyId}`);
check("TC-REG-21 and can still post", d3.next === "/jobs", d3.next);

await clearLimits();

// ─────────────────────────────────────────────────────────────
console.log("\nVALIDATION\n");

const noName = await post({ email: `x-${stamp}@example.com`, password: "a-good-password",
  lastName: "Only", role: "CANDIDATE", acceptedTerms: true });
check("TC-REG-30 a first name is required", noName.status === 400, `${noName.status}`);

const noTerms = await post({ email: `y-${stamp}@example.com`, password: "a-good-password",
  firstName: "No", lastName: "Terms", role: "CANDIDATE" });
check("TC-REG-31 the clickwrap cannot be skipped by calling the API",
  noTerms.status === 400, `${noTerms.status}`);

/** The limiter itself, since the suite depends on knowing it works. */
await clearLimits();
let limited = 0;
for (let i = 0; i < 7; i++) {
  const r = await post({ email: `flood-${stamp}-${i}@example.com`, password: "a-good-password",
    firstName: "F", lastName: "L", role: "CANDIDATE", acceptedTerms: true });
  if (r.status === 429) limited++;
}
check("TC-REG-40 signups are rate-limited per network", limited >= 1, `${limited} of 7 refused`);

// ── cleanup ──
await clearLimits();
const floods = Array.from({ length: 7 }, (_, i) => `flood-${stamp}-${i}@example.com`);
for (const email of [candEmail, shy, recEmail, soloEmail, ...floods]) {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (u) {
    await db.delete(companyMembers).where(eq(companyMembers.userId, u.id));
    await db.delete(users).where(eq(users.id, u.id));
  }
}
await db.delete(companies).where(like(companies.slug, `test-widgets-${stamp}%`));

console.log(`\n${pass} passed, ${fail} failed  —  registration\n`);
process.exit(fail ? 1 : 0);
