"use client";

import { useState } from "react";

type Initial = {
  name: string; email: string; headline: string; location: string; remotePref: string;
  yearsExp: number; salaryTarget: number | null; availability: string; bio: string;
  skills: string[]; openToOffers: boolean; title: string;
};

export default function ProfileEditor({
  initial,
  linkedinLinked,
  linkedinAvailable,
}: {
  initial: Initial;
  linkedinLinked: boolean;
  linkedinAvailable: boolean;
}) {
  const [f, setF] = useState({
    ...initial,
    salaryTarget: initial.salaryTarget ?? 0,
    skills: initial.skills.join(", "),
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: f.name,
        headline: f.headline,
        location: f.location,
        remotePref: f.remotePref,
        yearsExp: Number(f.yearsExp) || 0,
        salaryTarget: Number(f.salaryTarget) || null,
        availability: f.availability,
        bio: f.bio,
        openToOffers: f.openToOffers,
        title: f.title,
        skills: f.skills.split(",").map((s) => s.trim()).filter(Boolean),
      }),
    });
    const data = await res.json();
    setBusy(false);
    setMsg(
      res.ok
        ? { ok: true, text: "Saved — your deck has been re-ranked against the new profile." }
        : { ok: false, text: data.error ?? "Could not save" }
    );
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  return (
    <div className="shell">
      <header className="top">
        <a className="iconbtn" href="/swipe">
          ‹
        </a>
        <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: "-.3px" }}>Your profile</div>
        <div className="spacer" />
        <button className="iconbtn" onClick={logout} title="Sign out">
          ⏻
        </button>
      </header>

      <div style={{ padding: "0 16px 28px" }}>
        <div className="note">
          <b>{f.email}</b>
          <br />
          {linkedinLinked
            ? "✓ LinkedIn connected — identity verified. Recruiters see a Verified badge on your card."
            : linkedinAvailable
              ? "Not connected to LinkedIn."
              : "LinkedIn sign-in isn't configured on this deployment."}
        </div>

        {!linkedinLinked && linkedinAvailable ? (
          <a className="btn li" href="/api/auth/linkedin/start">
            in&nbsp;&nbsp;Connect LinkedIn
          </a>
        ) : null}

        <form onSubmit={save}>
          <label className="field">
            <span>Name</span>
            <input value={f.name} onChange={(e) => set("name", e.target.value)} required />
          </label>
          <label className="field">
            <span>Headline</span>
            <input value={f.headline} onChange={(e) => set("headline", e.target.value)} />
          </label>
          <div className="two">
            <label className="field">
              <span>Location</span>
              <input value={f.location} onChange={(e) => set("location", e.target.value)} />
            </label>
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
                value={f.yearsExp}
                onChange={(e) => set("yearsExp", Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span>Target salary ($k)</span>
              <input
                type="number"
                value={f.salaryTarget}
                onChange={(e) => set("salaryTarget", Number(e.target.value))}
              />
            </label>
          </div>
          <label className="field">
            <span>Availability</span>
            <input value={f.availability} onChange={(e) => set("availability", e.target.value)} />
          </label>
          <label className="field">
            <span>Skills — comma separated</span>
            <input value={f.skills} onChange={(e) => set("skills", e.target.value)} />
          </label>
          <label className="field">
            <span>About</span>
            <textarea value={f.bio} onChange={(e) => set("bio", e.target.value)} />
          </label>
          <label className="field">
            <span>Recruiter title (if you post jobs)</span>
            <input
              value={f.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Talent Partner"
            />
          </label>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginTop: 14,
              fontSize: 13.5,
              color: "var(--dim)",
            }}
          >
            <input
              type="checkbox"
              checked={f.openToOffers}
              onChange={(e) => set("openToOffers", e.target.checked)}
              style={{ width: 18, height: 18 }}
            />
            Open to offers — appear in recruiters&rsquo; candidate decks
          </label>

          {msg ? <div className={msg.ok ? "ok" : "err"}>{msg.text}</div> : null}

          <button className="btn go" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save profile"}
          </button>
        </form>
      </div>
    </div>
  );
}
