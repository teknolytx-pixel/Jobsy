"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon, Logo } from "@/components/Icon";

/**
 * LEGAL-009 — enforceable clickwrap.
 *
 * The Terms are only as good as this screen. Courts decide enforceability on
 * layout, not on drafting:
 *
 *   • Chabolla v. ClassPass (9th Cir. 2025) — arbitration clause VOIDED. The
 *     notice was smaller peripheral text, spread across screens, and the button
 *     said something different from the notice.
 *   • Tejon v. Zeus Networks (11th Cir. 2026) — no assent. "Small gray text
 *     overshadowed by prominent red buttons."
 *   • Dahdah v. Rocket Mortgage (6th Cir. 2026) — ENFORCED despite small font,
 *     because the notice sat directly adjacent to the button.
 *
 * So, deliberately, in this order:
 *   1. A separate checkbox that must be actively ticked — clickwrap, not
 *      sign-in wrap. The server rejects a signup without it, so it cannot be
 *      skipped by calling the API directly.
 *   2. The notice sits DIRECTLY ABOVE the action button, inside the flow.
 *   3. The button text MATCHES the notice: "By clicking Create Account…".
 *   4. Full-contrast text, underlined links. Not "timid light grey".
 */
const TERMS_HREF = "/legal/terms";
const PRIVACY_HREF = "/legal/privacy";

export default function LoginForm({
  linkedinEnabled,
  showSetupHint = false,
}: {
  linkedinEnabled: boolean;
  /** True only outside production — see the note further down. */
  showSetupHint?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [signup, setSignup] = useState(params.get("mode") === "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [accepted, setAccepted] = useState(false);
  // CAN-001 / REC-001 — asked once, at signup, and it is permanent. Null until
  // chosen so the form cannot be submitted on a default nobody read.
  /**
   * Pre-selected from ?role= when the home page sent them down a specific path.
   *
   * Only ever a PRE-selection: the choice is permanent once submitted, so the
   * control stays visible and changeable. A link that silently decided which
   * side of the marketplace somebody is on — from a query parameter they never
   * saw — would be the one irreversible decision in the product made for them.
   */
  const roleParam = params.get("role")?.toUpperCase();
  const [role, setRole] = useState<"CANDIDATE" | "RECRUITER" | null>(
    roleParam === "CANDIDATE" || roleParam === "RECRUITER" ? roleParam : null
  );
  const [err, setErr] = useState<string | null>(params.get("error"));
  const [notice, setNotice] = useState<string | null>(
    params.get("verified") ? "Your email is verified — welcome to Jobsy." : null
  );
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (signup && !role) {
      setErr("Tell us whether you're looking for a job or hiring — accounts are one or the other.");
      return;
    }
    if (signup && !accepted) {
      setErr("Please accept the Terms of Service and Privacy Policy to continue.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(signup ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          signup ? { email, password, name, role, acceptedTerms: true } : { email, password }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "Something went wrong");
        return;
      }
      if (signup) {
        // AUTH-006 — say what happens next, rather than letting the first
        // "verify your email" wall come as a surprise.
        setNotice("Check your inbox — we've sent you a link to verify your email address.");
      }
      /**
       * ORG-002 — return the person to where they were going.
       *
       * An invitation link sends a signed-out invitee here with ?next=/join?…
       * Without honouring it they land on a deck with no mention of the
       * invitation they just clicked, and the token is left unused in an email
       * they have already opened. Onboarding still wins: an unfinished profile
       * cannot use most destinations anyway.
       *
       * Only same-origin PATHS are followed. Taking an absolute URL from a
       * query parameter is an open redirect, which is a phishing primitive.
       */
      const raw = params.get("next");
      const next = raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : null;
      router.push(!data.profileReady ? "/onboarding" : (next ?? "/swipe"));
      router.refresh();
    } catch {
      setErr("Network error — is the server running?");
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

      <div style={{ padding: "12px 16px 24px" }}>
        <h1 style={{ fontSize: 26, letterSpacing: "-.6px", margin: "0 0 6px" }}>
          {signup ? "Create your account" : "Welcome back"}
        </h1>
        <p style={{ color: "var(--dim)", fontSize: 13.5, margin: "0 0 4px" }}>
          {signup
            ? // This said "one profile works for both sides" — written when that
              // was true, and left sitting directly above the control that now
              // tells you the opposite. Copy that contradicts the rule on the
              // same screen is worse than no copy.
              "Takes a minute. Pick a side below — it decides what Jobsy shows you."
            : "Sign in to keep swiping."}
        </p>

        {linkedinEnabled ? (
          <>
            <a className="btn li" href="/api/auth/linkedin/start" style={{ marginTop: 16 }}>
              in&nbsp;&nbsp;Continue with LinkedIn
            </a>
            <div className="divider">or use email</div>
          </>
        ) : showSetupHint ? (
          /*
           * Setup instructions, and ONLY in development.
           *
           * This block used to render unconditionally whenever LinkedIn was
           * unconfigured, which meant every real person arriving at the public
           * sign-up page was told to "add LINKEDIN_CLIENT_ID and
           * LINKEDIN_CLIENT_SECRET to .env". That is a maintenance note
           * addressed to the developer, shown to the customer, on the screen
           * where they are deciding whether this product looks finished.
           *
           * An unavailable sign-in option is not an error state that needs
           * explaining. In production the LinkedIn button simply is not there,
           * which is what every other site does with a provider it has not
           * enabled.
           */
          <div className="note" style={{ marginTop: 16 }}>
            <b>Dev note — LinkedIn sign-in is off.</b> Set <code>LINKEDIN_CLIENT_ID</code> and{" "}
            <code>LINKEDIN_CLIENT_SECRET</code> to switch it on; the OpenID Connect tier is
            self-serve and approves instantly. This notice is not shown in production.
          </div>
        ) : null}

        <form onSubmit={submit}>
          {signup ? (
            <div className="field" style={{ marginBottom: 14 }}>
              <span style={{ display: "block", marginBottom: 8 }}>
                What brings you here?
              </span>
              <div style={{ display: "flex", gap: 10 }}>
                {(
                  [
                    ["CANDIDATE", "briefcase", "I'm looking for a job"],
                    ["RECRUITER", "target", "I'm hiring"],
                  ] as const
                ).map(([value, icon, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setRole(value)}
                    aria-pressed={role === value}
                    style={{
                      flex: 1,
                      padding: "14px 10px",
                      borderRadius: 12,
                      cursor: "pointer",
                      textAlign: "center",
                      lineHeight: 1.35,
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: "var(--txt)",
                      background: role === value ? "var(--brand)" : "transparent",
                      border:
                        role === value
                          ? "1px solid transparent"
                          : "1px solid var(--line, #e6e8f0)",
                    }}
                  >
                    <span style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
                      <Icon name={icon} size={22} />
                    </span>
                    {label}
                  </button>
                ))}
              </div>
              <small style={{ color: "var(--dim)", fontSize: 12, display: "block", marginTop: 8 }}>
                This is permanent. Job seeker accounts can&rsquo;t post roles, and
                employer accounts can&rsquo;t apply for them &mdash; so nobody is on
                both sides of the same hire.
              </small>
            </div>
          ) : null}
          {signup ? (
            <label className="field">
              <span>Full name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
              />
            </label>
          ) : null}
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={signup ? 8 : 1}
              autoComplete={signup ? "new-password" : "current-password"}
            />
            {signup ? (
              <small style={{ color: "var(--dim)", fontSize: 12 }}>At least 8 characters.</small>
            ) : null}
          </label>

          {!signup ? (
            <p style={{ margin: "-4px 0 12px", fontSize: 13 }}>
              <a href="/reset" style={{ color: "var(--dim)", textDecoration: "underline" }}>
                Forgot your password?
              </a>
            </p>
          ) : null}

          {/* ── LEGAL-009: the clickwrap. Directly above the button, on purpose. ── */}
          {signup ? (
            <label
              htmlFor="accept-terms"
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                margin: "4px 0 14px",
                padding: "12px 14px",
                border: "1px solid var(--line, #e6e8f0)",
                borderRadius: 12,
                cursor: "pointer",
                // Full contrast. The cases above turned on exactly this.
                color: "var(--txt)",
                fontSize: 13.5,
                lineHeight: 1.5,
              }}
            >
              <input
                id="accept-terms"
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                required
                aria-describedby="accept-terms-text"
                style={{ marginTop: 2, width: 18, height: 18, flexShrink: 0 }}
              />
              <span id="accept-terms-text">
                I have read and agree to the{" "}
                <a
                  href={TERMS_HREF}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--brand, #ff4d6d)", textDecoration: "underline" }}
                >
                  Terms of Service
                </a>{" "}
                — which include an{" "}
                <b>arbitration agreement and a class action waiver</b> — and the{" "}
                <a
                  href={PRIVACY_HREF}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--brand, #ff4d6d)", textDecoration: "underline" }}
                >
                  Privacy Policy
                </a>
                .
              </span>
            </label>
          ) : null}

          {err ? <div className="err">{err}</div> : null}
          {notice ? (
            <div className="note" style={{ marginBottom: 12 }}>
              {notice}
            </div>
          ) : null}

          <button className="btn" disabled={busy} type="submit">
            {busy ? "…" : signup ? "Create account" : "Sign in"}
          </button>

          {/* Button text matches the notice text — the Chabolla requirement. */}
          {signup ? (
            <p
              style={{
                margin: "8px 0 0",
                fontSize: 12.5,
                color: "var(--dim)",
                textAlign: "center",
                lineHeight: 1.5,
              }}
            >
              By clicking <b>Create account</b>, you agree to the Terms of Service and Privacy
              Policy.
            </p>
          ) : null}
        </form>

        <button
          className="btn ghost"
          onClick={() => {
            setSignup(!signup);
            setErr(null);
            setAccepted(false);
          }}
        >
          {signup ? "I already have an account" : "Create an account instead"}
        </button>
      </div>
    </div>
  );
}
