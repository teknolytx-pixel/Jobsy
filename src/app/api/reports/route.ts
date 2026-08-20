import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, authErrorResponse } from "@/lib/auth";
import { fileReport } from "@/lib/trust";
import { clientIp, consume, tooMany } from "@/lib/ratelimit";

/**
 * TRUST-002 — report a job, a user, a message or a company.
 *
 * Rate limited (AC-6) because a reporting tool with no limit is itself a
 * harassment vector: twenty reports in a minute against one account is not
 * safety, it is brigading.
 */
const Body = z.object({
  kind: z.enum(["JOB", "USER", "MESSAGE", "COMPANY"]),
  targetId: z.string().min(1),
  reason: z.enum([
    "SCAM_OR_FEE",
    "DISCRIMINATORY",
    "HARASSMENT",
    "SPAM",
    "GHOST_JOB",
    "IMPERSONATION",
    "OTHER",
  ]),
  detail: z.string().max(4000).optional(),
});

export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    return authErrorResponse(e)!;
  }

  const rl = await consume("report", user.id);
  if (!rl.ok) return tooMany(rl, "You've filed several reports very quickly. Please slow down.");

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid report" },
      { status: 400 }
    );
  }

  const { id, ref } = await fileReport({
    reporterId: user.id,
    kind: parsed.data.kind,
    targetId: parsed.data.targetId,
    reason: parsed.data.reason,
    detail: parsed.data.detail ?? null,
  });

  // AC-5 — confirmed within one page load, not "we'll email you eventually".
  return NextResponse.json(
    {
      ok: true,
      reportId: id,
      reference: ref,
      message:
        "Thanks — we've received your report and a person will review it. We'll email you the outcome.",
    },
    { status: 201 }
  );
}
