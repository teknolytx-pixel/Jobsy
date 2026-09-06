# Jobsy — Security Audit

**Date:** 6 September 2026 · **Commit audited:** `ab4b9aa` (v2.50) · **Remediated at:** v2.51
**Method:** white-box source review of every route, library and config file in the repository, plus dependency analysis and git-history secret scanning. No live production testing — see *Scope* below.

---

## 0. Scope — and four pillars that do not apply

You asked for a review across Windows, macOS, iOS, Android and Cloud/API.

**Jobsy has no Windows, macOS, iOS or Android client.** It is a single Next.js application served over HTTPS and reached through a browser. I checked rather than assumed: there is no Xcode project, no Gradle build, no `.csproj`, no Capacitor or Electron configuration anywhere in the repository.

I could produce PASS rows for those four platforms. They would be meaningless — a PASS on "iOS Keychain usage" for an app with no iOS build tells you nothing and quietly teaches you the checklist is trustworthy. So they are reported **N/A**, and everything below concerns the one platform that exists.

The audit covers:

| Area | Covered |
|---|---|
| Cloud / API backend | **Yes** — 46 route handlers, 50 library modules, config, middleware |
| Browser client (the delivered web app) | **Yes** — headers, CSP, XSS surface, cookie handling |
| Data at rest / PII | **Yes** — resumes, sourced candidates, exports |
| Supply chain | **Yes** — 100% of the dependency tree |
| Secrets & git history | **Yes** |
| Windows / macOS / iOS / Android clients | **N/A — no such client exists** |

**One limit worth stating plainly:** this is a source review, not a penetration test. I could not reach the live deployment — outbound network from this environment is restricted — so nothing below is confirmed against `jobsy-weld.vercel.app`. Every finding is derived from code I read; the runtime findings marked *unverified* are the ones a live test would settle.

---

## 1. Critical Vulnerability Summary

| # | Severity | Finding | Status |
|---|---|---|---|
| C-1 | **CRITICAL** | Live database password committed in a **public** repository | **Code fixed — credential still needs rotating** |
| C-2 | **CRITICAL** | `AUTH_SECRET`, `CRON_SECRET`, Neon password and RapidAPI key all disclosed and never rotated | **Open — only you can fix this** |
| C-3 | **CRITICAL** | Repository is public and contains the full deployment runbook | **Open — only you can fix this** |
| H-1 | **HIGH** | No security response headers at all — no CSP, no framing protection | **Fixed** |
| H-2 | **HIGH** | Four declared rate limits were never enforced; candidate deck was unthrottled | **Fixed** |
| H-3 | **HIGH** | Six high-severity dependency vulnerabilities | **Fixed (0 high remaining)** |
| M-1 | MEDIUM | bcrypt cost 10; password floor 8 chars; no leaked-password check | **Fixed** |
| M-2 | MEDIUM | bcrypt's 72-byte truncation silently accepted longer passwords | **Fixed** |
| M-3 | MEDIUM | Password policy duplicated across signup and reset | **Fixed** |
| M-4 | MEDIUM | Rate limiter fails open on database error | **Accepted — documented trade-off** |
| M-5 | MEDIUM | `X-Forwarded-For` trusted for IP-based limits | **Accepted on Vercel — see L-2** |
| L-1 | LOW | Debug scripts (`dbg.mjs`, `dbg2.mjs`, `draft2.mjs`) committed | **Fixed** |
| L-2 | LOW | Dead `@prisma/client` reference in `next.config.ts` | **Fixed** |

### What was already right

It is worth recording, because a report that lists only failures gives a false picture of the codebase. The following were correct before this audit and I confirmed each by reading the implementation:

- **Broken object-level authorisation (BOLA/IDOR)** — the number-one API risk in the OWASP API Top 10 — **is not present.** Every one of the five `[id]` routes re-derives ownership from the session rather than trusting the path parameter. `/api/resumes/[id]/file` is the strongest example in the codebase: three independent gates (HMAC signature binding *both* resume and viewer, a live session matching that viewer, and a proven match between the two parties).
- **JWT algorithm is pinned** to HS256 on verification — `alg: none` and algorithm-confusion attacks fail.
- **Session revocation works without a session table** — a `sv` claim compared against a `session_version` column, incremented on password reset, password change and suspension.
- **SSRF is properly defended.** `safeFetch` validates *resolved addresses*, not hostnames, and re-validates on every redirect hop — which is the bypass most implementations miss. Cloud metadata (`169.254.169.254`), RFC1918, CGNAT, IPv6 ULA and IPv4-mapped addresses are all blocked. 35 tests cover it.
- **Email/reset/invite tokens are hashed before storage.** A stolen database dump cannot be replayed to take over an account.
- **XSS is controlled at the one real injection point.** The single `dangerouslySetInnerHTML` (JSON-LD on public job pages, built from employer-supplied text) goes through `safeJsonLd`, which escapes `<`, `>`, `&`, U+2028 and U+2029.
- **Resume uploads are content-sniffed**, not MIME-trusted, capped at 4 MB, and served `Content-Disposition: attachment` with `nosniff`.
- **OAuth CSRF state** is generated, stored httpOnly, compared, and deleted.
- **No wildcard CORS anywhere.** Every route is same-origin only.
- **Constant-time comparison** for `CRON_SECRET`.
- **Discrimination controls are enforced in code**, not policy: a build-time guard forbids protected attributes reaching the scoring engine, and sponsorship eligibility deliberately fails *open* so that a blank field can never be read as an inference about immigration status.

---

## 2. Attack Vectors

### C-1 — Live database password in a public repository

**Vector:** read a public GitHub repository.

`PRODUCTION.md` line 46 contained the live Neon password in plaintext — inside the very table instructing the reader to rotate it. The repository at `github.com/teknolytx-pixel/Jobsy` is public.

```
| Neon database password (`npg_tc1u4LeafDdX`) | Rotate in the Neon console → ... |
```

**Impact:** with the password and the hostname (also in `DEPLOY-STEPS.md`), an attacker connects directly to the production database. That is every user record, every password hash, every resume reference, every private message. No application control matters at that point — they are past all of them.

**Why this is worse than a leaked key:** GitHub is continuously scraped by automated credential harvesters. A secret in a public repository should be assumed compromised within minutes of the push, not "at risk". The commit history retains it even after the file is edited.

**Verified:** yes, by `git grep` on tracked files.

---

### C-2 — Disclosed credentials never rotated

`AUTH_SECRET` signs every session JWT **and** every resume download URL. Anyone holding it can forge a session cookie for any user id — that is complete authentication bypass, including admin — and mint a valid signed URL for any resume in the system.

`CRON_SECRET` authorises `/api/ingest`, the most expensive endpoint in the application.

The RapidAPI key was exposed in a screenshot; it is billed metered.

**Verified:** disclosure is a matter of record. Whether rotation has happened, only you can confirm.

---

### H-1 — No security headers (clickjacking)

**Vector:** attacker hosts a page with Jobsy's `/swipe` in a transparent iframe positioned under an innocuous button.

The application sent **no** `Content-Security-Policy`, **no** `X-Frame-Options`, **no** `Strict-Transport-Security`, **no** `Referrer-Policy`, **no** `Permissions-Policy`. There was no middleware file at all.

**Why this matters more for Jobsy than for most apps:** the core interaction is one tap meaning *yes*, with no confirmation step — that is the product's design premise. A framed deck turns every click on the attacker's page into a LIKE: a recruiter shortlisting people they never saw, a candidate applying to jobs they never read. There is no second step to fall back on.

The missing `Referrer-Policy` is a quieter but real problem: password-reset URLs carry the token in the path, and with no policy set that full URL travels in the `Referer` header to any third-party host the page loads a resource from.

**Verified:** yes, by absence of `src/middleware.ts` and absence of a `headers()` block in `next.config.ts`.

---

### H-2 — Rate limits declared but never enforced

**Vector:** authenticate as any recruiter, request `/api/deck?mode=recruiter` in a loop.

`LIMITS.swipeDaily`, `LIMITS.recruiterSwipeDaily`, `LIMITS.search` and `LIMITS.sourceSync` were all defined in `src/lib/ratelimit.ts` and **never once passed to `consume()`**. I confirmed this by counting call sites for every declared limit:

```
swipeDaily          -> 0 call sites
recruiterSwipeDaily -> 0 call sites
search              -> 0 call sites
sourceSync          -> 0 call sites
```

This is the most dangerous shape a security control can take. It appears in the config, it reads as enforced in review, and it enforces nothing.

**Impact:** the deck is the endpoint that returns *candidate profiles*. Unthrottled, it is a bulk-export interface with a login on the front of it. A single recruiter account — bought, phished, or simply signed up for — walks the entire candidate database at request speed. Under GDPR that is a reportable personal-data breach; the data subjects never consented to bulk extraction and would have no way to know it happened.

The unthrottled `sync-all` endpoint is a second-order problem: it is the one place where the server issues bulk outbound HTTP. `safeFetch` decides *where* those requests may go; nothing decided *how often*, so a compromised admin session could use Jobsy as a traffic source against a third party.

**Verified:** yes, by static analysis. Now locked down by a test that fails if any declared limit is unreferenced.

---

### H-3 — Dependency vulnerabilities

11 vulnerabilities (6 high). Notably `sharp` < 0.35.0 inheriting four libvips CVEs (`CVE-2026-33327/33328/35590/35591`) via `next@15.5.23`, and `postcss` ≤ 8.5.22 with four advisories including arbitrary `.map` file disclosure via attacker-controlled `sourceMappingURL`.

**Verified:** yes.

---

### M-1/M-2/M-3 — Password handling

Three separate issues in one area:

1. **bcrypt cost 10.** Below the practical floor for 2026 hardware. Each unit is a doubling; 12 is 4× the work per offline guess.
2. **72-byte truncation accepted silently.** bcrypt ignores everything past 72 bytes. A user with a 200-character passphrase was protected by its first 72 characters — and, worse, two *different* long passphrases sharing a 72-byte prefix were the *same password*. The user believes they have strong protection; they do not.
3. **Policy duplicated.** `z.string().min(8)` appeared independently in `signup/route.ts` and `reset/route.ts`. Two copies of a rule is one rule and one latent bug: strengthen signup, forget reset, and every account can be walked back down to a weak password through the forgotten-password flow.

Eight characters with no blocklist is inside the range a commodity GPU exhausts, and the strongest single predictor of takeover on a small site is password *reuse*, which a length rule does nothing about.

**Verified:** yes.

---

### M-4 — Rate limiter fails open (accepted)

`consume()` returns `{ok: true}` when the database throws. This is deliberate and documented in the source: a limiter that takes the site down on a database hiccup is worse than a brief window of unthrottled requests, and every throttled endpoint has a second line of defence.

I agree with the trade-off and am recording it rather than changing it. The residual risk is that a *sustained* database outage removes brute-force protection at exactly the moment you are least able to notice. Worth an alert on repeated `[ratelimit] check failed` log lines.

---

### M-5 — `X-Forwarded-For` trusted (accepted on Vercel)

`clientIp()` takes the first entry of `X-Forwarded-For`. If the header were client-controlled, an attacker would rotate it to make every login attempt look like a new IP and defeat `loginIp` entirely.

On Vercel this is safe: the platform overwrites the header at the edge. It becomes exploitable the moment Jobsy is served from anything else, or fronted by a second proxy. Flagged so the assumption is explicit rather than inherited.

---

## 3. Remediation — code applied

All of the following are implemented, tested and building clean.

### 3.1 Security headers — `src/middleware.ts` (new)

```ts
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",   // see note below
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://media.licdn.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",              // ← the clickjacking fix
  "frame-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(HEADERS)) res.headers.set(k, v);

  // RFC 6797 §7.2 — HSTS is only meaningful, and only permitted, over TLS.
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  if (proto === "https") {
    res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  // Signed-in HTML must never sit in a shared proxy cache.
  if (req.cookies.has("jobsy_session") && !req.nextUrl.pathname.startsWith("/api/")) {
    res.headers.set("Cache-Control", "private, no-store");
  }
  return res;
}
```

Also set: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` denying camera/microphone/geolocation/payment/USB/sensors, `Cross-Origin-Opener-Policy: same-origin`.

**One honest compromise:** `script-src` carries `'unsafe-inline'`. The Next.js App Router emits inline bootstrap and flight-data scripts on every server render; a strict nonce-based policy means threading a per-request nonce through all of them, which is a rendering change rather than a header edit and produces a site that works in development and is blank in production if done carelessly. What is still bought: `object-src 'none'` kills plugin execution, `base-uri 'self'` stops a `<base>` injection re-pointing every relative script URL, `form-action 'self'` stops an injected form posting an authenticated request off-site, and — critically — `frame-ancestors 'none'` is entirely unaffected by the script-src compromise. Nonce-based CSP is the right next step; it is a project, not a patch.

**No `preload` on HSTS.** Preloading is effectively irreversible and belongs in a deliberate decision once the domain is settled.

### 3.2 Enforce the dead rate limits

```ts
// src/app/api/swipe/route.ts — counted BEFORE the swipe is recorded, so the
// limit bounds attempts rather than successes; otherwise a rejected swipe is
// a free probe.
const rl = await consume(mode === "recruiter" ? "recruiterSwipeDaily" : "swipeDaily", user.id);
if (!rl.ok) return tooMany(rl, "You've reached today's limit …");
```

```ts
// src/app/api/deck/route.ts
const rl = await consume("search", user.id);
if (!rl.ok) return tooMany(rl, "You're moving faster than we can keep up. Try again in a moment.");
```

```ts
// src/app/api/sources/sync-all/route.ts
const rl = await consume("sourceSync", admin.id);
if (!rl.ok) return tooMany(rl, "A full sync was started recently …");
```

And the regression guard that matters more than the three fixes — this fails CI if *any* declared limit is ever added without being wired up:

```ts
for (const name of declaredLimits) {
  await t(`TC-SEC-002-${name}`, `LIMITS.${name} is referenced by a route`, () => {
    assert.ok(consumed.has(name), `LIMITS.${name} is declared but never consumed — it enforces nothing`);
  });
}
```

### 3.3 Password storage and policy — `src/lib/password.ts` (new)

```ts
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_BYTES = 72;   // bcrypt's silent truncation point

export function checkPassword(pw: string): PasswordVerdict {
  if (pw.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: "…at least 10 characters…" };
  if (Buffer.byteLength(pw, "utf8") > MAX_PASSWORD_BYTES) return { ok: false, reason: "…72 or fewer…" };
  if (COMMON.has(normalize(pw))) return { ok: false, reason: "That password appears in every published list of leaked passwords." };
  if (/^(.)\1+$/.test(pw)) return { ok: false, reason: "That's the same character repeated." };
  const f = flatten(pw);
  if (/^(?:0123456789|1234567890|abcdefghij|qwertyuiop)/.test(f) || isRun(f)) { … }
  return { ok: true };
}

/** The zod field used by EVERY route that accepts a new password. */
export const passwordField = () => z.string().superRefine((pw, ctx) => { … });
```

```ts
// src/lib/auth.ts
const BCRYPT_COST = 12;                     // was 10

export const hashPassword = (pw: string) => {
  if (!passwordLengthOk(pw)) throw new PasswordTooLongError();
  return bcrypt.hash(pw, BCRYPT_COST);
};
export const verifyPassword = (pw: string, hash: string) =>
  passwordLengthOk(pw) ? bcrypt.compare(pw, hash) : Promise.resolve(false);
```

Existing hashes carry their own cost parameter, so raising the factor **does not sign anyone out** — cost-10 hashes keep verifying, and anything set from now on is stored at 12.

**Deliberately absent: composition rules.** NIST SP 800-63B §5.1.1.2 is explicit that "one uppercase, one digit, one symbol" should *not* be imposed — it drives people to `Password1!` and to writing it down, measurably lowering entropy. There is a test (`TC-SEC-003-07`) asserting a long all-lowercase passphrase is accepted, specifically so nobody "improves" the policy by adding them later.

**The blocklist is local, not an API call.** Have I Been Pwned's range API is a far better dataset and is the right upgrade — but a blocklist that depends on a third party being reachable fails open on exactly the request where it matters, and adds a network round trip to the slowest endpoint in the app.

### 3.4 Committed-secret scanner

```ts
const SECRET_SHAPES: [string, RegExp][] = [
  ["Neon/Postgres password", /npg_(?=[A-Za-z0-9]{8,})(?=[a-z0-9]*[a-z])(?=[A-Za-z]*[0-9])[A-Za-z0-9]{8,}/],
  ["RapidAPI key", /[0-9a-f]{12}msh[0-9a-f]{10,}/],
  ["OpenAI-style key", /\bsk-[A-Za-z0-9_-]{20,}/],
  ["AWS access key id", /\bAKIA[0-9A-Z]{16}\b/],
  ["Vercel blob token", /vercel_blob_rw_[A-Za-z0-9_]{20,}/],
  ["Resend key", /\bre_[A-Za-z0-9]{24,}/],
  ["assigned secret in a doc", /(AUTH_SECRET|CRON_SECRET)\s*=\s*["']?[A-Za-z0-9+/=]{16,}/],
];
// `npg_NEWVALUE`, `sk-YOUR_KEY_HERE` and friends are instructions, not secrets.
// A scanner that cannot tell the difference gets switched off.
if (m && !/NEWVALUE|YOUR|EXAMPLE|PLACEHOLDER|REPLACE|xxxx|\.\.\./i.test(m[0])) hits.push(f);
```

This found a **second** occurrence I had missed with a manual grep — a placeholder in `DEPLOY-STEPS.md` — which is the argument for having it run on every commit rather than when someone remembers.

### 3.5 Dependencies

```json
"next": "15.5.25",
"overrides": { "deepmerge-ts": "^8.0.0", "postcss": "^8.5.23" }
```

`npm audit fix` (never `--force` — that would install `next@16` and is a breaking change).

**11 vulnerabilities (6 high) → 5 moderate, 0 high.**

The five remaining are all `esbuild` ≤ 0.24.2 reached through `drizzle-kit`'s deprecated `@esbuild-kit/*` dependency. The advisory concerns esbuild's *development server* accepting cross-origin requests. It is a devDependency, never deployed, and Jobsy never runs that server. Fixing it requires `drizzle-kit@0.18.1` — a major downgrade that would break the migration tooling. **Accepted and documented**, not silently ignored.

Also removed: the dead `@prisma/client` entry in `next.config.ts` (Prisma is not a dependency and is not imported anywhere), and the three committed debug scripts.

---

## 4. Go-Live Checklist

### Cloud / API — the platform that exists

| # | Control | Status | Evidence |
|---|---|---|---|
| 1 | No wildcard CORS | **PASS** | No `Access-Control-Allow-Origin` anywhere; `TC-SEC-005-04` |
| 2 | Object-level authorisation on every `[id]` route | **PASS** | All 5 re-derive ownership from session |
| 3 | Function-level authorisation (admin routes) | **PASS** | All 5 admin routes call `requirePlatformAdmin()` |
| 4 | Role boundary enforced server-side | **PASS** | `requireRole()`; swipe route rejects body-supplied `mode` |
| 5 | JWT algorithm pinned | **PASS** | `algorithms: ["HS256"]`; `TC-SEC-005-01` |
| 6 | Session revocation without a session table | **PASS** | `sv` claim vs `session_version` |
| 7 | Session cookie httpOnly + SameSite + Secure | **PASS** | `TC-SEC-005-02` |
| 8 | CSRF | **PASS** | SameSite=Lax blocks cross-site state-changing requests; no GET has cookie-authenticated side effects |
| 9 | Password hashing algorithm & cost | **PASS** | bcrypt cost 12; `TC-SEC-003-01` |
| 10 | Password policy (length, blocklist, no composition rules) | **PASS** | `TC-SEC-003-04..08` |
| 11 | Auth tokens hashed at rest, single-use, expiring | **PASS** | SHA-256; atomic `UPDATE … WHERE consumed_at IS NULL` |
| 12 | Rate limiting on auth endpoints | **PASS** | login (IP + email), signup, reset, verify |
| 13 | Rate limiting on data-read endpoints | **PASS** | *was FAIL* — deck and swipe now throttled |
| 14 | Every declared limit actually enforced | **PASS** | *was FAIL* — `TC-SEC-002-*` fails CI otherwise |
| 15 | SSRF — resolved-address validation, per-hop | **PASS** | `safeFetch`; 35 tests |
| 16 | Cloud metadata endpoint blocked | **PASS** | `169.254.0.0/16` blocked; tested |
| 17 | SQL injection | **PASS** | Drizzle parameterises; no `sql.raw` on user input |
| 18 | XSS — HTML injection points | **PASS** | One `dangerouslySetInnerHTML`, via `safeJsonLd`; `TC-SEC-005-05` |
| 19 | Content-Security-Policy | **PASS**¹ | *was FAIL* — see the `unsafe-inline` note |
| 20 | Clickjacking / frame-ancestors | **PASS** | *was FAIL* — `frame-ancestors 'none'` + `X-Frame-Options: DENY` |
| 21 | HSTS | **PASS** | *was FAIL* — HTTPS-conditional, no preload |
| 22 | Referrer-Policy | **PASS** | *was FAIL* — reset tokens no longer leak via `Referer` |
| 23 | Permissions-Policy | **PASS** | *was FAIL* |
| 24 | File upload — content-sniffed, size-capped | **PASS** | Magic bytes, 4 MB, PDF/DOCX only |
| 25 | Uploaded files served non-executably | **PASS** | `attachment` + `nosniff` + `default-src 'none'; sandbox` |
| 26 | Private file access requires signature **and** session **and** relationship | **PASS** | Three gates on `/api/resumes/[id]/file` |
| 27 | Cron endpoint authenticated, constant-time | **PASS** | `secretEquals()` |
| 28 | Dependency scan — no HIGH or CRITICAL | **PASS** | *was FAIL (6 high)* — now 0 high |
| 29 | Dependency scan — no MODERATE | **FAIL (accepted)** | 5 × esbuild dev-server, devDependency only, documented |
| 30 | No secrets in tracked files | **PASS** | *was FAIL* — `TC-SEC-004-*` |
| 31 | `.env` gitignored and untracked | **PASS** | `TC-SEC-004-env` |
| 32 | **Disclosed credentials rotated** | **FAIL** | **Blocker — only you can do this** |
| 33 | **Repository made private** | **FAIL** | **Blocker — only you can do this** |
| 34 | Demo accounts removed from production | **UNVERIFIED** | Cannot reach the live database |
| 35 | Database TLS enforced | **UNVERIFIED** | `sslmode=require` is in the documented URL; confirm the live value |
| 36 | Rate limiter failure alerting | **FAIL** | No alert on repeated `[ratelimit] check failed` |
| 37 | Anti-virus scanning of uploaded resumes | **FAIL (accepted)** | No AV; mitigated by never executing and never serving inline |
| 38 | Structured audit log of privileged actions | **PASS** | `audit()` on job edits, admin actions, trust blocks |
| 39 | Protected attributes excluded from matching | **PASS** | Build-time guard (`npm run guard`) |
| 40 | Right to erasure / data export implemented | **PASS** | `/api/account/delete`, `/api/account/export` |

¹ PASS with the stated `'unsafe-inline'` compromise on `script-src`. Nonce-based CSP is the follow-up.

### Windows · macOS · iOS · Android

| Control | Status |
|---|---|
| Every mobile and desktop control | **N/A — no such client exists** |

Should a mobile client ever be built, the controls that would then apply and do not yet exist anywhere: certificate pinning, Keychain/Keystore for the session token rather than shared preferences, jailbreak/root detection, screenshot suppression on the resume viewer, and a deep-link handler that validates its input.

---

## 5. What only you can do — in order

**1. Rotate every disclosed credential.** Nothing else on this list matters until this is done.

- Neon → *Reset password* → update `DATABASE_URL` in Vercel **and** local `.env`
- `AUTH_SECRET` → `openssl rand -base64 32` → set in Vercel. *This signs everyone out, which is the point.*
- `CRON_SECRET` → `openssl rand -base64 32` → set in Vercel **and** in the GitHub Actions secret
- RapidAPI → regenerate the key

**2. Make the repository private.** GitHub → Settings → General → Danger Zone → Change visibility.

Rotate *first*. Making it private does not un-publish what was already scraped.

**3. Delete the demo accounts.**

```sql
DELETE FROM users WHERE email LIKE '%@demo.jobsy';
```

**4. Deploy v2.51** — the headers, the throttles and the password policy.

**5. Confirm `sslmode=require` is present in the live `DATABASE_URL`.**

---

## 6. Test coverage added

`npm run test:hardening` — 50 tests, database-free so they run in CI with no secrets attached:

- **SEC-001** (11) — every header present; `frame-ancestors` is `'none'` and not merely set; HSTS is HTTPS-conditional
- **SEC-002** (17) — every declared limit is consumed by some route; the swipe limit is consumed *before* the write
- **SEC-003** (8) — bcrypt cost ≥ 12; 72-byte refusal including multi-byte; blocklist; no composition rules
- **SEC-004** (8) — seven secret shapes across every tracked file; `.env` untracked
- **SEC-005** (6) — regression guards on the controls that were already correct

**Full suite: 964 passed, 0 failed.** Build clean.
