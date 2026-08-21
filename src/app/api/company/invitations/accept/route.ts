import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, companies, companyInvitations, companyMembers, users } from "@/db";
import { requireUser, authErrorResponse } from "@/lib/auth";
import { hashToken } from "@/lib/tokens";
import { membershipOf, seatsUsed } from "@/lib/company";
import { audit } from "@/lib/audit";
import { clientIp } from "@/lib/ratelimit";

/**
 * SEAT-002 — accept an invitation.
 *
 * AC-5 is the security-relevant one: the invitation binds to the invited
 * ADDRESS, not merely to whoever holds the link. A user signed in as someone
 * else cannot redeem it, so a forwarded link does not hand over a seat.
 */
const Body = z.object({ token: z.string().min(1) });

export async function POST(req: Request) {
  let me;
  try {
    me = await requireUser();
  } catch (e) {
    return authErrorResponse(e)!;
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const rows = await db
    .select()
    .from(companyInvitations)
    .where(eq(companyInvitations.tokenHash, hashToken(parsed.data.token)))
    .limit(1);
  const invite = rows[0];

  if (!invite) {
    return NextResponse.json(
      { error: "This invitation link isn't valid. Ask your admin to send a new one." },
      { status: 400 }
    );
  }
  if (invite.status !== "PENDING") {
    return NextResponse.json(
      { error: "This invitation has already been used or was revoked.", code: "INVITE_USED" },
      { status: 400 }
    );
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    await db
      .update(companyInvitations)
      .set({ status: "EXPIRED" })
      .where(eq(companyInvitations.id, invite.id));
    return NextResponse.json(
      {
        error: "This invitation has expired. Ask your admin to send a new one.",
        code: "INVITE_EXPIRED",
      },
      { status: 400 }
    );
  }

  // AC-5 — the address is the binding, not possession of the link.
  if (me.email.toLowerCase() !== invite.email.toLowerCase()) {
    return NextResponse.json(
      {
        error: `This invitation was sent to ${invite.email}. Sign in with that address to accept it.`,
        code: "INVITE_WRONG_ACCOUNT",
      },
      { status: 403 }
    );
  }

  // AC-6 — one company at a time.
  const existing = await membershipOf(me.id);
  if (existing) {
    if (existing.companyId === invite.companyId) {
      await db
        .update(companyInvitations)
        .set({ status: "ACCEPTED", acceptedAt: new Date() })
        .where(eq(companyInvitations.id, invite.id));
      return NextResponse.json({ ok: true, alreadyMember: true, companyId: invite.companyId });
    }
    return NextResponse.json(
      {
        error: "You already belong to another company on Jobsy. Leave it before joining a new one.",
        code: "ALREADY_IN_COMPANY",
      },
      { status: 409 }
    );
  }

  const [company] = await db
    .select()
    .from(companies)
    .where(eq(companies.id, invite.companyId))
    .limit(1);
  if (!company) {
    return NextResponse.json({ error: "That company no longer exists" }, { status: 404 });
  }

  // Re-check the seat limit at ACCEPT time, not only at invite time. Seats can
  // fill between the two, and an invitation is not a reservation.
  if ((await seatsUsed(company.id)) >= company.seatLimit) {
    return NextResponse.json(
      {
        error: `${company.name} has no seats free. Ask an admin to free one and re-invite you.`,
        code: "SEAT_LIMIT_REACHED",
      },
      { status: 409 }
    );
  }

  // UPDATE ... WHERE status='PENDING' is what makes acceptance single-use under
  // concurrency: two simultaneous clicks yield one seat, not two.
  const claimed = await db
    .update(companyInvitations)
    .set({ status: "ACCEPTED", acceptedAt: new Date() })
    .where(and(eq(companyInvitations.id, invite.id), eq(companyInvitations.status, "PENDING")))
    .returning({ id: companyInvitations.id });
  if (!claimed[0]) {
    return NextResponse.json(
      { error: "This invitation has already been used.", code: "INVITE_USED" },
      { status: 400 }
    );
  }

  await db.transaction(async (tx) => {
    await tx.insert(companyMembers).values({
      companyId: invite.companyId,
      userId: me.id,
      seatRole: invite.seatRole,
    });
    await tx
      .update(users)
      .set({
        companyId: invite.companyId,
        role: me.role,
        updatedAt: new Date(),
      })
      .where(eq(users.id, me.id));
  });

  await audit({
    action: "company.member_joined",
    actorId: me.id,
    subjectType: "company",
    subjectId: invite.companyId,
    detail: { seatRole: invite.seatRole },
    ip: clientIp(req),
  });

  return NextResponse.json({ ok: true, companyId: invite.companyId, companyName: company.name });
}
