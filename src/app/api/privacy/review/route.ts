import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db, privacyRequests, users } from "@/db";
import { requireUser, requirePlatformAdmin, authErrorResponse } from "@/lib/auth";
import { completeRequest, hasOpenRequest, openRequest, SLA_DAYS } from "@/lib/privacy";
import { sendEmail, humanReviewOutcomeTemplate } from "@/lib/email";
import { audit } from "@/lib/audit";
import { clientIp } from "@/lib/ratelimit";

/**
 * XPLAIN-004 — human review of an adverse automated outcome.
 *
 * AC-2 is the one that matters: the reviewer must have AUTHORITY TO OVERTURN.
 * The CPPA's "meaningful human involvement" test is explicit that rubber-
 * stamping does not qualify — a human who can only confirm is not review. So
 * the decision endpoint requires a platform admin and records the reasoning,
 * and the outcome is communicated whichever way it goes.
 */
const RequestBody = z.object({
  detail: z.string().min(1).max(4000),
  context: z.string().max(200).optional(),
});

const DecideBody = z.object({
  requestId: z.string().min(1),
  outcome: z.enum(["UPHELD", "OVERTURNED", "PARTIALLY_OVERTURNED"]),
  reasoning: z.string().min(1).max(4000),
});

export async function GET() {
  let me;
  try {
    me = await requireUser();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const rows = await db
    .select()
    .from(privacyRequests)
    .where(and(eq(privacyRequests.userId, me.id), eq(privacyRequests.kind, "HUMAN_REVIEW")))
    .orderBy(desc(privacyRequests.requestedAt))
    .limit(20);
  return NextResponse.json({ requests: rows });
}

export async function POST(req: Request) {
  let me;
  try {
    me = await requireUser();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const parsed = RequestBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please tell us what you'd like reviewed" },
      { status: 400 }
    );
  }

  // AC-7 — one open review per person at a time. Not a rate limit that can
  // block the FIRST request; a guard against duplicate clocks on the same issue.
  const open = await hasOpenRequest(me.id, "HUMAN_REVIEW");
  if (open) {
    return NextResponse.json({
      ok: true,
      alreadyOpen: true,
      requestId: open.id,
      dueBy: open.dueAt.toISOString(),
      message: "You already have a review in progress. We'll come back to you on that one.",
    });
  }

  const { id, dueAt } = await openRequest({
    userId: me.id,
    kind: "HUMAN_REVIEW",
    jurisdiction: me.jurisdiction,
    detail: [parsed.data.context, parsed.data.detail].filter(Boolean).join(" — "),
  });

  await audit({
    action: "review.requested",
    actorId: me.id,
    subjectType: "privacy_request",
    subjectId: id,
    ip: clientIp(req),
  });

  return NextResponse.json(
    {
      ok: true,
      requestId: id,
      dueBy: dueAt.toISOString(),
      message: `A person will review this and come back to you by ${dueAt.toDateString()}. They can change the outcome — this isn't a formality.`,
      slaDays: SLA_DAYS.HUMAN_REVIEW,
    },
    { status: 201 }
  );
}

/** ADMIN — decide a review. Requires an account with authority to overturn. */
export async function PUT(req: Request) {
  let admin;
  try {
    admin = await requirePlatformAdmin();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const parsed = DecideBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  const rows = await db
    .select()
    .from(privacyRequests)
    .where(eq(privacyRequests.id, parsed.data.requestId))
    .limit(1);
  const request = rows[0];
  if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  if (request.kind !== "HUMAN_REVIEW") {
    return NextResponse.json({ error: "That isn't a review request" }, { status: 400 });
  }

  await completeRequest(
    request.id,
    `${parsed.data.outcome}: ${parsed.data.reasoning}`,
    admin.id
  );

  const [subject] = await db.select().from(users).where(eq(users.id, request.userId)).limit(1);
  if (subject) {
    // AC-5 — the outcome and the reasoning both go to the person, whichever way
    // the decision went.
    await sendEmail(
      humanReviewOutcomeTemplate({
        to: subject.email,
        name: subject.name,
        outcome: parsed.data.outcome.replace(/_/g, " ").toLowerCase(),
        reasoning: parsed.data.reasoning,
      })
    );
  }

  await audit({
    action: "review.decided",
    actorId: admin.id,
    subjectType: "privacy_request",
    subjectId: request.id,
    detail: { outcome: parsed.data.outcome },
    ip: clientIp(req),
  });

  return NextResponse.json({ ok: true });
}
