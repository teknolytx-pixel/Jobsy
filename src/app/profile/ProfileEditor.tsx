"use client";

import { useState } from "react";
// Country list only — the centroid table stays server-side.
import { COUNTRIES, REGIONS } from "@/lib/geo/countries";
import { Icon } from "@/components/Icon";
import ProfileSwitcher from "./ProfileSwitcher";

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
  requiresSponsorship: boolean | null;
};

export default function ProfileEditor({
  initial,
  linkedinLinked,
  linkedinAvailable,
  isPlatformAdmin = false,
  isRecruiter = false,
}: {
  initial: Initial;
  linkedinLinked: boolean;
  linkedinAvailable: boolean;
  isPlatformAdmin?: boolean;
  /** Recruiter-only fields are hidden rather than shown and rejected. */
  isRecruiter?: boolean;
}) {
  const [f, setF] = useState({
    ...initial,
    /*
     * Empty, not zero.
     *
     * `?? 0` put a literal 0 in the box for everyone who had never answered,
     * which reads as "I want nothing" rather than "I haven't said". A blank
     * field asks the question; a zero answers it wrongly on the candidate's
     * behalf — and the matcher treats a stated target very differently from an
     * absent one.
     */
    salaryTarget: initial.salaryTarget == null ? "" : String(initial.salaryTarget),
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
    requiresSponsorship:
      initial.requiresSponsorship === null || initial.requiresSponsorship === undefined
        ? ""
        : initial.requiresSponsorship
          ? "YES"
          : "NO",
  });
  /**
   * The stored value is a phrase — "2 weeks" — because that is what every
   * screen already renders and what the job description parser reads. Split it
   * for editing, rejoin it on save: a schema change here would ripple into the
   * matcher for no gain the candidate can see.
   */
  const parsedAvailability = /^(\d+)\s*(day|week|month)/i.exec(initial.availability ?? "");
  const [availNumber, setAvailNumber] = useState(parsedAvailability?.[1] ?? "");
  const [availUnit, setAvailUnit] = useState(
    parsedAvailability ? `${parsedAvailability[2].toLowerCase()}s` : "weeks"
  );

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
        salaryTarget: f.salaryTarget === "" ? null : Number(f.salaryTarget),
        /*
         * "1 weeks" is wrong and a person notices. Singularised on the way out,
         * and an empty number means available now rather than "0 weeks".
         */
        availability: availNumber
          ? `${availNumber} ${availNumber === "1" ? availUnit.replace(/s$/, "") : availUnit}`
          : "Available now",
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
        requiresSponsorship:
          f.requiresSponsorship === "" ? null : f.requiresSponsorship === "YES",
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
          <Icon name="external" size={15} label="Back" style={{ transform: "scaleX(-1)" }} />
        </a>
        <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: "-.3px" }}>Your profile</div>
        <div className="spacer" />
        <button className="iconbtn" onClick={logout} title="Sign out">
          <Icon name="power" size={15} label="Sign out" />
        </button>
      </header>

      <div style={{ padding: "0 16px 28px" }}>
        <div className="note">
          <b>{f.email}</b>
          <br />
          {linkedinLinked
            ? "LinkedIn connected — identity verified. Recruiters see a Verified badge on your card."
            : linkedinAvailable
              ? "Not connected to LinkedIn."
              : "LinkedIn sign-in isn't configured on this deployment."}
        </div>

        {!linkedinLinked && linkedinAvailable ? (
          <a className="btn li" href="/api/auth/linkedin/start">
            in&nbsp;&nbsp;Connect LinkedIn
          </a>
        ) : null}

        {/* ADMIN-005 / ADMIN-006 — the only link to the console anywhere. */}
        {isPlatformAdmin ? (
          <a className="btn ghost" href="/admin">
            <Icon name="key" size={15} /> Admin console
          </a>
        ) : null}

        <form onSubmit={save}>
          {/*
            * Above the fields, not below them.
            *
            * The fields edit whichever profile is LIVE. Showing which one that
            * is after the inputs would let somebody type a page of changes
            * before discovering they were editing a different direction from
            * the one they meant.
            */}
          {isRecruiter ? null : <ProfileSwitcher />}

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
              <span>ZIP code — optional</span>
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

          {/*
            CAN-004 / BR-006 — the lawful question, asked once and only of the
            person it concerns.

            It is about SPONSORSHIP, not about status. There is no field here
            for citizenship, nationality or visa category, and there must never
            be one: those are protected characteristics under 8 U.S.C. § 1324b,
            and this answer is the only immigration-adjacent thing Jobsy stores.

            "Prefer not to say" is first and is the default. A blank answer is
            treated as unstated, never as "yes" — inferring that someone needs
            sponsorship because they declined to answer would be exactly the
            discrimination the statute prohibits.
          */}
          <label className="field">
            <span>Will you need visa sponsorship?</span>
            <select
              value={f.requiresSponsorship}
              onChange={(e) => set("requiresSponsorship", e.target.value)}
            >
              <option value="">Prefer not to say</option>
              <option value="NO">No — I'm authorized to work without sponsorship</option>
              <option value="YES">Yes — now or in the future</option>
            </select>
            <small style={{ color: "var(--dim)", fontSize: 12 }}>
              Only used to hide roles whose employer has said they don&rsquo;t
              sponsor. It never affects your match score, and recruiters never
              see it as a filter. Leave it blank and nothing is filtered.
            </small>
          </label>

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
                className="nospin"
                min={0}
                inputMode="numeric"
                placeholder="e.g. 160"
                value={f.salaryTarget}
                onChange={(e) => set("salaryTarget", e.target.value.replace(/[^0-9]/g, ""))}
              />
            </label>
          </div>
          {/*
            * Availability is a number AND a unit.
            *
            * A single free-text box collected "2 weeks", "2wks", "a fortnight"
            * and "ASAP" — four spellings of two facts, none of them sortable or
            * comparable. Split at the point of entry, and stored as the plain
            * phrase the rest of the app already reads.
            */}
          <div className="field">
            <span>Availability — notice period</span>
            <div className="tworow" style={{ marginTop: 5 }}>
              <input
                type="number"
                className="nospin"
                min={0}
                inputMode="numeric"
                placeholder="2"
                value={availNumber}
                onChange={(e) => setAvailNumber(e.target.value.replace(/[^0-9]/g, ""))}
              />
              <select value={availUnit} onChange={(e) => setAvailUnit(e.target.value)}>
                <option value="days">days</option>
                <option value="weeks">weeks</option>
                <option value="months">months</option>
              </select>
            </div>
            <small style={{ color: "var(--dim)", fontSize: 12 }}>
              Leave the number blank if you can start immediately.
            </small>
          </div>
          <label className="field">
            <span>Skills — comma separated</span>
            <input value={f.skills} onChange={(e) => set("skills", e.target.value)} />
          </label>
          <label className="field">
            <span>About yourself</span>
            <textarea value={f.bio} onChange={(e) => set("bio", e.target.value)} />
          </label>
          {/*
            * Shown to recruiters only.
            *
            * "Recruiter title (if you post jobs)" sat on every job seeker's
            * profile and implied posting was something they could do. It is
            * not: /api/jobs refuses a candidate account outright. A field that
            * suggests a permission the account does not have is a bug in the
            * form, not a hint.
            */}
          {isRecruiter ? (
            <label className="field">
              <span>Your title</span>
              <input
                value={f.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="Talent Partner"
              />
            </label>
          ) : null}

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
