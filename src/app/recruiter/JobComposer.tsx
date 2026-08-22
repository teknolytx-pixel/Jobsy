"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui";
// Import the country list directly rather than through @/lib/geo, so the
// centroid table used for radius maths never reaches the client bundle.
import { COUNTRIES, REGIONS, US_STATES } from "@/lib/geo/countries";

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
    requiredSkills: "",
    preferredSkills: "",
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

    // ── FSD v1.1 §36.1 — JobLocation ──
    countryCode: "US",
    /** Identity: country + state + postal is what makes two postings one. */
    postalCode: "",
    /** RMT-004 — required when the role is remote. Blank is not a valid answer. */
    remoteScope: "" as "" | "SAME_COUNTRY" | "COUNTRIES" | "STATES" | "REGION" | "WORLDWIDE",
    remoteScopeCountries: "",
    remoteScopeStates: "",
    remoteScopeRegion: "NORTH_AMERICA",
    localOnly: false,
    localRadiusMiles: "50",
    localJustification: "",
    relocationAccepted: false,
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  /**
   * `asDraft` skips the checks that only matter once a posting is public.
   *
   * The attestation and the remote-scope question are asked at publish time,
   * not at save time: a half-written posting has nothing to attest to yet, and
   * being forced to answer them in order to keep your work is exactly the
   * problem drafts exist to solve. Pay transparency is skipped server-side for
   * the same reason, and re-checked on the way out of draft.
   */
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Catch it here rather than letting the server reject it, so the message
    // lands next to the control the recruiter has to act on.
    if (!f.attest) {
      setErr("Please confirm this is a current, open vacancy that you're authorized to advertise.");
      return;
    }
    // RMT-004 / BR-017 — refuse to guess. "Remote" is not a location.
    if (f.remote === "REMOTE" && !f.remoteScope) {
      setErr("Where can this remote role be performed from? Remote does not mean worldwide.");
      return;
    }
    // LOC-006 — see FSD §38.3. A radius is a geographic screen.
    if (f.localOnly && !f.localJustification.trim()) {
      setErr("Say why this role needs local candidates. We record the reason with the posting.");
      return;
    }
    await send(false);
  }

  async function send(draft: boolean) {
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
        requiredSkills: f.requiredSkills.split(",").map((s) => s.trim()).filter(Boolean),
        preferredSkills: f.preferredSkills.split(",").map((s) => s.trim()).filter(Boolean),
        applyMethod: f.applyMethod,
        applyUrl: f.applyMethod === "EXTERNAL" ? f.applyUrl : null,
        attestCurrentVacancy: f.attest,
        benefitsDescription: f.benefits.trim() || null,
        employeeCount: f.employeeCount ? Number(f.employeeCount) : null,
        status: draft ? "DRAFT" : "PUBLISHED",
        sponsorshipAvailable: f.sponsorship === "" ? null : f.sponsorship === "YES",
        countryCode: f.countryCode,
        postalCode: f.postalCode.trim() || null,
        remoteScope: f.remote === "REMOTE" ? f.remoteScope : null,
        remoteScopeCountries: f.remoteScopeCountries
          .split(",").map((x) => x.trim().toUpperCase()).filter(Boolean),
        remoteScopeStates: f.remoteScopeStates
          .split(",").map((x) => x.trim().toUpperCase()).filter(Boolean),
        remoteScopeRegion: f.remoteScope === "REGION" ? f.remoteScopeRegion : null,
        localOnly: f.localOnly,
        localRadiusMiles: f.localOnly && f.localRadiusMiles ? Number(f.localRadiusMiles) : null,
        localJustification: f.localOnly ? f.localJustification.trim() : null,
        relocationAccepted: f.relocationAccepted,
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

        <label className="field">
          <span>Postal / ZIP code — optional</span>
          <input
            value={f.postalCode}
            onChange={(e) => set("postalCode", e.target.value)}
            placeholder="78701"
            inputMode="text"
          />
          <small style={{ color: "var(--dim)", fontSize: 12 }}>
            Used to identify the workplace, so the same role coming from several job
            boards shows up once instead of three times. It is never used to filter
            candidates.
          </small>
        </label>

        <label className="field">
          <span>Country the work happens in</span>
          <select value={f.countryCode} onChange={(e) => set("countryCode", e.target.value)} required>
            {Object.entries(COUNTRIES).map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
          <small style={{ color: "var(--dim)", fontSize: 12 }}>
            Candidates see roles in their own country by default, so this decides who this
            posting reaches.
          </small>
        </label>

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

        {/*
          MATCH-002 — two fields, because the engine has always scored them
          differently and nobody could ever say which was which. Until now the
          split was inferred by looking for "Requirements" and "Nice to have"
          headings in the description; when that failed — which it usually does
          — every skill listed became mandatory, and candidates who could do the
          job ranked below candidates who could not.
        */}
        <label className="field">
          <span>Must have</span>
          <input
            value={f.requiredSkills}
            onChange={(e) => set("requiredSkills", e.target.value)}
            placeholder="React, TypeScript"
          />
        </label>
        <div className="s2" style={{ color: "var(--dim2)", margin: "4px 2px 0", lineHeight: 1.5 }}>
          Only what someone genuinely cannot do the job without. Every extra
          entry here pushes down people who could do the work.
        </div>

        <label className="field">
          <span>Nice to have</span>
          <input
            value={f.preferredSkills}
            onChange={(e) => set("preferredSkills", e.target.value)}
            placeholder="GraphQL, Figma"
          />
        </label>

        <label className="field">
          <span>Other skills — leave all three blank to auto-extract from the description</span>
          <input value={f.skills} onChange={(e) => set("skills", e.target.value)} placeholder="Jest, Storybook" />
        </label>

        <label className="field">
          <span>How should candidates apply?</span>
          <select value={f.applyMethod} onChange={(e) => set("applyMethod", e.target.value as "EASY" | "EXTERNAL")}>
            <option value="EASY">Easy Apply — profile emailed to me on right-swipe</option>
            <option value="EXTERNAL">Send them to my own posting</option>
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

        {f.remote === "REMOTE" ? (
          <>
            <label className="field">
              <span>Where can this remote role be performed from?</span>
              <select
                value={f.remoteScope}
                onChange={(e) => set("remoteScope", e.target.value as typeof f.remoteScope)}
                required
              >
                <option value="">Choose one…</option>
                <option value="SAME_COUNTRY">{COUNTRIES[f.countryCode] ?? "This country"} only</option>
                <option value="STATES">Specific states or provinces</option>
                <option value="COUNTRIES">Specific countries</option>
                <option value="REGION">A region</option>
                <option value="WORLDWIDE">Anywhere in the world</option>
              </select>
              <small style={{ color: "var(--dim)", fontSize: 12 }}>
                Remote is not the same as worldwide. Picking &ldquo;anywhere&rdquo; means you will
                see candidates who need authorisation you may not sponsor.
              </small>
            </label>

            {f.remoteScope === "COUNTRIES" ? (
              <label className="field">
                <span>Which countries? Two-letter codes, comma separated</span>
                <input
                  value={f.remoteScopeCountries}
                  onChange={(e) => set("remoteScopeCountries", e.target.value)}
                  placeholder="US, CA, MX"
                />
              </label>
            ) : null}

            {f.remoteScope === "STATES" ? (
              <label className="field">
                <span>Which states or provinces? Comma separated</span>
                <input
                  value={f.remoteScopeStates}
                  onChange={(e) => set("remoteScopeStates", e.target.value)}
                  placeholder={`TX, ${Object.keys(US_STATES).slice(4, 6).join(", ")}`}
                />
              </label>
            ) : null}

            {f.remoteScope === "REGION" ? (
              <label className="field">
                <span>Which region?</span>
                <select
                  value={f.remoteScopeRegion}
                  onChange={(e) => set("remoteScopeRegion", e.target.value)}
                >
                  {Object.keys(REGIONS).map((r) => (
                    <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </label>
            ) : null}
          </>
        ) : null}

        {/* ── LOC-001 – LOC-006 — the local-candidate boundary ── */}
        <label
          htmlFor="local-only"
          style={{
            display: "flex", alignItems: "flex-start", gap: 10, margin: "4px 0 10px",
            padding: "12px 14px", border: "1px solid var(--line, #e6e8f0)", borderRadius: 12,
            cursor: "pointer", color: "var(--txt)", fontSize: 13.5, lineHeight: 1.5,
          }}
        >
          <input
            id="local-only"
            type="checkbox"
            checked={f.localOnly}
            onChange={(e) => set("localOnly", e.target.checked)}
            style={{ marginTop: 2, width: 18, height: 18, flexShrink: 0 }}
          />
          <span>
            Local candidates only
            <br />
            <small style={{ color: "var(--dim)" }}>
              A hard filter. Candidates outside the boundary will not see this role, however
              well their skills match.
            </small>
          </span>
        </label>

        {f.localOnly ? (
          <>
            <label className="field">
              <span>Radius in miles</span>
              <input
                type="number"
                min={1}
                max={500}
                value={f.localRadiusMiles}
                onChange={(e) => set("localRadiusMiles", e.target.value)}
              />
            </label>
            <label className="field">
              <span>Why does this role need local candidates?</span>
              <textarea
                value={f.localJustification}
                onChange={(e) => set("localJustification", e.target.value)}
                placeholder="On-site lab work three days a week; equipment cannot leave the building."
              />
              <small style={{ color: "var(--dim)", fontSize: 12 }}>
                A radius drawn around a workplace is a geographic screen, and those can exclude
                a whole community without anyone intending it. We store your reason with the
                posting so the requirement can be shown to be job-related.
              </small>
            </label>
          </>
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

        <button
          className="btn ghost"
          type="button"
          disabled={busy}
            onClick={() => void send(true)}
        >
          {busy ? "Saving…" : "Save as draft"}
        </button>
        <div className="s2" style={{ color: "var(--dim2)", margin: "6px 2px 0", lineHeight: 1.5 }}>
          A draft is visible only to you. Salary-range rules are checked when you
          publish, not when you save.
        </div>

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
