"use client";

import { useState } from "react";
// Country list only — the centroid table stays server-side.
import { COUNTRIES, REGIONS } from "@/lib/geo/countries";

type Initial = {
  name: string; email: string; headline: string; location: string; remotePref: string;
  yearsExp: number; salaryTarget: number | null; availability: string; bio: string;
  skills: string[]; openToOffers: boolean; title: string;
  // ── FSD v1.1 §36.2 ──
  currentCountry: string | null;
  currentPostalCode: string | null;
  searchCountry: string | null;
  preferredCountries: string[];
  preferredRegions: string[];
  internationalSearchEnabled: boolean;
  remoteEligibleCountries: string[];
  relocationWillingness: string;
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
    currentCountry: initial.currentCountry ?? "",
    currentPostalCode: initial.currentPostalCode ?? "",
    preferredCountries: (initial.preferredCountries ?? []).join(", "),
    preferredRegions: (initial.preferredRegions ?? []).join(", "),
    internationalSearchEnabled: Boolean(initial.internationalSearchEnabled),
    // CLP-005 — "" same country only, "*" anywhere, otherwise a list.
    remoteReach:
      (initial.remoteEligibleCountries ?? []).includes("*")
        ? "ANYWHERE"
        : (initial.remoteEligibleCountries ?? []).includes("SAME")
          ? "SAME"
          : (initial.remoteEligibleCountries ?? []).length
            ? "LIST"
            : "UNSET",
    remoteEligibleCountries: (initial.remoteEligibleCountries ?? [])
      .filter((c) => c !== "*")
      .join(", "),
    relocationWillingness: initial.relocationWillingness ?? "NONE",
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
        currentCountry: f.currentCountry || null,
        currentPostalCode: f.currentPostalCode.trim() || null,
        preferredCountries: f.preferredCountries
          .split(",").map((x) => x.trim().toUpperCase()).filter(Boolean),
        preferredRegions: f.preferredRegions
          .split(",").map((x) => x.trim().toUpperCase()).filter(Boolean),
        internationalSearchEnabled: f.internationalSearchEnabled,
        remoteEligibleCountries:
          f.remoteReach === "ANYWHERE"
            ? ["*"]
            : f.remoteReach === "SAME"
              ? ["SAME"]
              : f.remoteReach === "LIST"
                ? f.remoteEligibleCountries
                    .split(",").map((x) => x.trim().toUpperCase()).filter(Boolean)
                : [],
        relocationWillingness: f.relocationWillingness,
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
          {/* ── FSD v1.1 §31 — where you want to work, as distinct from where you live ── */}
          <div className="sect" style={{ marginTop: 6 }}>
            <h4>Where you want to work</h4>
          </div>

          <div className="two">
            <label className="field">
              <span>Country you live in</span>
              <select
                value={f.currentCountry}
                onChange={(e) => set("currentCountry", e.target.value)}
              >
                <option value="">Choose…</option>
                {Object.entries(COUNTRIES).map(([code, name]) => (
                  <option key={code} value={code}>{name}</option>
                ))}
              </select>
              <small style={{ color: "var(--dim)", fontSize: 12 }}>
                We show you roles here by default. Nothing about citizenship is asked or stored.
              </small>
            </label>
            <label className="field">
              <span>Postal / ZIP code — optional</span>
              <input
                value={f.currentPostalCode}
                onChange={(e) => set("currentPostalCode", e.target.value)}
                placeholder="78701"
              />
              <small style={{ color: "var(--dim)", fontSize: 12 }}>
                Only used to judge distance for roles that require candidates to be
                local. It is never shown to recruiters and never affects your match
                score.
              </small>
            </label>
          </div>

          <div className="two">
            <label className="field">
              <span>Would you relocate?</span>
              <select
                value={f.relocationWillingness}
                onChange={(e) => set("relocationWillingness", e.target.value)}
              >
                <option value="NONE">No</option>
                <option value="DOMESTIC">Within my country</option>
                <option value="INTERNATIONAL">Anywhere</option>
              </select>
            </label>
          </div>

          <label
            htmlFor="intl-search"
            style={{
              display: "flex", alignItems: "flex-start", gap: 10, margin: "4px 0 12px",
              padding: "12px 14px", border: "1px solid var(--line)", borderRadius: 12,
              cursor: "pointer", color: "var(--txt)", fontSize: 13.5, lineHeight: 1.5,
            }}
          >
            <input
              id="intl-search"
              type="checkbox"
              checked={f.internationalSearchEnabled}
              onChange={(e) => set("internationalSearchEnabled", e.target.checked)}
              style={{ marginTop: 2, width: 18, height: 18, flexShrink: 0 }}
            />
            <span>
              Show me roles in other countries
              <br />
              <small style={{ color: "var(--dim)" }}>
                Off by default. Roles abroad may need work authorisation you do not have, so we
                do not show them unless you ask.
              </small>
            </span>
          </label>

          <div className="two">
            <label className="field">
              <span>Other countries you&rsquo;d consider</span>
              <input
                value={f.preferredCountries}
                onChange={(e) => set("preferredCountries", e.target.value)}
                placeholder="CA, GB"
              />
              <small style={{ color: "var(--dim)", fontSize: 12 }}>
                Two-letter codes, comma separated.
              </small>
            </label>
            <label className="field">
              <span>Regions you&rsquo;d consider</span>
              <input
                value={f.preferredRegions}
                onChange={(e) => set("preferredRegions", e.target.value)}
                placeholder={Object.keys(REGIONS).slice(0, 2).join(", ")}
              />
            </label>
          </div>

          <label className="field">
            <span>For remote roles, who can you work for?</span>
            <select value={f.remoteReach} onChange={(e) => set("remoteReach", e.target.value)}>
              <option value="UNSET">No preference</option>
              <option value="SAME">Employers in my own country only</option>
              <option value="LIST">Employers in specific countries</option>
              <option value="ANYWHERE">Anywhere, subject to eligibility</option>
            </select>
          </label>

          {f.remoteReach === "LIST" ? (
            <label className="field">
              <span>Which countries can you work remotely for?</span>
              <input
                value={f.remoteEligibleCountries}
                onChange={(e) => set("remoteEligibleCountries", e.target.value)}
                placeholder="US, CA"
              />
            </label>
          ) : null}

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
