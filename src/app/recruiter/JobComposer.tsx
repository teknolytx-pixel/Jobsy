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
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
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
