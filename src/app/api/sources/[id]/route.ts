import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, jobSources } from "@/db";
import { requireUser } from "@/lib/auth";
import { syncSource } from "@/lib/sources";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function load(id: string) {
  const rows = await db.select().from(jobSources).where(eq(jobSources.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Pull this company right now. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await params;
    const src = await load(id);
    if (!src) return NextResponse.json({ error: "Source not found" }, { status: 404 });

    const result = await syncSource(src);
    return NextResponse.json({ ok: !result.error, ...result });
  } catch {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
}

/** Pause or resume a company without losing its history. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
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
  } catch {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await params;
    const deleted = await db.delete(jobSources).where(eq(jobSources.id, id)).returning({ id: jobSources.id });
    if (!deleted.length) return NextResponse.json({ error: "Source not found" }, { status: 404 });
    // Jobs already imported are intentionally left in place — removing the
    // connector stops future syncs, it doesn't retract live postings.
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
}
