import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, companies, companyMembers, users } from "@/db";
import { requireVerifiedUser, authErrorResponse } from "@/lib/auth";
import { createCompany, membershipOf, seatsUsed } from "@/lib/company";
import { audit } from "@/lib/audit";
import { clientIp, consume, tooMany } from "@/lib/ratelimit";

/** COMP-002 — create or read the caller's company. */
const Body = z.object({
  name: z.string().min(2, "Please enter your company name").max(120),
  website: z.string().url().nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
});

export async function GET() {
  let me;
  try {
    me = await requireVerifiedUser();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const m = await membershipOf(me.id);
  if (!m) return NextResponse.json({ company: null, membership: null });

  const [company] = await db.select().from(companies).where(eq(companies.id, m.companyId)).limit(1);
  const members = await db
    .select({
      userId: companyMembers.userId,
      name: users.name,
      email: users.email,
      seatRole: companyMembers.seatRole,
      status: companyMembers.status,
      joinedAt: companyMembers.joinedAt,
    })
    .from(companyMembers)
    .innerJoin(users, eq(companyMembers.userId, users.id))
    .where(eq(companyMembers.companyId, m.companyId));

  return NextResponse.json({
    company: {
      id: company.id,
      name: company.name,
      slug: company.slug,
      website: company.website,
      description: company.description,
      verified: company.verified,
      verifiedMethod: company.verifiedMethod,
      emailDomain: company.emailDomain,
      seatLimit: company.seatLimit,
      seatsUsed: await seatsUsed(m.companyId),
    },
    membership: { seatRole: m.seatRole, isAdmin: m.isAdmin },
    // SEAT-003 — a plain recruiter does not get the roster's email addresses.
    members: m.isAdmin
      ? members
      : members.map(({ email, ...rest }) => ({ ...rest, email: null })),
  });
}

export async function POST(req: Request) {
  let me;
  try {
    me = await requireVerifiedUser();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const rl = await consume("write", me.id);
  if (!rl.ok) return tooMany(rl);

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  try {
    const { companyId } = await createCompany(me, parsed.data);
    await audit({
      action: "company.created",
      actorId: me.id,
      subjectType: "company",
      subjectId: companyId,
      ip: clientIp(req),
    });
    return NextResponse.json({ ok: true, companyId }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}
