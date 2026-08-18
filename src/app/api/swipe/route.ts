import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { candidateSwipe, recruiterSwipe } from "@/lib/swipe";

const Body = z.object({
  mode: z.enum(["candidate", "recruiter"]),
  direction: z.enum(["LIKE", "PASS"]),
  jobId: z.string().min(1),
  candidateId: z.string().min(1).optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
    }
    const { mode, direction, jobId, candidateId } = parsed.data;

    if (mode === "recruiter") {
      if (!candidateId) return NextResponse.json({ error: "candidateId required" }, { status: 400 });
      return NextResponse.json(await recruiterSwipe(user, jobId, candidateId, direction));
    }
    return NextResponse.json(await candidateSwipe(user, jobId, direction));
  } catch (e) {
    const status = e instanceof AuthError ? 401 : 400;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
