import { NextResponse } from "next/server";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { db, matches, messages, users } from "@/db";
import { requireVerifiedUser, requireUser, authErrorResponse } from "@/lib/auth";
import { isBlocked } from "@/lib/trust";
import { consume, tooMany } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/** Only the two people in a match may read or write its thread. */
async function assertParticipant(matchId: string, userId: string) {
  const rows = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  const match = rows[0];
  if (!match) throw new Error("Match not found");
  if (match.candidateId !== userId && match.recruiterId !== userId) {
    throw new Error("Not your conversation");
  }
  return match;
}

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const matchId = new URL(req.url).searchParams.get("matchId");
    if (!matchId) return NextResponse.json({ error: "matchId required" }, { status: 400 });

    await assertParticipant(matchId, user.id);
    const rows = await db
      .select({ msg: messages, senderName: users.name })
      .from(messages)
      .innerJoin(users, eq(messages.senderId, users.id))
      .where(eq(messages.matchId, matchId))
      .orderBy(asc(messages.createdAt))
      .limit(200);

    return NextResponse.json({
      messages: rows.map((r) => ({
        id: r.msg.id,
        body: r.msg.body,
        at: r.msg.createdAt.toISOString(),
        mine: r.msg.senderId === user.id,
        senderName: r.senderName,
      })),
    });
  } catch (e) {
    return authErrorResponse(e) ?? NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

const Body = z.object({ matchId: z.string().min(1), body: z.string().min(1).max(4000) });

export async function POST(req: Request) {
  try {
    // AUTH-006 AC-5 — an unverified address cannot message a match.
    const user = await requireVerifiedUser();
    const rl = await consume("write", user.id);
    if (!rl.ok) return tooMany(rl);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });

    const match = await assertParticipant(parsed.data.matchId, user.id);

    // MSG-004 AC-1 — a block stops messages in BOTH directions. A one-way block
    // would let the blocked party keep talking, which is the opposite of what
    // the person clicking "block" is asking for.
    const other = match.candidateId === user.id ? match.recruiterId : match.candidateId;
    if (await isBlocked(user.id, other)) {
      // AC-3 — deliberately does not say who blocked whom, or that a block
      // exists at all. The blocked party is never told.
      return NextResponse.json(
        { error: "This conversation is closed.", code: "CONVERSATION_CLOSED" },
        { status: 403 }
      );
    }

    const [msg] = await db
      .insert(messages)
      .values({ matchId: parsed.data.matchId, senderId: user.id, body: parsed.data.body.trim() })
      .returning();

    return NextResponse.json({ ok: true, id: msg.id, at: msg.createdAt.toISOString() });
  } catch (e) {
    return authErrorResponse(e) ?? NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
