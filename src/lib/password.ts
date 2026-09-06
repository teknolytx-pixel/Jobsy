import { z } from "zod";

/**
 * bcrypt silently truncates at 72 BYTES. A 200-character passphrase is really
 * protected by its first 72 characters, and — worse — two different long
 * passphrases sharing a 72-byte prefix ARE the same password to bcrypt.
 * Refusing the input is honest; truncating it quietly is not.
 *
 * This lives here rather than in auth.ts so that the policy can be imported —
 * and tested — without dragging in the database client.
 */
export const MAX_PASSWORD_BYTES = 72;

export class PasswordTooLongError extends Error {
  status = 400;
  constructor() {
    super(
      `Please use a password of ${MAX_PASSWORD_BYTES} characters or fewer. Longer ones get silently cut short by the algorithm that stores them, which would leave your account less protected than it looks.`
    );
  }
}

export function passwordLengthOk(pw: string): boolean {
  return Buffer.byteLength(pw, "utf8") <= MAX_PASSWORD_BYTES;
}

/**
 * SEC-003 — one password policy, in one place.
 *
 * Signup and reset each carried their own `z.string().min(8)`. Two copies of a
 * rule is one rule and one bug waiting: strengthen signup, forget reset, and
 * every account can still be walked back down to a weak password through the
 * forgotten-password flow. This module is now the only definition, and both
 * routes import it.
 *
 * ── What is enforced, and what deliberately is not ──
 *
 * NIST SP 800-63B is explicit that composition rules — "one uppercase, one
 * digit, one symbol" — should NOT be imposed. They push people toward
 * `Password1!` and toward writing it down, and they measurably reduce entropy
 * rather than raising it. So there are none here.
 *
 * What SP 800-63B does call for is a length floor, a generous ceiling, and a
 * check against known-compromised values. The floor is 10 rather than 8:
 * eight characters is inside the range a commodity GPU exhausts, and the
 * strongest single predictor of account takeover on a small site is not
 * password shape but password reuse.
 *
 * ── The blocklist ──
 *
 * A local list, not an API call. Have I Been Pwned's range API is the better
 * dataset by a wide margin, and it is the right upgrade once there is a budget
 * for an outbound call on the signup path — but a blocklist that depends on a
 * third party being reachable fails open on exactly the request where it
 * matters, and adds a network round trip to the slowest endpoint in the app.
 * This catches the passwords that actually appear at the top of every credential
 * dump, which is where the volume is.
 *
 * Comparison is case-insensitive and strips trailing digits, because
 * `Password123` is not meaningfully different from `password`.
 */

export const MIN_PASSWORD_LENGTH = 10;

const COMMON = new Set([
  "password",
  "passw0rd",
  "letmein",
  "welcome",
  "qwerty",
  "qwertyuiop",
  "iloveyou",
  "admin",
  "administrator",
  "abc",
  "abcd",
  "monkey",
  "dragon",
  "football",
  "baseball",
  "sunshine",
  "princess",
  "superman",
  "trustno",
  "changeme",
  "secret",
  "master",
  "login",
  "starwars",
  "whatever",
  "jobsy",
  "recruiter",
  "candidate",
]);

/** Lowercased, punctuation stripped — the form the sequence checks judge. */
function flatten(pw: string): string {
  return pw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Reduce a candidate password to the shape the BLOCKLIST should judge.
 *
 * Trailing digits come off because `password123` is not meaningfully different
 * from `password` — it is the single most common way people satisfy a
 * composition rule without adding any entropy at all.
 */
function normalize(pw: string): string {
  return flatten(pw).replace(/[0-9]+$/, "");
}

/** Every character one step from the last, up or down: abcdefghij, 9876543210. */
function isRun(s: string): boolean {
  if (s.length < 6) return false;
  const step = s.charCodeAt(1) - s.charCodeAt(0);
  if (step !== 1 && step !== -1) return false;
  for (let i = 2; i < s.length; i++) {
    if (s.charCodeAt(i) - s.charCodeAt(i - 1) !== step) return false;
  }
  return true;
}

export type PasswordVerdict = { ok: true } | { ok: false; reason: string };

export function checkPassword(pw: string): PasswordVerdict {
  if (pw.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      reason: `Please use at least ${MIN_PASSWORD_LENGTH} characters. A few ordinary words in a row is easier to remember than a short scramble, and much harder to guess.`,
    };
  }
  if (Buffer.byteLength(pw, "utf8") > MAX_PASSWORD_BYTES) {
    return {
      ok: false,
      reason: `Please use ${MAX_PASSWORD_BYTES} characters or fewer — longer passwords get silently cut short when stored, which would leave your account less protected than it looks.`,
    };
  }

  const n = normalize(pw);
  if (COMMON.has(n)) {
    return {
      ok: false,
      reason: "That password appears in every published list of leaked passwords. Please choose another.",
    };
  }

  // A single repeated character, or a straight run off the keyboard.
  if (/^(.)\1+$/.test(pw)) {
    return { ok: false, reason: "That's the same character repeated. Please choose something else." };
  }
  // Judged on the flattened form, NOT the blocklist form: `normalize` strips
  // trailing digits, so "1234567890" reduces to the empty string and every
  // sequence check silently passed. Caught by TC-SEC-003-06.
  const f = flatten(pw);
  if (/^(?:0123456789|1234567890|abcdefghij|qwertyuiop)/.test(f) || isRun(f)) {
    return { ok: false, reason: "That's a straight sequence. Please choose something else." };
  }

  return { ok: true };
}

/** The zod field used by every route that accepts a new password. */
export const passwordField = () =>
  z.string().superRefine((pw, ctx) => {
    const v = checkPassword(pw);
    if (!v.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: v.reason });
  });
