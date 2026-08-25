"use client";

import { useState } from "react";
import { Avatar, useToast } from "@/components/ui";
import { Icon, Logo } from "@/components/Icon";
import SignOutButton from "@/components/SignOutButton";

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
    | { ok: false; text: string; suggestions: string[]; trace?: string[]; employer?: string }
    | null
  >(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);

  /**
   * One button, everything.
   *
   * The nightly run does this already; the button exists because "wait until
   * tomorrow to find out whether that connection works" is a miserable way to
   * run a job board.
   *
   * It reports what it did NOT get to as well as what it did. A 60-second
   * function cannot walk every source of a large deployment, and a summary that
   * quietly omits the ones the clock ran out on would read as "all done" when
   * half the list is untouched.
   */
  const syncEverything = async () => {
    setSyncingAll(true);
    try {
      const r = await fetch("/api/sources/sync-all", { method: "POST" });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        toast(d?.error ?? `Sync failed (${r.status})`);
        return;
      }
      const parts = [`${d.created} new, ${d.updated} refreshed`];
      parts.push(`${d.syncedSources} source(s), ${d.syncedEmployers} followed employer(s) in ${d.seconds}s`);
      if (d.deferred?.length) parts.push(`ran out of time on ${d.deferred.length} — press again to continue`);
      if (d.failures?.length) parts.push(`${d.failures.length} failed`);
      toast(parts.join(" · "));
      await refresh();
    } finally {
      setSyncingAll(false);
    }
  };
  const { toast, toastNode } = useToast();

  /** The company inside a careers hostname. digitalcareers.infosys.com → Infosys. */
  const employerFromUrl = (raw: string): string | undefined => {
    try {
      const host = new URL(raw.startsWith("http") ? raw : `https://${raw}`).hostname;
      const label = host
        .replace(/^(www|jobs?|careers?|digitalcareers|apply|talent)\./i, "")
        .split(".")[0]
        .replace(/[-_]+/g, " ")
        .trim();
      if (!label) return undefined;
      return label.length <= 3
        ? label.toUpperCase()
        : label.replace(/\b[a-z]/g, (c) => c.toUpperCase());
    } catch {
      return undefined;
    }
  };

  const follow = async (name: string) => {
    setFollowing(true);
    try {
      const r = await fetch("/api/sources/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, careersUrl: url }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || d?.result?.error) {
        setResult({
          ok: false,
          text: d?.result?.error ?? d?.error ?? "Couldn't follow that employer.",
          suggestions: [],
        });
        return;
      }
      const res = d.result;
      setResult({
        ok: true,
        text:
          res.created + res.updated > 0
            ? `Following ${d.employer.name} — ${res.created} new, ${res.updated} refreshed from ${res.providers.join(", ")}.`
            : `Following ${d.employer.name}, but the boards returned no matching jobs yet. Searched: ${res.providers.join(", ") || "no board is configured"}.`,
      });
      await refresh();
    } finally {
      setFollowing(false);
    }
  };

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
        setResult({
          ok: false,
          text: data.error ?? "Couldn't connect that site",
          suggestions: data.suggestions ?? [],
          trace: data.trace ?? [],
          /*
           * The employer's name, guessed from the host, so the escape hatch can
           * be offered by name rather than as an empty box. digitalcareers.
           * infosys.com is Infosys whatever the page failed to say.
           */
          employer: employerFromUrl(url),
        });
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
      /*
       * A crawl of a large employer stops on its time budget with pages left
       * over. That is a partial success, and saying nothing about it made it
       * indistinguishable from "this site only has fifteen jobs".
       */
      toast(
        d.error
          ? `Sync failed: ${d.error}`
          : `${d.company}: ${d.created} new, ${d.updated} refreshed` + (d.note ? ` — ${d.note}` : "")
      );
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
        <a href="/home" className="logo">
          <Logo />
          <b>Jobsy</b>
        </a>
        <div className="spacer" />
        <a className="iconbtn" href="/recruiter"><Icon name="close" size={15} label="Close" /></a>
        <SignOutButton />
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

        {result?.ok ? <div className="ok"><Icon name="check" size={13} /> {result.text}</div> : null}
        {result && !result.ok ? (
          <div className="err">
            {result.text}
            {/*
              * What was actually tried, folded away.
              *
              * Four rounds of "why won't this connect" were answered by
              * guessing, because the message said what we did not FIND and
              * never what we LOOKED AT. Collapsed by default — a recruiter
              * wants the sentence above, and whoever is debugging wants this.
              */}
            {result.trace?.length ? (
              <details style={{ margin: "10px 0 0" }}>
                <summary style={{ cursor: "pointer", fontSize: 12.5, color: "var(--dim2)" }}>
                  What Jobsy tried
                </summary>
                <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12.5, color: "var(--dim)", lineHeight: 1.6 }}>
                  {result.trace.map((t, i) => (
                    <li key={i} style={{ wordBreak: "break-word" }}>{t}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            {/*
              * The escape hatch, offered at the exact moment it is needed.
              *
              * A careers site that renders its jobs in the browser cannot be
              * read without one, and nothing in the parser will ever change
              * that. But the boards already index these employers, so the
              * honest next move is to stop fighting the site and ask the
              * boards — offered here rather than left for someone to discover.
              */}
            {result.employer ? (
              <div style={{ marginTop: 12 }}>
                <button
                  className="btn"
                  disabled={following}
                  onClick={() => void follow(result.employer!)}
                >
                  {following ? "Searching the job boards…" : `Follow ${result.employer} through job boards instead`}
                </button>
                <small style={{ display: "block", marginTop: 6, color: "var(--dim)", fontSize: 12.5, lineHeight: 1.5 }}>
                  Pulls this employer&rsquo;s jobs from the boards Jobsy licenses — the same listings
                  that appear on Indeed and LinkedIn. It won&rsquo;t catch roles they never
                  syndicated, and it may lag their own site by a day.
                </small>
              </div>
            ) : null}
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
          company&rsquo;s own branded careers page. Not on any of those? Jobsy reads the schema.org
          job data the page publishes for Google, then an XML feed, then the individual job pages the
          listing links to — and if the listing is built in the browser and links to nothing, the
          site&rsquo;s sitemap. Jobsy checks robots.txt first and doesn&rsquo;t crawl sites that ask
          it not to.
          <br />
          <br />
          <b>When it can&rsquo;t.</b> Some large employers run systems that publish nothing a machine
          can read — Radancy, Phenom, iCIMS, Taleo, SuccessFactors and others. Jobsy names the one
          it found and gives you a sentence to send the employer: every one of those platforms can
          switch on the same XML feed they already send to Indeed, and pasting that URL here connects
          them in seconds.
        </div>

        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, margin: "22px 0 8px" }}>
          <h4 style={{ margin: 0, fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".9px", color: "var(--dim2)", fontWeight: 800 }}>
            {sources.length} connected
          </h4>
          {sources.length ? (
            <button
              className="btn ghost"
              style={{ width: "auto", padding: "8px 14px", marginTop: 0, fontSize: 13 }}
              disabled={syncingAll}
              onClick={() => void syncEverything()}
            >
              {syncingAll ? "Syncing everything…" : "Sync all now"}
            </button>
          ) : null}
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--dim)", lineHeight: 1.55 }}>
          Everything here syncs on its own overnight. &ldquo;Sync all now&rdquo; runs the same pass
          immediately — it works through the least-recently-synced first, so if it runs out of
          time it says so and pressing again continues where it stopped.
        </p>

        {sources.length === 0 ? (
          <div className="emptylist">
            <span className="big"><Icon name="building" size={34} /></span>
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
                      <div className="s2" style={{ color: "var(--gold)", display: "flex", gap: 6, alignItems: "flex-start" }}>
                      <Icon name="alert" size={13} style={{ marginTop: 2 }} /> {s.lastError.slice(0, 120)}
                    </div>
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
