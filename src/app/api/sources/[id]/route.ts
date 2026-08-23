import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, jobSources } from "@/db";
import { authErrorResponse, requirePlatformAdmin } from "@/lib/auth";
import { errorResponse } from "@/lib/apiError";
import { syncSource } from "@/lib/sources";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function load(id: string) {
  const rows = await db.select().from(jobSources).where(eq(jobSources.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Pull this company right now. */
/**
 * ADM-006 — job sources are a PLATFORM concern, not a recruiter one.
 *
 * Connecting a source subscribes the whole deployment to somebody's careers
 * board: every posting it carries enters the corpus every candidate swipes
 * through. Disabling or deleting one removes those postings for everyone. None
 * of that is scoped to the person doing it, so none of it belongs to a
 * recruiter account.
 *
 * ── What this replaces ──
 *
 * `requireUser()`. Any signed-in account — including a CANDIDATE — could list,
 * connect, sync, disable and DELETE every job source on the platform. The
 * /sources page checked for a recruiter, so the restriction looked real while
 * the API underneath enforced nothing beyond being logged in.
 *
 * That is the exact failure the seat tests already guard against elsewhere
 * ("permission checks are server-side, not UI-only"): a UI-only check is not a
 * permission, it is a suggestion, and the API is the thing anyone can call.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePlatformAdmin();
    const { id } = await params;
    const src = await load(id);
    if (!src) return NextResponse.json({ error: "Source not found" }, { status: 404 });

    const result = await syncSource(src);
    return NextResponse.json({ ok: !result.error, ...result });
  } catch (e) {
      /*
       * `authErrorResponse` rather than a bespoke catch.
       *
       * These handlers translated their own errors and got it wrong in both
       * directions: GET returned 401 "Not signed in" for everything, and POST
       * mapped anything that was not an AuthError to 400. A signed-in candidate
       * refused for lacking admin therefore received "400 Invalid input",
       * which tells a client its request was malformed when the request was
       * fine and the caller simply was not allowed.
       *
       * The shared helper distinguishes 401 from 403, which is the whole point
       * of having two error classes.
       */
      return (
      authErrorResponse(e) ?? errorResponse(e, "syncing that source")
    );
  }
}

/** Pause or resume a company without losing its history. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePlatformAdmin();
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { enabled?: boolean };
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }

    const [updated] = await db
      .update(jobSources)
      .set({
        enabled: body.enabled,
        status: body.enabled ? "PENDING" : "DISABLED",
        consecutiveFailures: body.enabled ? 0 : undefined,
        lastError: body.enabled ? null : undefined,
      })
      .where(eq(jobSources.id, id))
      .returning();

    if (!updated) return NextResponse.json({ error: "Source not found" }, { status: 404 });
    return NextResponse.json({ ok: true, enabled: updated.enabled, status: updated.status });
  } catch (e) {
      /*
       * `authErrorResponse` rather than a bespoke catch.
       *
       * These handlers translated their own errors and got it wrong in both
       * directions: GET returned 401 "Not signed in" for everything, and POST
       * mapped anything that was not an AuthError to 400. A signed-in candidate
       * refused for lacking admin therefore received "400 Invalid input",
       * which tells a client its request was malformed when the request was
       * fine and the caller simply was not allowed.
       *
       * The shared helper distinguishes 401 from 403, which is the whole point
       * of having two error classes.
       */
      return (
      authErrorResponse(e) ?? errorResponse(e, "updating that source")
    );
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePlatformAdmin();
    const { id } = await params;
    const deleted = await db.delete(jobSources).where(eq(jobSources.id, id)).returning({ id: jobSources.id });
    if (!deleted.length) return NextResponse.json({ error: "Source not found" }, { status: 404 });
    // Jobs already imported are intentionally left in place — removing the
    // connector stops future syncs, it doesn't retract live postings.
    return NextResponse.json({ ok: true });
  } catch (e) {
      /*
       * `authErrorResponse` rather than a bespoke catch.
       *
       * These handlers translated their own errors and got it wrong in both
       * directions: GET returned 401 "Not signed in" for everything, and POST
       * mapped anything that was not an AuthError to 400. A signed-in candidate
       * refused for lacking admin therefore received "400 Invalid input",
       * which tells a client its request was malformed when the request was
       * fine and the caller simply was not allowed.
       *
       * The shared helper distinguishes 401 from 403, which is the whole point
       * of having two error classes.
       */
      return (
      authErrorResponse(e) ?? errorResponse(e, "removing that source")
    );
  }
}
