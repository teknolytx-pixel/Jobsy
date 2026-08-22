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
  const [tab, setTab] = useState<"queue" | "compliance">("queue");
  const [queue, setQueue] = useState<(typeof QUEUES)[number]["key"]>("OPEN");
  const [reports, setReports] = useState<Report[] | null>(null);
  const [compliance, setCompliance] = useState<Compliance | null>(null);
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

        <div className="s2" style={{ color: "var(--dim2)", marginTop: 18 }}>
          Signed in as {email}. Opening this console is itself recorded in the audit log —
          reading personal data is an access like any other.
        </div>
      </div>
    </div>
  );
}
