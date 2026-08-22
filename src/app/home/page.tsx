import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { Icon, Logo } from "@/components/Icon";
import SignOutButton from "@/components/SignOutButton";

export const dynamic = "force-dynamic";

/**
 * "Home", for a product that has two of them.
 *
 * Every page's wordmark now points here instead of at a hardcoded destination.
 * That was the bug worth fixing: the logo on the recruiter's job list linked to
 * `/swipe`, so clicking the thing that means "take me home" took an employer to
 * the candidate's job deck, which their account cannot even use. Several
 * screens had no way back at all.
 *
 * A route that decides is better than eleven links that guess. It also means
 * the answer changes in one place when the product grows a third surface.
 */
export default async function HomePage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  /**
   * An administrator is the one account with two homes.
   *
   * `hasRole()` has always returned true for a platform admin against either
   * role, so these accounts could always use both surfaces — there was just no
   * link to the other one, because AUTH-002 removed the role switcher to stop
   * ordinary accounts hopping sides. That was right for them and wrong for the
   * one account type meant to see both.
   *
   * This is not the old switcher. It changes nothing about the account; it is
   * two links, shown only to admins.
   */
  if (user.isPlatformAdmin) {
    return (
      <div className="shell">
        <header className="top">
          <span className="logo">
            <Logo />
            <b>Jobsy</b>
          </span>
          <div className="spacer" />
          <span className="pill">admin</span>
          <SignOutButton />
        </header>

        <div className="list">
          <div className="sect">
            <h4>Where to?</h4>
          </div>
          <p style={{ color: "var(--dim)", fontSize: 13.5, margin: "0 0 14px", lineHeight: 1.6 }}>
            Your account is an administrator, so it can use both sides. Everyone
            else has exactly one.
          </p>

          {[
            { href: "/swipe", icon: "briefcase" as const, t: "Job seeker", s: "Swipe jobs, applications, matches, resume" },
            { href: "/recruiter", icon: "target" as const, t: "Recruiter", s: "Source candidates, post roles, review applicants" },
            { href: "/admin", icon: "key" as const, t: "Admin console", s: "Moderation queue and compliance" },
          ].map((l) => (
            <a key={l.href} className="row" href={l.href} style={{ alignItems: "center" }}>
              <span className="av" style={{ width: 40, height: 40, background: "var(--card2)", color: "var(--brand)" }}>
                <Icon name={l.icon} size={19} />
              </span>
              <div className="g">
                <div className="t">{l.t}</div>
                <div className="s2">{l.s}</div>
              </div>
              <Icon name="external" size={14} style={{ color: "var(--dim2)" }} />
            </a>
          ))}
        </div>
      </div>
    );
  }

  // One account, one role. The redirect is instant and never shows a chooser
  // for a choice that does not exist.
  redirect(user.role === "RECRUITER" ? "/recruiter" : "/swipe");
}
