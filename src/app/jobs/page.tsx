import WrongAccount from "@/components/WrongAccount";
import { redirect } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { applications, candidateSwipes, companies, db, jobs, matches, recruiterSwipes } from "@/db";
import { currentUser, hasRole } from "@/lib/auth";
import { Avatar } from "@/components/ui";
import { money, REMOTE_LABEL } from "@/components/format";
import { Icon, Logo } from "@/components/Icon";
import SignOutButton from "@/components/SignOutButton";

export const dynamic = "force-dynamic";

export default async function MyJobsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!hasRole(user, "RECRUITER"))
    return <WrongAccount need="RECRUITER" homeHref="/swipe" homeLabel="Go to your job feed" />;

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
        <a href="/home" className="logo">
          <Logo />
          <b>Jobsy</b>
        </a>
        <div className="spacer" />
        <a className="iconbtn" href="/recruiter"><Icon name="close" size={15} label="Close" /></a>
        <SignOutButton />
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
            <span className="big"><Icon name="target" size={34} /></span>
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
                  {r.job.applyMethod === "EASY" ? (
                    <>
                      <Icon name="bolt" size={12} style={{ display: "inline-block", verticalAlign: "-2px" }} /> Easy Apply
                    </>
                  ) : (
                    <>
                      <Icon name="external" size={12} style={{ display: "inline-block", verticalAlign: "-2px" }} /> External apply
                    </>
                  )}{" "}
                  · {r.seenBy} candidate
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
