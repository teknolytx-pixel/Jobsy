import { NextResponse } from "next/server";
import { z } from "zod";
import { and, count, eq } from "drizzle-orm";
import { db, companyMembers, jobs, users } from "@/db";
import { requireVerifiedUser, authErrorResponse, revokeSessions } from "@/lib/auth";
import { adminCount, requireCompanyAdmin } from "@/lib/company";
import { audit } from "@/lib/audit";
import { clientIp } from "@/lib/ratelimit";

/**
 * SEAT-003 / SEAT-004 — change a member's role, or remove them.
 *
 * Removal is the interesting one. A recruiter who leaves owns live job postings
 * and live conversations. Dropping the membership row without reassigning them
 * leaves active jobs with no owner, which means nobody can edit or close them —
 * exactly the state that produces ghost jobs.
 */

const PatchBody = z.object({
  userId: z.string().min(1),
  seatRole: z.enum(["COMPANY_ADMIN", "RECRUITER"]),
});

const DeleteBody = z.object({
  userId: z.string().min(1),
  /** Who inherits their jobs. Defaults to the acting admin (AC-2). */
  reassignToUserId: z.string().min(1).optional(),
});

export async function PATCH(req: Request) {
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

  const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  // SEAT-001 AC-4 — a company must always retain at least one admin. Demoting
  // the last one locks everybody out of their own company permanently.
  if (parsed.data.userId === me.id && parsed.data.seatRole === "RECRUITER") {
    if ((await adminCount(m.companyId)) <= 1) {
      return NextResponse.json(
        {
          error: "You're the only admin. Promote someone else before stepping down.",
          code: "LAST_ADMIN",
        },
        { status: 409 }
      );
    }
  }

  const res = await db
    .update(companyMembers)
    .set({ seatRole: parsed.data.seatRole })
    .where(
      and(
        eq(companyMembers.companyId, m.companyId),
        eq(companyMembers.userId, parsed.data.userId)
      )
    )
    .returning({ id: companyMembers.id });

  if (!res[0]) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const ip = clientIp(req);
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

  const parsed = DeleteBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { userId, reassignToUserId } = parsed.data;

  // SEAT-001 AC-4 again — the sole admin cannot remove themselves.
  if (userId === me.id && (await adminCount(m.companyId)) <= 1) {
    return NextResponse.json(
      {
        error: "You're the only admin. Promote someone else before leaving.",
        code: "LAST_ADMIN",
      },
      { status: 409 }
    );
  }

  const target = await db
    .select({ id: companyMembers.id })
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, m.companyId), eq(companyMembers.userId, userId)))
    .limit(1);
  if (!target[0]) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  // AC-1/2 — the inheritor must be an active member of the same company.
  const inheritor = reassignToUserId ?? me.id;
  if (inheritor !== me.id) {
    const ok = await db
      .select({ id: companyMembers.id })
      .from(companyMembers)
      .where(
        and(
          eq(companyMembers.companyId, m.companyId),
          eq(companyMembers.userId, inheritor),
          eq(companyMembers.status, "ACTIVE")
        )
      )
      .limit(1);
    if (!ok[0]) {
      return NextResponse.json(
        { error: "The person you chose isn't an active member of your company", code: "BAD_INHERITOR" },
        { status: 400 }
      );
    }
  }

  const [{ n: jobCount }] = await db
    .select({ n: count() })
    .from(jobs)
    .where(eq(jobs.postedById, userId));

  await db.transaction(async (tx) => {
    // AC-1/5 — reassign FIRST, so no window exists in which an active job has
    // no owner.
    await tx.update(jobs).set({ postedById: inheritor }).where(eq(jobs.postedById, userId));

    await tx
      .delete(companyMembers)
      .where(and(eq(companyMembers.companyId, m.companyId), eq(companyMembers.userId, userId)));

    await tx.update(users).set({ companyId: null, updatedAt: new Date() }).where(eq(users.id, userId));
  });

  // AC-4 — access ends now, not when their 30-day session happens to expire.
  await revokeSessions(userId);

  await audit({
    action: "company.member_removed",
    actorId: me.id,
    subjectType: "user",
    subjectId: userId,
    detail: { companyId: m.companyId, jobsReassigned: jobCount, inheritor },
    ip,
  });

  return NextResponse.json({ ok: true, jobsReassigned: jobCount, reassignedTo: inheritor });
}
