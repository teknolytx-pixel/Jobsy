import { NextResponse } from "next/server";
import { AuthError, authErrorResponse, requireRole, requireUser } from "@/lib/auth";
import { candidateDeck, recruiterDeck } from "@/lib/deck";
import { consume, tooMany } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await requireUser();

    /**
     * SEC-002 — `LIMITS.search` was declared and never consumed.
     *
     * The deck is a read endpoint, so it is easy to think of throttling it as
     * politeness. It is not: this is the endpoint that returns candidate
     * profiles, and an unbounded one is a scraping interface with a login on
     * the front of it. Sixty a minute is far above what any human moves
     * through and far below what a script wants.
     */
    const rl = await consume("search", user.id);
    if (!rl.ok) return tooMany(rl, "You're moving faster than we can keep up. Try again in a moment.");

    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") ?? "candidate";

    if (mode === "recruiter") {
      // Sourcing candidates is an employer action. Job ownership is checked
      // inside recruiterDeck(), but ownership alone would still let a candidate
      // who somehow owns a posting browse people.
      const recruiter = await requireRole("RECRUITER");
      const jobId = url.searchParams.get("jobId");
      if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 });

      /**
       * CAND-002 / CAND-007 — parameters are READ BY NAME, one at a time.
       *
       * Never spread from the query string. `{...Object.fromEntries(params)}`
       * would work, would look tidy, and would mean any future column name
       * becomes a filter the moment someone guesses it — including the ones
       * that must never be filterable. Anything not named here is ignored.
       */
      const num = (k: string) => {
        const v = url.searchParams.get(k);
        if (v === null || v.trim() === "") return undefined;
        const n = Number(v);
        return Number.isFinite(n) ? n : undefined;
      };
      const skills = (url.searchParams.get("skills") ?? "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 12);

      return NextResponse.json({
        mode,
        cards: await recruiterDeck(recruiter, jobId, {
          skills: skills.length ? skills : undefined,
          minYearsExp: num("minYearsExp"),
          maxYearsExp: num("maxYearsExp"),
          maxSalaryTarget: num("maxSalaryTarget"),
          minScore: num("minScore"),
          remotePref: url.searchParams.get("remotePref") ?? undefined,
        }),
      });
    }

    if (user.role !== "CANDIDATE" && !user.isPlatformAdmin) {
      return NextResponse.json(
        { error: "This is an employer account.", code: "WRONG_ACCOUNT_TYPE" },
        { status: 403 }
      );
    }

    if (!user.profileReady) {
      return NextResponse.json({ error: "Finish onboarding first", needsOnboarding: true }, { status: 428 });
    }
    return NextResponse.json({ mode: "candidate", cards: await candidateDeck(user) });
  } catch (e) {
    const forbidden = authErrorResponse(e);
    if (forbidden) return forbidden;
    const status = e instanceof AuthError ? 401 : 400;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
