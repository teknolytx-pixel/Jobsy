"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui";

export default function JobComposer({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [f, setF] = useState({
    title: "",
    companyName: "",
    location: "",
    remote: "HYBRID",
    employmentType: "Full-time",
    salaryMin: "",
    salaryMax: "",
    description: "",
    skills: "",
    applyMethod: "EASY" as "EASY" | "EXTERNAL",
    applyUrl: "",
    /** TRUST-001 — the ghost-jobs attestation. Required by the API. */
    attest: false,
    /** LEGAL-002 — headcount drives the pay-transparency thresholds. */
    employeeCount: "",
    /**
     * LEGAL-002 — required wherever a pay-transparency rule applies, which
     * includes every REMOTE role, because a remote role may be performed from
     * a covered state.
     */
    benefits: "",
    /** WORK-002 — three states. "" means unstated, and is never inferred. */
    sponsorship: "" as "" | "YES" | "NO",
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Catch it here rather than letting the server reject it, so the message
    // lands next to the control the recruiter has to act on.
    if (!f.attest) {
      setErr("Please confirm this is a current, open vacancy that you're authorized to advertise.");
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: f.title,
        companyName: f.companyName,
        location: f.location,
        remote: f.remote,
        employmentType: f.employmentType,
        salaryMin: f.salaryMin ? Number(f.salaryMin) : null,
        salaryMax: f.salaryMax ? Number(f.salaryMax) : null,
        description: f.description,
        skills: f.skills.split(",").map((s) => s.trim()).filter(Boolean),
        applyMethod: f.applyMethod,
        applyUrl: f.applyMethod === "EXTERNAL" ? f.applyUrl : null,
        attestCurrentVacancy: f.attest,
        benefitsDescription: f.benefits.trim() || null,
        employeeCount: f.employeeCount ? Number(f.employeeCount) : null,
        sponsorshipAvailable: f.sponsorship === "" ? null : f.sponsorship === "YES",
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setErr(data.error ?? "Could not create the post");
    onCreated();
  }

  return (
    <Sheet onClose={onClose}>
      <h3>Post a job</h3>
      <p className="lead">
        Candidates will swipe this. You&rsquo;ll swipe candidates against it.
      </p>

      <form onSubmit={submit}>
        <label className="field">
          <span>Job title</span>
          <input value={f.title} onChange={(e) => set("title", e.target.value)} required placeholder="Senior Frontend Engineer" />
        </label>

        <div className="two">
          <label className="field">
            <span>Company</span>
            <input value={f.companyName} onChange={(e) => set("companyName", e.target.value)} required />
          </label>
          <label className="field">
            <span>Location</span>
            <input value={f.location} onChange={(e) => set("location", e.target.value)} required placeholder="Austin, TX" />
          </label>
        </div>

        <div className="two">
          <label className="field">
            <span>Work style</span>
            <select value={f.remote} onChange={(e) => set("remote", e.target.value)}>
              <option value="ONSITE">Onsite</option>
              <option value="HYBRID">Hybrid</option>
              <option value="REMOTE">Remote</option>
            </select>
          </label>
          <label className="field">
            <span>Type</span>
            <select value={f.employmentType} onChange={(e) => set("employmentType", e.target.value)}>
              <option>Full-time</option>
              <option>Contract</option>
              <option>Part-time</option>
              <option>Internship</option>
            </select>
          </label>
        </div>

        <div className="two">
          <label className="field">
            <span>Salary min ($k)</span>
            <input type="number" value={f.salaryMin} onChange={(e) => set("salaryMin", e.target.value)} placeholder="150" />
          </label>
          <label className="field">
            <span>Salary max ($k)</span>
            <input type="number" value={f.salaryMax} onChange={(e) => set("salaryMax", e.target.value)} placeholder="185" />
          </label>
        </div>

        <label className="field">
          <span>Description</span>
          <textarea
            value={f.description}
            onChange={(e) => set("description", e.target.value)}
            required
            minLength={20}
            placeholder="What the person will own, and what makes this role worth leaving somewhere else for."
          />
        </label>

        <label className="field">
          <span>Skills — leave blank to auto-extract from the description</span>
          <input value={f.skills} onChange={(e) => set("skills", e.target.value)} placeholder="React, TypeScript, GraphQL" />
        </label>

        <label className="field">
          <span>How should candidates apply?</span>
          <select value={f.applyMethod} onChange={(e) => set("applyMethod", e.target.value as "EASY" | "EXTERNAL")}>
            <option value="EASY">⚡ Easy Apply — profile emailed to me on right-swipe</option>
            <option value="EXTERNAL">↗ Send them to my own posting</option>
          </select>
        </label>

        {f.applyMethod === "EXTERNAL" ? (
          <label className="field">
            <span>Apply URL — LinkedIn, Indeed, Greenhouse, careers page…</span>
            <input
              type="url"
              value={f.applyUrl}
              onChange={(e) => set("applyUrl", e.target.value)}
              required
              placeholder="https://www.linkedin.com/jobs/view/…"
            />
          </label>
        ) : null}

        <label className="field">
          <span>
            Benefits and other compensation
            {f.remote === "REMOTE" ? " — required for remote roles" : ""}
          </span>
          <textarea
            value={f.benefits}
            onChange={(e) => set("benefits", e.target.value)}
            placeholder="Health, dental and vision; 401(k) with 4% match; 20 days PTO; annual bonus target 10%; equity."
          />
          <small style={{ color: "var(--dim)", fontSize: 12 }}>
            Sixteen states require this alongside the salary range. A remote role counts as covered,
            because it can be performed from any of them.
          </small>
        </label>

        <div className="two">
          <label className="field">
            <span>Company headcount — optional</span>
            <input
              type="number"
              min={1}
              value={f.employeeCount}
              onChange={(e) => set("employeeCount", e.target.value)}
              placeholder="250"
            />
            <small style={{ color: "var(--dim)", fontSize: 12 }}>
              Sets which pay-transparency rules apply. Left blank, we assume they all do.
            </small>
          </label>
          <label className="field">
            <span>Visa sponsorship</span>
            <select
              value={f.sponsorship}
              onChange={(e) => set("sponsorship", e.target.value as "" | "YES" | "NO")}
            >
              <option value="">Prefer not to state</option>
              <option value="YES">Available for this role</option>
              <option value="NO">Not available for this role</option>
            </select>
          </label>
        </div>

        {/* ── TRUST-001: the ghost-jobs attestation. Required, not optional. ── */}
        <label
          htmlFor="attest-vacancy"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            margin: "4px 0 14px",
            padding: "12px 14px",
            border: "1px solid var(--line, #e6e8f0)",
            borderRadius: 12,
            cursor: "pointer",
            color: "var(--txt)",
            fontSize: 13.5,
            lineHeight: 1.5,
          }}
        >
          <input
            id="attest-vacancy"
            type="checkbox"
            checked={f.attest}
            onChange={(e) => set("attest", e.target.checked)}
            required
            aria-describedby="attest-vacancy-text"
            style={{ marginTop: 2, width: 18, height: 18, flexShrink: 0 }}
          />
          <span id="attest-vacancy-text">
            I confirm this is a <b>current, open vacancy</b> that I am authorized to advertise.
            <br />
            <small style={{ color: "var(--dim)" }}>
              Advertising a role that isn&rsquo;t genuinely open is unlawful in several states —
              Texas allows treble damages.
            </small>
          </span>
        </label>

        {err ? <div className="err">{err}</div> : null}

        <button className="btn go" type="submit" disabled={busy}>
          {busy ? "Posting…" : "Publish job"}
        </button>
      </form>
      <button className="btn ghost" onClick={onClose}>
        Cancel
      </button>
    </Sheet>
  );
}
