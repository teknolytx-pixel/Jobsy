import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/apiError";
import { consume, tooMany } from "@/lib/ratelimit";
import { audit } from "@/lib/audit";
import { attachResume, deleteProfile, setPrimary, updateProfile } from "@/lib/profiles";

export const dynamic = "force-dynamic";

const Patch = z.object({
  label: z.string().min(1).max(80).optional(),
  headline: z.string().max(200).nullable().optional(),
  skills: z.array(z.string().max(60)).max(40).optional(),
  yearsExp: z.number().int().min(0).max(60).optional(),
  salaryTarget: z.number().int().min(0).max(2000).nullable().optional(),
  availability: z.string().max(60).nullable().optional(),
  bio: z.string().max(4000).nullable().optional(),
  /** Attaching a CV is checked against the owner of the CV, not just the profile. */
  resumeId: z.string().max(36).nullable().optional(),
  /** Promote this profile. The only way matching direction changes. */
  makePrimary: z.literal(true).optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser();
    const { id } = await ctx.params;

    const rl = await consume("write", me.id);
    if (!rl.ok) return tooMany(rl);

    const parsed = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 }
      );
    }
    const { makePrimary, resumeId, ...patch } = parsed.data;

    /*
     * A CV is attached through its own function because it needs a second
     * ownership check: the resume must belong to the same person. Without it,
     * pointing your profile at somebody else's resumeId would render their CV
     * on your profile page.
     */
    if (resumeId !== undefined) {
      const attached = await attachResume(me.id, id, resumeId);
      if (!attached) {
        return NextResponse.json({ error: "That CV isn't yours, or that profile isn't." }, { status: 404 });
      }
    }

    if (Object.keys(patch).length) {
      const updated = await updateProfile(me.id, id, patch);
      if (!updated) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    if (makePrimary) {
      const promoted = await setPrimary(me.id, id);
      if (!promoted) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
      await audit({
        action: "profile.made_primary",
        actorId: me.id,
        subjectType: "profile",
        subjectId: id,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return authErrorResponse(e) ?? errorResponse(e, "saving that profile");
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser();
    const { id } = await ctx.params;

    const result = await deleteProfile(me.id, id);
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });

    await audit({ action: "profile.deleted", actorId: me.id, subjectType: "profile", subjectId: id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return authErrorResponse(e) ?? errorResponse(e, "deleting that profile");
  }
}
