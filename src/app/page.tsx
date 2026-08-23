import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { Icon, Logo } from "@/components/Icon";

export const dynamic = "force-dynamic";

/**
 * THE PUBLIC HOME PAGE.
 *
 * ── The argument it makes ──
 *
 * Neither side of hiring has a shortage. A candidate can see millions of
 * listings; a recruiter can see hundreds of CVs. What both lack is any way to
 * tell which of them are real. So the page does not compete on volume, and
 * deliberately shows no job counter — Jobsy has a few hundred postings against
 * aggregators with eight million, and a number that small would undercut the
 * argument even if it were larger. "You're not short of options, you're short
 * of the right ones" only works if the page isn't simultaneously bragging about
 * quantity.
 *
 * ── Why it is short ──
 *
 * The previous version explained the swipe model, listed three steps, four
 * differentiators and a paragraph on application routing. All true, none of it
 * read. Somebody deciding whether to sign up is answering one question — will
 * this waste my time like the last one did — and every extra section pushes the
 * answer further down the page.
 *
 * What survives: the feeling, the two doors, and three promises that are
 * specific enough to be checked. Nothing here claims scale, a success rate, or
 * a number of users, because none of those would be true yet and a landing page
 * that oversells is the first broken promise a product makes.
 */
export default async function Home() {
  const user = await currentUser();
  if (user) redirect(user.profileReady ? "/home" : "/onboarding");

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
          You&rsquo;re not short
          <br />
          of options.
          <br />
          <span className="hero-turn">You&rsquo;re short of the right ones.</span>
        </h1>

        <p className="lede">
          Job hunting means sending fifty applications into silence. Hiring means reading three
          hundred CVs to find four people worth calling. Both sides are exhausted — and both sides
          are looking for each other.
        </p>
        <p className="lede" style={{ marginTop: 12 }}>
          Jobsy only shows you the ones that genuinely fit, and opens a conversation the moment you
          both say yes.
        </p>

        <div className="paths">
          <a className="path" href="/login?mode=signup&role=CANDIDATE">
            <span className="path-ico">
              <Icon name="briefcase" size={20} />
            </span>
            <b>I&rsquo;m looking for a job</b>
            <span className="path-sub">
              Swipe through roles you can actually get, and see exactly why each one matched.
            </span>
            <span className="path-go">
              Start here <Icon name="external" size={12} />
            </span>
          </a>

          <a className="path" href="/login?mode=signup&role=RECRUITER">
            <span className="path-ico">
              <Icon name="target" size={20} />
            </span>
            <b>I&rsquo;m hiring</b>
            <span className="path-sub">
              Post a role and meet the people who meet it — not the three hundred who don&rsquo;t.
            </span>
            <span className="path-go">
              Start here <Icon name="external" size={12} />
            </span>
          </a>
        </div>

        {/*
          Three promises, each one specific enough that a user could catch us
          breaking it. Vague reassurance ("smarter matching", "powered by AI")
          is unfalsifiable, which is why nobody believes it.
        */}
        <ul className="promises">
          <li>
            <b>Only what actually fits.</b> If a role can&rsquo;t sponsor a visa you need, or is
            onsite somewhere you aren&rsquo;t, it isn&rsquo;t shown as a weak match — it isn&rsquo;t
            shown.
          </li>
          <li>
            <b>Nobody messages you first.</b> A conversation opens only when you have both said yes.
            Until then, neither side can reach the other.
          </li>
          <li>
            <b>You always know why.</b> Every match shows the skills you share, the ones you&rsquo;re
            missing, and what the score is made of. No black box.
          </li>
        </ul>

        <a className="btn" href="/login?mode=signup">
          Create your account
        </a>
        {env.linkedin.enabled ? (
          <a className="btn li" href="/api/auth/linkedin/start">
            in&nbsp;&nbsp;Continue with LinkedIn
          </a>
        ) : null}
        <a className="btn ghost" href="/login">
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
