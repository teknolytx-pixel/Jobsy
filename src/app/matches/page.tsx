import { redirect } from "next/navigation";
import { aliasedTable, desc, eq, or, sql } from "drizzle-orm";
import { companies, db, jobs, matches, messages, users } from "@/db";
import { currentUser } from "@/lib/auth";
import { Avatar } from "@/components/ui";
import { Icon, Logo } from "@/components/Icon";

export const dynamic = "force-dynamic";

export default async function MatchesPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const cand = aliasedTable(users, "cand");
  const rec = aliasedTable(users, "rec");

  const rows = await db
    .select({
      match: matches,
      jobTitle: jobs.title,
      company: companies.name,
      cand: { id: cand.id, name: cand.name, headline: cand.headline, image: cand.image },
      rec: { id: rec.id, name: rec.name, title: rec.title, image: rec.image },
      msgCount: sql<number>`(select count(*)::int from ${messages} where ${messages.matchId} = ${matches.id})`,
      lastMsg: sql<string | null>`(select ${messages.body} from ${messages} where ${messages.matchId} = ${matches.id} order by ${messages.createdAt} desc limit 1)`,
    })
    .from(matches)
    .innerJoin(jobs, eq(matches.jobId, jobs.id))
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .innerJoin(cand, eq(matches.candidateId, cand.id))
    .innerJoin(rec, eq(matches.recruiterId, rec.id))
    .where(or(eq(matches.candidateId, user.id), eq(matches.recruiterId, user.id)))
    .orderBy(desc(matches.createdAt));

  return (
    <div className="shell">
      <header className="top">
        <a href="/swipe" className="logo">
          <Logo />
          <b>Jobsy</b>
        </a>
        <div className="spacer" />
        <a className="iconbtn" href="/swipe" title="Back to swiping"><Icon name="close" size={15} label="Close" /></a>
      </header>

      <div className="tabs">
        <a href="/swipe">Discover</a>
        <a href="/applied">Applied</a>
        <button className="on">
          Matches{rows.length ? <span className="n">{rows.length}</span> : null}
        </button>
        <a href="/resume">Resume</a>
      </div>

      <div className="list">
        {rows.length === 0 ? (
          <div className="emptylist">
            <span className="big"><Icon name="sparkle" size={34} /></span>
            <b>No matches yet</b>
            <br />A match happens when both sides swipe right on the same job. Keep swiping — or post a
            job and start sourcing.
          </div>
        ) : (
          rows.map((r) => {
            const iAmCandidate = r.match.candidateId === user.id;
            const other = iAmCandidate ? r.rec : r.cand;
            const subtitle = iAmCandidate ? (r.rec.title ?? "Hiring team") : (r.cand.headline ?? "Candidate");
            return (
              <a key={r.match.id} href={`/matches/${r.match.id}`} className="row">
                <Avatar name={other.name} seed={other.id} image={other.image} />
                <div className="g">
                  <div className="t">{other.name}</div>
                  <div className="s">
                    {subtitle} · {r.jobTitle}
                  </div>
                  <div className="s2">
                    {r.lastMsg
                      ? `“${r.lastMsg.slice(0, 70)}${r.lastMsg.length > 70 ? "…" : ""}”`
                      : `${r.company} · ${r.match.score}% fit · say hello`}
                  </div>
                </div>
                <span className="badge m">{r.msgCount ? `${r.msgCount} msg` : "New"}</span>
              </a>
            );
          })
        )}
      </div>
    </div>
  );
}
