import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { applications, db, jobs, matches } from "@/db";
import { currentUser } from "@/lib/auth";
import CandidateSwipe from "./CandidateSwipe";

export const dynamic = "force-dynamic";

const countOf = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;

export default async function SwipePage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.profileReady) redirect("/onboarding");

  const [applied, matchCount, myJobs] = await Promise.all([
    countOf(
      db.select({ n: sql<number>`count(*)::int` }).from(applications).where(eq(applications.candidateId, user.id))
    ),
    countOf(db.select({ n: sql<number>`count(*)::int` }).from(matches).where(eq(matches.candidateId, user.id))),
    countOf(db.select({ n: sql<number>`count(*)::int` }).from(jobs).where(eq(jobs.postedById, user.id))),
  ]);

  return (
    <CandidateSwipe
      me={{ id: user.id, name: user.name, image: user.image }}
      counts={{ applied, matches: matchCount }}
      hasJobPosts={myJobs > 0}
    />
  );
}
