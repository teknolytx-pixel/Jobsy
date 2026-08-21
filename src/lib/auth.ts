import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { eq, or, sql } from "drizzle-orm";
import { db, users, type User } from "@/db";
import { env } from "./env";

const COOKIE = "jobsy_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const secret = () => new TextEncoder().encode(env.authSecret);

export type SessionPayload = { uid: string; email: string; sv: number };

/**
 * AUTH-008 — the `sv` claim is the user's session_version at issue time.
 *
 * Verification rejects any token whose claim is below the row's current value,
 * so incrementing the column revokes every outstanding session on the very next
 * request. No deploy, no cache flush, no session table to sweep. Password reset,
 * password change and admin suspension all increment it.
 */
export async function createSession(
  userId: string,
  email: string,
  sessionVersion = 0
): Promise<string> {
  return new SignJWT({ uid: userId, email, sv: sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function readSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    // Pinning the algorithm is what stops an `alg: none` or algorithm-confusion
    // token from being accepted. jose defaults are sane, but this is explicit.
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (typeof payload.uid !== "string" || typeof payload.email !== "string") return null;
    return {
      uid: payload.uid,
      email: payload.email,
      // Tokens issued before AUTH-008 have no `sv`; treat them as version 0,
      // which is the default on every existing row, so they keep working until
      // the first revocation.
      sv: typeof payload.sv === "number" ? payload.sv : 0,
    };
  } catch {
    return null;
  }
}

export async function currentUser(): Promise<User | null> {
  const s = await readSession();
  if (!s) return null;
  const rows = await db.select().from(users).where(eq(users.id, s.uid)).limit(1);
  const user = rows[0];
  if (!user) return null;

  // AUTH-008 — a stale session version means the session was revoked.
  if (s.sv < user.sessionVersion) return null;

  // A suspended, closed or deleted account has no session, whatever the cookie
  // says. `deletionRequestedAt` matters as much as `deletedAt`: closure is
  // effective immediately from the user's point of view, and the purge that
  // sets `deletedAt` does not run for 30 days.
  if (user.suspendedAt || user.deletedAt || user.deletionRequestedAt) return null;

  return user;
}

export class AuthError extends Error {
  status = 401;
}

export class ForbiddenError extends Error {
  status = 403;
  code: string;
  constructor(message: string, code = "FORBIDDEN") {
    super(message);
    this.code = code;
  }
}

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) throw new AuthError("Not signed in");
  return u;
}

/**
 * AUTH-006 AC-5/6 — gate the actions that must not be available to an
 * unverified address: posting a job, messaging a match, and appearing in a
 * recruiter's deck.
 *
 * LinkedIn OIDC accounts arrive verified, because LinkedIn asserts a verified
 * email in the userinfo response.
 */
export async function requireVerifiedUser(): Promise<User> {
  const u = await requireUser();
  if (!u.emailVerified) {
    throw new ForbiddenError(
      "Please verify your email address before doing this. Check your inbox, or request a new link from your profile.",
      "EMAIL_NOT_VERIFIED"
    );
  }
  return u;
}

/**
 * AUTH-002 / JOB-001 / BR-001 — the candidate/recruiter boundary.
 *
 * An account is one thing or the other, permanently. This is not a UI
 * convention: it is the rule the spec states as a P0 business rule, and before
 * this existed a candidate could reach /recruiter, post a job, and be silently
 * promoted to a dual role by the posting endpoint itself.
 *
 * `isPlatformAdmin` is the ONLY bypass, and it is deliberately a separate
 * boolean rather than a third value in the role enum — an admin is staff, not a
 * kind of user, and conflating the two is how "admin" ends up meaning
 * "recruiter with extra buttons".
 */
export type AppRole = "CANDIDATE" | "RECRUITER";

export function hasRole(u: Pick<User, "role" | "isPlatformAdmin">, role: AppRole): boolean {
  if (u.isPlatformAdmin) return true;
  return u.role === role;
}

const WRONG_ROLE_MESSAGE: Record<AppRole, string> = {
  RECRUITER:
    "This is a job seeker account. Posting and sourcing need a separate employer account.",
  CANDIDATE:
    "This is an employer account. Applying for roles needs a separate job seeker account.",
};

/**
 * API-side gate. Throws ForbiddenError with a stable code so callers get a 403
 * and a message that explains the boundary rather than just refusing.
 */
export async function requireRole(role: AppRole): Promise<User> {
  const u = await requireUser();
  if (!hasRole(u, role)) {
    throw new ForbiddenError(WRONG_ROLE_MESSAGE[role], "WRONG_ACCOUNT_TYPE");
  }
  return u;
}

export const wrongRoleMessage = (role: AppRole) => WRONG_ROLE_MESSAGE[role];

/** ADMIN-001 — platform staff, distinct from any company role. */
export async function requirePlatformAdmin(): Promise<User> {
  const u = await requireUser();
  if (!u.isPlatformAdmin) throw new ForbiddenError("Administrator access required", "ADMIN_ONLY");
  return u;
}

/** Increment session_version, revoking every outstanding session for a user. */
export async function revokeSessions(userId: string): Promise<number> {
  const [row] = await db
    .update(users)
    .set({ sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ sv: users.sessionVersion });
  return row?.sv ?? 0;
}

/** Map any auth error to a JSON response with a stable machine-readable code. */
export function authErrorResponse(e: unknown): Response | null {
  if (e instanceof ForbiddenError) {
    return Response.json({ error: e.message, code: e.code }, { status: 403 });
  }
  if (e instanceof AuthError) {
    return Response.json({ error: e.message, code: "UNAUTHENTICATED" }, { status: 401 });
  }
  return null;
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

// ─────────────────────────────────────────────────────────────
// LinkedIn — "Sign In with LinkedIn using OpenID Connect"
//
// This is the ONLY LinkedIn tier available self-serve. Request the product on
// your app's Products tab; approval is automatic. Scopes: openid profile email.
//
// /v2/userinfo returns:
//   { sub, name, given_name, family_name, picture, locale, email, email_verified }
//
// It does NOT return work history, education, skills, connections, job
// postings, or candidate search. Those are Talent Solutions APIs — partner-
// gated, and LinkedIn is not accepting new Job Posting API partners. See README.
// ─────────────────────────────────────────────────────────────
const LI_AUTH = "https://www.linkedin.com/oauth/v2/authorization";
const LI_TOKEN = "https://www.linkedin.com/oauth/v2/accessToken";
const LI_USERINFO = "https://api.linkedin.com/v2/userinfo";

export const linkedinRedirectUri = () => `${env.appUrl}/api/auth/linkedin/callback`;

export function linkedinAuthUrl(state: string): string {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: env.linkedin.clientId!,
    redirect_uri: linkedinRedirectUri(),
    state,
    scope: "openid profile email",
  });
  return `${LI_AUTH}?${p.toString()}`;
}

export type LinkedInProfile = {
  sub: string;
  name: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  email?: string;
  email_verified?: boolean;
};

export async function exchangeLinkedInCode(code: string): Promise<LinkedInProfile> {
  const tokenRes = await fetch(LI_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: linkedinRedirectUri(),
      client_id: env.linkedin.clientId!,
      client_secret: env.linkedin.clientSecret!,
    }),
    cache: "no-store",
  });

  if (!tokenRes.ok) {
    throw new Error(`LinkedIn token exchange failed (${tokenRes.status}): ${await tokenRes.text()}`);
  }
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const meRes = await fetch(LI_USERINFO, {
    headers: { Authorization: `Bearer ${access_token}` },
    cache: "no-store",
  });
  if (!meRes.ok) throw new Error(`LinkedIn userinfo failed (${meRes.status}): ${await meRes.text()}`);

  return (await meRes.json()) as LinkedInProfile;
}

/** Link to an existing account by email, or create one. */
export async function upsertUserFromLinkedIn(p: LinkedInProfile): Promise<User> {
  const email = p.email?.toLowerCase();
  if (!email) {
    throw new Error(
      "LinkedIn did not return an email. Ensure the 'email' scope is granted on your LinkedIn app."
    );
  }

  const found = await db
    .select()
    .from(users)
    .where(or(eq(users.linkedinSub, p.sub), eq(users.email, email)))
    .limit(1);
  const existing = found[0];

  if (existing) {
    const [updated] = await db
      .update(users)
      .set({
        linkedinSub: p.sub,
        linkedinLinkedAt: new Date(),
        image: existing.image ?? p.picture ?? null,
        name: existing.name || p.name,
        emailVerified: existing.emailVerified || Boolean(p.email_verified),
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(users)
    .values({
      email,
      name: p.name || [p.given_name, p.family_name].filter(Boolean).join(" ") || email,
      image: p.picture ?? null,
      linkedinSub: p.sub,
      linkedinLinkedAt: new Date(),
      emailVerified: Boolean(p.email_verified),
      role: "CANDIDATE",
    })
    .returning();
  return created;
}
