import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, users } from "@/db";
import { requireUser, authErrorResponse, revokeSessions, clearSessionCookie, verifyPassword } from "@/lib/auth";
import { openRequest } from "@/lib/privacy";
import { audit } from "@/lib/audit";
import { clientIp } from "@/lib/ratelimit";

/**
 * AUTH-012 — account deletion.
 *
 * Two-phase by design. This endpoint marks the account for deletion, ends every
 * session and stops all processing; the nightly purge does the irreversible
 * erasure. That gap is deliberate:
 *
 *  • It gives an accidental or coerced deletion a window to be reversed by
 *    support before anything is unrecoverable.
 *  • It lets AC-7's legal hold interrupt the purge rather than having to undo it.
 *  • It keeps a slow multi-table erase off a user-facing request.
 *
 * The user experiences it as immediate — they are signed out, they cannot sign
 * back in, and they are gone from every deck — which is what "deleted" means to
 * a person.
 */
const Body = z.object({
  /** AC-1 — an explicit confirmation. Typing your own email is unambiguous. */
  confirm: z.string().min(1),
  /** Required when the account has a password, as a second factor. */
  password: z.string().optional(),
});

export async function POST(req: Request) {
  let me;
  try {
    me = await requireUser();
  } catch (e) {
    return authErrorResponse(e)!;
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Confirmation required" }, { status: 400 });
  }

  if (parsed.data.confirm.trim().toLowerCase() !== me.email.toLowerCase()) {
    return NextResponse.json(
      {
        error: "Type your email address exactly to confirm. This can't be undone.",
        code: "CONFIRM_MISMATCH",
      },
      { status: 400 }
    );
  }

  if (me.passwordHash) {
    if (!parsed.data.password) {
      return NextResponse.json(
        { error: "Enter your password to confirm", code: "PASSWORD_REQUIRED" },
        { status: 400 }
      );
    }
    if (!(await verifyPassword(parsed.data.password, me.passwordHash))) {
      return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
    }
  }

  // AC-7 — a legal hold suspends deletion, and the requester is told rather
  // than left thinking it worked.
  if (me.legalHold) {
    const { id, dueAt } = await openRequest({
      userId: me.id,
      kind: "DELETE",
      jurisdiction: me.jurisdiction,
      detail: "Suspended: legal hold",
    });
    await db
      .update(users)
      .set({ deletionRequestedAt: new Date(), openToOffers: false, updatedAt: new Date() })
      .where(eq(users.id, me.id));
    return NextResponse.json({
      ok: true,
      held: true,
      requestId: id,
      message:
        "We've stopped using your data and removed you from search, but we can't erase it yet — a legal hold applies to your account. We'll complete the deletion as soon as it lifts, and we'll write to you when we do.",
      dueBy: dueAt.toISOString(),
    });
  }

  const { id } = await openRequest({
    userId: me.id,
    kind: "DELETE",
    jurisdiction: me.jurisdiction,
  });

  await db
    .update(users)
    .set({
      deletionRequestedAt: new Date(),
      // Effective immediately from the user's point of view: gone from every
      // deck, no longer contactable, signed out.
      openToOffers: false,
      profileReady: false,
      updatedAt: new Date(),
    })
    .where(eq(users.id, me.id));

  await revokeSessions(me.id);
  await clearSessionCookie();

  await audit({
    action: "privacy.request_created",
    actorId: me.id,
    subjectType: "user",
    subjectId: me.id,
    detail: { kind: "DELETE", phase: "marked" },
    ip: clientIp(req),
  });

  return NextResponse.json({
    ok: true,
    requestId: id,
    message:
      "Your account is closed. You've been signed out, you no longer appear anywhere on Jobsy, and your personal data will be erased within 30 days. Anyone you matched with will see 'Former Jobsy user' — their conversation history stays readable to them, but nothing identifies you.",
  });
}
