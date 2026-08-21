"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { COUNTRIES } from "@/lib/geo/countries";

type Initial = {
  name: string;
  headline: string;
  location: string;
  remotePref: string;
  yearsExp: number;
  salaryTarget: number | null;
  availability: string;
  bio: string;
  skills: string[];
  /** CLP-001 — the single most consequential field on this form. */
  currentCountry: string | null;
};

export default function OnboardingForm({
  initial,
  linkedinLinked,
}: {
  initial: Initial;
  linkedinLinked: boolean;
}) {
  const router = useRouter();
  const [f, setF] = useState({
    ...initial,
    currentCountry: initial.currentCountry ?? "",
    salaryTarget: initial.salaryTarget ?? 0,
    skills: initial.skills.join(", "),
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const skills = f.skills.split(",").map((s) => s.trim()).filter(Boolean);
    if (skills.length < 3) {
      setErr("Add at least 3 skills — the match engine needs them to rank jobs for you.");
      setBusy(false);
      return;
    }
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: f.name,
        headline: f.headline,
        location: f.location,
        currentCountry: f.currentCountry || null,
        remotePref: f.remotePref,
        yearsExp: Number(f.yearsExp) || 0,
        salaryTarget: Number(f.salaryTarget) || null,
        availability: f.availability || "Flexible",
        bio: f.bio,
        skills,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setErr(data.error ?? "Could not save");
    router.push("/swipe");
    router.refresh();
  }

  return (
    <div className="shell">
      <header className="top">
        <div className="logo">
          <span className="spark">🔥</span>
          <b>Jobsy</b>
        </div>
      </header>

      <div style={{ padding: "6px 16px 28px" }}>
        <h1 style={{ fontSize: 24, letterSpacing: "-.5px", margin: "0 0 6px" }}>Build your profile</h1>
        <p style={{ color: "var(--dim)", fontSize: 13.5, margin: "0 0 4px", lineHeight: 1.6 }}>
          This is what recruiters swipe on, and what Easy Apply sends on your behalf.
        </p>

        {linkedinLinked ? (
          <div className="ok" style={{ marginTop: 14 }}>
            ✓ LinkedIn connected — name, email and photo imported. LinkedIn&rsquo;s OIDC scope
            doesn&rsquo;t include work history or skills, so those two fields are on you.
          </div>
        ) : null}

        <form onSubmit={save}>
          <label className="field">
            <span>Name</span>
            <input value={f.name} onChange={(e) => set("name", e.target.value)} required />
          </label>

          <label className="field">
            <span>Headline</span>
            <input
              value={f.headline}
              onChange={(e) => set("headline", e.target.value)}
              placeholder="Senior Frontend Engineer"
              required
            />
          </label>

          <div className="two">
            <label className="field">
              <span>Location</span>
              <input
                value={f.location}
                onChange={(e) => set("location", e.target.value)}
                placeholder="Austin, TX"
                required
              />
            </label>
            <label className="field">
              <span>Country</span>
              <select
                value={f.currentCountry}
                onChange={(e) => set("currentCountry", e.target.value)}
                required
              >
                <option value="">Choose…</option>
                {Object.entries(COUNTRIES).map(([code, name]) => (
                  <option key={code} value={code}>{name}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="two">
            <label className="field">
              <span>Work style</span>
              <select value={f.remotePref} onChange={(e) => set("remotePref", e.target.value)}>
                <option value="ANY">Flexible</option>
                <option value="REMOTE">Remote only</option>
                <option value="HYBRID">Hybrid</option>
                <option value="ONSITE">Onsite</option>
              </select>
            </label>
          </div>

          <div className="two">
            <label className="field">
              <span>Years experience</span>
              <input
                type="number"
                min={0}
                max={60}
                value={f.yearsExp}
                onChange={(e) => set("yearsExp", Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span>Target salary ($k)</span>
              <input
                type="number"
                min={0}
                max={2000}
                value={f.salaryTarget}
                onChange={(e) => set("salaryTarget", Number(e.target.value))}
                placeholder="160"
              />
            </label>
          </div>

          <label className="field">
            <span>Availability</span>
            <input
              value={f.availability}
              onChange={(e) => set("availability", e.target.value)}
              placeholder="2 weeks"
            />
          </label>

          <label className="field">
            <span>Skills — comma separated, 3 minimum</span>
            <input
              value={f.skills}
              onChange={(e) => set("skills", e.target.value)}
              placeholder="React, TypeScript, GraphQL, SQL"
              required
            />
          </label>

          <label className="field">
            <span>About you</span>
            <textarea
              value={f.bio}
              onChange={(e) => set("bio", e.target.value)}
              placeholder="What you've shipped, and what you want next."
            />
          </label>

          {err ? <div className="err">{err}</div> : null}

          <button className="btn go" disabled={busy} type="submit">
            {busy ? "Saving…" : "Start swiping →"}
          </button>
        </form>
      </div>
    </div>
  );
}
