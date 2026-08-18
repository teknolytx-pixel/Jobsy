import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { companies, db, users } from "@/db";
import { AuthError, requireUser } from "@/lib/auth";
import { normalizeSkills } from "@/lib/skills";

const Body = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(["CANDIDATE", "RECRUITER", "BOTH"]).optional(),
  headline: z.string().max(140).optional(),
  bio: z.string().max(2000).optional(),
  location: z.string().max(120).optional(),
  remotePref: z.enum(["ONSITE", "HYBRID", "REMOTE", "ANY"]).optional(),
  yearsExp: z.number().int().min(0).max(60).optional(),
  salaryTarget: z.number().int().min(0).max(2000).nullable().optional(),
  availability: z.string().max(60).optional(),
  skills: z.array(z.string()).max(40).optional(),
  openToOffers: z.boolean().optional(),
  title: z.string().max(120).optional(),
  companyName: z.string().max(120).optional(),
});

export async function GET() {
  try {
    const u = await requireUser();
    return NextResponse.json({
      id: u.id, email: u.email, name: u.name, role: u.role, image: u.image,
      headline: u.headline, bio: u.bio, location: u.location, remotePref: u.remotePref,
      yearsExp: u.yearsExp, salaryTarget: u.salaryTarget, availability: u.availability,
      skills: u.skills, openToOffers: u.openToOffers, profileReady: u.profileReady,
      title: u.title, companyId: u.companyId, linkedinLinked: Boolean(u.linkedinSub),
    });
  } catch {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
    }
    const { companyName, skills, ...rest } = parsed.data;

    let companyId = user.companyId;
    if (companyName) {
      const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const [c] = await db
        .insert(companies)
        .values({ name: companyName, slug, source: "JOBSY" })
        .onConflictDoUpdate({ target: companies.slug, set: { name: companyName } })
        .returning();
      companyId = c.id;
    }

    const nextSkills = skills ? normalizeSkills(skills) : undefined;
    const merged = {
      headline: rest.headline ?? user.headline,
      location: rest.location ?? user.location,
      skills: nextSkills ?? user.skills,
    };
    const ready = Boolean(merged.headline) && Boolean(merged.location) && merged.skills.length >= 3;

    const [updated] = await db
      .update(users)
      .set({
        ...rest,
        ...(nextSkills ? { skills: nextSkills } : {}),
        ...(companyId ? { companyId } : {}),
        profileReady: ready,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();

    return NextResponse.json({ ok: true, profileReady: updated.profileReady, skills: updated.skills });
  } catch (e) {
    const status = e instanceof AuthError ? 401 : 400;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
