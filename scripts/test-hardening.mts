/**
 * SEC-001..003 — the hardening suite.
 *
 * Everything here is deliberately DATABASE-FREE, because these are the tests
 * that must be able to run in CI on a pull request with no secrets attached.
 * A security control that is only verified by a suite needing production-shaped
 * credentials is a control that stops being verified the first time CI is set
 * up properly.
 *
 * Several of these read source files rather than calling functions. That is a
 * conscious choice for a specific class of bug: a rate limit that is DECLARED
 * and never CONSUMED cannot be caught by calling it — it can only be caught by
 * asking "does anything reference this?". That exact bug is what four of these
 * tests exist to prevent recurring, because it had already happened four times.
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
const { checkPassword, MIN_PASSWORD_LENGTH, MAX_PASSWORD_BYTES, passwordLengthOk } = await import(
  "../src/lib/password"
);

let pass = 0;
let fail = 0;
const failures: string[] = [];

async function t(id: string, name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    pass++;
    console.log(`  ✓ ${id}  ${name}`);
  } catch (e) {
    fail++;
    failures.push(`${id}  ${name} — ${(e as Error).message}`);
    console.log(`  ✗ ${id}  ${name}`);
  }
}

const read = (p: string) => readFileSync(p, "utf8");
const srcFiles = execSync("git ls-files 'src/**/*.ts' 'src/**/*.tsx'", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
const allSrc = srcFiles.map(read).join("\n");

console.log("\n─── SEC-001  response security headers ───\n");

await t("TC-SEC-001-01", "a middleware exists to set them", () => {
  assert.ok(existsSync("src/middleware.ts"), "src/middleware.ts is missing — no headers are sent");
});

const mw = existsSync("src/middleware.ts") ? read("src/middleware.ts") : "";

for (const [id, header] of [
  ["02", "Content-Security-Policy"],
  ["03", "X-Frame-Options"],
  ["04", "X-Content-Type-Options"],
  ["05", "Referrer-Policy"],
  ["06", "Permissions-Policy"],
  ["07", "Strict-Transport-Security"],
] as const) {
  await t(`TC-SEC-001-${id}`, `sends ${header}`, () => {
    assert.ok(mw.includes(header), `${header} is not set anywhere in the middleware`);
  });
}

/**
 * The clickjacking test is the one that matters most for this product and so
 * it checks the VALUE, not just the presence. `frame-ancestors 'self'` would
 * pass a presence check and still allow the attack, because the attack does not
 * need a cross-origin frame if any Jobsy page can frame any other.
 */
await t("TC-SEC-001-08", "framing is denied outright, not merely restricted", () => {
  assert.ok(
    mw.includes("frame-ancestors 'none'"),
    "frame-ancestors must be 'none' — the swipe deck is a one-tap irreversible action"
  );
  assert.ok(mw.includes('"X-Frame-Options": "DENY"'), "X-Frame-Options must be DENY for older browsers");
});

await t("TC-SEC-001-09", "the CSP blocks base-tag and off-site form hijacking", () => {
  assert.ok(mw.includes("base-uri 'self'"), "base-uri is unset — a <base> injection re-points every script");
  assert.ok(mw.includes("form-action 'self'"), "form-action is unset — an injected form can post the session off-site");
  assert.ok(mw.includes("object-src 'none'"), "object-src is unset");
});

/**
 * HSTS on a plaintext response is not just useless, it is contrary to RFC 6797
 * §7.2 — and sending it locally makes http://localhost permanently unreachable
 * in the developer's browser, which is a genuinely painful thing to debug.
 */
await t("TC-SEC-001-10", "HSTS is conditional on HTTPS", () => {
  const idx = mw.indexOf("Strict-Transport-Security");
  const before = mw.slice(Math.max(0, idx - 400), idx);
  assert.ok(
    /x-forwarded-proto|https/.test(before),
    "HSTS appears to be sent unconditionally; it must be gated on the request being HTTPS"
  );
});

await t("TC-SEC-001-11", "static assets are excluded from the matcher", () => {
  assert.ok(mw.includes("_next/static"), "the matcher does not exclude _next/static");
});

console.log("\n─── SEC-002  every declared rate limit is actually consumed ───\n");

/**
 * The bug this catches: `swipeDaily`, `recruiterSwipeDaily`, `search` and
 * `sourceSync` were all defined in LIMITS and never once passed to consume().
 * They read as enforced in review and enforced nothing at runtime.
 */
const consumed = new Set(
  [...allSrc.matchAll(/consume\(\s*"([a-zA-Z]+)"/g)].map((m) => m[1]!)
);
// The swipe route picks its limit with a ternary, so both names appear as
// string literals rather than inside a consume( call.
for (const m of allSrc.matchAll(/"(swipeDaily|recruiterSwipeDaily)"/g)) consumed.add(m[1]!);

/**
 * The limit names are read from the SOURCE of ratelimit.ts rather than
 * imported, so this suite never touches the database client. A CI-safe test is
 * one that runs on a pull request with no secrets attached.
 */
const declaredLimits = [
  ...readFileSync("src/lib/ratelimit.ts", "utf8")
    .split("export const LIMITS")[1]!
    .split("} as const satisfies")[0]!
    .matchAll(/^\s{2}([a-zA-Z]+):\s*\{\s*max:/gm),
].map((m) => m[1]!);

await t("TC-SEC-002-parse", "the limit table was parsed", () => {
  assert.ok(declaredLimits.length >= 10, `only found ${declaredLimits.length} limits`);
});

for (const name of declaredLimits) {
  await t(`TC-SEC-002-${name}`, `LIMITS.${name} is referenced by a route`, () => {
    assert.ok(
      consumed.has(name),
      `LIMITS.${name} is declared but never consumed — it enforces nothing`
    );
  });
}

await t("TC-SEC-002-deck", "the deck endpoint is throttled", () => {
  assert.ok(
    read("src/app/api/deck/route.ts").includes('consume("search"'),
    "the deck returns candidate profiles and must be throttled against bulk export"
  );
});

await t("TC-SEC-002-swipe", "the swipe endpoint throttles before it records", () => {
  const s = read("src/app/api/swipe/route.ts");
  const rl = s.indexOf("consume(");
  const write = Math.min(
    ...["recruiterSwipe(", "candidateSwipe("].map((k) => {
      const i = s.indexOf(k);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    })
  );
  assert.ok(rl > -1, "the swipe route consumes no limit");
  assert.ok(rl < write, "the limit is consumed after the swipe is recorded — a refused swipe is a free probe");
});

await t("TC-SEC-002-sync", "the outbound-crawl endpoint is throttled", () => {
  assert.ok(
    read("src/app/api/sources/sync-all/route.ts").includes('consume("sourceSync"'),
    "sync-all issues bulk outbound requests and must be throttled"
  );
});

console.log("\n─── SEC-003  password storage and policy ───\n");

await t("TC-SEC-003-01", "bcrypt cost is at least 12", () => {
  const cost = Number(read("src/lib/auth.ts").match(/BCRYPT_COST = (\d+)/)?.[1]);
  assert.ok(Number.isFinite(cost), "BCRYPT_COST is not declared");
  assert.ok(cost >= 12, `bcrypt cost is ${cost}; 12 is the current floor`);
});

await t("TC-SEC-003-02", "bcrypt's 72-byte truncation is refused, not hidden", () => {
  assert.equal(MAX_PASSWORD_BYTES, 72);
  assert.equal(passwordLengthOk("a".repeat(72)), true);
  assert.equal(passwordLengthOk("a".repeat(73)), false);
  // Multi-byte characters count as bytes, which is the whole point.
  assert.equal(passwordLengthOk("é".repeat(37)), false, "74 bytes of accented text must be refused");
});

await t("TC-SEC-003-03", "a long password never silently verifies against its prefix", () => {
  // Two distinct passwords sharing a 72-byte prefix must not both be accepted.
  const base = "x".repeat(72);
  assert.equal(passwordLengthOk(base + "AAAA"), false);
  assert.equal(passwordLengthOk(base + "BBBB"), false);
});

await t("TC-SEC-003-04", `the floor is ${MIN_PASSWORD_LENGTH} characters`, () => {
  assert.equal(checkPassword("a".repeat(MIN_PASSWORD_LENGTH - 1)).ok, false);
  assert.equal(checkPassword("correct horse battery").ok, true);
});

await t("TC-SEC-003-05", "leaked-list passwords are refused", () => {
  for (const pw of ["password12", "Password123", "qwertyuiop", "letmein123", "iloveyou11"]) {
    assert.equal(checkPassword(pw).ok, false, `${pw} was accepted`);
  }
});

await t("TC-SEC-003-06", "repeats and straight sequences are refused", () => {
  assert.equal(checkPassword("aaaaaaaaaaaa").ok, false);
  assert.equal(checkPassword("1234567890").ok, false);
});

/**
 * NIST SP 800-63B §5.1.1.2 is explicit that composition rules should not be
 * imposed. This test exists so nobody "improves" the policy by adding them.
 */
await t("TC-SEC-003-07", "no composition rules are imposed", () => {
  const ok = checkPassword("all lowercase words here");
  assert.equal(ok.ok, true, "a long all-lowercase passphrase must be accepted (NIST SP 800-63B)");
});

await t("TC-SEC-003-08", "signup and reset share one policy", () => {
  for (const p of ["src/app/api/auth/signup/route.ts", "src/app/api/auth/reset/route.ts"]) {
    const s = read(p);
    assert.ok(s.includes("passwordField"), `${p} does not use the shared password policy`);
    assert.ok(
      !/password:\s*z\.string\(\)\.min\(/.test(s),
      `${p} still carries its own inline password rule — the two will drift`
    );
  }
});

console.log("\n─── SEC-004  no live secret is committed ───\n");

/**
 * The finding this locks down: the live Neon password was sitting in
 * PRODUCTION.md, in a PUBLIC repository, inside the very table telling the
 * reader to rotate it.
 */
const tracked = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
const SECRET_SHAPES: [string, RegExp][] = [
  ["Neon/Postgres password", /npg_(?=[A-Za-z0-9]{8,})(?=[a-z0-9]*[a-z])(?=[A-Za-z]*[0-9])[A-Za-z0-9]{8,}/],
  ["RapidAPI key", /[0-9a-f]{12}msh[0-9a-f]{10,}/],
  ["OpenAI-style key", /\bsk-[A-Za-z0-9_-]{20,}/],
  ["AWS access key id", /\bAKIA[0-9A-Z]{16}\b/],
  ["Vercel blob token", /vercel_blob_rw_[A-Za-z0-9_]{20,}/],
  ["Resend key", /\bre_[A-Za-z0-9]{24,}/],
  ["assigned secret in a doc", /(AUTH_SECRET|CRON_SECRET)\s*=\s*["']?[A-Za-z0-9+/=]{16,}/],
];

for (const [label, re] of SECRET_SHAPES) {
  await t(`TC-SEC-004-${label.slice(0, 12)}`, `no ${label} in any tracked file`, () => {
    const hits: string[] = [];
    for (const f of tracked) {
      if (f.startsWith("scripts/test-hardening")) continue; // this file holds the patterns
      let body: string;
      try {
        body = read(f);
      } catch {
        continue;
      }
      const m = body.match(re);
      // `npg_NEWVALUE`, `sk-YOUR_KEY_HERE` and friends are instructions, not
      // secrets. A scanner that cannot tell the difference gets switched off.
      if (m && !/NEWVALUE|YOUR|EXAMPLE|PLACEHOLDER|REPLACE|xxxx|\.\.\./i.test(m[0])) hits.push(f);
    }
    assert.deepEqual(hits, [], `possible ${label} committed in: ${hits.join(", ")}`);
  });
}

await t("TC-SEC-004-env", ".env is not tracked", () => {
  assert.ok(!tracked.includes(".env"), ".env is committed — every secret in it is public");
  assert.ok(read(".gitignore").split("\n").includes(".env"), ".env is not gitignored");
});

console.log("\n─── SEC-005  the controls that were already right stay right ───\n");

await t("TC-SEC-005-01", "the JWT algorithm is pinned on verification", () => {
  assert.ok(
    read("src/lib/auth.ts").includes('algorithms: ["HS256"]'),
    "jwtVerify must pin the algorithm or an alg-confusion token is accepted"
  );
});

await t("TC-SEC-005-02", "the session cookie is httpOnly and sameSite", () => {
  const s = read("src/lib/auth.ts");
  assert.ok(s.includes("httpOnly: true"));
  assert.ok(s.includes('sameSite: "lax"'));
  assert.ok(s.includes('secure: process.env.NODE_ENV === "production"'));
});

await t("TC-SEC-005-03", "resumes are served as attachments with nosniff", () => {
  const s = read("src/app/api/resumes/[id]/file/route.ts");
  assert.ok(s.includes("attachment;"), "a resume served inline runs in our origin");
  assert.ok(s.includes("X-Content-Type-Options"));
});

await t("TC-SEC-005-04", "no route sets a permissive CORS header", () => {
  assert.ok(
    !/Access-Control-Allow-Origin["']?\s*[:,]\s*["']\*/.test(allSrc),
    "a wildcard CORS header would make every cookie-authenticated route readable cross-origin"
  );
});

/**
 * Every `dangerouslySetInnerHTML` must be either escaped through safeJsonLd /
 * escapeXml, or an ALL-CAPS module constant — a literal written in the file
 * itself, with no interpolation and nothing user-supplied reaching it.
 *
 * The constant carve-out exists for exactly one case: the anti-flash theme
 * script in layout.tsx, which has to run synchronously in <head> before first
 * paint and therefore cannot be a React effect or an external file. Naming the
 * shape (SCREAMING_CASE identifier, no template literal) keeps the exemption
 * narrow — a variable holding a request value cannot accidentally qualify.
 */
await t("TC-SEC-005-05", "every dangerouslySetInnerHTML is escaped or a vetted constant", () => {
  const uses = srcFiles.filter((f) => read(f).includes("dangerouslySetInnerHTML"));
  for (const f of uses) {
    const s = read(f);
    for (const m of s.matchAll(/dangerouslySetInnerHTML=\{\{\s*__html:\s*([^}]+)\}\}/g)) {
      const expr = m[1]!.trim();
      const escaped = /safeJsonLd|escapeXml/.test(expr);
      const vettedConstant = /^[A-Z][A-Z0-9_]*$/.test(expr);
      assert.ok(
        escaped || vettedConstant,
        `${f} injects raw HTML (${expr}) without escaping it or using a vetted constant`
      );
      if (vettedConstant) {
        const decl = new RegExp(`const\\s+${expr}\\s*=\\s*\`([^\`]*)\``).exec(s);
        assert.ok(decl, `${f}: ${expr} is not a plain template literal in this file`);
        assert.ok(
          !decl![1]!.includes("${"),
          `${f}: ${expr} interpolates a value — that is not a constant, it is injection`
        );
      }
    }
  }
});

await t("TC-SEC-005-06", "the SSRF guard is applied, not merely present", () => {
  const discovery = read("src/lib/discovery.ts");
  assert.ok(discovery.includes("safeFetch"), "discovery.ts fetches user-supplied URLs without the guard");
});

console.log(`\n${pass} passed, ${fail} failed  —  hardening suite\n`);
if (fail) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
process.exit(0);
