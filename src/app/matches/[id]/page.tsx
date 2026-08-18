import { notFound, redirect } from "next/navigation";
import { aliasedTable, asc, eq } from "drizzle-orm";
import { companies, db, jobs, matches, messages, users } from "@/db";
import { currentUser } from "@/lib/auth";
import Chat from "./Chat";

export const dynamic = "force-dynamic";

export default async function MatchThread({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect("/login");

  const cand = aliasedTable(users, "cand");
  const rec = aliasedTable(users, "rec");

  const rows = await db
    .select({
      match: matches,
      job: jobs,
      company: companies,
      cand: { id: cand.id, name: cand.name, headline: cand.headline, image: cand.image, email: cand.email },
      rec: { id: rec.id, name: rec.name, title: rec.title, image: rec.image, email: rec.email },
    })
    .from(matches)
    .innerJoin(jobs, eq(matches.jobId, jobs.id))
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .innerJoin(cand, eq(matches.candidateId, cand.id))
    .innerJoin(rec, eq(matches.recruiterId, rec.id))
    .where(eq(matches.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) notFound();
  if (row.match.candidateId !== user.id && row.match.recruiterId !== user.id) notFound();

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.matchId, id))
    .orderBy(asc(messages.createdAt))
    .limit(200);

  const iAmCandidate = row.match.candidateId === user.id;
  const other = iAmCandidate ? row.rec : row.cand;

  return (
    <Chat
      matchId={row.match.id}
      other={{
        id: other.id,
        name: other.name,
        image: other.image,
        subtitle: iAmCandidate ? (row.rec.title ?? "Hiring team") : (row.cand.headline ?? "Candidate"),
        email: other.email,
      }}
      job={{ title: row.job.title, company: row.company.name, location: row.job.location }}
      score={row.match.score}
      initial={msgs.map((m) => ({
        id: m.id,
        body: m.body,
        at: m.createdAt.toISOString(),
        mine: m.senderId === user.id,
      }))}
    />
  );
}
