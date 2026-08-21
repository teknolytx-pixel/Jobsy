"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon, Logo } from "@/components/Icon";

/**
 * The resume screen.
 *
 * Three things are on it, and the order is the argument: the document first,
 * what a specific posting is missing second, and the optional AI polish last
 * and clearly labelled. The polish is last because it is the least of it — the
 * builder and the gap report are the features, and both work with no model.
 *
 * Nothing here writes to the profile. Every suggestion is shown next to the
 * candidate's own text with the original still visible.
 */

type Section = {
  key: string;
  title: string;
  lines: string[];
  /** Indices of `lines` that are role headings. Stated by the builder. */
  headings: number[];
  empty: boolean;
  hint: string | null;
  deprioritised?: string[];
};

type Built = {
  name: string;
  contact: string[];
  headline: string | null;
  sections: Section[];
  missing: string[];
};

type Gap = {
  severity: "BLOCKING" | "IMPORTANT" | "MINOR";
  title: string;
  detail: string;
  action: string | null;
  skill: string | null;
};

type Payload = {
  resume: Built;
  tailored: (Built & { unaddressed: string[]; notes: string[] }) | null;
  gaps: { score: number; gaps: Gap[]; strengths: string[] } | null;
  polish: {
    lines: { original: string; text: string; applied: boolean }[];
    stats: { total: number; applied: number; rejected: number; skipped: number };
    provider: string | null;
    unavailable: boolean;
  } | null;
  ai: { available: boolean; subProcessors: string[] };
};

type Job = { id: string; title: string; company: string };

const SEV_COLOR: Record<Gap["severity"], string> = {
  BLOCKING: "var(--no)",
  IMPORTANT: "var(--gold)",
  MINOR: "var(--blue)",
};

export default function ResumeBuilder() {
  const [data, setData] = useState<Payload | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobId, setJobId] = useState("");
  const [busy, setBusy] = useState(true);
  const [polishing, setPolishing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (id: string, polish = false) => {
    polish ? setPolishing(true) : setBusy(true);
    setErr(null);
    try {
      const qs = new URLSearchParams();
      if (id) qs.set("jobId", id);
      if (polish) qs.set("polish", "1");
      const res = await fetch(`/api/resume/builder?${qs}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not build your resume.");
      setData(body);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      setPolishing(false);
    }
  }, []);

  useEffect(() => {
    void load("");
    // The postings the candidate has already said yes to. Tailoring against a
    // role they have not shown interest in is busywork.
    void fetch("/api/matches", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { matches: [] }))
      .then((b) => {
        const rows = (b.matches ?? []) as { jobId?: string; jobTitle?: string; company?: string }[];
        setJobs(
          rows
            .filter((m) => m.jobId && m.jobTitle)
            .map((m) => ({ id: m.jobId!, title: m.jobTitle!, company: m.company ?? "" }))
        );
      })
      .catch(() => {});
  }, [load]);

  const doc = data?.tailored ?? data?.resume ?? null;

  return (
    <div className="shell">
      <header className="top">
        <a href="/swipe" className="logo">
          <Logo />
          <b>Jobsy</b>
        </a>
        <div className="spacer" />
        <a className="iconbtn" href="/swipe">
          <Icon name="close" size={15} label="Close" />
        </a>
      </header>

      <div className="tabs">
        <a href="/swipe">Discover</a>
        <a href="/applied">Applied</a>
        <a href="/matches">Matches</a>
        <button className="on">Resume</button>
      </div>

      <div className="list">
        {err ? <div className="err">{err}</div> : null}

        {/* Tailoring target. Empty option is the plain document. */}
        <div className="ctxbar">
          <span className="lbl">Tailor to</span>
          <select
            value={jobId}
            onChange={(e) => {
              setJobId(e.target.value);
              void load(e.target.value);
            }}
          >
            <option value="">My resume (no specific role)</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title}
                {j.company ? ` · ${j.company}` : ""}
              </option>
            ))}
          </select>
        </div>

        {busy ? <div className="emptylist">Building your resume…</div> : null}

        {doc && !busy ? (
          <>
            {data?.resume.missing.length ? (
              <div className="note">
                <b>Your profile is missing {data.resume.missing.join(", ")}.</b>
                <br />
                The resume builds without them — it just has less to work with.{" "}
                <a href="/profile" style={{ color: "var(--blue)" }}>
                  Fill them in
                </a>{" "}
                and everything here improves, including your matches.
              </div>
            ) : null}

            {data?.tailored?.notes.length ? (
              <div className="note">
                {data.tailored.notes.map((n, i) => (
                  <div key={i} style={{ marginBottom: i === data.tailored!.notes.length - 1 ? 0 : 6 }}>
                    {n}
                  </div>
                ))}
              </div>
            ) : null}

            {/* The document. */}
            <div className="row" style={{ flexDirection: "column", alignItems: "stretch", gap: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-.3px" }}>{doc.name}</div>
              {doc.headline ? <div className="s">{doc.headline}</div> : null}
              {doc.contact.length ? <div className="s2">{doc.contact.join(" · ")}</div> : null}

              {doc.sections.map((s) => (
                <div key={s.key} className="sect">
                  <h4>{s.title}</h4>
                  {s.empty ? (
                    <p style={{ color: "var(--dim2)", fontSize: 12.5, margin: 0 }}>{s.hint}</p>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: 18, color: "#ced5e4", fontSize: 13.5, lineHeight: 1.6 }}>
                      {s.lines.map((l, i) => {
                        // Whether a line is a role heading comes from the
                        // builder. Guessing it here with a regex made a summary
                        // that happened to contain an em-dash render as a job
                        // title.
                        const head = s.headings.includes(i);
                        return (
                          <li
                            key={i}
                            style={{
                              listStyle: head ? "none" : "disc",
                              marginLeft: head ? -18 : 0,
                              fontWeight: head ? 700 : 400,
                              marginTop: head ? 10 : 2,
                            }}
                          >
                            {l}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {s.deprioritised?.length ? (
                    <details style={{ marginTop: 6 }}>
                      <summary style={{ color: "var(--dim2)", fontSize: 12, cursor: "pointer" }}>
                        {s.deprioritised.length} line{s.deprioritised.length === 1 ? "" : "s"} moved out for this role
                      </summary>
                      <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "var(--dim2)", fontSize: 12.5 }}>
                        {s.deprioritised.map((l, i) => (
                          <li key={i}>{l}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="two" style={{ marginTop: 4 }}>
              <a className="btn ghost" href="/api/resume/builder?format=txt">
                <Icon name="external" size={15} /> Download .txt
              </a>
              <a className="btn ghost" href="/api/resume/builder?format=html">
                <Icon name="external" size={15} /> Download .html
              </a>
            </div>

            {/* RES-006 */}
            {data?.gaps ? (
              <>
                <div className="sect" style={{ marginTop: 18 }}>
                  <h4>What this role asks for</h4>
                </div>
                {data.gaps.strengths.map((s, i) => (
                  <div key={i} className="ok">
                    <Icon name="check" size={13} /> {s}
                  </div>
                ))}
                {data.gaps.gaps.map((g, i) => (
                  <div key={i} className="row" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, color: SEV_COLOR[g.severity] }}>
                      <Icon name={g.severity === "MINOR" ? "info" : "alert"} size={14} />
                      <b style={{ fontSize: 13.5, color: "var(--txt)" }}>{g.title}</b>
                    </div>
                    <div className="s2" style={{ marginTop: 0 }}>{g.detail}</div>
                    {g.action ? (
                      <div className="s2" style={{ color: "var(--dim)" }}>{g.action}</div>
                    ) : null}
                  </div>
                ))}
              </>
            ) : null}

            {/* RES-005, and labelled for what it is. */}
            <div className="sect" style={{ marginTop: 18 }}>
              <h4>Optional — AI wording pass</h4>
            </div>
            {data?.ai.available ? (
              <>
                <div className="note">
                  This rewrites the <b>wording</b> of your bullet points and nothing else. Every
                  rewrite is checked against what you wrote, and any version that adds a number,
                  a date, a tool or an employer that isn&rsquo;t already in your text is thrown
                  away — you get your original line back instead.
                  {data.ai.subProcessors.length ? (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ cursor: "pointer", color: "var(--dim2)", fontSize: 12 }}>
                        Who processes this text
                      </summary>
                      <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12, color: "var(--dim2)" }}>
                        {data.ai.subProcessors.map((s, i) => (
                          <li key={i} style={{ marginTop: 4 }}>{s}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
                <button
                  className="btn"
                  disabled={polishing}
                  onClick={() => void load(jobId, true)}
                >
                  {polishing ? "Rewriting…" : <><Icon name="sparkle" size={15} /> Suggest better wording</>}
                </button>
              </>
            ) : (
              <div className="note">
                No AI provider is configured on this deployment, so the wording pass is off.
                Everything above &mdash; the document, the tailoring and the gap report &mdash;
                is built without one and is unaffected.
              </div>
            )}

            {data?.polish && !data.polish.unavailable ? (
              <>
                <div className="s2" style={{ margin: "10px 0 4px", color: "var(--dim2)" }}>
                  {data.polish.stats.applied} suggestion
                  {data.polish.stats.applied === 1 ? "" : "s"} · {data.polish.stats.rejected} discarded
                  for adding facts you didn&rsquo;t write
                  {data.polish.provider ? ` · via ${data.polish.provider}` : ""}
                </div>
                {data.polish.lines
                  .filter((l) => l.applied)
                  .map((l, i) => (
                    <div key={i} className="row" style={{ flexDirection: "column", alignItems: "stretch", gap: 5 }}>
                      <div className="s2" style={{ color: "var(--dim2)", textDecoration: "line-through", marginTop: 0 }}>
                        {l.original}
                      </div>
                      <div style={{ fontSize: 13.5, color: "var(--txt)" }}>{l.text}</div>
                    </div>
                  ))}
                {data.polish.stats.applied === 0 ? (
                  <div className="emptylist">
                    Nothing to change &mdash; your bullets already read well.
                  </div>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
