import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, users, termsAcceptances, notificationPrefs } from "@/db";
import { createSession, hashPassword, setSessionCookie } from "@/lib/auth";
import { clientIp, consume, tooMany } from "@/lib/ratelimit";
import { audit } from "@/lib/audit";
import { sendVerification } from "@/lib/verification";
import { newToken, hashToken } from "@/lib/tokens";
import { CURRENT_TERMS, CURRENT_PRIVACY } from "@/lib/legalVersions";
import { stateOf } from "@/lib/compliance/jurisdiction";
import { deliverAedtNotice } from "@/lib/compliance/aedt";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(2, "Please enter your name"),
  /**
   * CAN-001 / REC-001 — chosen once, at signup, and only ever one of two.
   * BOTH is gone: it existed only as the side effect of a candidate posting a
   * job. Platform staff are flagged by isPlatformAdmin, which no request body
   * can reach.
   */
  role: z.enum(["CANDIDATE", "RECRUITER"]).default("CANDIDATE"),
  location: z.string().max(200).optional(),
  /**
   * LEGAL-009 — clickwrap. The UI presents a separate checkbox directly above
   * the Create Account button with matching button text. This field is the
   * server-side half: without it there is no account, so the assent cannot be
   * bypassed by calling the API directly.
   */
  acceptedTerms: z.literal(true, {
    message: "Please accept the Terms of Service and Privacy Policy to continue",
  }),
});

export async function POST(req: Request) {
  const ip = clientIp(req);

  const rl = await consume("signupIp", ip);
  if (!rl.ok) {
    await audit({ action: "auth.rate_limited", detail: { endpoint: "signup" }, ip });
    return tooMany(rl, "Too many accounts created from this network. Please try again later.");
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input", field: parsed.error.issues[0]?.path?.[0] },
      { status: 400 }
    );
  }
  const { email, password, name, role, location } = parsed.data;
  const lower = email.toLowerCase().trim();

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, lower)).limit(1);
  if (existing[0]) {
    return NextResponse.json({ error: "An account with that email already exists" }, { status: 409 });
  }

  const [user] = await db
    .insert(users)
    .values({
      email: lower,
      name: name.trim(),
      passwordHash: await hashPassword(password),
      role,
      location: location?.trim() || null,
      // Used ONLY to select which legal notices apply. Never a matching input.
      jurisdiction: stateOf(location) ?? null,
    })
    .returning();

  // LEGAL-009 AC-5 — record exactly what was accepted, in which version, from
  // where. Without this row there is no evidence of assent, and the arbitration
  // clause binds nobody.
  await db.insert(termsAcceptances).values([
    {
      userId: user.id,
      document: "TERMS_OF_SERVICE",
      version: CURRENT_TERMS,
      ip,
      userAgent: req.headers.get("user-agent")?.slice(0, 1000) ?? null,
    },
    {
      userId: user.id,
      document: "PRIVACY_POLICY",
      version: CURRENT_PRIVACY,
      ip,
      userAgent: req.headers.get("user-agent")?.slice(0, 1000) ?? null,
    },
  ]);

  // NOTIF-001 — defaults, plus the token that makes an unsubscribe link work
  // without a login.
  await db.insert(notificationPrefs).values({
    userId: user.id,
    unsubscribeTokenHash: hashToken(newToken()),
  });

  // XPLAIN-002 — the AEDT notice is delivered at signup, before any automated
  // assessment runs. In NYC it also starts the 10-business-day clock.
  await deliverAedtNotice(user.id, user.jurisdiction);

  await sendVerification(user.id, user.email, user.name);

  await setSessionCookie(await createSession(user.id, user.email, user.sessionVersion));

  await audit({
    action: "auth.signup",
    actorId: user.id,
    subjectType: "user",
    subjectId: user.id,
    detail: { role, jurisdiction: user.jurisdiction },
    ip,
  });
  await audit({
    action: "legal.terms_accepted",
    actorId: user.id,
    subjectType: "user",
    subjectId: user.id,
    detail: { terms: CURRENT_TERMS, privacy: CURRENT_PRIVACY },
    ip,
  });

  return NextResponse.json(
    {
      ok: true,
      userId: user.id,
      role: user.role,
      profileReady: false,
      emailVerified: false,
      message: "Check your email to verify your address.",
    },
    { status: 201 }
  );
}
