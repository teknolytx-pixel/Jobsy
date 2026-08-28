import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/apiError";
import { consume, tooMany } from "@/lib/ratelimit";
import { audit } from "@/lib/audit";
import { ProfileLimit, createProfile, ensureProfile, profilesWithResumes } from "@/lib/profiles";

export const dynamic = "force-dynamic";

/**
 * A CANDIDATE'S PROFILES.
 *
 * Every route in this file is scoped to the signed-in user inside the query
 * itself — never "fetch by id, then compare the owner". A profile id is
 * guessable and an ownership check that lives in a separate statement is one
 * somebody forgets to copy onto the next endpoint. Here the only way to name a
 * row is to also name its owner, so forgetting is not available.
 */
export async function GET() {
  try {
    const me = await requireUser();
    // Somebody who registered before profiles existed has none. Seed from their
    // user row rather than showing an empty screen that implies data was lost.
    if (me.role === "CANDIDATE") await ensureProfile(me.id);

    const rows = await profilesWithResumes(me.id);
    return NextResponse.json({
      profiles: rows.map((r) => ({
        id: r.profile.id,
        label: r.profile.label,
        isPrimary: r.profile.isPrimary,
        headline: r.profile.headline,
        skills: r.profile.skills,
        yearsExp: r.profile.yearsExp,
        salaryTarget: r.profile.salaryTarget,
        availability: r.profile.availability,
        bio: r.profile.bio,
        resumeId: r.profile.resumeId,
        resumeFilename: r.resumeFilename,
        updatedAt: r.profile.updatedAt.toISOString(),
      })),
    });
  } catch (e) {
    return authErrorResponse(e) ?? errorResponse(e, "loading your profiles");
  }
}

const Body = z.object({
  label: z.string().min(1, "Give this profile a name").max(80),
  headline: z.string().max(200).nullable().optional(),
  skills: z.array(z.string().max(60)).max(40).optional(),
  yearsExp: z.number().int().min(0).max(60).optional(),
  salaryTarget: z.number().int().min(0).max(2000).nullable().optional(),
  availability: z.string().max(60).nullable().optional(),
  bio: z.string().max(4000).nullable().optional(),
});

export async function POST(req: Request) {
  try {
    const me = await requireUser();
    if (me.role !== "CANDIDATE") {
      return NextResponse.json(
        { error: "Profiles are for job seekers.", code: "WRONG_ACCOUNT_TYPE" },
        { status: 403 }
      );
    }

    const rl = await consume("write", me.id);
    if (!rl.ok) return tooMany(rl);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 }
      );
    }

    const created = await createProfile(me.id, {
      ...parsed.data,
      skills: parsed.data.skills?.map((s) => s.trim()).filter(Boolean),
    });
    await audit({
      action: "profile.created",
      actorId: me.id,
      subjectType: "profile",
      subjectId: created.id,
      detail: { label: created.label, isPrimary: created.isPrimary },
    });

    return NextResponse.json({ ok: true, profile: { id: created.id, label: created.label } }, { status: 201 });
  } catch (e) {
    if (e instanceof ProfileLimit) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    return authErrorResponse(e) ?? errorResponse(e, "creating that profile");
  }
}
