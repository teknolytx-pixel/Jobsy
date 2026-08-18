import { redirect } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { applications, candidateSwipes, companies, db, jobs, matches, recruiterSwipes } from "@/db";
import { currentUser } from "@/lib/auth";
import { Avatar } from "@/components/ui";
import { money, REMOTE_LABEL } from "@/components/format";

export const dynamic = "force-dynamic";

export default async function MyJobsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const rows = await db
    .select({
      job: jobs,
      company: companies,
      applicants: sql<number>`(select count(*)::int from ${applications} where ${applications.jobId} = ${jobs.id})`,
      matched: sql<number>`(select count(*)::int from ${matches} where ${matches.jobId} = ${jobs.id})`,
      reviewed: sql<number>`(select count(*)::int from ${recruiterSwipes} where ${recruiterSwipes.jobId} = ${jobs.id})`,
      seenBy: sql<number>`(select count(*)::int from ${candidateSwipes} where ${candidateSwipes.jobId} = ${jobs.id})`,
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(eq(jobs.postedById, user.id))
    .orderBy(desc(jobs.postedAt));

  return (
    <div className="shell">
      <header className="top">
        <a href="/recruiter" className="logo">
          <span className="spark">🔥</span>
          <b>Jobsy</b>
        </a>
        <div className="spacer" />
        <a className="iconbtn" href="/recruiter">
          ✕
        </a>
      </header>

      <div className="tabs">
        <a href="/recruiter">Source</a>
        <a href="/matches">Matches</a>
        <button className="on">My posts{rows.length ? <span className="n">{rows.length}</span> : null}</button>
        <a href="/sources">Companies</a>
      </div>

      <div className="list">
        {rows.length === 0 ? (
          <div className="emptylist">
            <span className="big">🎯</span>
            <b>No job posts yet</b>
            <br />
            Post one from the Recruiter tab to start sourcing candidates against it.
          </div>
        ) : (
          rows.map((r) => (
            <div key={r.job.id} className="row">
              <Avatar name={r.company.name} seed={r.job.id} />
              <div className="g">
                <div className="t">{r.job.title}</div>
                <div className="s">
                  {r.job.location} · {REMOTE_LABEL[r.job.remote] ?? r.job.remote} ·{" "}
                  {money(r.job.salaryMin, r.job.salaryMax)}
                </div>
                <div className="s2">
                  {r.job.applyMethod === "EASY" ? "⚡ Easy Apply" : "↗ External apply"} · {r.seenBy} candidate
                  swipes · {r.applicants} applied · {r.reviewed} reviewed · {r.matched} matched
                </div>
              </div>
              <span className={`badge ${r.job.active ? "a" : "s"}`}>{r.job.active ? "Live" : "Closed"}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
