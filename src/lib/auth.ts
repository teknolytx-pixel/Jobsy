import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { eq, or } from "drizzle-orm";
import { db, users, type User } from "@/db";
import { env } from "./env";

const COOKIE = "jobsy_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const secret = () => new TextEncoder().encode(env.authSecret);

export type SessionPayload = { uid: string; email: string };

export async function createSession(userId: string, email: string): Promise<string> {
  return new SignJWT({ uid: userId, email })
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
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.uid !== "string" || typeof payload.email !== "string") return null;
    return { uid: payload.uid, email: payload.email };
  } catch {
    return null;
  }
}

export async function currentUser(): Promise<User | null> {
  const s = await readSession();
  if (!s) return null;
  const rows = await db.select().from(users).where(eq(users.id, s.uid)).limit(1);
  return rows[0] ?? null;
}

export class AuthError extends Error {
  status = 401;
}

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) throw new AuthError("Not signed in");
  return u;
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
