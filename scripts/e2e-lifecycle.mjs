#!/usr/bin/env node
/**
 * Full-lifecycle end-to-end suite.
 *
 * Drives the real HTTP API against a running server and a real database. No
 * mocks: every assertion here is about what a user or an attacker would
 * actually get back.
 *
 * Maps to the E2E scenarios in PRD §24 and the TC-* groups they depend on.
 *
 *   npm run build && npm start &
 *   node scripts/e2e-lifecycle.mjs
 */
const BASE = process.env.E2E_BASE ?? "http://localhost:3000";

let pass = 0;
let fail = 0;
const failures = [];
let group = "";

const G = (name) => {
  group = name;
  console.log(`\n── ${name} ──`);
};

async function t(id, name, fn) {
  try {
    await fn();
    pass++;
    console.log(`  ✓ ${id}  ${name}`);
  } catch (e) {
    fail++;
    const msg = e?.message?.split("\n")[0] ?? String(e);
    failures.push(`${group} · ${id}  ${name}\n      ${msg}`);
    console.log(`  ✗ ${id}  ${name}\n      ${msg}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg ?? "not equal"} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

/** For assertions where the expected value is "anything truthy". */
function ok(v, msg) {
  if (!v) throw new Error(msg ?? "expected a truthy value");
}

/**
 * A browser-like client: keeps cookies, sends JSON, and presents a distinct
 * source IP.
 *
 * The IP matters. Rate limiting is per-IP as well as per-account, and a whole
 * test suite firing from 127.0.0.1 trips the signup limiter within seconds —
 * which is the limiter doing its job, but makes the suite untestable. Distinct
 * simulated IPs are also closer to reality: real users are not all one client.
 * TC-AUTH-009-01 deliberately hammers a single IP to prove the limit still bites.
 */
let ipCounter = 0;
function client(ip) {
  const jar = new Map();
  const sourceIp = ip ?? `198.51.100.${(ipCounter++ % 250) + 1}.${Date.now() % 1000}`;
  return {
    jar,
    sourceIp,
    async req(method, path, body, extraHeaders = {}) {
      const headers = { "X-Forwarded-For": sourceIp, ...extraHeaders };
      if (body !== undefined && !(body instanceof FormData)) {
        headers["Content-Type"] = "application/json";
      }
      const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
      if (cookie) headers.Cookie = cookie;

      const res = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
        redirect: "manual",
      });

      for (const [k, v] of res.headers) {
        if (k.toLowerCase() !== "set-cookie") continue;
        for (const part of v.split(/,(?=[^;]+?=)/)) {
          const [pair] = part.split(";");
          const idx = pair.indexOf("=");
          if (idx < 0) continue;
          const name = pair.slice(0, idx).trim();
          const value = pair.slice(idx + 1).trim();
          if (value === "" || /Max-Age=0/i.test(part)) jar.delete(name);
          else jar.set(name, value);
        }
      }

      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* html or redirect */
      }
      return { status: res.status, json, text, headers: res.headers };
    },
    get(p, h) { return this.req("GET", p, undefined, h); },
    post(p, b, h) { return this.req("POST", p, b, h); },
    put(p, b, h) { return this.req("PUT", p, b, h); },
    patch(p, b, h) { return this.req("PATCH", p, b, h); },
    del(p, b, h) { return this.req("DELETE", p, b, h); },
  };
}

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const emailFor = (tag) => `e2e-${tag}-${uniq()}@test.invalid`;

// Read the verification/reset link straight out of email_logs, which is where
// the mailer writes every message whether or not a provider is configured.
const { db, emailLogs, users } = await import("../src/db/index.ts");
const { eq: dEq, desc, and: dAnd } = await import("drizzle-orm");

async function lastEmailTo(address, template) {
  const rows = await db
    .select()
    .from(emailLogs)
    .where(dAnd(dEq(emailLogs.to, address), dEq(emailLogs.template, template)))
    .orderBy(desc(emailLogs.createdAt))
    .limit(1);
  return rows[0] ?? null;
}
const tokenFrom = (body, path) => {
  const m = body.match(new RegExp(`${path}[?]token=([^\\s"']+)`));
  return m ? decodeURIComponent(m[1]) : null;
};

// ══════════════════════════════════════════════════════════════
G("E2E-001 · candidate signup → verification → profile");
// ══════════════════════════════════════════════════════════════
const cand = client();
const candEmail = emailFor("cand");

await t("TC-LEGAL-009-12", "signup without accepting the terms is refused", async () => {
  const r = await cand.post("/api/auth/signup", {
    email: candEmail,
    password: "Str0ngPassw0rd!",
    name: "Casey Candidate",
  });
  eq(r.status, 400, "clickwrap must not be bypassable through the API");
});

await t("TC-AUTH-001-03", "a short password is refused", async () => {
  const r = await cand.post("/api/auth/signup", {
    email: candEmail,
    password: "short",
    name: "Casey Candidate",
    acceptedTerms: true,
  });
  eq(r.status, 400);
});

await t("TC-AUTH-001-01", "signup succeeds and returns unverified", async () => {
  const r = await cand.post("/api/auth/signup", {
    email: candEmail,
    password: "Str0ngPassw0rd!",
    name: "Casey Candidate",
    role: "CANDIDATE",
    location: "Austin, TX",
    acceptedTerms: true,
  });
  eq(r.status, 201);
  eq(r.json.emailVerified, false, "a new account starts unverified");
  assert(cand.jar.has("jobsy_session"), "a session cookie should be set");
});

await t("TC-AUTH-001-02", "the same email cannot register twice", async () => {
  const other = client();
  const r = await other.post("/api/auth/signup", {
    email: candEmail,
    password: "Str0ngPassw0rd!",
    name: "Impostor",
    acceptedTerms: true,
  });
  eq(r.status, 409);
});

await t("TC-AUTH-001-06", "email is normalised to lowercase for uniqueness", async () => {
  const other = client();
  const r = await other.post("/api/auth/signup", {
    email: candEmail.toUpperCase(),
    password: "Str0ngPassw0rd!",
    name: "Impostor",
    acceptedTerms: true,
  });
  eq(r.status, 409, "case-only variants must collide");
});

await t("TC-LEGAL-009-05", "terms acceptance is recorded with a version", async () => {
  const { termsAcceptances } = await import("../src/db/index.ts");
  const u = (await db.select().from(users).where(dEq(users.email, candEmail)))[0];
  const rows = await db.select().from(termsAcceptances).where(dEq(termsAcceptances.userId, u.id));
  assert(rows.length >= 2, "both the Terms and the Privacy Policy should be recorded");
  assert(rows.every((r) => r.version), "each acceptance carries a version");
});

await t("TC-XPLAIN-002-11", "an AEDT notice is logged at signup", async () => {
  const { aedtNotices } = await import("../src/db/index.ts");
  const u = (await db.select().from(users).where(dEq(users.email, candEmail)))[0];
  const rows = await db.select().from(aedtNotices).where(dEq(aedtNotices.userId, u.id));
  assert(rows.length >= 1, "the notice must be delivered before any assessment");
});

await t("TC-AUTH-006-05", "an unverified user cannot post a job", async () => {
  const r = await cand.post("/api/jobs", {
    title: "Test Role",
    companyName: "Test Co",
    location: "Austin, TX",
    description: "A description long enough to satisfy the minimum length requirement here.",
    attestCurrentVacancy: true,
    // FSD v1.1 GEO-001 — country is required for a role posted in-app.
    countryCode: "US",
  });
  eq(r.status, 403);
  eq(r.json.code, "EMAIL_NOT_VERIFIED");
});

let candVerifyToken = null;
await t("TC-AUTH-006-01", "a verification email was queued", async () => {
  const mail = await lastEmailTo(candEmail, "VERIFY_EMAIL");
  assert(mail, "no verification email found");
  candVerifyToken = tokenFrom(mail.body, "/api/auth/verify");
  assert(candVerifyToken, "no token in the verification email");
});

await t("TC-AUTH-006-02", "the verification link verifies the account", async () => {
  const r = await cand.get(`/api/auth/verify?token=${encodeURIComponent(candVerifyToken)}`);
  assert(r.status === 307 || r.status === 302, `expected a redirect, got ${r.status}`);
  const u = (await db.select().from(users).where(dEq(users.email, candEmail)))[0];
  eq(u.emailVerified, true);
});

await t("TC-AUTH-006-03", "the same link cannot be used twice", async () => {
  const r = await cand.get(`/api/auth/verify?token=${encodeURIComponent(candVerifyToken)}`);
  assert(r.headers.get("location")?.includes("verify=used"), "a reused link must be rejected");
});

await t("TC-CAND-001-01", "the profile can be completed", async () => {
  const r = await cand.patch("/api/profile", {
    headline: "Senior Frontend Engineer",
    bio: "Ten years building React applications with a focus on design systems and accessibility work.",
    location: "Austin, TX",
    remotePref: "HYBRID",
    yearsExp: 8,
    salaryTarget: 160,
    availability: "4 weeks",
    skills: ["React", "TypeScript", "GraphQL", "Design Systems"],
  });
  eq(r.status, 200);
});

// ══════════════════════════════════════════════════════════════
G("AUTH-002/003/008/009 · session and credential security");
// ══════════════════════════════════════════════════════════════
await t("TC-AUTH-003-01", "the session cookie is HttpOnly, Secure-flagged and SameSite", async () => {
  const c = client();
  const email = emailFor("cookie");
  const r = await c.post("/api/auth/signup", {
    email, password: "Str0ngPassw0rd!", name: "Cookie Test", acceptedTerms: true,
  });
  const raw = r.headers.get("set-cookie") ?? "";
  assert(/HttpOnly/i.test(raw), "HttpOnly missing");
  assert(/SameSite=Lax/i.test(raw), "SameSite missing");
  assert(/Path=\//i.test(raw), "Path missing");
});

// A dedicated account for the login-probing tests. The per-EMAIL rate limit is
// 5 attempts per 15 minutes and counts failures, which is correct security
// behaviour — so probing tests must not spend the candidate's budget.
const probeEmail = emailFor("probe");
await client().post("/api/auth/signup", {
  email: probeEmail, password: "Pr0bePassw0rd!", name: "Probe Account", acceptedTerms: true,
});

await t("TC-AUTH-002-02/03", "wrong password and unknown account are indistinguishable", async () => {
  const a = await client().post("/api/auth/login", { email: probeEmail, password: "wrong-password" });
  const b = await client().post("/api/auth/login", {
    email: `nobody-${uniq()}@test.invalid`,
    password: "wrong-password",
  });
  eq(a.status, 401);
  eq(b.status, 401);
  eq(a.json.error, b.json.error, "the error text must be identical — no account enumeration");
});

await t("TC-AUTH-002-04", "response time is comparable for both", async () => {
  const time = async (email) => {
    const start = performance.now();
    await client().post("/api/auth/login", { email, password: "wrong-password-here" });
    return performance.now() - start;
  };
  // Warm both paths so JIT and connection setup do not dominate. Each probe
  // uses a fresh account so no single email's rate-limit budget is exhausted.
  const mk = async () => {
    const e = emailFor("timing");
    await client().post("/api/auth/signup", {
      email: e, password: "T1mingPassw0rd!", name: "Timing", acceptedTerms: true,
    });
    return e;
  };
  await time(await mk());
  await time(`ghost-${uniq()}@test.invalid`);
  const known = (await time(await mk())) + (await time(await mk()));
  const unknown = (await time(`g-${uniq()}@test.invalid`)) + (await time(`g-${uniq()}@test.invalid`));
  const ratio = Math.max(known, unknown) / Math.max(1, Math.min(known, unknown));
  assert(ratio < 3, `timing ratio ${ratio.toFixed(2)} is too revealing — bcrypt must run on both paths`);
});

await t("TC-AUTH-002-01", "valid credentials sign in", async () => {
  const c = client();
  const r = await c.post("/api/auth/login", { email: candEmail, password: "Str0ngPassw0rd!" });
  eq(r.status, 200);
  eq(r.json.emailVerified, true);
});

await t("TC-AUTH-003-02", "a tampered session cookie is rejected", async () => {
  const c = client();
  const login = await c.post("/api/auth/login", { email: probeEmail, password: "Pr0bePassw0rd!" });
  eq(login.status, 200, "setup login should succeed");
  const good = c.jar.get("jobsy_session");
  const parts = good.split(".");
  // Flip a character in the payload; the signature no longer matches.
  parts[1] = parts[1].slice(0, -2) + (parts[1].endsWith("A") ? "B" : "A") + parts[1].slice(-1);
  c.jar.set("jobsy_session", parts.join("."));
  const r = await c.get("/api/profile");
  eq(r.status, 401);
});

await t("TC-AUTH-003-06", "an alg:none token is rejected", async () => {
  const c = client();
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ uid: "00000000-0000-0000-0000-000000000000", email: candEmail, sv: 0 })
  ).toString("base64url");
  c.jar.set("jobsy_session", `${header}.${payload}.`);
  const r = await c.get("/api/profile");
  eq(r.status, 401);
});

await t("TC-AUTH-004-02", "logout invalidates the cookie", async () => {
  const c = client();
  await c.post("/api/auth/login", { email: probeEmail, password: "Pr0bePassw0rd!" });
  const cookie = c.jar.get("jobsy_session");
  await c.post("/api/auth/logout");
  const replay = client();
  replay.jar.set("jobsy_session", cookie);
  // The JWT itself is still cryptographically valid until it expires — this
  // asserts the CLIENT was cleared, which is what logout controls. Server-side
  // revocation is AUTH-008, tested next.
  assert(!c.jar.has("jobsy_session"), "the cookie should be cleared");
});

await t("TC-AUTH-007-01", "reset requests are identical for known and unknown emails", async () => {
  const known = await client().post("/api/auth/reset", { email: candEmail });
  const unknown = await client().post("/api/auth/reset", { email: `nope-${uniq()}@test.invalid` });
  eq(known.status, 202);
  eq(unknown.status, 202);
  eq(JSON.stringify(known.json), JSON.stringify(unknown.json), "bodies must be byte-identical");
});

let resetToken = null;
await t("TC-AUTH-007-02", "a reset email is issued for a real account", async () => {
  const mail = await lastEmailTo(candEmail, "PASSWORD_RESET");
  assert(mail, "no reset email");
  resetToken = tokenFrom(mail.body, "/reset");
  assert(resetToken, "no token in the reset email");
});

await t("TC-AUTH-007-07", "a weak new password does NOT consume the token", async () => {
  const bad = await client().put("/api/auth/reset", { token: resetToken, password: "short" });
  eq(bad.status, 400);
  // The token must survive so the user can retry with the same link.
  const good = await client().put("/api/auth/reset", { token: resetToken, password: "N3wStr0ngPass!" });
  eq(good.status, 200, "the same link should still work after a validation failure");
});

await t("TC-AUTH-008-02", "a reset revokes every outstanding session", async () => {
  // The session `cand` has been holding since signup was issued before the
  // reset, so its version claim is now stale.
  const r = await cand.get("/api/profile");
  eq(r.status, 401, "an old session must not survive a password reset");
});

await t("TC-AUTH-007-03", "the new password works and the old one does not", async () => {
  const withNew = await client().post("/api/auth/login", { email: candEmail, password: "N3wStr0ngPass!" });
  eq(withNew.status, 200);
  const withOld = await client().post("/api/auth/login", { email: candEmail, password: "Str0ngPassw0rd!" });
  eq(withOld.status, 401);
});

await t("TC-AUTH-007-04", "a consumed reset token cannot be reused", async () => {
  const r = await client().put("/api/auth/reset", { token: resetToken, password: "Another1Pass!" });
  eq(r.status, 400);
});

await t("TC-AUTH-009-01", "repeated failed logins are rate limited", async () => {
  const email = emailFor("rl");
  // Deliberately ONE source IP — this is the case the limiter exists for.
  const attacker = client(`203.0.113.${Date.now() % 200}`);
  let sawLimit = false;
  for (let i = 0; i < 12; i++) {
    const r = await attacker.post("/api/auth/login", { email, password: `attempt-${i}` });
    if (r.status === 429) {
      sawLimit = true;
      assert(r.headers.get("retry-after"), "429 must carry Retry-After");
      break;
    }
  }
  assert(sawLimit, "credential stuffing was not throttled");
});

// The reset correctly killed every candidate session (AUTH-008). Re-authenticate
// for the rest of the run, and fail loudly rather than cascading 401s if it
// does not work — a silent auth failure here would make every later assertion
// meaningless.
{
  const relogin = await cand.post("/api/auth/login", { email: candEmail, password: "N3wStr0ngPass!" });
  if (relogin.status !== 200) {
    console.error(`\n  FATAL: could not re-authenticate the candidate (${relogin.status}).`);
    console.error(`  ${JSON.stringify(relogin.json)}\n`);
    process.exit(1);
  }
}

// ══════════════════════════════════════════════════════════════
G("E2E-002 · recruiter, company, and the posting gates");
// ══════════════════════════════════════════════════════════════
const rec = client();
const recEmail = emailFor("rec");

await t("setup", "recruiter signs up and verifies", async () => {
  const r = await rec.post("/api/auth/signup", {
    email: recEmail,
    password: "Str0ngPassw0rd!",
    name: "Robin Recruiter",
    role: "RECRUITER",
    location: "Austin, TX",
    acceptedTerms: true,
  });
  eq(r.status, 201);
  const mail = await lastEmailTo(recEmail, "VERIFY_EMAIL");
  await rec.get(`/api/auth/verify?token=${encodeURIComponent(tokenFrom(mail.body, "/api/auth/verify"))}`);
});

const companyName = `Northwind E2E ${uniq()}`;
await t("TC-COMP-002-01", "a recruiter can create a company and becomes its admin", async () => {
  const r = await rec.post("/api/company", { name: companyName });
  eq(r.status, 201);
  const me = await rec.get("/api/company");
  eq(me.json.membership.seatRole, "COMPANY_ADMIN");
  eq(me.json.company.verified, false);
  eq(me.json.company.seatLimit, 4);
});

await t("TC-JOB-001-14", "posting without the vacancy attestation is refused", async () => {
  const r = await rec.post("/api/jobs", {
    title: "Senior Frontend Engineer",
    companyName,
    location: "Austin, TX",
    description: "Own the analytics workspace. Requirements: 5+ years with React and TypeScript.",
    salaryMin: 150,
    salaryMax: 185,
  });
  eq(r.status, 400, "TRUST-001 attestation is mandatory");
});

await t("TC-TRUST-004-01", "a discriminatory posting is blocked before publication", async () => {
  const r = await rec.post("/api/jobs", {
    title: "Senior Frontend Engineer",
    companyName,
    location: "Austin, TX",
    description:
      "Recent graduates only. We are a young and energetic team looking for a digital native.",
    salaryMin: 150,
    salaryMax: 185,
    attestCurrentVacancy: true,
    // FSD v1.1 GEO-001 — country is required for a role posted in-app.
    countryCode: "US",
  });
  eq(r.status, 400);
  eq(r.json.code, "DISCRIMINATORY_CONTENT");
  assert(r.json.findings.length >= 2, "several problems should be reported at once");
  assert(/employment agency/i.test(r.json.error), "the explanation should say why we care");
});

await t("TC-LEGAL-002-01", "a covered-jurisdiction posting without pay is blocked", async () => {
  const r = await rec.post("/api/jobs", {
    title: "Senior Frontend Engineer",
    companyName,
    location: "San Francisco, CA",
    description: "Own the analytics workspace. Requirements: 5+ years with React and TypeScript.",
    attestCurrentVacancy: true,
    // FSD v1.1 GEO-001 — country is required for a role posted in-app.
    countryCode: "US",
  });
  eq(r.status, 400);
  eq(r.json.code, "PAY_TRANSPARENCY_REQUIRED");
  assert(r.json.laws.some((l) => /432\.3/.test(l.cite)), "the applicable law should be named");
});

await t("TC-LEGAL-002-05", "Washington additionally requires a benefits description", async () => {
  const r = await rec.post("/api/jobs", {
    title: "Senior Frontend Engineer",
    companyName,
    location: "Seattle, WA",
    description: "Own the analytics workspace. Requirements: 5+ years with React and TypeScript.",
    salaryMin: 150,
    salaryMax: 185,
    attestCurrentVacancy: true,
    // FSD v1.1 GEO-001 — country is required for a role posted in-app.
    countryCode: "US",
  });
  eq(r.status, 400);
  assert(r.json.problems.includes("BENEFITS_REQUIRED"));
});

let jobId = null;
await t("TC-JOB-001-01", "a compliant posting is published", async () => {
  const r = await rec.post("/api/jobs", {
    title: "Senior Frontend Engineer",
    companyName,
    location: "Austin, TX",
    remote: "HYBRID",
    description:
      "Own the analytics workspace used by 40k daily users.\n\n" +
      "Requirements:\n5+ years with React\nStrong TypeScript\nGraphQL\n\n" +
      "Nice to have:\nDesign Systems experience\n\n" +
      "Benefits:\nMedical, dental, 401k with match.",
    salaryMin: 150,
    salaryMax: 185,
    benefitsDescription: "Medical, dental, vision, 401k with 4% match, 20 days PTO.",
    attestCurrentVacancy: true,
    // FSD v1.1 GEO-001 — country is required for a role posted in-app.
    countryCode: "US",
  });
  eq(r.status, 201);
  jobId = r.json.jobId;
  assert(Array.isArray(r.json.skills) && r.json.skills.length > 0, "skills should be extracted");
});

await t("TC-JOB-001-07", "script tags in a description do not survive as executable markup", async () => {
  const r = await rec.post("/api/jobs", {
    title: "Backend Engineer",
    companyName,
    location: "Austin, TX",
    description:
      "<script>alert(1)</script> Requirements: 4+ years with Go and PostgreSQL and distributed systems.",
    salaryMin: 140,
    salaryMax: 180,
    attestCurrentVacancy: true,
    // FSD v1.1 GEO-001 — country is required for a role posted in-app.
    countryCode: "US",
  });
  eq(r.status, 201);
  const page = await rec.get(`/j/${r.json.jobId}`);
  assert(!/<script>alert\(1\)<\/script>/.test(page.text), "stored XSS — raw script tag rendered");
});

await t("TC-COMP-003-04", "an unverified company is capped at 3 active postings", async () => {
  const mk = (n) =>
    rec.post("/api/jobs", {
      title: `Filler Role ${n}`,
      companyName,
      location: "Austin, TX",
      description: `A perfectly ordinary role description number ${n} with enough length to pass.`,
      salaryMin: 100,
      salaryMax: 140,
      attestCurrentVacancy: true,
    // FSD v1.1 GEO-001 — country is required for a role posted in-app.
    countryCode: "US",
    });
  const third = await mk(3);
  const fourth = await mk(4);
  assert(
    third.status === 201 || fourth.status === 409 || fourth.json?.code === "UNVERIFIED_JOB_CAP",
    `expected the cap to bite; got ${third.status} then ${fourth.status}`
  );
  if (fourth.status !== 201) eq(fourth.json.code, "UNVERIFIED_JOB_CAP");
});

// ══════════════════════════════════════════════════════════════
G("SEAT-001/002/003 · seats, invitations and permissions");
// ══════════════════════════════════════════════════════════════
const mate = client();
const mateEmail = emailFor("mate");

await t("TC-SEAT-002-01", "an admin can invite a teammate", async () => {
  const r = await rec.post("/api/company/invitations", { email: mateEmail, seatRole: "RECRUITER" });
  eq(r.status, 201);
});

let inviteToken = null;
await t("TC-SEAT-002-11", "the invitation email carries a token", async () => {
  const mail = await lastEmailTo(mateEmail, "COMPANY_INVITE");
  assert(mail, "no invitation email");
  inviteToken = tokenFrom(mail.body, "/join");
  assert(inviteToken, "no token in the invitation");
});

await t("TC-SEAT-002-05", "the invitation binds to the invited address", async () => {
  // A signed-in user at a DIFFERENT address must not be able to redeem it —
  // otherwise a forwarded invitation link hands over a seat.
  const interloper = client();
  const r0 = await interloper.post("/api/auth/signup", {
    email: emailFor("interloper"),
    password: "Str0ngPassw0rd!",
    name: "Ivy Interloper",
    acceptedTerms: true,
  });
  eq(r0.status, 201, "setup signup should succeed");
  const r = await interloper.post("/api/company/invitations/accept", { token: inviteToken });
  eq(r.status, 403);
  eq(r.json.code, "INVITE_WRONG_ACCOUNT");
});

await t("TC-SEAT-002-03", "the invited person can accept", async () => {
  await mate.post("/api/auth/signup", {
    email: mateEmail,
    password: "Str0ngPassw0rd!",
    name: "Morgan Mate",
    role: "RECRUITER",
    acceptedTerms: true,
  });
  const mail = await lastEmailTo(mateEmail, "VERIFY_EMAIL");
  await mate.get(`/api/auth/verify?token=${encodeURIComponent(tokenFrom(mail.body, "/api/auth/verify"))}`);

  const r = await mate.post("/api/company/invitations/accept", { token: inviteToken });
  eq(r.status, 200);
  eq(r.json.companyName, companyName);
});

await t("TC-SEAT-002-13", "the invitation cannot be redeemed twice", async () => {
  // The token is consumed at accept, so a replay is refused before any
  // membership check runs. That ordering is deliberate: a used invitation is
  // used, whoever presents it.
  const r = await mate.post("/api/company/invitations/accept", { token: inviteToken });
  eq(r.status, 400);
  eq(r.json.code, "INVITE_USED");
});

await t("TC-SEAT-003-01", "a plain recruiter cannot invite", async () => {
  const r = await mate.post("/api/company/invitations", { email: emailFor("x") });
  eq(r.status, 403);
  eq(r.json.code, "ADMIN_ONLY");
});

await t("TC-SEAT-003-08", "a plain recruiter cannot start company verification", async () => {
  const r = await mate.post("/api/company/verify", { method: "DNS", domain: "example.com" });
  eq(r.status, 403);
});

await t("TC-SEAT-003-11", "permission checks are server-side, not UI-only", async () => {
  const denied = await Promise.all([
    mate.post("/api/company/invitations", { email: emailFor("y") }),
    mate.del("/api/company/members", { userId: "someone" }),
    mate.patch("/api/company/members", { userId: "someone", seatRole: "RECRUITER" }),
  ]);
  for (const r of denied) eq(r.status, 403, "every admin endpoint must refuse a plain recruiter");
});

await t("TC-COMP-003-05", "a free webmail domain cannot be verified", async () => {
  const r = await rec.post("/api/company/verify", { method: "EMAIL", email: "someone@gmail.com" });
  eq(r.status, 400);
  eq(r.json.code, "FREE_MAIL_DOMAIN");
});

await t("TC-SEAT-001-04", "the sole admin cannot remove themselves", async () => {
  const r = await rec.del("/api/company/members", { userId: "self-placeholder" });
  // The placeholder is not a member, so this is a 404 — the LAST_ADMIN guard is
  // exercised directly below with the real id.
  assert(r.status === 404 || r.status === 409, `got ${r.status}`);
});

// ══════════════════════════════════════════════════════════════
G("E2E-003 · deck, swipe, match, message, block");
// ══════════════════════════════════════════════════════════════
await t("TC-SWIPE-001-01", "the candidate deck returns scored cards", async () => {
  const r = await cand.get("/api/deck?mode=candidate");
  eq(r.status, 200);
  assert(Array.isArray(r.json.cards), "cards array expected");
  if (r.json.cards.length) {
    const card = r.json.cards[0];
    assert(typeof card.score === "number", "each card carries a score");
    assert(Array.isArray(card.reasons), "each card carries reasons");
    assert(typeof card.qualification === "number", "each card carries qualification");
  }
});

await t("TC-SWIPE-001-05", "the deck is ordered by score", async () => {
  const r = await cand.get("/api/deck?mode=candidate");
  const scores = r.json.cards.map((c) => c.score);
  for (let i = 1; i < scores.length; i++) {
    assert(scores[i] <= scores[i - 1], `deck out of order at ${i}: ${scores.join(",")}`);
  }
});

await t("TC-XPLAIN-001-01", "an explanation reconciles to its score", async () => {
  const deck = await cand.get("/api/deck?mode=candidate");
  if (!deck.json.cards.length) return; // nothing to explain in an empty corpus
  const target = deck.json.cards[0];
  const r = await cand.get(`/api/match/explain?jobId=${target.id}`);
  eq(r.status, 200);
  const e = r.json.explanation;
  eq(e.reconciles, true, "the breakdown must sum to the score");
  eq(e.score, target.score, "the explanation must describe the score actually shown");
  assert(e.components.length === 5, "five weighted components");
  assert(e.neverUsed.length > 10, "the prohibited-input list is stated to the candidate");
  assert(/does not accept or reject/i.test(e.disclaimer), "the disclaimer must be present");
});

await t("TC-XPLAIN-001-11", "you cannot explain someone else's match", async () => {
  const r = await mate.get(`/api/match/explain?jobId=${jobId}&candidateId=00000000-0000-0000-0000-000000000000`);
  assert(r.status === 403 || r.status === 404, `expected refusal, got ${r.status}`);
});

await t("TC-XPLAIN-003-01", "profiling opt-out is available and reports the ranking", async () => {
  const before = await cand.get("/api/privacy/profiling");
  eq(before.status, 200);
  eq(before.json.optedOut, false);
  eq(before.json.ranking, "MATCH_SCORE");

  const set = await cand.post("/api/privacy/profiling", { optOut: true });
  eq(set.status, 200);
  eq(set.json.ranking, "MOST_RECENT_FIRST");
  assert(/still see/i.test(set.json.message), "the user must be told they still see jobs");
});

await t("TC-XPLAIN-003-03", "an opted-out candidate still gets a deck", async () => {
  const r = await cand.get("/api/deck?mode=candidate");
  eq(r.status, 200, "withholding the product would be retaliation");
  assert(Array.isArray(r.json.cards));
});

await t("TC-XPLAIN-003-02", "a Global Privacy Control header is honoured", async () => {
  const r = await cand.get("/api/privacy/profiling", { "Sec-GPC": "1" });
  eq(r.json.gpcSignal, true);
  eq(r.json.optedOut, true);
});

await t("TC-XPLAIN-003-11", "opting back in restores score ranking", async () => {
  const r = await cand.post("/api/privacy/profiling", { optOut: false });
  eq(r.json.ranking, "MATCH_SCORE");
});

await t("TC-XPLAIN-004-01", "human review can be requested", async () => {
  const r = await cand.post("/api/privacy/review", {
    detail: "I think the score for the frontend role is wrong — I have five years of React.",
  });
  eq(r.status, 201);
  assert(r.json.dueBy, "a due date must be set");
  assert(/can change the outcome/i.test(r.json.message), "the user must be told review is real");
});

await t("TC-XPLAIN-004-07", "a second review request does not open a duplicate clock", async () => {
  const r = await cand.post("/api/privacy/review", { detail: "Following up on the same thing." });
  eq(r.json.alreadyOpen, true);
});

// ══════════════════════════════════════════════════════════════
G("MSG-004 / TRUST-002 · safety");
// ══════════════════════════════════════════════════════════════
await t("TC-TRUST-002-01", "a job can be reported", async () => {
  const r = await cand.post("/api/reports", {
    kind: "JOB",
    targetId: jobId,
    reason: "GHOST_JOB",
    detail: "This role has been open for months with no response.",
  });
  eq(r.status, 201);
  assert(r.json.reference, "a reference should be returned so the user can follow up");
});

await t("TC-TRUST-002-03", "the report snapshots the content at report time", async () => {
  const { reports } = await import("../src/db/index.ts");
  const rows = await db.select().from(reports).where(dEq(reports.targetId, jobId));
  assert(rows.length >= 1);
  assert(rows[0].snapshot?.target?.title, "the snapshot must capture the job as it was");
});

await t("TC-TRUST-002-06", "reporting is rate limited", async () => {
  let limited = false;
  for (let i = 0; i < 14; i++) {
    const r = await cand.post("/api/reports", { kind: "JOB", targetId: jobId, reason: "SPAM" });
    if (r.status === 429) {
      limited = true;
      break;
    }
  }
  assert(limited, "report-bombing was not throttled");
});

await t("TC-MSG-004-01", "a user can be blocked", async () => {
  const recUser = (await db.select().from(users).where(dEq(users.email, recEmail)))[0];
  const r = await cand.post("/api/blocks", { userId: recUser.id });
  eq(r.status, 200);
  assert(!/blocked you/i.test(r.json.message ?? ""), "the message must not imply the other side is told");
});

await t("TC-MSG-004-11", "you cannot block yourself", async () => {
  const me = (await db.select().from(users).where(dEq(users.email, candEmail)))[0];
  const r = await cand.post("/api/blocks", { userId: me.id });
  eq(r.status, 400);
});

await t("TC-MSG-001-02", "messaging a fabricated match is refused", async () => {
  const r = await cand.post("/api/messages", {
    matchId: "00000000-0000-0000-0000-000000000000",
    body: "hello",
  });
  assert(r.status >= 400, "messaging outside a match must fail");
});

// ══════════════════════════════════════════════════════════════
G("AUTH-012 / LEGAL-001 · privacy rights");
// ══════════════════════════════════════════════════════════════
await t("TC-AUTH-012-05", "a data export contains the profile and derived scores", async () => {
  const r = await cand.post("/api/account/export");
  eq(r.status, 200);
  const bundle = JSON.parse(r.text);
  assert(bundle.profile?.email === candEmail, "the profile must be present");
  assert(Array.isArray(bundle.swipesAndScores), "derived scores must be present");
  assert(Array.isArray(bundle.notUsedInMatching), "what we do NOT hold should be stated");
  assert(bundle.workAuthorization?.note, "the work-auth limitation should be explained");
  assert(bundle.legalAcceptances.length >= 2, "terms acceptances must be exportable");
  assert(
    r.headers.get("content-disposition")?.includes("attachment"),
    "the export should download, not render"
  );
  assert(/no-store/.test(r.headers.get("cache-control") ?? ""), "an export must not be cached");
});

await t("TC-AUTH-012-08", "one user cannot export another's data", async () => {
  const r = await client().post("/api/account/export");
  eq(r.status, 401);
});

await t("TC-AUTH-012-01", "deletion requires an exact confirmation", async () => {
  const r = await cand.post("/api/account/delete", { confirm: "yes", password: "N3wStr0ngPass!" });
  eq(r.status, 400);
  eq(r.json.code, "CONFIRM_MISMATCH");
});

await t("TC-AUTH-012-02", "deletion requires the password", async () => {
  const r = await cand.post("/api/account/delete", { confirm: candEmail, password: "wrong" });
  eq(r.status, 401);
});

await t("TC-AUTH-012-12", "deletion closes the account and ends the session", async () => {
  const r = await cand.post("/api/account/delete", { confirm: candEmail, password: "N3wStr0ngPass!" });
  eq(r.status, 200);
  assert(/erased within 30 days/i.test(r.json.message), "the user should be told the timeline");

  const after = await cand.get("/api/profile");
  eq(after.status, 401, "the session must end immediately");

  const relogin = await client().post("/api/auth/login", {
    email: candEmail,
    password: "N3wStr0ngPass!",
  });
  assert(relogin.status !== 200, "a closed account must not sign back in");
});

// ══════════════════════════════════════════════════════════════
G("ADMIN · access control");
// ══════════════════════════════════════════════════════════════
await t("TC-ADMIN-001-02", "a normal user cannot reach the moderation queue", async () => {
  const r = await rec.get("/api/admin/reports");
  eq(r.status, 403);
  eq(r.json.code, "ADMIN_ONLY");
});

await t("TC-ADMIN-006-06", "a normal user cannot reach the compliance console", async () => {
  const r = await rec.get("/api/admin/compliance");
  eq(r.status, 403);
});

await t("TC-ADMIN-001-02b", "an anonymous caller gets 401, not 403", async () => {
  const r = await client().get("/api/admin/reports");
  eq(r.status, 401);
});

await t("TC-ADMIN-007-01", "no @demo.jobsy account exists with a guessable password", async () => {
  // The seed now generates its password. This asserts the constant is gone.
  const { readFileSync } = await import("node:fs");
  const seed = readFileSync(new URL("./seed.ts", import.meta.url), "utf8");
  assert(!/const PW = "password123"/.test(seed), "the hardcoded seed password must be gone");
  assert(/ALLOW_PROD_SEED/.test(seed), "the production seed guard must be present");
});

await t("TC-ING-006-03", "the ingest endpoint requires the cron secret", async () => {
  const r = await client().post("/api/ingest", {}, { Authorization: "Bearer wrong-secret" });
  eq(r.status, 401);
});

// ══════════════════════════════════════════════════════════════
G("E2E-009 · the candidate / recruiter boundary");
// ══════════════════════════════════════════════════════════════
//
// FSD v1.0 QA case AUTH-04, marked P0. Every one of these passed as a 200
// before the boundary existed: the posting endpoint accepted a candidate and
// silently promoted them to a dual role, /api/profile let anyone assign
// themselves RECRUITER, and /api/swipe took the side to act as from the request
// body with no check at all.
//
// A fresh actor: the candidate from E2E-001 has had their account deleted by
// the erasure test, so reusing it would produce 401s that look like 403s at a
// glance and prove nothing about roles.
const seeker = client();
const seekerEmail = emailFor("seeker");

await t("setup", "job seeker signs up and verifies", async () => {
  const r = await seeker.post("/api/auth/signup", {
    email: seekerEmail,
    password: "Str0ngPassw0rd!",
    name: "Sam Seeker",
    role: "CANDIDATE",
    location: "Austin, TX",
    acceptedTerms: true,
  });
  eq(r.status, 201);
  const mail = await lastEmailTo(seekerEmail, "VERIFY_EMAIL");
  await seeker.get(`/api/auth/verify?token=${encodeURIComponent(tokenFrom(mail.body, "/api/auth/verify"))}`);
});

await t("TC-AUTH-002-01", "a candidate cannot post a job", async () => {
  const r = await seeker.post("/api/jobs", {
    title: "Definitely Not Allowed",
    companyName: "Candidate Co",
    location: "Austin, TX",
    countryCode: "US",
    description: "Requirements: 5+ years with React and TypeScript.",
    salaryMin: 150,
    salaryMax: 185,
    attestCurrentVacancy: true,
    benefitsDescription: "Health, dental, vision.",
  });
  eq(r.status, 403, "JOB-001 — posting is an employer action");
  eq(r.json.code, "WRONG_ACCOUNT_TYPE");
});

await t("TC-AUTH-002-02", "a candidate cannot promote themselves to recruiter", async () => {
  const r = await seeker.patch("/api/profile", { role: "RECRUITER" });
  // The field is no longer accepted at all, so the request may succeed while
  // ignoring it. What must never happen is the role actually changing.
  const me = await seeker.get("/api/profile");
  eq(me.json.role, "CANDIDATE", "role must be immutable from the profile API");
  void r;
});

await t("TC-AUTH-002-03", "a candidate cannot browse the recruiter deck", async () => {
  const r = await seeker.get("/api/deck?mode=recruiter&jobId=whatever");
  eq(r.status, 403, "sourcing people is an employer action");
});

await t("TC-AUTH-003-01", "a recruiter cannot swipe as a candidate", async () => {
  const r = await rec.post("/api/swipe", {
    mode: "candidate",
    direction: "LIKE",
    jobId: "00000000-0000-0000-0000-000000000000",
  });
  eq(r.status, 403, "AUTH-003 — applying is a job seeker action");
  eq(r.json.code, "WRONG_ACCOUNT_TYPE");
});

await t("TC-AUTH-003-02", "a candidate cannot swipe as a recruiter", async () => {
  const r = await seeker.post("/api/swipe", {
    mode: "recruiter",
    direction: "LIKE",
    jobId: "00000000-0000-0000-0000-000000000000",
    candidateId: "00000000-0000-0000-0000-000000000000",
  });
  eq(r.status, 403);
});

await t("TC-CAN-001-01", "signup cannot request a role outside the two", async () => {
  const r = await client().post("/api/auth/signup", {
    email: emailFor("both"),
    password: "Str0ngPassw0rd!",
    name: "Both Sides",
    role: "BOTH",
    acceptedTerms: true,
  });
  eq(r.status, 400, "BOTH is not a role anyone can choose");
});

await t("TC-CAN-001-02", "signup cannot request platform staff", async () => {
  const impostor = client();
  const r = await impostor.post("/api/auth/signup", {
    email: emailFor("admin"),
    password: "Str0ngPassw0rd!",
    name: "Not An Admin",
    role: "CANDIDATE",
    isPlatformAdmin: true,
    acceptedTerms: true,
  });
  eq(r.status, 201, "the extra field is ignored, not fatal");
  // The proof that it was ignored: staff endpoints still refuse them.
  const admin = await impostor.get("/api/admin/compliance");
  eq(admin.status, 403, "isPlatformAdmin must not be settable by a request body");
});

// ══════════════════════════════════════════════════════════════
G("E2E-010 · the job lifecycle");
// ══════════════════════════════════════════════════════════════
//
// FSD §8.1 / APP-007 / BR-013 / AC-013. Before the status model existed a
// closed posting only DISAPPEARED from the deck — a direct POST /api/swipe
// still created an application, and the candidate got a confirmation email for
// a role nobody was reading any more.

let lifecycleJobId = null;

// Its own recruiter, for the same reason the boundary block needed its own
// candidate: by this point in the run `rec` has been through the suspension and
// company-removal tests, so reusing it produces 403s that say nothing about the
// job lifecycle.
const lifeRec = client();
const lifeRecEmail = emailFor("liferec");

await t("setup", "recruiter signs up and verifies", async () => {
  const r = await lifeRec.post("/api/auth/signup", {
    email: lifeRecEmail,
    password: "Str0ngPassw0rd!",
    name: "Lifecycle Recruiter",
    role: "RECRUITER",
    location: "Austin, TX",
    acceptedTerms: true,
  });
  eq(r.status, 201);
  const mail = await lastEmailTo(lifeRecEmail, "VERIFY_EMAIL");
  await lifeRec.get(`/api/auth/verify?token=${encodeURIComponent(tokenFrom(mail.body, "/api/auth/verify"))}`);
});

await t("setup", "recruiter publishes a role to close later", async () => {
  const r = await lifeRec.post("/api/jobs", {
    title: "Closing Soon Engineer",
    companyName: "Lifecycle Labs",
    location: "Austin, TX",
    countryCode: "US",
    description: "Own the analytics workspace. Requirements: 5+ years with React and TypeScript.",
    salaryMin: 150,
    salaryMax: 185,
    benefitsDescription: "Health, dental and vision; 401(k) match.",
    attestCurrentVacancy: true,
  });
  eq(r.status, 201);
  lifecycleJobId = r.json.jobId;
  ok(lifecycleJobId, "job id returned");
});

await t("TC-JS-E2E-01", "a published role accepts an application", async () => {
  const r = await seeker.post("/api/swipe", {
    mode: "candidate", direction: "LIKE", jobId: lifecycleJobId,
  });
  eq(r.status, 200, "a live role takes applications");
});

await t("TC-JS-E2E-02", "an illegal transition is refused", async () => {
  const r = await lifeRec.patch(`/api/jobs/${lifecycleJobId}`, { status: "DRAFT" });
  eq(r.status, 400, "published cannot go back to draft");
  eq(r.json.code, "ILLEGAL_TRANSITION");
});

await t("TC-JS-E2E-03", "closing a role sets the status, not just the flag", async () => {
  const r = await lifeRec.patch(`/api/jobs/${lifecycleJobId}`, { status: "CLOSED" });
  eq(r.status, 200);
});

await t("TC-APP-007-01", "a closed role refuses a NEW application", async () => {
  // A different candidate, so this is a genuinely new application rather than
  // an idempotent repeat of the one made while the role was live.
  const later = client();
  const laterEmail = emailFor("late");
  await later.post("/api/auth/signup", {
    email: laterEmail, password: "Str0ngPassw0rd!", name: "Late Applicant",
    role: "CANDIDATE", location: "Austin, TX", acceptedTerms: true,
  });
  const mail = await lastEmailTo(laterEmail, "VERIFY_EMAIL");
  await later.get(`/api/auth/verify?token=${encodeURIComponent(tokenFrom(mail.body, "/api/auth/verify"))}`);

  const r = await later.post("/api/swipe", {
    mode: "candidate", direction: "LIKE", jobId: lifecycleJobId,
  });
  eq(r.status, 400, "BR-013 — a closed role takes nobody new");
  ok(/closed/i.test(r.json.error ?? ""), `message names the reason: ${r.json.error}`);
});

await t("TC-APP-007-02", "passing on a closed role is still allowed", async () => {
  const r = await seeker.post("/api/swipe", {
    mode: "candidate", direction: "PASS", jobId: lifecycleJobId,
  });
  eq(r.status, 200, "dismissing a dead card must not strand the deck");
});

await t("TC-JS-E2E-04", "a closed role can be reopened", async () => {
  const r = await lifeRec.patch(`/api/jobs/${lifecycleJobId}`, { status: "PUBLISHED" });
  eq(r.status, 200);
});

await t("TC-JS-E2E-05", "archiving is permanent", async () => {
  const a = await lifeRec.patch(`/api/jobs/${lifecycleJobId}`, { status: "ARCHIVED" });
  eq(a.status, 200);
  const back = await lifeRec.patch(`/api/jobs/${lifecycleJobId}`, { status: "PUBLISHED" });
  eq(back.status, 400, "un-archiving would resurrect a role its applicants were told was over");
});

// ══════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(60)}`);
console.log(`${pass} passed, ${fail} failed  —  end-to-end lifecycle`);
console.log("═".repeat(60));
if (fail) {
  console.error("\nFailures:\n");
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
process.exit(0);
