import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, users } from "@/db";
import { env } from "@/lib/env";
import { consumeToken } from "@/lib/tokens";
import { sendVerification } from "@/lib/verification";
import { requireUser, authErrorResponse } from "@/lib/auth";
import { clientIp, consume, tooMany } from "@/lib/ratelimit";
import { audit } from "@/lib/audit";

/**
 * AUTH-006 — email verification.
 *
 * GET  /api/auth/verify?token=…  consume a link
 * POST /api/auth/verify          re-send to the signed-in user
 */

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const out = await consumeToken(token, "VERIFY_EMAIL");

  if (!out.ok) {
    const reason =
      out.reason === "USED"
        ? "used"
        : out.reason === "EXPIRED"
          ? "expired"
          : "invalid";
    return NextResponse.redirect(`${env.appUrl}/onboarding?verify=${reason}`);
  }

  if (!out.userId) {
    return NextResponse.redirect(`${env.appUrl}/onboarding?verify=invalid`);
  }

  // AC-12 — verifying an already-verified account is a no-op, not an error.
  await db
    .update(users)
    .set({ emailVerified: true, updatedAt: new Date() })
    .where(eq(users.id, out.userId));

  await audit({
    action: "auth.email_verified",
    actorId: out.userId,
    subjectType: "user",
    subjectId: out.userId,
    ip: clientIp(req),
  });

  return NextResponse.redirect(`${env.appUrl}/onboarding?verified=1`);
}

export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    return authErrorResponse(e) ?? NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  if (user.emailVerified) {
    return NextResponse.json({ ok: true, alreadyVerified: true });
  }

  // AC-7 — three sends per user per hour.
  const rl = await consume("verifySend", user.id);
  if (!rl.ok) {
    await audit({
      action: "auth.rate_limited",
      actorId: user.id,
      detail: { endpoint: "verify/send" },
      ip: clientIp(req),
    });
    return tooMany(rl, "You've requested several verification emails. Please wait a little while.");
  }

  await sendVerification(user.id, user.email, user.name);
  return NextResponse.json({ ok: true, sent: true });
}
