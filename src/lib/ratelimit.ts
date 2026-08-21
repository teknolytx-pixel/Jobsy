import { and, lt, sql } from "drizzle-orm";
import { db, rateLimits } from "@/db";

/**
 * AUTH-009 — rate limiting.
 *
 * The live deployment previously had none, which left credential stuffing
 * completely unimpeded.
 *
 * Why Postgres and not an in-memory counter: this runs on Vercel, where every
 * request may hit a different stateless instance. A module-level Map would
 * silently enforce nothing — the worst kind of security control, because it
 * looks like it works. Postgres gives a counter that is correct across every
 * instance. Swap in Redis when write volume justifies it; the interface below
 * does not change.
 *
 * Fixed window rather than sliding: an attacker can burst 2× the limit across a
 * window boundary. That is an accepted trade for one round trip and no sorted
 * sets. The limits below are set low enough that 2× is still not useful.
 */

export type Limit = { max: number; windowSec: number };

export const LIMITS = {
  loginIp: { max: 10, windowSec: 900 },
  loginEmail: { max: 5, windowSec: 900 },
  signupIp: { max: 5, windowSec: 3600 },
  resetEmail: { max: 5, windowSec: 3600 },
  verifySend: { max: 3, windowSec: 3600 },
  write: { max: 100, windowSec: 60 },
  report: { max: 10, windowSec: 60 },
  sourceSync: { max: 1, windowSec: 600 },
  search: { max: 60, windowSec: 60 },
  swipeDaily: { max: 100, windowSec: 86_400 },
  recruiterSwipeDaily: { max: 200, windowSec: 86_400 },
  urlImport: { max: 20, windowSec: 3600 },
  /**
   * RES-005 — AI polish, per candidate, per hour.
   *
   * Tight because each call is a burst of one-request-per-bullet against a free
   * tier shared by every user of this deployment. A candidate polishing the same
   * resume forty times in an afternoon would exhaust the quota for everyone
   * else, and the deterministic builder is already the thing doing the work.
   */
  resumePolish: { max: 6, windowSec: 3600 },
} as const satisfies Record<string, Limit>;

export type RateResult = {
  ok: boolean;
  remaining: number;
  /** Seconds until the window resets. Sent as Retry-After. */
  retryAfter: number;
};

/**
 * Consume one unit against `name:identifier`.
 *
 * The window number is baked into the primary key, so a new window is a new
 * row and no cleanup is needed for correctness — only for table size, which
 * `sweepRateLimits` handles.
 */
export async function consume(
  name: keyof typeof LIMITS,
  identifier: string,
  overrides?: Partial<Limit>
): Promise<RateResult> {
  const limit = { ...LIMITS[name], ...overrides };
  const now = Date.now();
  const windowIndex = Math.floor(now / (limit.windowSec * 1000));
  const key = `${name}:${identifier}:${windowIndex}`.slice(0, 191);
  const expiresAt = new Date((windowIndex + 1) * limit.windowSec * 1000);

  try {
    const [row] = await db
      .insert(rateLimits)
      .values({ key, count: 1, expiresAt })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: { count: sql`${rateLimits.count} + 1` },
      })
      .returning({ count: rateLimits.count });

    const used = row?.count ?? 1;
    return {
      ok: used <= limit.max,
      remaining: Math.max(0, limit.max - used),
      retryAfter: Math.max(1, Math.ceil((expiresAt.getTime() - now) / 1000)),
    };
  } catch (e) {
    // Fail OPEN, deliberately. A rate limiter that takes the site down when the
    // database hiccups is a worse outcome than a brief window of unthrottled
    // requests — and every throttled endpoint has a second line of defence
    // (generic auth errors, hashed single-use tokens, ownership checks).
    console.error("[ratelimit] check failed, allowing request:", (e as Error).message);
    return { ok: true, remaining: limit.max, retryAfter: 0 };
  }
}

/** Read the caller's IP from the proxy headers Vercel sets. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/** 429 with a Retry-After header. */
export function tooMany(r: RateResult, message = "Too many requests. Please try again shortly.") {
  return new Response(JSON.stringify({ error: message, retryAfter: r.retryAfter }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(r.retryAfter),
    },
  });
}

/** Housekeeping — called by the daily cron. Purely for table size. */
export async function sweepRateLimits(): Promise<number> {
  const res = await db.delete(rateLimits).where(lt(rateLimits.expiresAt, new Date())).returning({
    key: rateLimits.key,
  });
  return res.length;
}

export { and };
