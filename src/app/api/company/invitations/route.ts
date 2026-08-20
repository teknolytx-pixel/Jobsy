import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, companies, companyInvitations, companyMembers, users } from "@/db";
import { requireVerifiedUser, authErrorResponse } from "@/lib/auth";
import { membershipOf, requireCompanyAdmin, seatsUsed } from "@/lib/company";
import { hashToken, newToken, TTL } from "@/lib/tokens";
import { sendEmail, companyInviteTemplate } from "@/lib/email";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { clientIp, consume, tooMany } from "@/lib/ratelimit";

/** SEAT-002 — invite, list, revoke. */
const Body = z.object({
  email: z.string().email(),
  seatRole: z.enum(["COMPANY_ADMIN", "RECRUITER"]).default("RECRUITER"),
});

export async function GET() {
  let me;
  try {
    me = await requireVerifiedUser();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const m = await membershipOf(me.id);
  if (!m) return NextResponse.json({ invitations: [] });
  if (!m.isAdmin) {
    return NextResponse.json({ error: "Only a company admin can do this", code: "ADMIN_ONLY" }, { status: 403 });
  }
  const rows = await db
    .select({
      id: companyInvitations.id,
      email: companyInvitations.email,
      seatRole: companyInvitations.seatRole,
      status: companyInvitations.status,
      expiresAt: companyInvitations.expiresAt,
      createdAt: companyInvitations.createdAt,
    })
    .from(companyInvitations)
    .where(eq(companyInvitations.companyId, m.companyId));
  return NextResponse.json({ invitations: rows });
}

export async function POST(req: Request) {
  let me;
  try {
    me = await requireVerifiedUser();
  } catch (e) {
    return authErrorResponse(e)!;
  }

  let m;
  try {
    m = await requireCompanyAdmin(me.id);
  } catch (e) {
    // AC-8 — a plain recruiter gets 403, not a hidden button.
    return NextResponse.json({ error: (e as Error).message, code: "ADMIN_ONLY" }, { status: 403 });
  }

  const rl = await consume("write", me.id);
  if (!rl.ok) return tooMany(rl);

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const email = parsed.data.email.toLowerCase().trim();

  // AC-12 — inviting someone who is already a member.
  const already = await db
    .select({ id: companyMembers.id })
    .from(companyMembers)
    .innerJoin(users, eq(companyMembers.userId, users.id))
    .where(and(eq(companyMembers.companyId, m.companyId), eq(users.email, email)))
    .limit(1);
  if (already[0]) {
    return NextResponse.json(
      { error: "That person is already on your team", code: "ALREADY_MEMBER" },
      { status: 409 }
    );
  }

  // AC-2 — seat limit, checked against ACTIVE members plus live invitations, so
  // four simultaneous invites cannot overfill a company with one seat free.
  const pending = await db
    .select({ id: companyInvitations.id })
    .from(companyInvitations)
    .where(
      and(eq(companyInvitations.companyId, m.companyId), eq(companyInvitations.status, "PENDING"))
    );
  if ((await seatsUsed(m.companyId)) + pending.length >= m.seatLimit) {
    return NextResponse.json(
      {
        error: `Your plan includes ${m.seatLimit} seats and they're all taken or invited. Remove a member or revoke an invitation first.`,
        code: "SEAT_LIMIT_REACHED",
      },
      { status: 409 }
    );
  }

  // AC-7 — re-inviting the same address revokes the previous token. Otherwise
  // every link ever sent stays live for 7 days, and a forwarded old email is a
  // way into someone else's company.
  await db
    .update(companyInvitations)
    .set({ status: "REVOKED" })
    .where(
      and(
        eq(companyInvitations.companyId, m.companyId),
        eq(companyInvitations.email, email),
        eq(companyInvitations.status, "PENDING")
      )
    );

  const raw = newToken();
  const [invite] = await db
    .insert(companyInvitations)
    .values({
      companyId: m.companyId,
      email,
      seatRole: parsed.data.seatRole,
      tokenHash: hashToken(raw),
      invitedById: me.id,
      expiresAt: new Date(Date.now() + TTL.COMPANY_INVITE * 1000),
    })
    .returning({ id: companyInvitations.id });

  const [company] = await db.select().from(companies).where(eq(companies.id, m.companyId)).limit(1);

  await sendEmail(
    companyInviteTemplate({
      to: email,
      companyName: company.name,
      inviterName: me.name,
      seatRole: parsed.data.seatRole,
      url: `${env.appUrl}/join?token=${encodeURIComponent(raw)}`,
    })
  );

  await audit({
    action: "company.member_invited",
    actorId: me.id,
    subjectType: "company",
    subjectId: m.companyId,
    detail: { email, seatRole: parsed.data.seatRole },
    ip: clientIp(req),
  });

  return NextResponse.json({ ok: true, invitationId: invite.id }, { status: 201 });
}

export async function DELETE(req: Request) {
  let me;
  try {
    me = await requireVerifiedUser();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  let m;
  try {
    m = await requireCompanyAdmin(me.id);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, code: "ADMIN_ONLY" }, { status: 403 });
  }

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // AC-9 — scoped to the caller's own company, so an id from another company
  // cannot be revoked by guessing it.
  const res = await db
    .update(companyInvitations)
    .set({ status: "REVOKED" })
    .where(and(eq(companyInvitations.id, id), eq(companyInvitations.companyId, m.companyId)))
    .returning({ id: companyInvitations.id });

  if (!res[0]) return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
