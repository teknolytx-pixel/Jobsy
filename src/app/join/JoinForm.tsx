"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, Logo } from "@/components/Icon";

/**
 * ORG-002 — accepting is an affirmative act, not a page load.
 *
 * The invitation is single-use. Consuming it because a mail scanner followed
 * the link would burn it before the person ever saw the page, and they would
 * arrive at "this invitation has already been used" with no way to tell whether
 * they or a robot used it.
 */
export default function JoinForm({
  token,
  email,
  name,
}: {
  token: string;
  email: string;
  name: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/company/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "This invitation could not be accepted.");
        return;
      }
      setDone(data.companyName ?? "your team");
      setTimeout(() => router.push("/recruiter"), 1400);
    } catch {
      setErr("Something went wrong. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <header className="top">
        <a href="/" className="logo">
          <Logo />
          <b>Jobsy</b>
        </a>
      </header>

      <div
        style={{
          margin: "40px auto",
          maxWidth: 460,
          padding: "0 24px",
          textAlign: "center",
          color: "var(--txt)",
        }}
      >
        <div style={{ marginBottom: 12, color: done ? "var(--go)" : "var(--brand)" }}>
            <Icon name={done ? "checkCircle" : "hand"} size={38} />
          </div>

        {done ? (
          <>
            <h3 style={{ margin: "0 0 10px" }}>You&rsquo;re in</h3>
            <p style={{ color: "var(--dim)", lineHeight: 1.6 }}>
              You&rsquo;ve joined <b style={{ color: "var(--txt)" }}>{done}</b>. Taking
              you to sourcing…
            </p>
          </>
        ) : (
          <>
            <h3 style={{ margin: "0 0 10px" }}>Join your team on Jobsy</h3>
            <p style={{ color: "var(--dim)", lineHeight: 1.6, margin: "0 0 6px" }}>
              You&rsquo;re signed in as <b style={{ color: "var(--txt)" }}>{name}</b>.
            </p>
            <p style={{ color: "var(--dim)", fontSize: 13, margin: "0 0 22px" }}>
              {email}
            </p>

            {err ? (
              <div className="err" style={{ marginBottom: 16, textAlign: "left" }}>
                {err}
              </div>
            ) : null}

            <button
              className="btn go"
              onClick={accept}
              disabled={busy}
              style={{ maxWidth: 280, margin: "0 auto" }}
            >
              {busy ? "Joining…" : "Accept invitation"}
            </button>

            {/*
              AC-5 — the invitation is bound to the address it was sent to, not
              to whoever holds the link. Saying so here means a mismatch is
              understood before it happens, rather than arriving as a refusal.
            */}
            <p
              style={{
                color: "var(--dim)",
                fontSize: 12.5,
                marginTop: 20,
                lineHeight: 1.6,
              }}
            >
              Invitations are tied to the email address they were sent to. If
              that isn&rsquo;t {email},{" "}
              <a href="/api/auth/logout" style={{ color: "var(--dim)", textDecoration: "underline" }}>
                sign out
              </a>{" "}
              and sign in with the right account.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
