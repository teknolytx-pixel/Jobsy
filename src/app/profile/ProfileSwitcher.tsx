"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * ONE PERSON, SEVERAL DIRECTIONS.
 *
 * ── What this screen has to make unmistakable ──
 *
 * That exactly one profile is live. Everything else here is ordinary CRUD; the
 * thing that would genuinely hurt somebody is quietly job-hunting under a
 * profile they thought was a draft. So "Live" is stated on the row rather than
 * implied by position, the others say plainly that they are not being matched,
 * and promoting is a button with a consequence written on it rather than a
 * radio dot.
 */
type Profile = {
  id: string;
  label: string;
  isPrimary: boolean;
  headline: string | null;
  skills: string[];
  yearsExp: number;
  salaryTarget: number | null;
  availability: string | null;
  bio: string | null;
  resumeId: string | null;
  resumeFilename: string | null;
  updatedAt: string;
};

export default function ProfileSwitcher() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");

  const load = async () => {
    const r = await fetch("/api/profiles", { cache: "no-store" });
    if (!r.ok) {
      const d = await r.json().catch(() => null);
      setMsg(d?.error ?? "Couldn't load your profiles.");
      setProfiles([]);
      return;
    }
    setProfiles((await r.json()).profiles ?? []);
  };
  useEffect(() => {
    void load();
  }, []);

  const promote = async (id: string, label: string) => {
    setBusy(id);
    setMsg(null);
    try {
      const r = await fetch(`/api/profiles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ makePrimary: true }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setMsg(d?.error ?? "Couldn't switch profiles.");
        return;
      }
      setMsg(`“${label}” is now the profile you're matched on.`);
      await load();
      // The rest of the page renders the mirrored fields, which have just moved.
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string, label: string) => {
    setBusy(id);
    setMsg(null);
    try {
      const r = await fetch(`/api/profiles/${id}`, { method: "DELETE" });
      const d = await r.json().catch(() => null);
      setMsg(r.ok ? `Deleted “${label}”.` : (d?.error ?? "Couldn't delete that profile."));
      await load();
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    if (!newLabel.trim()) return;
    setCreating(true);
    setMsg(null);
    try {
      const r = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newLabel.trim() }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setMsg(d?.error ?? "Couldn't create that profile.");
        return;
      }
      setNewLabel("");
      setMsg("Created. It starts as a draft — make it primary when you're ready to be matched on it.");
      await load();
    } finally {
      setCreating(false);
    }
  };

  if (!profiles) return <div className="emptylist">Loading your profiles…</div>;

  return (
    <section style={{ marginBottom: 22 }}>
      <h4
        style={{
          margin: "0 0 6px",
          fontSize: 10.5,
          textTransform: "uppercase",
          letterSpacing: ".9px",
          color: "var(--dim2)",
          fontWeight: 800,
        }}
      >
        Your profiles
      </h4>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--dim)", lineHeight: 1.55 }}>
        Keep a separate profile for each direction you&rsquo;re job hunting in — different skills,
        different CV. <b>Only your primary profile is matched with jobs.</b>
      </p>

      {msg ? (
        <div className="notice" style={{ marginBottom: 12 }}>
          {msg}
        </div>
      ) : null}

      {profiles.map((p) => (
        <div key={p.id} className="srcrow">
          <div>
            <b>{p.label}</b>{" "}
            {p.isPrimary ? (
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 800,
                  letterSpacing: ".6px",
                  color: "var(--go)",
                  border: "1px solid var(--go)",
                  borderRadius: 999,
                  padding: "2px 8px",
                  marginLeft: 4,
                }}
              >
                LIVE
              </span>
            ) : null}
            <div style={{ fontSize: 12.5, color: "var(--dim)" }}>
              {p.headline || "No headline yet"}
              {p.skills.length ? ` · ${p.skills.slice(0, 4).join(", ")}` : " · no skills yet"}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--dim2)" }}>
              {p.resumeFilename ? `CV: ${p.resumeFilename}` : "No CV on this profile"}
              {p.isPrimary ? " · matched with jobs" : " · not being matched"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {p.isPrimary ? null : (
              <button
                className="btn ghost"
                style={{ width: "auto", padding: "8px 14px", marginTop: 0, fontSize: 13 }}
                disabled={busy === p.id}
                onClick={() => void promote(p.id, p.label)}
              >
                {busy === p.id ? "…" : "Make primary"}
              </button>
            )}
            {p.isPrimary || profiles.length === 1 ? null : (
              <button
                className="btn ghost"
                style={{ width: "auto", padding: "8px 14px", marginTop: 0, fontSize: 13, color: "var(--bad)" }}
                disabled={busy === p.id}
                onClick={() => void remove(p.id, p.label)}
              >
                Delete
              </button>
            )}
          </div>
        </div>
      ))}

      <div className="tworow" style={{ marginTop: 10 }}>
        <label className="field" style={{ marginTop: 0 }}>
          <span>Add a profile</span>
          <input
            value={newLabel}
            placeholder="e.g. Product Management"
            maxLength={80}
            onChange={(e) => setNewLabel(e.target.value)}
          />
        </label>
        <button
          className="btn ghost"
          style={{ marginTop: 0, height: 44 }}
          disabled={creating || !newLabel.trim()}
          onClick={() => void create()}
        >
          {creating ? "Adding…" : "Add"}
        </button>
      </div>
      <small style={{ color: "var(--dim)", fontSize: 12 }}>
        New profiles start as drafts. The fields below always edit whichever profile is live.
      </small>
    </section>
  );
}
