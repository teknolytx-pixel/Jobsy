import { NextResponse } from "next/server";
import { and, eq, isNull, or } from "drizzle-orm";
import { db, matches, resumes } from "@/db";
import { currentUser } from "@/lib/auth";
import { getObject, verifyResumeSignature } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * RESUME-001 AC-6/8/9 — serve a resume file.
 *
 * Three independent gates, all of which must pass:
 *
 *   1. A valid, unexpired signature that binds the resume AND the viewer.
 *   2. A live session belonging to that same viewer — so a leaked URL is
 *      useless to anyone who is not signed in as the person it was issued to.
 *   3. Authorisation: the owner, or a recruiter who has MATCHED with them.
 *
 * CAND-004 is the reason for the third gate. A resume is post-match data. A
 * recruiter who has merely seen a card in their deck has not earned it.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const viewerId = url.searchParams.get("v") ?? "";

  const sig = verifyResumeSignature(id, viewerId, url.searchParams.get("e"), url.searchParams.get("s"));
  if (!sig.ok) {
    return NextResponse.json(
      {
        error:
          sig.reason === "EXPIRED"
            ? "This download link has expired. Open the profile again for a fresh one."
            : "This link isn't valid.",
        code: sig.reason,
      },
      { status: 403 }
    );
  }

  // Gate 2 — the signature says who it was for; the session says who is asking.
  const me = await currentUser();
  if (!me || me.id !== viewerId) {
    return NextResponse.json({ error: "Sign in to view this file" }, { status: 401 });
  }

  const rows = await db
    .select()
    .from(resumes)
    .where(and(eq(resumes.id, id), isNull(resumes.deletedAt)))
    .limit(1);
  const resume = rows[0];
  if (!resume) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Gate 3 — owner, or matched recruiter.
  if (resume.userId !== me.id) {
    const matched = await db
      .select({ id: matches.id })
      .from(matches)
      .where(
        and(
          eq(matches.candidateId, resume.userId),
          or(eq(matches.recruiterId, me.id), eq(matches.candidateId, me.id))
        )
      )
      .limit(1);
    if (!matched[0]) {
      return NextResponse.json(
        {
          error: "You can see a candidate's resume once you've both matched.",
          code: "MATCH_REQUIRED",
        },
        { status: 403 }
      );
    }
  }

  const body = await getObject(resume.storageKey);
  if (!body) return NextResponse.json({ error: "File is no longer available" }, { status: 404 });

  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": resume.mime,
      // `attachment` rather than `inline`: a PDF rendered in the browser runs
      // in our origin, and we would rather it never get the chance.
      "Content-Disposition": `attachment; filename="${resume.filename.replace(/"/g, "")}"`,
      "Content-Length": String(body.length),
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
