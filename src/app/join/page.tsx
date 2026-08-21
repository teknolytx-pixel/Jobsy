import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import JoinForm from "./JoinForm";

export const dynamic = "force-dynamic";

/**
 * ORG-002 — the page every company invitation email has been linking to.
 *
 * The invitation flow was complete on the server: tokens hashed, expiry
 * enforced, seat limits checked twice, the email composed and sent. The link in
 * that email pointed at `/join?token=…`, and this page did not exist — so every
 * person invited to a company since the feature shipped got a 404 from a
 * correctly-generated, cryptographically-sound invitation.
 *
 * The token is deliberately NOT verified here. A GET that validates a
 * single-use token is a GET with a side effect, and mail scanners, link
 * previewers and prefetchers all follow links in email. Acceptance is a POST
 * the invitee makes on purpose.
 */
export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const user = await currentUser();

  if (!token) {
    return (
      <div className="shell">
        <header className="top">
          <a href="/" className="logo">
            <span className="spark">🔥</span>
            <b>Jobsy</b>
          </a>
        </header>
        <div style={{ margin: "48px auto", maxWidth: 460, padding: "0 24px", textAlign: "center", color: "var(--txt)" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✉️</div>
          <h3 style={{ margin: "0 0 10px" }}>Invitation link incomplete</h3>
          <p style={{ color: "var(--dim)", lineHeight: 1.6 }}>
            This link is missing its token. Open the invitation from your email
            again, or ask your admin to resend it.
          </p>
        </div>
      </div>
    );
  }

  // Signed out: keep the token through the round trip, so the invitee lands
  // back here rather than on a generic deck with nothing to click.
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/join?token=${token}`)}`);
  }

  return <JoinForm token={token} email={user.email} name={user.name} />;
}
