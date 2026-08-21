import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, authErrorResponse, requireRole } from "@/lib/auth";
import { candidateSwipe, recruiterSwipe } from "@/lib/swipe";
import { REJECTION_REASONS } from "@/lib/rejectionReasons";

const Body = z.object({
  mode: z.enum(["candidate", "recruiter"]),
  direction: z.enum(["LIKE", "PASS"]),
  jobId: z.string().min(1),
  candidateId: z.string().min(1).optional(),
  /** BR-011 — required when a recruiter passes. See below. */
  rejectionReason: z.enum(REJECTION_REASONS).optional(),
});

export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
    }
    const { mode, direction, jobId, candidateId } = parsed.data;

    // AUTH-003 — the mode decides which side you must be. Gating the UI is not
    // enough: this endpoint takes `mode` from the request body, so without the
    // check a recruiter could POST mode:"candidate" and auto-create job
    // applications in their own name.
    const user = await requireRole(mode === "recruiter" ? "RECRUITER" : "CANDIDATE");

    if (mode === "recruiter") {
      if (!candidateId) return NextResponse.json({ error: "candidateId required" }, { status: 400 });

      // AC-014 — a pass without a stated, job-related reason is refused.
      //
      // Enforced here rather than in the UI because the UI is not the security
      // boundary, and because "we require a reason" is only true if the API
      // does. Optional-with-a-default would have made the column look populated
      // while recording nothing anyone chose.
      if (direction === "PASS" && !parsed.data.rejectionReason) {
        return NextResponse.json(
          {
            error: "Choose a job-related reason for passing.",
            code: "REJECTION_REASON_REQUIRED",
            allowed: REJECTION_REASONS,
          },
          { status: 400 }
        );
      }
      return NextResponse.json(
        await recruiterSwipe(user, jobId, candidateId, direction, parsed.data.rejectionReason ?? null)
      );
    }
    return NextResponse.json(await candidateSwipe(user, jobId, direction));
  } catch (e) {
    const forbidden = authErrorResponse(e);
    if (forbidden) return forbidden;
    const status = e instanceof AuthError ? 401 : 400;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
