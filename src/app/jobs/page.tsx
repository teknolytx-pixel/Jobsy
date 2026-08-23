import WrongAccount from "@/components/WrongAccount";
import { redirect } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { applications, candidateSwipes, companies, db, jobs, matches, recruiterSwipes } from "@/db";
import { currentUser, hasRole } from "@/lib/auth";
import { Avatar } from "@/components/ui";
import { money, REMOTE_LABEL } from "@/components/format";
import { Icon, Logo } from "@/components/Icon";
import SignOutButton from "@/components/SignOutButton";
import JobActions from "./JobActions";
import { JOB_STATUS_LABEL, type JobStatus } from "@/lib/jobStatus";

export const dynamic = "force-dynamic";

/** Badge text. The full sentence lives in JOB_STATUS_LABEL, inside the sheet. */
const SHORT_STATUS: Record<JobStatus, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Live",
  PAUSED: "Paused",
  CLOSED: "Closed",
  ARCHIVED: "Archived",
};

/** Green for live, blue for anything still actionable, muted for finished. */
const statusTone = (s: JobStatus) => (s === "PUBLISHED" ? "a" : s === "DRAFT" || s === "PAUSED" ? "s" : "m");

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
              {/*
                The real status, not a boolean.
                "Live or Closed" collapsed five states into two, so a DRAFT and
                a PAUSED and an ARCHIVED posting all read as "Closed" — which is
                exactly the confusion that made the draft feel like a black hole.
              */}
              <span className={`badge ${statusTone(r.job.status as JobStatus)}`}>
                {SHORT_STATUS[r.job.status as JobStatus] ?? r.job.status}
              </span>
              <JobActions
                jobId={r.job.id}
                status={r.job.status as JobStatus}
                editable={r.job.source === "JOBSY"}
                title={r.job.title}
                location={r.job.location}
                salaryMin={r.job.salaryMin}
                salaryMax={r.job.salaryMax}
                benefitsDescription={r.job.benefitsDescription}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
