import WrongAccount from "@/components/WrongAccount";
import { redirect } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { companies, db, jobs, matches } from "@/db";
import { currentUser, hasRole } from "@/lib/auth";
import RecruiterSwipe from "./RecruiterSwipe";

export const dynamic = "force-dynamic";

export default async function RecruiterPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!hasRole(user, "RECRUITER"))
    return <WrongAccount need="RECRUITER" homeHref="/swipe" homeLabel="Go to your job feed" />;

  const rows = await db
    .select({ job: jobs, company: companies })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(and(eq(jobs.postedById, user.id), eq(jobs.active, true)))
    .orderBy(desc(jobs.postedAt));

  const [m] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(matches)
    .where(eq(matches.recruiterId, user.id));

  return (
    <RecruiterSwipe
      me={{ id: user.id, name: user.name, image: user.image }}
      jobs={rows.map((r) => ({
        id: r.job.id,
        title: r.job.title,
        company: r.company.name,
        location: r.job.location,
        applyMethod: r.job.applyMethod,
      }))}
      matchCount={m?.n ?? 0}
    />
  );
}
