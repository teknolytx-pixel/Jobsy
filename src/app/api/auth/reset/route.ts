import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, users } from "@/db";
import { env } from "@/lib/env";
import { consumeToken, issueToken, revokeTokens } from "@/lib/tokens";
import { sendEmail, passwordResetTemplate, passwordChangedTemplate } from "@/lib/email";
import { hashPassword, revokeSessions } from "@/lib/auth";
import { clientIp, consume, tooMany } from "@/lib/ratelimit";
import { audit } from "@/lib/audit";

/**
 * AUTH-007 — password reset.
 *
 * POST /api/auth/reset            { email }              → request a link
 * PUT  /api/auth/reset            { token, password }    → complete the reset
 *
 * The request endpoint returns an identical 202 whether or not the account
 * exists. Anything else — a different status, a different body, a materially
 * different response time — is an account enumeration oracle, and a job board's
 * user list is exactly what a spammer wants.
 */

const RequestBody = z.object({ email: z.string().email() });
const ConfirmBody = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const IDENTICAL_RESPONSE = {
  ok: true,
  message: "If an account exists for that address, we've sent a reset link.",
};

export async function POST(req: Request) {
  const parsed = RequestBody.safeParse(await req.json().catch(() => ({})));
  // Even a malformed email gets the same shape, so probing the validator does
  // not distinguish "not an email" from "no such account".
  if (!parsed.success) return NextResponse.json(IDENTICAL_RESPONSE, { status: 202 });

  const email = parsed.data.email.toLowerCase();

  const rl = await consume("resetEmail", email);
  if (!rl.ok) {
    await audit({ action: "auth.rate_limited", detail: { endpoint: "reset/request" }, ip: clientIp(req) });
    return tooMany(rl);
  }

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];

  if (user && !user.deletedAt) {
    await revokeTokens("RESET_PASSWORD", user.id);
    const { raw } = await issueToken({ purpose: "RESET_PASSWORD", userId: user.id, email });
    await sendEmail(
      passwordResetTemplate({
        to: email,
        name: user.name,
        url: `${env.appUrl}/reset?token=${encodeURIComponent(raw)}`,
      })
    );
    await audit({
      action: "auth.password_reset_requested",
      actorId: user.id,
      subjectType: "user",
      subjectId: user.id,
      ip: clientIp(req),
    });
  }

  return NextResponse.json(IDENTICAL_RESPONSE, { status: 202 });
}

export async function PUT(req: Request) {
  const parsed = ConfirmBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  // AC-7 — validate the new password BEFORE consuming the token, so a user who
  // types a weak password can retry with the same link rather than having to
  // request another one.
  const out = await consumeToken(parsed.data.token, "RESET_PASSWORD");
  if (!out.ok || !out.userId) {
    const message =
      out.ok === false && out.reason === "EXPIRED"
        ? "This reset link has expired. Please request a new one."
        : out.ok === false && out.reason === "USED"
          ? "This reset link has already been used. Please request a new one."
          : "This reset link isn't valid. Please request a new one.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const rows = await db.select().from(users).where(eq(users.id, out.userId)).limit(1);
  const user = rows[0];
  if (!user) return NextResponse.json({ error: "Account not found" }, { status: 400 });

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(parsed.data.password), updatedAt: new Date() })
    .where(eq(users.id, user.id));

  // AC-3 — a reset means the account may have been compromised, so every
  // outstanding session dies, including the attacker's.
  await revokeSessions(user.id);

  // AC-5 — always tell the account owner, on the address of record. If the
  // reset was not theirs, this email is how they find out.
  await sendEmail(passwordChangedTemplate({ to: user.email, name: user.name, when: new Date() }));

  await audit({
    action: "auth.password_reset_completed",
    actorId: user.id,
    subjectType: "user",
    subjectId: user.id,
    ip: clientIp(req),
  });

  return NextResponse.json({
    ok: true,
    message: "Your password has been reset. Please sign in with your new password.",
  });
}
