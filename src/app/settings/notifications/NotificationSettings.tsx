"use client";

import { useEffect, useState } from "react";

type Prefs = {
  newMatch: boolean;
  newMessage: boolean;
  recruiterInterest: boolean;
  applicationStatus: boolean;
  jobAlerts: boolean;
  productUpdates: boolean;
  unsubscribedAll: boolean;
};

/**
 * Which toggles are worth showing to whom. A job seeker has no use for
 * "someone applied to your role", and a recruiter has no use for "a recruiter
 * is interested in you" — showing both to everyone makes the page look like it
 * belongs to somebody else.
 */
const ROWS: {
  key: keyof Omit<Prefs, "unsubscribedAll">;
  label: string;
  help: string;
  roles: ("CANDIDATE" | "RECRUITER" | "BOTH")[];
}[] = [
  { key: "newMatch", label: "New matches", help: "When you and the other side both swipe right.", roles: ["CANDIDATE", "RECRUITER", "BOTH"] },
  { key: "newMessage", label: "New messages", help: "When someone you matched with writes to you.", roles: ["CANDIDATE", "RECRUITER", "BOTH"] },
  { key: "recruiterInterest", label: "Recruiter interest", help: "When an employer likes your profile for a role.", roles: ["CANDIDATE", "BOTH"] },
  { key: "applicationStatus", label: "Applications", help: "When someone applies to a role you posted.", roles: ["RECRUITER", "BOTH"] },
  { key: "jobAlerts", label: "Job alerts", help: "Occasional roles we think fit you. Off by default.", roles: ["CANDIDATE", "BOTH"] },
  { key: "productUpdates", label: "Product updates", help: "Changes to Jobsy itself. Off by default.", roles: ["CANDIDATE", "RECRUITER", "BOTH"] },
];

export default function NotificationSettings({ role }: { role: string }) {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/account/notifications")
      .then((r) => r.json())
      .then(setPrefs)
      .catch(() => setErr("Couldn't load your preferences."));
  }, []);

  async function save(patch: Partial<Prefs>) {
    // Optimistic: a preference toggle that waits on a round trip feels broken,
    // and the failure path below puts it back.
    const before = prefs;
    setPrefs((p) => (p ? { ...p, ...patch } : p));
    setErr(null);
    try {
      const body = "unsubscribedAll" in patch ? { unsubscribeAll: patch.unsubscribedAll } : patch;
      const res = await fetch("/api/account/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch {
      setPrefs(before);
      setErr("That didn't save. Try again.");
    }
  }

  const visible = ROWS.filter((r) => r.roles.includes(role as "CANDIDATE" | "RECRUITER" | "BOTH"));

  return (
    <div className="shell">
      <header className="top">
        <a href="/profile" className="logo">
          <span className="spark">🔥</span>
          <b>Jobsy</b>
        </a>
        <div className="spacer" />
        <a className="iconbtn" href="/profile">
          ✕
        </a>
      </header>

      <div style={{ padding: "12px 16px 40px", color: "var(--txt)" }}>
        <h1 style={{ fontSize: 24, letterSpacing: "-.5px", margin: "0 0 6px" }}>
          Email preferences
        </h1>
        <p style={{ color: "var(--dim)", fontSize: 13.5, margin: "0 0 20px", lineHeight: 1.6 }}>
          Turn off anything you don&rsquo;t want. Security emails &mdash; verifying
          your address, resetting or changing your password, and data you&rsquo;ve
          asked us for &mdash; are always sent and can&rsquo;t be switched off.
        </p>

        {err ? <div className="err" style={{ marginBottom: 14 }}>{err}</div> : null}
        {saved ? (
          <div className="note" style={{ marginBottom: 14 }}>
            Saved.
          </div>
        ) : null}

        {!prefs ? (
          <p style={{ color: "var(--dim)" }}>Loading…</p>
        ) : (
          <>
            {visible.map((row) => (
              <label
                key={row.key}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: "14px 0",
                  borderBottom: "1px solid var(--line, #e6e8f0)",
                  cursor: prefs.unsubscribedAll ? "not-allowed" : "pointer",
                  opacity: prefs.unsubscribedAll ? 0.45 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={prefs[row.key]}
                  disabled={prefs.unsubscribedAll}
                  onChange={(e) => save({ [row.key]: e.target.checked } as Partial<Prefs>)}
                  style={{ marginTop: 3, width: 18, height: 18, flexShrink: 0 }}
                />
                <span style={{ lineHeight: 1.5 }}>
                  {row.label}
                  <br />
                  <small style={{ color: "var(--dim)" }}>{row.help}</small>
                </span>
              </label>
            ))}

            <div
              style={{
                marginTop: 26,
                padding: "14px 16px",
                border: "1px solid var(--line, #e6e8f0)",
                borderRadius: 12,
              }}
            >
              <label style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={prefs.unsubscribedAll}
                  onChange={(e) => save({ unsubscribedAll: e.target.checked })}
                  style={{ marginTop: 3, width: 18, height: 18, flexShrink: 0 }}
                />
                <span style={{ lineHeight: 1.5, fontSize: 13.5 }}>
                  Unsubscribe from all non-essential email
                  <br />
                  <small style={{ color: "var(--dim)" }}>
                    Overrides everything above. You&rsquo;ll still get security and
                    account emails, because those aren&rsquo;t marketing.
                  </small>
                </span>
              </label>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
