import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, users } from "@/db";
import { requireUser, authErrorResponse } from "@/lib/auth";
import { blockUser, unblockUser, blockedIdsFor } from "@/lib/trust";

/** MSG-004 — block and unblock. */
const Body = z.object({ userId: z.string().min(1) });

export async function GET() {
  let me;
  try {
    me = await requireUser();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const ids = await blockedIdsFor(me.id);
  if (!ids.length) return NextResponse.json({ blocked: [] });
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, ids[0]!));
  // Only names the user themselves blocked are listed; ids where they were the
  // blocked party are deliberately not surfaced back to them.
  return NextResponse.json({ blocked: rows });
}

export async function POST(req: Request) {
  let me;
  try {
    me = await requireUser();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  if (parsed.data.userId === me.id) {
    return NextResponse.json({ error: "You can't block yourself" }, { status: 400 });
  }
  await blockUser(me.id, parsed.data.userId);
  // AC-3 — a neutral confirmation. Nothing here or anywhere else tells the
  // blocked party what happened.
  return NextResponse.json({ ok: true, message: "Blocked. They won't be able to reach you." });
}

export async function DELETE(req: Request) {
  let me;
  try {
    me = await requireUser();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  await unblockUser(me.id, parsed.data.userId);
  return NextResponse.json({ ok: true });
}
