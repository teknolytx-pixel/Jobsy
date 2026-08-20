import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, users } from "@/db";
import { createSession, setSessionCookie, verifyPassword } from "@/lib/auth";
import { clientIp, consume, tooMany } from "@/lib/ratelimit";
import { audit } from "@/lib/audit";

const Body = z.object({ email: z.string().email(), password: z.string().min(1) });

/**
 * AUTH-002 — sign in.
 *
 * Two properties this route has to hold, both of them about not leaking which
 * addresses have accounts:
 *
 *  1. An identical response for "wrong password" and "no such account". A job
 *     board's user list is exactly what a spammer wants, and a distinguishable
 *     error hands it over an address at a time.
 *
 *  2. Comparable response TIME. Returning early when the user is absent skips
 *     bcrypt, and bcrypt at cost 10 is ~100ms — a difference anyone can measure
 *     from a browser. So we compare against a dummy hash instead, and burn the
 *     same work whether or not the account exists.
 */

// bcrypt hash of a random string nobody holds. Only ever compared against, so
// its plaintext is irrelevant — what matters is that verifying it costs the
// same as verifying a real one.
const DUMMY_HASH = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

const GENERIC = "Incorrect email or password";

export async function POST(req: Request) {
  const ip = clientIp(req);

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: GENERIC }, { status: 401 });
  const email = parsed.data.email.toLowerCase().trim();

  // AC-1/2 — per IP and per account. Per-account matters independently: an
  // attacker with a botnet defeats per-IP limiting trivially, but cannot spread
  // attempts against one address across it.
  const byIp = await consume("loginIp", ip);
  const byEmail = await consume("loginEmail", email);
  if (!byIp.ok || !byEmail.ok) {
    await audit({
      action: "auth.rate_limited",
      detail: { endpoint: "login", byIp: !byIp.ok, byEmail: !byEmail.ok },
      ip,
    });
    return tooMany(byIp.ok ? byEmail : byIp);
  }

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];

  // Always run a comparison. AC-5: an account created through LinkedIn has a
  // null password_hash, and must not crash here or be distinguishable.
  const ok = await verifyPassword(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);

  // AUTH-012 — an account that has been closed must not sign back in during the
  // 30-day window before the purge runs. Checking only `deletedAt` let a closed
  // account log straight back in, which defeats the point of closing it.
  // Found by TC-AUTH-012-12.
  if (!user || !user.passwordHash || !ok || user.deletedAt || user.deletionRequestedAt) {
    await audit({ action: "auth.login.failed", detail: { email }, ip });
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }

  if (user.suspendedAt) {
    // A suspended account is told, because the person needs to know why they
    // cannot get in and how to reach us. This is not an enumeration concern:
    // the correct password was already supplied.
    return NextResponse.json(
      {
        error: "This account has been suspended. Contact support if you think that's a mistake.",
        code: "SUSPENDED",
      },
      { status: 403 }
    );
  }

  await setSessionCookie(await createSession(user.id, user.email, user.sessionVersion));
  await audit({
    action: "auth.login.success",
    actorId: user.id,
    subjectType: "user",
    subjectId: user.id,
    ip,
  });

  return NextResponse.json({
    ok: true,
    userId: user.id,
    role: user.role,
    profileReady: user.profileReady,
    emailVerified: user.emailVerified,
  });
}
