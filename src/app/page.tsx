import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { companies, db, jobs } from "@/db";
import { currentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { Icon, Logo } from "@/components/Icon";

export const dynamic = "force-dynamic";

/**
 * THE PUBLIC HOME PAGE.
 *
 * Two audiences arrive here who want opposite things, and the previous version
 * gave them one "Get started" button between them. Everything after that button
 * — which deck you see, whether you can post a role — turns on a choice the page
 * never mentioned, so the first thing a visitor met was a form asking a question
 * they had not been prepared for.
 *
 * So the split is the primary content. Each path states plainly what that side
 * of the product does, and carries the choice through in the link, which the
 * signup form pre-selects. It stays changeable there: account type is permanent
 * once submitted, and a query parameter is not informed consent.
 *
 * Signed-in visitors never see any of this — they are redirected on line one.
 * A logged-in user landing on a marketing page is a navigation failure.
 */
export default async function Home() {
  const user = await currentUser();
  if (user) redirect(user.profileReady ? "/home" : "/onboarding");

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
        <div className="spacer" />
        <a className="topline" href="/login">
          Sign in
        </a>
      </header>

      <div className="page">
        <h1 className="hero">
          Swipe right on
          <br />
          your next job.
        </h1>
        <p className="lede">
          Jobsy is a two-sided hiring marketplace. Candidates swipe jobs, recruiters swipe
          candidates, and a conversation opens only when both sides say yes — so nobody is cold-
          messaged and nobody screens a pile of applications from people who were never eligible.
        </p>

        {/* The choice, made explicit and made first. */}
        <h2 className="sect-h">Where do you want to start?</h2>
        <div className="paths">
          <a className="path" href="/login?mode=signup&role=CANDIDATE">
            <span className="path-ico">
              <Icon name="briefcase" size={20} />
            </span>
            <b>I&rsquo;m looking for a job</b>
            <span className="path-sub">
              Build a profile or upload your CV, then swipe through roles you are actually eligible
              for. Every card shows why it matched and what you are missing.
            </span>
            <span className="path-go">
              Get started <Icon name="external" size={12} />
            </span>
          </a>

          <a className="path" href="/login?mode=signup&role=RECRUITER">
            <span className="path-ico">
              <Icon name="target" size={20} />
            </span>
            <b>I&rsquo;m hiring</b>
            <span className="path-sub">
              Post a role, or import one from a link or a document. Source ranked candidates who
              meet the requirements — location and work authorisation included, not bolted on.
            </span>
            <span className="path-go">
              Get started <Icon name="external" size={12} />
            </span>
          </a>
        </div>

        <div className="stat" style={{ marginTop: 16 }}>
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

        <h2 className="sect-h">How it works</h2>
        <ol className="steps">
          <li>
            <b>Say who you are.</b> Candidates add skills or upload a CV and Jobsy reads it.
            Recruiters post a role, or paste a link to one that already exists.
          </li>
          <li>
            <b>Swipe.</b> You see a ranked deck rather than a search box. Each card carries a match
            score, the skills you share, and the ones you don&rsquo;t.
          </li>
          <li>
            <b>Match, then talk.</b> Two right-swipes open a conversation. Until then, neither side
            can message the other.
          </li>
        </ol>

        <h2 className="sect-h">What makes the matching different</h2>
        <ul className="points">
          <li>
            <b>Eligibility comes before ranking.</b> If a role can&rsquo;t sponsor a visa and you
            need one, it isn&rsquo;t shown as a weak match — it isn&rsquo;t shown. The same applies
            to location and work model, on both sides.
          </li>
          <li>
            <b>Related skills count.</b> Vue counts toward React, Spark toward Databricks. You
            aren&rsquo;t filtered out for writing a skill by a different name.
          </li>
          <li>
            <b>Every score is explained.</b> No black box: you can see which requirements you met,
            which you missed, and what the gap actually is.
          </li>
          <li>
            <b>Protected characteristics are never used.</b> Not age, gender, school, photo or
            citizenship — a build check fails if any of them reaches the matching code.
          </li>
        </ul>

        <div className="note" style={{ marginTop: 20 }}>
          <b>How applying works.</b> Every job carries the route its poster chose. Easy Apply sends
          your profile the second you swipe. External jobs hand you to the company&rsquo;s own posting
          on LinkedIn, Indeed, Greenhouse or their careers site — your swipe is saved either way.
        </div>

        {env.linkedin.enabled ? (
          <a className="btn li" href="/api/auth/linkedin/start" style={{ marginTop: 14 }}>
            in&nbsp;&nbsp;Continue with LinkedIn
          </a>
        ) : null}
        <a className="btn ghost" href="/login" style={{ marginTop: 14 }}>
          I already have an account
        </a>

        <footer className="foot">
          <a href="/legal/terms">Terms</a>
          <span aria-hidden="true">·</span>
          <a href="/legal/privacy">Privacy</a>
        </footer>
      </div>
    </div>
  );
}
