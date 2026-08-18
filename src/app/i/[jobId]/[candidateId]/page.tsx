import { eq } from "drizzle-orm";
import { companies, db, jobs } from "@/db";
import { respondToInterest } from "@/lib/swipe";

export const dynamic = "force-dynamic";

/**
 * Landing page for the two buttons in the recruiter-interest email.
 *   ?r=yes → recorded as a LIKE → match + chat opens
 *   ?r=no  → recorded as a PASS, no further email about this role
 */
export default async function InterestResponse({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string; candidateId: string }>;
  searchParams: Promise<{ r?: string }>;
}) {
  const { jobId, candidateId } = await params;
  const { r } = await searchParams;
  const interested = r === "yes";

  const rows = await db
    .select({ job: jobs, company: companies })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(eq(jobs.id, jobId))
    .limit(1);
  const row = rows[0];

  if (!row) {
    return (
      <div className="center">
        <div style={{ fontSize: 40 }}>🤔</div>
        <h1 style={{ fontSize: 20, margin: 0 }}>That role is no longer listed</h1>
        <p style={{ color: "var(--dim)", maxWidth: 320 }}>
          The posting was removed or filled. Plenty more waiting.
        </p>
        <a className="btn" href="/swipe" style={{ maxWidth: 240 }}>
          Browse jobs
        </a>
      </div>
    );
  }

  let result: { matched: boolean; matchId?: string } = { matched: false };
  let error: string | null = null;
  try {
    result = await respondToInterest(jobId, candidateId, interested);
  } catch (e) {
    error = (e as Error).message;
  }

  if (error) {
    return (
      <div className="center">
        <div style={{ fontSize: 40 }}>⚠️</div>
        <h1 style={{ fontSize: 20, margin: 0 }}>Couldn&rsquo;t record that</h1>
        <p style={{ color: "var(--dim)", maxWidth: 320 }}>{error}</p>
        <a className="btn ghost" href="/swipe" style={{ maxWidth: 240 }}>
          Open Jobsy
        </a>
      </div>
    );
  }

  if (!interested) {
    return (
      <div className="center">
        <div style={{ fontSize: 40 }}>👍</div>
        <h1 style={{ fontSize: 22, margin: 0, letterSpacing: "-.4px" }}>Noted — no thanks</h1>
        <p style={{ color: "var(--dim)", maxWidth: 330, lineHeight: 1.6 }}>
          We told {row.company.name} you&rsquo;re not interested in {row.job.title} right now, and you
          won&rsquo;t hear about this role again.
        </p>
        <a className="btn ghost" href="/swipe" style={{ maxWidth: 240 }}>
          See roles that do fit
        </a>
      </div>
    );
  }

  return (
    <div className="center">
      <div style={{ fontSize: 44 }}>🔥</div>
      <h1
        style={{
          fontSize: 30,
          margin: 0,
          letterSpacing: "-1px",
          background: "linear-gradient(100deg,#fff,#ffb3c1)",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
        }}
      >
        It&rsquo;s a match!
      </h1>
      <p style={{ color: "var(--dim)", maxWidth: 340, lineHeight: 1.6 }}>
        You and {row.company.name} both want to talk about{" "}
        <b style={{ color: "var(--txt)" }}>{row.job.title}</b>. The conversation is open.
      </p>
      <a
        className="btn"
        href={result.matchId ? `/matches/${result.matchId}` : "/matches"}
        style={{ maxWidth: 260 }}
      >
        💬 Open the conversation
      </a>
      <a className="btn ghost" href="/swipe" style={{ maxWidth: 260 }}>
        Keep swiping
      </a>
    </div>
  );
}
