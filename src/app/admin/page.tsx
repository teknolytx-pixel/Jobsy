import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { Icon, Logo } from "@/components/Icon";
import AdminConsole from "./AdminConsole";
import SignOutButton from "@/components/SignOutButton";

export const dynamic = "force-dynamic";

/**
 * ADMIN-005 / ADMIN-006 — the console.
 *
 * Both admin APIs have existed and been enforced with `requirePlatformAdmin`
 * since they were written, and there has never been a page that calls either
 * one. The moderation queue could receive reports and nobody could read them;
 * the compliance console could compute which privacy requests were overdue and
 * nobody could see the number.
 *
 * That is a worse failure than a missing feature. A report filed by a user
 * creates an obligation the moment it arrives, and a 45-day statutory clock on
 * a privacy request runs whether or not anyone is looking at it.
 */
export default async function AdminPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  // Not a 404. A 404 would be a lie — the page exists, this account may not see
  // it — and it teaches an admin who mistyped nothing about what went wrong.
  if (!user.isPlatformAdmin) {
    return (
      <div className="shell">
        <header className="top">
          <a href="/home" className="logo">
            <Logo />
            <b>Jobsy</b>
          </a>
          <SignOutButton />
        </header>
        <div className="center">
          <div style={{ color: "var(--gold)" }}>
            <Icon name="key" size={38} />
          </div>
          <h3 style={{ margin: 0 }}>Administrator access required</h3>
          <p style={{ color: "var(--dim)", maxWidth: 320, lineHeight: 1.6 }}>
            This console shows moderation reports and privacy requests across every
            account, so it&rsquo;s limited to platform administrators. You&rsquo;re signed
            in as <b>{user.email}</b>.
          </p>
          <a className="btn ghost" href="/" style={{ maxWidth: 260 }}>
            Back to Jobsy
          </a>
        </div>
      </div>
    );
  }

  return <AdminConsole email={user.email} />;
}
