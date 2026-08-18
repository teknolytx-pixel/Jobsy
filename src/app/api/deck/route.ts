import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { candidateDeck, recruiterDeck } from "@/lib/deck";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") ?? "candidate";

    if (mode === "recruiter") {
      const jobId = url.searchParams.get("jobId");
      if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 });
      return NextResponse.json({ mode, cards: await recruiterDeck(user, jobId) });
    }

    if (!user.profileReady) {
      return NextResponse.json({ error: "Finish onboarding first", needsOnboarding: true }, { status: 428 });
    }
    return NextResponse.json({ mode: "candidate", cards: await candidateDeck(user) });
  } catch (e) {
    const status = e instanceof AuthError ? 401 : 400;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
