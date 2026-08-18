import { NextResponse } from "next/server";
import { aliasedTable, desc, eq, or, sql } from "drizzle-orm";
import { companies, db, jobs, matches, messages, users } from "@/db";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const cand = aliasedTable(users, "cand");
    const rec = aliasedTable(users, "rec");

    const rows = await db
      .select({
        match: matches,
        job: jobs,
        company: companies,
        cand: { id: cand.id, name: cand.name, headline: cand.headline, image: cand.image, email: cand.email },
        rec: { id: rec.id, name: rec.name, title: rec.title, image: rec.image, email: rec.email },
        msgCount: sql<number>`(select count(*)::int from ${messages} where ${messages.matchId} = ${matches.id})`,
      })
      .from(matches)
      .innerJoin(jobs, eq(matches.jobId, jobs.id))
      .innerJoin(companies, eq(jobs.companyId, companies.id))
      .innerJoin(cand, eq(matches.candidateId, cand.id))
      .innerJoin(rec, eq(matches.recruiterId, rec.id))
      .where(or(eq(matches.candidateId, user.id), eq(matches.recruiterId, user.id)))
      .orderBy(desc(matches.createdAt));

    return NextResponse.json({
      matches: rows.map((r) => {
        const iAmCandidate = r.match.candidateId === user.id;
        const other = iAmCandidate ? r.rec : r.cand;
        return {
          id: r.match.id,
          jobTitle: r.job.title,
          company: r.company.name,
          score: r.match.score,
          createdAt: r.match.createdAt.toISOString(),
          perspective: iAmCandidate ? "candidate" : "recruiter",
          messageCount: r.msgCount,
          other: {
            id: other.id,
            name: other.name,
            subtitle: iAmCandidate ? (r.rec.title ?? "Hiring team") : (r.cand.headline ?? "Candidate"),
            email: other.email,
            image: other.image,
          },
        };
      }),
    });
  } catch {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
}
