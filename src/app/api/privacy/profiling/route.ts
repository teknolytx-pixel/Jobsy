import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, users } from "@/db";
import { requireUser, authErrorResponse } from "@/lib/auth";
import { completeRequest, gpcSignalled, openRequest } from "@/lib/privacy";
import { audit } from "@/lib/audit";
import { clientIp } from "@/lib/ratelimit";

/**
 * XPLAIN-003 — opt out of automated ranking.
 *
 * AC-3 is the part that is easy to get wrong: an opted-out candidate still sees
 * jobs. Withholding the product because someone exercised a statutory right is
 * retaliation, which AC-8 prohibits and which several of these statutes name
 * explicitly. They get a different ORDERING, and we tell them which.
 */
const Body = z.object({ optOut: z.boolean() });

export async function GET(req: Request) {
  let me;
  try {
    me = await requireUser();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const gpc = gpcSignalled(req);
  return NextResponse.json({
    optedOut: me.profilingOptOut || gpc,
    storedPreference: me.profilingOptOut,
    // AC-2 — surfaced so the UI can explain why the toggle looks on when the
    // user did not touch it.
    gpcSignal: gpc,
    ranking: me.profilingOptOut || gpc ? "MOST_RECENT_FIRST" : "MATCH_SCORE",
    explanation:
      me.profilingOptOut || gpc
        ? "Automated ranking is off. Jobs are shown newest first. Your match score is still calculated so you can see it if you want, but it isn't used to order what you see."
        : "Jobs are ordered by how well they match your profile. You can turn this off at any time.",
  });
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

  const { optOut } = parsed.data;
  if (optOut === me.profilingOptOut) {
    return NextResponse.json({ ok: true, optedOut: optOut, unchanged: true });
  }

  await db
    .update(users)
    .set({ profilingOptOut: optOut, updatedAt: new Date() })
    .where(eq(users.id, me.id));

  // AC-9 — recorded in the ledger, so the compliance console can show it was
  // honoured and when. An opt-out honoured but not evidenced is not honoured.
  if (optOut) {
    const { id } = await openRequest({
      userId: me.id,
      kind: "OPT_OUT_PROFILING",
      jurisdiction: me.jurisdiction,
    });
    // AC-7 — effective immediately in practice; the 15-day statutory window is
    // an outer bound, not a target.
    await completeRequest(id, "Honoured immediately", me.id);
  }

  await audit({
    action: optOut ? "privacy.profiling_opt_out" : "privacy.profiling_opt_in",
    actorId: me.id,
    subjectType: "user",
    subjectId: me.id,
    ip: clientIp(req),
  });

  return NextResponse.json({
    ok: true,
    optedOut: optOut,
    ranking: optOut ? "MOST_RECENT_FIRST" : "MATCH_SCORE",
    message: optOut
      ? "Automated ranking is off. You'll still see the same jobs — they'll be ordered newest first instead. Nothing else about your account changes."
      : "Automated ranking is back on. Jobs will be ordered by how well they match your profile.",
  });
}
