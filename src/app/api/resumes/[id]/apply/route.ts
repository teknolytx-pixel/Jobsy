import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db, resumeParses, resumes, users } from "@/db";
import { AuthError, authErrorResponse, requireRole } from "@/lib/auth";
import { audit, safeDetail } from "@/lib/audit";
import { normalizeSkills } from "@/lib/skills";
import { toProfilePatch, type ParseOutcome } from "@/lib/resume/parse";
import { consume, tooMany } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/**
 * RESUME-003 AC-4 — apply the parts of a parsed resume the candidate approved.
 *
 * This endpoint is the missing half of a feature that has been half-built since
 * the schema was written. Upload worked, extraction worked, parsing worked, and
 * `toProfilePatch()` existed with tests — and nothing in the product ever called
 * it. A candidate could upload a CV and watch it be read, and the reading went
 * nowhere.
 *
 * ── Approval is per field, and it is the whole point ──
 *
 * The request names which fields to take. Anything not named is not written,
 * and there is deliberately no "apply everything" flag: a parser that
 * silently overwrites a profile is a parser that silently makes people's
 * profiles wrong, and the person who finds out is a recruiter reading a
 * headline the candidate never wrote.
 *
 * The same rule applies in reverse — approving a field never DELETES anything.
 * An empty parse result for a field the candidate has filled in by hand is
 * ignored rather than treated as "clear it".
 */

const FIELDS = ["headline", "summary", "skills", "totalYearsExperience"] as const;

const Body = z.object({
  approved: z.array(z.enum(FIELDS)).min(1),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    // CANDIDATE only. A recruiter has no profile to patch this way, and
    // `requireRole` is what enforces it rather than a comment.
    const me = await requireRole("CANDIDATE");
    const { id } = await ctx.params;

    const rl = await consume("write", me.id, { max: 20, windowSec: 3600 });
    if (!rl.ok) return tooMany(rl);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Tick at least one field to apply.", allowed: FIELDS },
        { status: 400 }
      );
    }

    // Ownership, checked on the resume rather than the parse: a parse id is
    // guessable and belongs to nobody on its own.
    const rows = await db
      .select({ resume: resumes, parse: resumeParses })
      .from(resumes)
      .innerJoin(resumeParses, eq(resumeParses.resumeId, resumes.id))
      .where(and(eq(resumes.id, id), eq(resumes.userId, me.id)))
      .orderBy(desc(resumeParses.createdAt))
      .limit(1);

    const row = rows[0];
    if (!row) return NextResponse.json({ error: "Resume not found" }, { status: 404 });
    if (row.resume.deletedAt) {
      return NextResponse.json({ error: "That resume has been deleted." }, { status: 410 });
    }

    const outcome: ParseOutcome = {
      parsed: row.parse.structured as ParseOutcome["parsed"],
      confidence: (row.parse.confidence as ParseOutcome["confidence"]) ?? {},
      needsConfirmation: [],
    };

    const patch = toProfilePatch(outcome, parsed.data.approved);
    if (!Object.keys(patch).length) {
      return NextResponse.json(
        { error: "Nothing to apply — the fields you ticked came back empty.", applied: [] },
        { status: 400 }
      );
    }

    // Skills go through the same normaliser the rest of the product uses, so a
    // resume saying "JS" and a profile saying "JavaScript" are one skill and
    // the match engine sees them as one.
    const nextSkills = patch.skills ? normalizeSkills(patch.skills) : undefined;

    const merged = {
      headline: patch.headline ?? me.headline,
      bio: patch.bio ?? me.bio,
      skills: nextSkills ?? me.skills,
      yearsExp: patch.yearsExp ?? me.yearsExp,
    };

    // Same readiness rule as PATCH /api/profile. Duplicated deliberately rather
    // than imported: if the rule changes, both call sites should be found.
    const profileReady =
      Boolean(merged.headline) && Boolean(me.location) && merged.skills.length >= 3;

    const [updated] = await db
      .update(users)
      .set({
        ...(patch.headline ? { headline: patch.headline } : {}),
        ...(patch.bio ? { bio: patch.bio } : {}),
        ...(nextSkills ? { skills: nextSkills } : {}),
        ...(patch.yearsExp != null ? { yearsExp: patch.yearsExp } : {}),
        profileReady,
        updatedAt: new Date(),
      })
      .where(eq(users.id, me.id))
      .returning();

    // Marks the parse as spent so the review card stops asking. Without this a
    // candidate is prompted to apply the same suggestions on every visit.
    await db
      .update(resumeParses)
      .set({ appliedToProfile: true, appliedAt: new Date() })
      .where(eq(resumeParses.id, row.parse.id));

    await audit({
      action: "profile.updated_from_resume",
      actorId: me.id,
      subjectType: "user",
      subjectId: me.id,
      // Field NAMES only. The values are the candidate's own profile content
      // and an audit log is the wrong place to keep a second copy of it.
      detail: safeDetail({ source: "resume_parse", resumeId: id, fields: Object.keys(patch) }),
    });

    /**
     * Report back in the candidate's vocabulary, not the database's.
     *
     * `patch` is keyed by COLUMN — bio, yearsExp — while the request was keyed
     * by the field names shown on screen: summary, totalYearsExperience. Echoing
     * the column names put "yearsexp" in a sentence a person reads.
     */
    const COLUMN_FOR: Record<(typeof FIELDS)[number], keyof typeof patch> = {
      headline: "headline",
      summary: "bio",
      skills: "skills",
      totalYearsExperience: "yearsExp",
    };
    const applied = parsed.data.approved.filter((f) => COLUMN_FOR[f] in patch);

    return NextResponse.json({
      ok: true,
      applied,
      profileReady: updated.profileReady,
      skills: updated.skills,
    });
  } catch (e) {
    const status = e instanceof AuthError ? 401 : 400;
    return authErrorResponse(e) ?? NextResponse.json({ error: (e as Error).message }, { status });
  }
}
