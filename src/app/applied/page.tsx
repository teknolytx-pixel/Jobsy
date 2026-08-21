import WrongAccount from "@/components/WrongAccount";
import { redirect } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { applications, candidateSwipes, companies, db, jobs, matches } from "@/db";
import { currentUser, hasRole } from "@/lib/auth";
import { Avatar } from "@/components/ui";
import { money, SOURCE_LABEL } from "@/components/format";

export const dynamic = "force-dynamic";

const n = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;

export default async function AppliedPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!hasRole(user, "CANDIDATE"))
    return <WrongAccount need="CANDIDATE" homeHref="/recruiter" homeLabel="Go to sourcing" />;

  const [rows, likes, matchCount] = await Promise.all([
    db
      .select({ app: applications, job: jobs, company: companies })
      .from(applications)
      .innerJoin(jobs, eq(applications.jobId, jobs.id))
      .innerJoin(companies, eq(jobs.companyId, companies.id))
      .where(eq(applications.candidateId, user.id))
      .orderBy(desc(applications.createdAt)),
    n(
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(candidateSwipes)
        .where(and(eq(candidateSwipes.candidateId, user.id), eq(candidateSwipes.direction, "LIKE")))
    ),
    n(db.select({ n: sql<number>`count(*)::int` }).from(matches).where(eq(matches.candidateId, user.id))),
  ]);

  return (
    <div className="shell">
      <header className="top">
        <a href="/swipe" className="logo">
          <span className="spark">🔥</span>
          <b>Jobsy</b>
        </a>
        <div className="spacer" />
        <a className="iconbtn" href="/swipe">
          ✕
        </a>
      </header>

      <div className="tabs">
        <a href="/swipe">Discover</a>
        <button className="on">
          Applied{rows.length ? <span className="n">{rows.length}</span> : null}
        </button>
        <a href="/matches">Matches{matchCount ? <span className="n">{matchCount}</span> : null}</a>
      </div>

      <div className="list">
        <div className="stat">
          <div>
            <b>{rows.length}</b>
            <span>Applied</span>
          </div>
          <div>
            <b>{likes}</b>
            <span>Liked</span>
          </div>
          <div>
            <b>{matchCount}</b>
            <span>Matches</span>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="emptylist">
            <span className="big">💼</span>
            <b>Nothing applied yet</b>
            <br />
            Swipe right on a job in Discover and it lands here.
          </div>
        ) : (
          rows.map((r) => (
            <div key={r.app.id} className="row">
              <Avatar name={r.company.name} seed={r.job.id} />
              <div className="g">
                <div className="t">{r.job.title}</div>
                <div className="s">
                  {r.company.name} · {r.job.location}
                </div>
                <div className="s2">
                  {r.app.method === "EASY"
                    ? "⚡ Easy Apply"
                    : `↗ ${SOURCE_LABEL[r.job.source] ?? r.job.source}`}{" "}
                  · {money(r.job.salaryMin, r.job.salaryMax)} ·{" "}
                  {r.app.createdAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </div>
              </div>
              <span className={`badge ${r.app.method === "EASY" ? "a" : "s"}`}>{r.app.status}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
