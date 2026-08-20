import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, emailTokens, type TokenPurpose } from "@/db";

/**
 * AUTH-006 / AUTH-007 / SEAT-002 / COMP-003 — single-use, expiring tokens.
 *
 * The raw token is returned to the caller exactly once, to put in an email, and
 * is never stored. Only its SHA-256 hash goes to the database. A stolen
 * database dump therefore cannot be used to verify an email address, reset a
 * password, or join a company.
 *
 * SHA-256 rather than bcrypt is correct here: these are 256 bits of CSPRNG
 * output, not a human-chosen password, so there is nothing for an offline
 * attacker to guess. bcrypt would only make lookup slow.
 */

export const TTL = {
  VERIFY_EMAIL: 24 * 60 * 60,
  RESET_PASSWORD: 60 * 60,
  COMPANY_INVITE: 7 * 24 * 60 * 60,
  DOMAIN_VERIFY: 7 * 24 * 60 * 60,
  UNSUBSCRIBE: 0, // never expires
} as const;

export const hashToken = (raw: string) => createHash("sha256").update(raw).digest("hex");

export const newToken = () => randomBytes(32).toString("base64url");

export type IssueArgs = {
  purpose: TokenPurpose;
  userId?: string | null;
  email?: string | null;
  context?: Record<string, unknown>;
  ttlSec?: number;
};

/** Issue a token and return the RAW value. Store the hash; email the raw. */
export async function issueToken(a: IssueArgs): Promise<{ raw: string; id: string }> {
  const raw = newToken();
  const ttl = a.ttlSec ?? TTL[a.purpose];
  const [row] = await db
    .insert(emailTokens)
    .values({
      userId: a.userId ?? null,
      email: a.email?.toLowerCase() ?? null,
      tokenHash: hashToken(raw),
      purpose: a.purpose,
      context: a.context ?? null,
      // A zero TTL means "no expiry"; represent it as a far-future date rather
      // than a nullable column so every query can use the same predicate.
      expiresAt: new Date(Date.now() + (ttl || 100 * 365 * 24 * 60 * 60) * 1000),
    })
    .returning({ id: emailTokens.id });
  return { raw, id: row!.id };
}

export type ConsumeOutcome =
  | { ok: true; userId: string | null; email: string | null; context: Record<string, unknown> | null }
  | { ok: false; reason: "NOT_FOUND" | "USED" | "EXPIRED" };

/**
 * Atomically consume a token.
 *
 * The UPDATE ... WHERE consumed_at IS NULL is what makes this single-use under
 * concurrency: two simultaneous clicks on the same link produce one success and
 * one USED, not two successes.
 */
export async function consumeToken(raw: string, purpose: TokenPurpose): Promise<ConsumeOutcome> {
  if (!raw) return { ok: false, reason: "NOT_FOUND" };
  const hash = hashToken(raw);

  const found = await db
    .select()
    .from(emailTokens)
    .where(and(eq(emailTokens.tokenHash, hash), eq(emailTokens.purpose, purpose)))
    .limit(1);
  const row = found[0];
  if (!row) return { ok: false, reason: "NOT_FOUND" };
  if (row.consumedAt) return { ok: false, reason: "USED" };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: "EXPIRED" };

  const claimed = await db
    .update(emailTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(emailTokens.id, row.id),
        isNull(emailTokens.consumedAt),
        gt(emailTokens.expiresAt, new Date())
      )
    )
    .returning({ id: emailTokens.id });

  if (!claimed[0]) return { ok: false, reason: "USED" };
  return {
    ok: true,
    userId: row.userId,
    email: row.email,
    context: (row.context as Record<string, unknown> | null) ?? null,
  };
}

/**
 * Invalidate every outstanding token of a purpose for a user.
 *
 * Called when a new one is issued, so re-sending an invitation or a reset link
 * kills the previous one — otherwise every link ever emailed stays live for its
 * full TTL, and a forwarded old email is an account takeover.
 */
export async function revokeTokens(purpose: TokenPurpose, userId: string): Promise<void> {
  await db
    .update(emailTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(emailTokens.purpose, purpose),
        eq(emailTokens.userId, userId),
        isNull(emailTokens.consumedAt)
      )
    );
}

/** Constant-time compare for secrets held in env (CRON_SECRET). */
export function secretEquals(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    // Still burn a comparison so length is not learnable from timing.
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}
