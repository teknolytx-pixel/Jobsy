"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Logo } from "@/components/Icon";

/**
 * AUTH-007 — password reset, both halves.
 *
 * With a token in the URL this is the "set a new password" form. Without one it
 * is the "send me a link" form, whose response is deliberately identical
 * whether or not the address has an account — anything else is an enumeration
 * oracle, and a job board's user list is exactly what a spammer wants.
 */
export default function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function request(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.status === 429) {
        setErr(data.error ?? "Too many requests. Please wait a little while.");
        return;
      }
      // Always the same message. We do not say whether the account exists.
      setMsg(data.message ?? "If an account exists for that address, we've sent a reset link.");
    } catch {
      setErr("Network error — is the server running?");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "Something went wrong");
        return;
      }
      setMsg(data.message);
      setTimeout(() => router.push("/login"), 1500);
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
          {token ? "Choose a new password" : "Reset your password"}
        </h1>
        <p style={{ color: "var(--dim)", fontSize: 13.5, margin: "0 0 16px" }}>
          {token
            ? "Setting a new password will sign you out everywhere else."
            : "We'll email you a link. It works once and expires in an hour."}
        </p>

        <form onSubmit={token ? confirm : request}>
          {token ? (
            <label className="field">
              <span>New password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
              <small style={{ color: "var(--dim)", fontSize: 12 }}>At least 8 characters.</small>
            </label>
          ) : (
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
          )}

          {err ? <div className="err">{err}</div> : null}
          {msg ? (
            <div className="note" style={{ marginBottom: 12 }}>
              {msg}
            </div>
          ) : null}

          <button className="btn" disabled={busy} type="submit">
            {busy ? "…" : token ? "Set new password" : "Email me a reset link"}
          </button>
        </form>

        <a className="btn ghost" href="/login">
          Back to sign in
        </a>
      </div>
    </div>
  );
}
