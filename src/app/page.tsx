import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { companies, db, jobs } from "@/db";
import { currentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { Logo } from "@/components/Icon";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await currentUser();
  if (user) redirect(user.profileReady ? "/swipe" : "/onboarding");

  let jobCount = 0;
  let companyCount = 0;
  try {
    const [j] = await db.select({ n: sql<number>`count(*)::int` }).from(jobs).where(eq(jobs.active, true));
    const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(companies);
    jobCount = j?.n ?? 0;
    companyCount = c?.n ?? 0;
  } catch {
    // DB not migrated yet — the landing page still renders
  }

  return (
    <div className="shell">
      <header className="top">
        <div className="logo">
          <Logo />
          <b>Jobsy</b>
        </div>
      </header>

      <div style={{ padding: "20px 16px 0" }}>
        <h1 style={{ fontSize: 34, lineHeight: 1.1, letterSpacing: "-1.2px", margin: "0 0 12px" }}>
          Swipe right on
          <br />
          your next job.
        </h1>
        <p style={{ color: "var(--dim)", fontSize: 15, lineHeight: 1.6, margin: 0 }}>
          Candidates swipe jobs. Recruiters swipe candidates. When you both swipe right it&rsquo;s a
          match — and the conversation opens instantly.
        </p>

        <div className="stat" style={{ marginTop: 18 }}>
          <div>
            <b>{jobCount.toLocaleString()}</b>
            <span>Live jobs</span>
          </div>
          <div>
            <b>{companyCount.toLocaleString()}</b>
            <span>Companies</span>
          </div>
          <div>
            <b>1</b>
            <span>Swipe to apply</span>
          </div>
        </div>

        <a className="btn" href="/login?mode=signup">
          Get started
        </a>
        {env.linkedin.enabled ? (
          <a className="btn li" href="/api/auth/linkedin/start">
            in&nbsp;&nbsp;Continue with LinkedIn
          </a>
        ) : null}
        <a className="btn ghost" href="/login">
          I already have an account
        </a>

        <div className="note" style={{ marginTop: 22 }}>
          <b>How applying works.</b> Every job carries the route its poster chose. Easy Apply sends
          your profile the second you swipe. External jobs hand you to the company&rsquo;s own posting
          on LinkedIn, Indeed, Greenhouse or their careers site — your swipe is saved either way.
        </div>
      </div>
    </div>
  );
}
