import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { applications, db, jobs, matches } from "@/db";
import { currentUser } from "@/lib/auth";
import { candidateGeoDiagnostics } from "@/lib/deck";
import CandidateSwipe from "./CandidateSwipe";

export const dynamic = "force-dynamic";

const countOf = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;

export default async function SwipePage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.profileReady) redirect("/onboarding");

  // GEO-007 — if geography is why the deck is thin, say so. An empty deck with
  // no explanation reads as a broken product, and a candidate who has never
  // turned international search on has no way to guess that is the reason.
  const [applied, matchCount, myJobs, geo] = await Promise.all([
    countOf(
      db.select({ n: sql<number>`count(*)::int` }).from(applications).where(eq(applications.candidateId, user.id))
    ),
    countOf(db.select({ n: sql<number>`count(*)::int` }).from(matches).where(eq(matches.candidateId, user.id))),
    countOf(db.select({ n: sql<number>`count(*)::int` }).from(jobs).where(eq(jobs.postedById, user.id))),
    candidateGeoDiagnostics(user),
  ]);

  return (
    <CandidateSwipe
      me={{ id: user.id, name: user.name, image: user.image }}
      counts={{ applied, matches: matchCount }}
      hasJobPosts={myJobs > 0}
      geo={geo}
    />
  );
}
