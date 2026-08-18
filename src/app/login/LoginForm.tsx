"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginForm({ linkedinEnabled }: { linkedinEnabled: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [signup, setSignup] = useState(params.get("mode") === "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(params.get("error"));
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(signup ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signup ? { email, password, name } : { email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "Something went wrong");
        return;
      }
      router.push(data.profileReady ? "/swipe" : "/onboarding");
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
          <span className="spark">🔥</span>
          <b>Jobsy</b>
        </a>
      </header>

      <div style={{ padding: "12px 16px 24px" }}>
        <h1 style={{ fontSize: 26, letterSpacing: "-.6px", margin: "0 0 6px" }}>
          {signup ? "Create your account" : "Welcome back"}
        </h1>
        <p style={{ color: "var(--dim)", fontSize: 13.5, margin: "0 0 4px" }}>
          {signup ? "One profile works for both sides — swipe jobs and post them." : "Sign in to keep swiping."}
        </p>

        {linkedinEnabled ? (
          <>
            <a className="btn li" href="/api/auth/linkedin/start" style={{ marginTop: 16 }}>
              in&nbsp;&nbsp;Continue with LinkedIn
            </a>
            <div className="divider">or use email</div>
          </>
        ) : (
          <div className="note" style={{ marginTop: 16 }}>
            <b>LinkedIn sign-in is off.</b> Add <code>LINKEDIN_CLIENT_ID</code> and{" "}
            <code>LINKEDIN_CLIENT_SECRET</code> to <code>.env</code> to switch it on — the OIDC tier is
            self-serve and approves instantly.
          </div>
        )}

        <form onSubmit={submit}>
          {signup ? (
            <label className="field">
              <span>Full name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
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
          </label>

          {err ? <div className="err">{err}</div> : null}

          <button className="btn" disabled={busy} type="submit">
            {busy ? "…" : signup ? "Create account" : "Sign in"}
          </button>
        </form>

        <button className="btn ghost" onClick={() => { setSignup(!signup); setErr(null); }}>
          {signup ? "I already have an account" : "Create an account instead"}
        </button>
      </div>
    </div>
  );
}
