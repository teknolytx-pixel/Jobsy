"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon, Logo } from "@/components/Icon";
import SignOutButton from "@/components/SignOutButton";

/**
 * The admin console.
 *
 * Two things a platform operator has to be able to see and could not: the
 * moderation queue, and the compliance clock.
 *
 * ── Why the ordering is what it is ──
 *
 * Overdue comes first, everywhere. A privacy request that has passed its
 * statutory deadline is not a backlog item to be worked through in turn — it is
 * a compliance failure that is already happening, and a console that sorts it
 * in with everything else by date hides exactly the thing an operator needs to
 * be shouted at about.
 */

type PrivacyRequest = {
  id: string;
  kind: string;
  jurisdiction: string;
  requestedAt: string;
  dueAt: string;
  daysRemaining: number;
  overdue: boolean;
};

type Compliance = {
  privacyRequests: { open: PrivacyRequest[]; overdueCount: number };
  aedtNoticesDelivered: number;
  profilingOptOuts: number;
  moderation: { open: number; escalated: number };
  notes: string[];
};

type Finding = {
  severity: "CRITICAL" | "WARNING" | "OK";
  area: "EMAIL" | "CONFIG" | "STORAGE" | "INGESTION" | "PARSING";
  title: string;
  detail: string;
  action: string | null;
};

type Health = {
  windowDays: number;
  findings: Finding[];
  counts: Record<string, number>;
};

type Undelivered = {
  id: string;
  template: string;
  status: string;
  subject: string;
  createdAt: string;
  expiresAt: string | null;
  expired: boolean;
  link: string | null;
};

type Report = {
  id: string;
  kind: string;
  targetId: string;
  reason: string;
  detail: string | null;
  status: string;
  action: string;
  createdAt: string;
  ageHours: number;
  escalated: boolean;
  resolutionNote: string | null;
};

const ACTIONS = ["NONE", "WARNED", "CONTENT_REMOVED", "SUSPENDED", "BANNED"] as const;
const ACTION_LABEL: Record<string, string> = {
  NONE: "No action needed",
  WARNED: "Warn the account",
  CONTENT_REMOVED: "Remove the content",
  SUSPENDED: "Suspend the account",
  BANNED: "Ban the account",
};

const QUEUES = [
  { key: "OPEN", label: "Open" },
  { key: "REVIEWING", label: "Reviewing" },
  { key: "ACTIONED", label: "Actioned" },
  { key: "DISMISSED", label: "Dismissed" },
] as const;

const human = (s: string) => s.replace(/_/g, " ").toLowerCase();

export default function AdminConsole({ email }: { email: string }) {
  const [tab, setTab] = useState<"queue" | "compliance" | "health" | "candidates">("queue");
  const [queue, setQueue] = useState<(typeof QUEUES)[number]["key"]>("OPEN");
  const [reports, setReports] = useState<Report[] | null>(null);
  const [compliance, setCompliance] = useState<Compliance | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [lookup, setLookup] = useState("");
  const [undelivered, setUndelivered] = useState<Undelivered[] | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [lookupErr, setLookupErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ action: string; status: string; note: string }>({
    action: "NONE",
    status: "ACTIONED",
    note: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const loadReports = useCallback(async (status: string) => {
    setErr(null);
    try {
      const res = await fetch(`/api/admin/reports?status=${status}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not load the queue.");
      setReports(body.reports ?? []);
    } catch (e) {
      setErr((e as Error).message);
      setReports([]);
    }
  }, []);

  const loadCompliance = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch("/api/admin/compliance", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not load compliance.");
      setCompliance(body);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadReports(queue);
  }, [queue, loadReports]);

  useEffect(() => {
    void loadCompliance();
  }, [loadCompliance]);

  /**
   * NFR-010. Loaded on mount rather than when the tab is opened, because the
   * whole point is the badge: an operator who never thinks to look at a Health
   * tab is exactly the person who needs to be told email is not being sent.
   */
  useEffect(() => {
    void fetch("/api/admin/health", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => setHealth(b))
      .catch(() => {});
  }, []);

  async function decide(reportId: string) {
    // AC-3 — the note is required by the API, and it is required here too so a
    // moderator finds out before they have made the decision, not after.
    if (draft.note.trim().length < 1) {
      setErr("Write down why. A moderation record without a reason can't be defended later.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/reports", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId, ...draft, note: draft.note.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not record that decision.");
      setMsg(`Recorded: ${ACTION_LABEL[draft.action] ?? draft.action}.`);
      setOpen(null);
      setDraft({ action: "NONE", status: "ACTIONED", note: "" });
      await Promise.all([loadReports(queue), loadCompliance()]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function findUndelivered() {
    setLookupErr(null);
    setUndelivered(null);
    setRevealed(new Set());
    try {
      const res = await fetch(`/api/admin/emails?to=${encodeURIComponent(lookup.trim())}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not read that.");
      setUndelivered(body.messages ?? []);
    } catch (e) {
      setLookupErr((e as Error).message);
    }
  }

  return (
    <div className="shell">
      <header className="top">
        <a href="/home" className="logo">
          <Logo />
          <b>Jobsy</b>
        </a>
        <div className="spacer" />
        <span className="pill">admin</span>
        <SignOutButton />
      </header>

      <div className="tabs">
        <button className={tab === "queue" ? "on" : ""} onClick={() => setTab("queue")}>
          Moderation
          {compliance?.moderation.open ? <span className="n">{compliance.moderation.open}</span> : null}
        </button>
        <button className={tab === "compliance" ? "on" : ""} onClick={() => setTab("compliance")}>
          Compliance
          {compliance?.privacyRequests.overdueCount ? (
            <span className="n">{compliance.privacyRequests.overdueCount}</span>
          ) : null}
        </button>
        <button className={tab === "candidates" ? "on" : ""} onClick={() => setTab("candidates")}>
          Candidates
        </button>
        <button className={tab === "health" ? "on" : ""} onClick={() => setTab("health")}>
          Health
          {health?.findings.length ? <span className="n">{health.findings.length}</span> : null}
        </button>
        {/*
          ADM-006 — job sources live here, not in the recruiter area.
          A link rather than a tab: the screen is substantial enough to own a
          page, and it was already built as one.
        */}
        <a href="/sources">Job sources</a>
      </div>

      <div className="list">
        {err ? <div className="err">{err}</div> : null}
        {msg ? (
          <div className="ok">
            <Icon name="check" size={13} /> {msg}
          </div>
        ) : null}

        {/* The alarm, shown on both tabs. Overdue is never a footnote. */}
        {compliance?.privacyRequests.overdueCount ? (
          <div className="err" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <Icon name="alert" size={14} style={{ marginTop: 2 }} />
            <div>
              <b>
                {compliance.privacyRequests.overdueCount} privacy request
                {compliance.privacyRequests.overdueCount === 1 ? " is" : "s are"} past the legal
                deadline.
              </b>
              <br />
              These are a compliance failure rather than a backlog. Service them before anything
              else on this screen.
            </div>
          </div>
        ) : null}

        {tab === "queue" ? (
          <>
            <div className="tabs" style={{ padding: "0 0 10px" }}>
              {QUEUES.map((q) => (
                <button key={q.key} className={queue === q.key ? "on" : ""} onClick={() => setQueue(q.key)}>
                  {q.label}
                </button>
              ))}
            </div>

            {reports === null ? <div className="emptylist">Loading…</div> : null}

            {reports?.length === 0 ? (
              <div className="emptylist">
                <span className="big">
                  <Icon name="checkCircle" size={34} />
                </span>
                Nothing in the {QUEUES.find((q) => q.key === queue)?.label.toLowerCase()} queue.
              </div>
            ) : null}

            {reports?.map((r) => (
              <div key={r.id} className="row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className={`badge ${r.escalated ? "m" : "s"}`}>{human(r.reason)}</span>
                  <span className="s2" style={{ marginTop: 0, color: "var(--dim2)" }}>
                    {human(r.kind)} · {r.ageHours}h old
                  </span>
                  {r.escalated ? (
                    <span
                      className="s2"
                      style={{ marginTop: 0, color: "var(--no)", display: "flex", gap: 5 }}
                    >
                      <Icon name="alert" size={12} /> over 48h
                    </span>
                  ) : null}
                </div>

                {r.detail ? (
                  <div className="s2" style={{ color: "var(--txt)", marginTop: 0 }}>
                    {r.detail}
                  </div>
                ) : null}

                <div className="s2" style={{ color: "var(--dim2)", marginTop: 0 }}>
                  target <code>{r.targetId.slice(0, 12)}…</code>
                </div>

                {r.resolutionNote ? (
                  <div className="note" style={{ margin: "6px 0 0" }}>
                    <b>{ACTION_LABEL[r.action] ?? r.action}</b> — {r.resolutionNote}
                  </div>
                ) : null}

                {r.status === "OPEN" || r.status === "REVIEWING" ? (
                  open === r.id ? (
                    <div style={{ marginTop: 4 }}>
                      <label className="field">
                        <span>Decision</span>
                        <select value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })}>
                          {ACTIONS.map((a) => (
                            <option key={a} value={a}>
                              {ACTION_LABEL[a]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Queue</span>
                        <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                          <option value="REVIEWING">Still reviewing</option>
                          <option value="ACTIONED">Actioned — close it</option>
                          <option value="DISMISSED">Dismissed — no violation</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>Why (recorded permanently)</span>
                        <textarea
                          value={draft.note}
                          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                          placeholder="What you found, and which rule it breaks."
                        />
                      </label>
                      <div className="two">
                        <button className="btn" disabled={busy} onClick={() => void decide(r.id)}>
                          {busy ? "Saving…" : "Record decision"}
                        </button>
                        <button className="btn ghost" disabled={busy} onClick={() => setOpen(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="btn ghost"
                      style={{ marginTop: 6 }}
                      onClick={() => {
                        setOpen(r.id);
                        setErr(null);
                      }}
                    >
                      Review this report
                    </button>
                  )
                ) : null}
              </div>
            ))}
          </>
        ) : null}

        {tab === "compliance" ? (
          compliance ? (
            <>
              <div className="stat">
                <div>
                  <b>{compliance.privacyRequests.open.length}</b>
                  <span>Open requests</span>
                </div>
                <div>
                  <b style={{ color: compliance.privacyRequests.overdueCount ? "var(--no)" : undefined }}>
                    {compliance.privacyRequests.overdueCount}
                  </b>
                  <span>Overdue</span>
                </div>
                <div>
                  <b style={{ color: compliance.moderation.escalated ? "var(--gold)" : undefined }}>
                    {compliance.moderation.escalated}
                  </b>
                  <span>Escalated</span>
                </div>
              </div>
              <div className="stat">
                <div>
                  <b>{compliance.aedtNoticesDelivered}</b>
                  <span>AEDT notices</span>
                </div>
                <div>
                  <b>{compliance.profilingOptOuts}</b>
                  <span>Profiling opt-outs</span>
                </div>
              </div>

              <div className="sect" style={{ marginTop: 14 }}>
                <h4>Open privacy requests</h4>
              </div>

              {compliance.privacyRequests.open.length === 0 ? (
                <div className="emptylist">Nothing outstanding.</div>
              ) : null}

              {/* Overdue first, then soonest due. Never by arrival order. */}
              {[...compliance.privacyRequests.open]
                .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.daysRemaining - b.daysRemaining)
                .map((r) => (
                  <div key={r.id} className="row" style={{ alignItems: "center" }}>
                    <div className="g">
                      <div className="t">{human(r.kind)}</div>
                      <div className="s2">
                        {r.jurisdiction} · requested{" "}
                        {new Date(r.requestedAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </div>
                    </div>
                    <span className={`badge ${r.overdue ? "m" : r.daysRemaining <= 7 ? "s" : "a"}`}>
                      {r.overdue
                        ? `${Math.abs(r.daysRemaining)}d overdue`
                        : `${r.daysRemaining}d left`}
                    </span>
                  </div>
                ))}

              {compliance.notes.map((n, i) => (
                <div key={i} className="note">
                  {n}
                </div>
              ))}
            </>
          ) : (
            <div className="emptylist">Loading…</div>
          )
        ) : null}

        {tab === "candidates" ? <CandidatesPanel /> : null}

        {tab === "health" ? (
          health ? (
            <>
              <p style={{ color: "var(--dim)", fontSize: 13.5, margin: "0 0 12px", lineHeight: 1.6 }}>
                Failures that are invisible from a page load. Unconfigured email still
                returns success to the person asking for a password reset; a source that
                has been erroring for a week still leaves the site full of older jobs.
                Last {health.windowDays} days.
              </p>

              {health.findings.length === 0 ? (
                <div className="ok">
                  <Icon name="check" size={13} /> Nothing wrong that this can detect.
                </div>
              ) : null}

              {health.findings.map((f, i) => (
                <div
                  key={i}
                  className={f.severity === "CRITICAL" ? "err" : "row"}
                  style={{ flexDirection: "column", alignItems: "stretch", gap: 5, display: "flex" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <Icon name={f.severity === "CRITICAL" ? "alert" : "info"} size={14} />
                    <b style={{ fontSize: 13.5 }}>{f.title}</b>
                    <span className="badge s">{f.area.toLowerCase()}</span>
                  </div>
                  <div className="s2" style={{ marginTop: 0 }}>{f.detail}</div>
                  {f.action ? (
                    <div className="s2" style={{ color: "var(--dim)" }}>
                      <b>Fix:</b> {f.action}
                    </div>
                  ) : null}
                </div>
              ))}

              <div className="stat" style={{ marginTop: 14 }}>
                <div>
                  <b>{health.counts.emailSent ?? 0}</b>
                  <span>Email sent</span>
                </div>
                <div>
                  <b style={{ color: health.counts.emailFailed ? "var(--no)" : undefined }}>
                    {health.counts.emailFailed ?? 0}
                  </b>
                  <span>Failed</span>
                </div>
                <div>
                  <b style={{ color: health.counts.emailLoggedOnly ? "var(--no)" : undefined }}>
                    {health.counts.emailLoggedOnly ?? 0}
                  </b>
                  <span>Never sent</span>
                </div>
              </div>
            </>
          ) : (
            <div className="emptylist">Loading…</div>
          )
        ) : null}

        {/*
          Shown only on the Health tab, and only while email is broken — the
          endpoint refuses once a sending domain is configured, so this cannot
          outlive the outage it exists for.
        */}
        {tab === "health" && health?.findings.some((f) => f.area === "EMAIL") ? (
          <>
            <div className="sect" style={{ marginTop: 22 }}>
              <h4>Recover a locked-out user</h4>
            </div>
            <div className="err">
              <Icon name="alert" size={14} />
              <div>
                <b>A reset link signs someone in.</b> While email is down these can be
                read here so you can pass one on by hand. Every lookup is recorded
                against the address you searched. Send a link only to the address it was
                issued for, and only when you are certain who asked for it.
              </div>
            </div>

            <div className="two" style={{ marginTop: 8 }}>
              <label className="field" style={{ marginTop: 0 }}>
                <span>Their email address</span>
                <input
                  value={lookup}
                  onChange={(e) => setLookup(e.target.value)}
                  placeholder="someone@example.com"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void findUndelivered();
                  }}
                />
              </label>
            </div>
            <button className="btn ghost" disabled={!lookup.trim()} onClick={() => void findUndelivered()}>
              <Icon name="search" size={15} /> Find undelivered messages
            </button>

            {lookupErr ? <div className="err">{lookupErr}</div> : null}

            {undelivered?.length === 0 ? (
              <div className="emptylist">
                Nothing undelivered for that address in the last 7 days. Ask them to
                request a new link, then look again.
              </div>
            ) : null}

            {undelivered?.map((m) => (
              <div key={m.id} className="row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <b style={{ fontSize: 13.5 }}>{m.template.replace(/_/g, " ").toLowerCase()}</b>
                  <span className={`badge ${m.expired ? "m" : "a"}`}>
                    {m.expired ? "expired" : "still valid"}
                  </span>
                  <span className="s2" style={{ marginTop: 0, color: "var(--dim2)" }}>
                    {new Date(m.createdAt).toLocaleString()}
                  </span>
                </div>

                {m.expired ? (
                  <div className="s2" style={{ marginTop: 0 }}>
                    This link has expired, so it is of no use. Ask them to request a new
                    one, then look again.
                  </div>
                ) : revealed.has(m.id) ? (
                  <div
                    className="s2"
                    style={{ marginTop: 0, wordBreak: "break-all", color: "var(--txt)", fontFamily: "monospace" }}
                  >
                    {m.link ?? "No link found in this message."}
                  </div>
                ) : (
                  // Hidden until asked for, so a shoulder-surfer or a screenshot
                  // of this screen does not hand out working credentials.
                  <button className="btn ghost" onClick={() => setRevealed((s) => new Set(s).add(m.id))}>
                    <Icon name="key" size={14} /> Reveal the link
                  </button>
                )}
              </div>
            ))}
          </>
        ) : null}

        <div className="s2" style={{ color: "var(--dim2)", marginTop: 18 }}>
          Signed in as {email}. Opening this console is itself recorded in the audit log —
          reading personal data is an access like any other.
        </div>
      </div>
    </div>
  );
}

/**
 * WHO WE HOLD, AND WHETHER WE HAVE TOLD THEM.
 *
 * The second half of that sentence is the reason this screen exists. An import
 * count on its own reads as an achievement; an import count next to the number
 * of people who have not been notified reads as what it is — an obligation with
 * a deadline attached. GDPR Article 14 gives a month, and NYC LL144 forbids
 * running an automated hiring tool over someone who has not been told.
 *
 * So "not yet notified" is rendered first, largest, and in the alert colour when
 * it is non-zero. A dashboard that made this comfortable to ignore would be
 * doing the opposite of its job.
 */
function CandidatesPanel() {
  type Src = {
    id: string; kind: string; kindLabel: string; label: string; token: string;
    hasCredential: boolean; lawfulBasis: string; enabled: boolean; status: string;
    held: number; lastCount: number; totalImported: number;
    lastRunAt: string | null; lastError: string | null; resumable: boolean;
  };
  type Data = {
    stats: { total: number; imported: number; notified: number; claimed: number;
             suppressed: number; withEmail: number; withPreferredChannel: number };
    owed: number;
    sources: Src[];
    companies: { id: string; name: string }[];
    available: {
      kind: string; label: string; live: boolean; needs: string | null;
      where: string | null; tokenLabel: string | null;
    }[];
  };

  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  /**
   * A failed load is not a slow load.
   *
   * The first version did `if (r.ok) setData(...)` and nothing else, so any
   * error left the panel on "Loading…" for ever — which is exactly what an
   * administrator saw when the tables had not been migrated yet. The server was
   * returning a clear 503 saying "run the pending migration"; the screen threw
   * it away and showed a spinner. A screen that cannot fail is a screen that
   * lies.
   */
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);

  const load = async () => {
    setError(null);
    try {
      const r = await fetch("/api/admin/candidates", { cache: "no-store" });
      const body = await r.json().catch(() => null);
      if (!r.ok) {
        setError({
          message: body?.error ?? `The server returned ${r.status}.`,
          hint: body?.suggestions?.[0],
        });
        return;
      }
      setData(body);
    } catch {
      setError({ message: "Couldn't reach the server. Check your connection and reload." });
    }
  };
  useEffect(() => { void load(); }, []);

  /**
   * Connecting is a form, not a detection.
   *
   * Job sources auto-detect because a careers page is public — paste a URL and
   * the system works out the rest. A candidate source cannot work that way: it
   * needs a secret API key that belongs to one employer, which nothing can
   * discover, guess, or generate on their behalf. Somebody with access to that
   * employer's ATS has to create it and hand it over.
   *
   * So the honest interface is a short form that says exactly what it needs and
   * where to get it, rather than a hopeful "connect" button.
   */
  const [form, setForm] = useState({
    kind: "GREENHOUSE", companyId: "", label: "", token: "", secret: "",
    lawfulBasis: "APPLICATION",
  });
  const [connecting, setConnecting] = useState(false);

  const connect = async () => {
    setConnecting(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setMsg(d?.error ?? `Couldn't connect that source (${r.status}).`);
        return;
      }
      setMsg(
        d.result?.error
          ? `Connected, but the first pull failed: ${d.result.error}`
          : `Connected. ${d.result.created} people imported.`
      );
      // The secret is deliberately not kept in state after a successful save.
      setForm((f) => ({ ...f, secret: "", label: "", token: "" }));
      await load();
    } finally {
      setConnecting(false);
    }
  };

  const sync = async (sourceId: string) => {
    setBusy(sourceId);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/candidates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId }),
      });
      const d = await r.json();
      setMsg(
        d.result?.error
          ? `Sync failed: ${d.result.error}`
          : `${d.result.created} new, ${d.result.updated} refreshed` +
            (d.result.suppressed ? `, ${d.result.suppressed} skipped (previously objected)` : "") +
            (d.result.note ? ` — ${d.result.note}` : "")
      );
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (error) {
    return (
      <div className="notice" style={{ borderColor: "var(--bad)" }}>
        <b>Candidate sourcing isn&rsquo;t available.</b>
        <div style={{ marginTop: 6 }}>{error.message}</div>
        {error.hint ? <div style={{ marginTop: 6, color: "var(--dim2)" }}>{error.hint}</div> : null}
        <button className="ghost" style={{ marginTop: 10 }} onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }

  if (!data) return <div className="emptylist">Loading…</div>;

  const s = data.stats;
  const selected = data.available.find((a) => a.kind === form.kind);
  return (
    <>
      <p style={{ color: "var(--dim)", fontSize: 13.5, margin: "0 0 14px", lineHeight: 1.6 }}>
        People imported from connected systems. They are <b>not</b> users and are not matched
        against anything until they have been told they are here and have claimed their profile.
      </p>

      <div className="conf" style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 28, fontWeight: 800, color: data.owed ? "var(--bad)" : "var(--dim2)" }}>
          {data.owed}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--dim)" }}>
          {data.owed
            ? "held but not yet notified — each is owed a notice within a month of import"
            : "everyone held has been notified"}
        </div>
      </div>

      <div className="statgrid">
        {[
          ["Held in total", s.total],
          ["Notified", s.notified],
          ["Claimed their profile", s.claimed],
          ["Objected / erased", s.suppressed],
          ["Reachable by email", s.withEmail],
          ["Published a profile link", s.withPreferredChannel],
        ].map(([label, n]) => (
          <div key={String(label)} className="stat">
            <b>{n as number}</b>
            <span>{label as string}</span>
          </div>
        ))}
      </div>

      {msg ? <div className="notice" style={{ margin: "12px 0" }}>{msg}</div> : null}

      <h4 style={{ margin: "22px 0 8px", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".9px", color: "var(--dim2)", fontWeight: 800 }}>
        {data.sources.length} connected
      </h4>

      {data.sources.length === 0 ? (
        <div className="emptylist">
          Nothing connected yet. A source is one employer&rsquo;s ATS account and its own API key.
        </div>
      ) : (
        data.sources.map((src) => (
          <div key={src.id} className="srcrow">
            <div>
              <b>{src.label}</b>
              <div style={{ fontSize: 12.5, color: "var(--dim)" }}>
                {src.kindLabel}
                {src.token ? ` · ${src.token}` : ""} · basis: {src.lawfulBasis.toLowerCase().replace(/_/g, " ")}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--dim2)" }}>
                {src.held} held · {src.totalImported} imported all-time
                {src.lastRunAt ? ` · synced ${new Date(src.lastRunAt).toLocaleString()}` : " · never synced"}
                {src.resumable ? " · resuming next run" : ""}
              </div>
              {src.lastError ? (
                <div style={{ fontSize: 12.5, color: "var(--bad)" }}>{src.lastError}</div>
              ) : null}
            </div>
            <button className="ghost" disabled={busy === src.id} onClick={() => void sync(src.id)}>
              {busy === src.id ? "Syncing…" : "Sync now"}
            </button>
          </div>
        ))
      )}

      <h4 style={{ margin: "22px 0 8px", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".9px", color: "var(--dim2)", fontWeight: 800 }}>
        Connect a source
      </h4>

      <div className="notice" style={{ marginBottom: 12 }}>
        This cannot connect itself. A candidate source reads one employer&rsquo;s own applicants
        using a key that only they can generate — there is no public endpoint to detect, the way
        there is for a careers page.
      </div>

      <div className="field">
        <span>System</span>
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
          {data.available.filter((a) => a.live).map((a) => (
            <option key={a.kind} value={a.kind}>{a.label}</option>
          ))}
        </select>
      </div>

      {selected?.where ? (
        <div style={{ fontSize: 12.5, color: "var(--dim)", margin: "-4px 0 10px", lineHeight: 1.55 }}>
          {selected.where}
        </div>
      ) : null}

      <div className="field">
        <span>Employer</span>
        <select value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
          <option value="">Choose a company…</option>
          {data.companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="field">
        <span>Name for this connection</span>
        <input value={form.label} placeholder="e.g. Acme — Greenhouse"
          onChange={(e) => setForm({ ...form, label: e.target.value })} />
      </div>

      {selected?.tokenLabel ? (
        <div className="field">
          <span>{selected.tokenLabel}</span>
          <input value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} />
        </div>
      ) : null}

      <div className="field">
        <span>API key</span>
        {/* type=password so a key is not left readable on a shared screen. */}
        <input type="password" value={form.secret} autoComplete="off"
          onChange={(e) => setForm({ ...form, secret: e.target.value })} />
      </div>

      <div className="field">
        <span>Why we may hold these people</span>
        <select value={form.lawfulBasis} onChange={(e) => setForm({ ...form, lawfulBasis: e.target.value })}>
          <option value="APPLICATION">They applied to this employer</option>
          <option value="LICENSED">Held under a resume-database licence</option>
          <option value="LEGITIMATE_INTEREST">Sourcing under legitimate interest</option>
          <option value="CONSENT">They told us directly</option>
        </select>
      </div>

      <button
        className="primary"
        disabled={connecting || !form.companyId || !form.label || form.secret.length < 8}
        onClick={() => void connect()}
      >
        {connecting ? "Connecting…" : "Connect and import"}
      </button>

      <h4 style={{ margin: "22px 0 8px", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".9px", color: "var(--dim2)", fontWeight: 800 }}>
        What can be connected
      </h4>
      {data.available.map((a) => (
        <div key={a.kind} className="emptylist" style={{ marginBottom: 8, textAlign: "left" }}>
          <b>{a.label}</b>
          {a.live ? (
            <div style={{ fontSize: 12.5, color: "var(--dim)" }}>
              Ready — needs an API key generated in that employer&rsquo;s own account.
            </div>
          ) : (
            /*
             * Said plainly rather than hidden behind a disabled button. These
             * are real products with real contracts; the honest answer to "why
             * can't I connect Monster" is the sentence their account manager
             * needs to hear, not a greyed-out control.
             */
            <div style={{ fontSize: 12.5, color: "var(--dim)" }}>Needs {a.needs}</div>
          )}
        </div>
      ))}
    </>
  );
}
