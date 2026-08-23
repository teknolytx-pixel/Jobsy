"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet, useToast } from "@/components/ui";
import { Icon } from "@/components/Icon";
import {
  JOB_STATUS_LABEL,
  canTransition,
  type JobStatus,
} from "@/lib/jobStatus";

/**
 * REC-003 — managing a posting after it exists.
 *
 * ── What this replaces ──
 *
 * Nothing. `PATCH /api/jobs/[id]` has been complete and tested since the
 * lifecycle was written — publish, pause, close, archive, edit, re-attest — and
 * no screen in the product called any of it. The posting list rendered a status
 * badge and stopped there.
 *
 * The sharpest consequence was the draft. "Save as draft" wrote a row the
 * recruiter could then never reach: not visible to candidates, not editable, not
 * publishable, and not deletable. The one honest description of that feature was
 * that it discarded your work while appearing to save it.
 *
 * ── Only the legal transitions are offered ──
 *
 * Read from `canTransition`, the same table the API enforces, rather than a
 * hand-written list of buttons. A UI that offers a move the server refuses
 * teaches people the product is broken; one that silently hides a move the
 * server allows is a feature nobody finds. Importing the table means the two
 * cannot drift.
 *
 * ARCHIVED is terminal and the UI says so before you do it, because the API
 * will refuse to undo it and an undo button that does not exist is better
 * discovered in a confirmation than after the fact.
 */

type Props = {
  jobId: string;
  status: JobStatus;
  /** Feed-ingested rows are edited at the source; see INGESTED_NOT_EDITABLE. */
  editable: boolean;
  title: string;
  location: string;
  salaryMin: number | null;
  salaryMax: number | null;
  benefitsDescription: string | null;
};

/** What each move is called in the sheet, and how alarming it should look. */
const MOVES: { to: JobStatus; label: string; done: string; hint: string; tone?: "go" | "warn" }[] = [
  { to: "PUBLISHED", label: "Publish", done: "Published — it's live.", hint: "Visible to candidates and accepting applications.", tone: "go" },
  { to: "PAUSED", label: "Pause", done: "Paused.", hint: "Hidden from decks. Existing conversations continue." },
  { to: "CLOSED", label: "Close", done: "Closed.", hint: "Still readable, but no new applications." },
  { to: "ARCHIVED", label: "Archive", done: "Archived.", hint: "Hidden everywhere. This cannot be undone.", tone: "warn" },
];

export default function JobActions(p: Props) {
  const router = useRouter();
  const { toast, toastNode } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** LEGAL-002 — the specific things missing, when publishing is refused. */
  const [problems, setProblems] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({
    title: p.title,
    location: p.location,
    salaryMin: p.salaryMin?.toString() ?? "",
    salaryMax: p.salaryMax?.toString() ?? "",
    benefitsDescription: p.benefitsDescription ?? "",
    employeeCount: "",
  });

  async function patch(body: Record<string, unknown>, okMessage: string) {
    setBusy(true);
    setErr(null);
    setProblems([]);
    try {
      const res = await fetch(`/api/jobs/${p.jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error ?? "That didn't work.");
        /**
         * Publishing a draft re-runs pay transparency, and it comes back with
         * exactly what is missing. Showing the list is the difference between
         * "rejected" and "add a salary range and this will go live".
         */
        if (Array.isArray(data.problems)) setProblems(data.problems);
        return;
      }
      toast(okMessage);
      setOpen(false);
      setEditing(false);
      router.refresh();
    } catch {
      setErr("Network error — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const moves = MOVES.filter((m) => m.to !== p.status && canTransition(p.status, m.to));

  return (
    <>
      <button
        className="iconbtn"
        onClick={() => setOpen(true)}
        title="Manage this posting"
        aria-label={`Manage ${p.title}`}
      >
        <Icon name="sliders" size={15} />
      </button>

      {open ? (
        <Sheet onClose={() => setOpen(false)}>
          <h3>{p.title}</h3>
          <p className="lead">{JOB_STATUS_LABEL[p.status]}</p>

          {!p.editable ? (
            <div className="note">
              This posting came from the employer&rsquo;s own careers site or applicant tracking
              system, so it&rsquo;s managed there. Anything changed here would be overwritten by the
              next sync.
            </div>
          ) : (
            <>
              {err ? (
                <div className="err">
                  {err}
                  {problems.length ? (
                    <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                      {problems.map((x) => (
                        <li key={x} style={{ margin: "3px 0" }}>
                          {x}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              {/*
                TRUST-001 — the "still open" attestation, which also resets the
                expiry clock. Offered on live postings only: confirming that a
                closed role is still open is a contradiction, and Illinois and
                Texas both attach real liability to advertising a role that is
                not.
              */}
              {p.status === "PUBLISHED" ? (
                <button
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => patch({ confirmStillOpen: true }, "Confirmed — the expiry clock is reset.")}
                >
                  <Icon name="checkCircle" size={15} /> This role is still open
                </button>
              ) : null}

              {/* Button and its consequence together — a list of buttons followed
                  by a separate list of explanations makes the reader match them
                  up by position, which is exactly when someone archives by
                  mistake. */}
              {moves.map((m) => (
                <div key={m.to}>
                  <button
                    className={`btn ${m.tone === "go" ? "go" : "ghost"}`}
                    disabled={busy}
                    onClick={() => {
                      if (m.to === "ARCHIVED" && !confirm("Archiving is permanent. Continue?")) return;
                      patch(
                        m.to === "PUBLISHED" && f.employeeCount
                          ? { status: m.to, employeeCount: Number(f.employeeCount) }
                          : { status: m.to },
                        m.done
                      );
                    }}
                  >
                    {m.label}
                  </button>
                  <p className="hint" style={{ textAlign: "left", margin: "4px 2px 10px" }}>
                    {m.hint}
                  </p>
                </div>
              ))}

              {!editing ? (
                <button className="btn ghost" onClick={() => setEditing(true)}>
                  <Icon name="pencil" size={15} /> Edit details
                </button>
              ) : (
                <>
                  <label className="field">
                    <span>Title</span>
                    <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
                  </label>
                  <label className="field">
                    <span>Location</span>
                    <input
                      value={f.location}
                      onChange={(e) => setF({ ...f, location: e.target.value })}
                    />
                  </label>
                  <div className="two">
                    <label className="field">
                      <span>Salary min ($k)</span>
                      <input
                        inputMode="numeric"
                        value={f.salaryMin}
                        onChange={(e) => setF({ ...f, salaryMin: e.target.value })}
                      />
                    </label>
                    <label className="field">
                      <span>Salary max ($k)</span>
                      <input
                        inputMode="numeric"
                        value={f.salaryMax}
                        onChange={(e) => setF({ ...f, salaryMax: e.target.value })}
                      />
                    </label>
                  </div>
                  <label className="field">
                    <span>Benefits</span>
                    <textarea
                      value={f.benefitsDescription}
                      onChange={(e) => setF({ ...f, benefitsDescription: e.target.value })}
                      placeholder="Required alongside a salary range in several states."
                    />
                  </label>
                  {/*
                    Headcount is not stored on the job, so it has to be resent
                    whenever pay-transparency rules are re-evaluated. Unknown is
                    treated as "every rule applies", which is the safe default
                    but holds a genuinely exempt small employer to rules that do
                    not apply to them.
                  */}
                  <label className="field">
                    <span>Employees at your company (optional)</span>
                    <input
                      inputMode="numeric"
                      value={f.employeeCount}
                      onChange={(e) => setF({ ...f, employeeCount: e.target.value })}
                      placeholder="Leave blank and every state rule is applied"
                    />
                  </label>

                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() =>
                      patch(
                        {
                          title: f.title,
                          location: f.location,
                          salaryMin: f.salaryMin === "" ? null : Number(f.salaryMin),
                          salaryMax: f.salaryMax === "" ? null : Number(f.salaryMax),
                          benefitsDescription:
                            f.benefitsDescription.trim() === "" ? null : f.benefitsDescription,
                          ...(f.employeeCount ? { employeeCount: Number(f.employeeCount) } : {}),
                        },
                        "Saved."
                      )
                    }
                  >
                    {busy ? "Saving…" : "Save changes"}
                  </button>
                  <button className="btn ghost" disabled={busy} onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                </>
              )}
            </>
          )}
        </Sheet>
      ) : null}
      {toastNode}
    </>
  );
}
