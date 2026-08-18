"use client";

import { useState } from "react";
import { Avatar, useToast } from "@/components/ui";

type Source = {
  id: string; company: string; kind: string; kindLabel: string; token: string;
  careersUrl: string | null; enabled: boolean; status: string; detectedVia: string | null;
  lastRunAt: string | null; lastJobCount: number; totalImported: number; lastError: string | null;
};

const STATUS: Record<string, { cls: string; text: string }> = {
  OK: { cls: "a", text: "Live" },
  PENDING: { cls: "s", text: "Pending" },
  FAILING: { cls: "m", text: "Failing" },
  DISABLED: { cls: "s", text: "Paused" },
};

export default function SourcesManager({ initial }: { initial: Source[] }) {
  const [sources, setSources] = useState(initial);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    | { ok: true; text: string }
    | { ok: false; text: string; suggestions: string[] }
    | null
  >(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const { toast, toastNode } = useToast();

  const refresh = async () => {
    const res = await fetch("/api/sources", { cache: "no-store" });
    if (res.ok) setSources((await res.json()).sources ?? []);
  };

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ ok: false, text: data.error ?? "Couldn't connect that site", suggestions: data.suggestions ?? [] });
        return;
      }
      setResult({
        ok: true,
        text: `${data.detection.via} Imported ${data.imported} job${data.imported === 1 ? "" : "s"} from ${data.source.company}${data.alreadyExisted ? " (already connected — refreshed it)" : ""}.`,
      });
      setUrl("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function syncNow(id: string) {
    setSyncing(id);
    try {
      const res = await fetch(`/api/sources/${id}`, { method: "POST" });
      const d = await res.json();
      toast(d.error ? `Sync failed: ${d.error}` : `${d.company}: ${d.created} new, ${d.updated} refreshed`);
      await refresh();
    } finally {
      setSyncing(null);
    }
  }

  async function toggle(s: Source) {
    await fetch(`/api/sources/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !s.enabled }),
    });
    await refresh();
  }

  async function remove(s: Source) {
    await fetch(`/api/sources/${s.id}`, { method: "DELETE" });
    toast(`Disconnected ${s.company} — jobs already imported stay live`);
    await refresh();
  }

  const when = (iso: string | null) =>
    !iso ? "never" : new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <div className="shell">
      <header className="top">
        <a href="/recruiter" className="logo">
          <span className="spark">🔥</span>
          <b>Jobsy</b>
        </a>
        <div className="spacer" />
        <a className="iconbtn" href="/recruiter">✕</a>
      </header>

      <div className="tabs">
        <a href="/recruiter">Source</a>
        <a href="/jobs">My posts</a>
        <button className="on">Companies{sources.length ? <span className="n">{sources.length}</span> : null}</button>
      </div>

      <div className="list">
        <h1 style={{ fontSize: 22, letterSpacing: "-.5px", margin: "0 0 6px" }}>Connected companies</h1>
        <p style={{ color: "var(--dim)", fontSize: 13.5, lineHeight: 1.6, margin: "0 0 14px" }}>
          Paste any careers page. Jobsy works out which system powers it and pulls every job that
          employer posts — then keeps pulling, every 6 hours, automatically.
        </p>

        <form onSubmit={connect}>
          <label className="field">
            <span>Careers page URL</span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://acme.com/careers"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button className="btn go" type="submit" disabled={busy || !url.trim()}>
            {busy ? "Detecting…" : "Detect & connect"}
          </button>
        </form>

        {result?.ok ? <div className="ok">✓ {result.text}</div> : null}
        {result && !result.ok ? (
          <div className="err">
            {result.text}
            {result.suggestions.length ? (
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
                {result.suggestions.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="note" style={{ marginTop: 16 }}>
          <b>What gets detected.</b> Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee,
          Personio, BambooHR and Workday boards — whether you paste the ATS link directly or the
          company&rsquo;s own branded careers page. Not on any of those? Jobsy falls back to the
          schema.org job data the page already publishes for Google, then to an XML feed. Worst case,
          ask the employer for the feed URL they give Indeed — Jobsy reads that format too.
        </div>

        <h4 style={{ margin: "22px 0 8px", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".9px", color: "var(--dim2)", fontWeight: 800 }}>
          {sources.length} connected
        </h4>

        {sources.length === 0 ? (
          <div className="emptylist">
            <span className="big">🏢</span>
            <b>No companies connected yet</b>
            <br />
            Paste a careers URL above — try <code>boards.greenhouse.io/stripe</code>.
          </div>
        ) : (
          sources.map((s) => {
            const st = STATUS[s.status] ?? STATUS.PENDING;
            return (
              <div key={s.id} className="row" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
                <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                  <Avatar name={s.company} seed={s.id} />
                  <div className="g">
                    <div className="t">{s.company}</div>
                    <div className="s">
                      {s.kindLabel} · <code style={{ fontSize: 11 }}>{s.token.slice(0, 44)}</code>
                    </div>
                    <div className="s2">
                      {s.lastJobCount} live · {s.totalImported} imported all-time · synced {when(s.lastRunAt)}
                    </div>
                    {s.lastError ? (
                      <div className="s2" style={{ color: "#ffb3c1" }}>⚠ {s.lastError.slice(0, 120)}</div>
                    ) : null}
                  </div>
                  <span className={`badge ${st.cls}`}>{st.text}</span>
                </div>

                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    className="btn ghost"
                    style={{ margin: 0, padding: "9px 10px", fontSize: 12.5 }}
                    onClick={() => syncNow(s.id)}
                    disabled={syncing === s.id}
                  >
                    {syncing === s.id ? "Syncing…" : "Sync now"}
                  </button>
                  <button
                    className="btn ghost"
                    style={{ margin: 0, padding: "9px 10px", fontSize: 12.5 }}
                    onClick={() => toggle(s)}
                  >
                    {s.enabled ? "Pause" : "Resume"}
                  </button>
                  <button
                    className="btn ghost"
                    style={{ margin: 0, padding: "9px 10px", fontSize: 12.5, color: "#ffb3c1" }}
                    onClick={() => remove(s)}
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {toastNode}
    </div>
  );
}
