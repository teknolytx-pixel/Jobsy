"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";

/**
 * RESUME-001 / RESUME-003 — the upload screen.
 *
 * The parser, the extractor, the storage layer and the approval function have
 * all existed and been tested since the schema was written. There was no way to
 * reach any of it: no file input anywhere in the product. This component is
 * that missing surface, and it is why the resume builder next to it had an
 * Experience section that could never be filled.
 *
 * ── Every suggestion is a checkbox ──
 *
 * Nothing is written to the profile until the candidate ticks it and presses
 * apply. Low-confidence fields arrive UNTICKED, which is the whole difference
 * between a tool that helps you fill a form and one that fills it in wrong
 * while you watch.
 */

type ResumeRow = {
  id: string;
  filename: string;
  bytes: number;
  version: number;
  isPrimary: boolean;
  parseStatus: "PENDING" | "OK" | "MANUAL" | "FAILED";
  parseError: string | null;
  uploadedAt: string;
  downloadUrl: string;
};

type Parsed = {
  headline: string | null;
  summary: string | null;
  skills: string[];
  roles: { title: string | null; company: string | null; period: string | null; bullets: string[] }[];
  education: { institution: string | null; degree: string | null; field: string | null }[];
  certifications: string[];
  totalYearsExperience: number | null;
  discarded: string[];
};

type Suggestion = {
  resumeId: string;
  parsed: Parsed;
  confidence: Record<string, number>;
};

/** Matches src/lib/resume/parse.ts — below this a field arrives unticked. */
const CONFIDENT = 0.7;

/**
 * Must match MAX_BYTES in the upload route.
 *
 * Duplicated rather than imported: this is a client component, and the route
 * imports the database client — pulling it in here would drag the ORM into the
 * browser bundle, which has broken the landing page before.
 */
const MAX_MB = 4;
const MAX_BYTES = MAX_MB * 1024 * 1024;

const FIELD_LABEL: Record<string, string> = {
  headline: "Headline",
  summary: "Summary",
  skills: "Skills",
  totalYearsExperience: "Years of experience",
};

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/**
 * `onChanged` fires after ANY change to the CV on file — upload, apply, delete
 * — not just after an approval. Uploading a CV is the moment the resume above
 * gains a work history, so a callback that only fired on apply left the
 * document showing "upload a resume" directly beneath the file that had just
 * been read.
 */
export default function ResumeUpload({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<ResumeRow[] | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/resumes", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not load your resumes.");
      setRows(body.resumes ?? []);
      setSuggestion(body.suggestion ?? null);
      // Pre-tick only what the parser is confident about (AC-3).
      if (body.suggestion) {
        const c: Record<string, number> = body.suggestion.confidence ?? {};
        const p: Parsed = body.suggestion.parsed;
        const next = new Set<string>();
        const has = (k: string) =>
          k === "skills"
            ? p.skills.length > 0
            : k === "totalYearsExperience"
              ? p.totalYearsExperience != null
              : Boolean((p as unknown as Record<string, string | null>)[k]);
        for (const k of Object.keys(FIELD_LABEL)) {
          if (has(k) && (c[k] ?? 0) >= CONFIDENT) next.add(k);
        }
        setTicked(next);
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(file: File) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/resumes", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Upload failed.");
      setMsg(body.message ?? "Uploaded.");
      await load();
      onChanged?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function apply() {
    if (!suggestion || !ticked.size) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/resumes/${suggestion.resumeId}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: [...ticked] }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not apply those changes.");
      setMsg(
        `Updated your profile: ${(body.applied as string[]).map((f) => FIELD_LABEL[f] ?? f).join(", ").toLowerCase()}.`
      );
      setSuggestion(null);
      await load();
      onChanged?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/resumes?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not delete that file.");
      setMsg("Deleted.");
      await load();
      onChanged?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (k: string) =>
    setTicked((s) => {
      const n = new Set(s);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  const p = suggestion?.parsed;

  /** What a ticked field will actually put in the profile. */
  const preview = (k: string): string | null => {
    if (!p) return null;
    if (k === "headline") return p.headline;
    if (k === "summary") return p.summary;
    if (k === "skills") return p.skills.length ? p.skills.join(" · ") : null;
    if (k === "totalYearsExperience")
      return p.totalYearsExperience != null ? `${p.totalYearsExperience} years` : null;
    return null;
  };

  return (
    <>
      <div className="sect" style={{ marginTop: 18 }}>
        <h4>Your CV</h4>
      </div>

      {err ? <div className="err">{err}</div> : null}
      {msg ? (
        <div className="ok">
          <Icon name="check" size={13} /> {msg}
        </div>
      ) : null}

      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          // Checked here as well as on the server, because a file this size is
          // rejected by the platform before our route runs — so without this
          // the candidate would watch a long upload fail with a generic error.
          if (f.size > MAX_BYTES) {
            setErr(
              `That file is ${(f.size / 1048576).toFixed(1)} MB, and the limit is ${MAX_MB} MB. ` +
                "Most CVs are well under 1 MB — a large one usually means a scanned page or an embedded photo, " +
                "and exporting to PDF again will shrink it."
            );
            e.target.value = "";
            return;
          }
          void upload(f);
        }}
      />

      <button className="btn ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
        <Icon name="external" size={15} style={{ transform: "rotate(180deg)" }} />
        {busy ? "Working…" : rows?.length ? "Upload a new version" : "Upload your CV"}
      </button>
      <div className="s2" style={{ color: "var(--dim2)", margin: "8px 2px 0" }}>
        PDF or Word, up to 4 MB. We read it to suggest profile fields — nothing is
        saved to your profile until you tick it below. Your date of birth, age,
        graduation years, photo and marital status are discarded on sight, even if
        your CV states them.
      </div>

      {/* The review step. */}
      {suggestion && p ? (
        <>
          <div className="sect" style={{ marginTop: 18 }}>
            <h4>What we read — tick what&rsquo;s right</h4>
          </div>

          {Object.keys(FIELD_LABEL).map((k) => {
            const value = preview(k);
            if (!value) return null;
            const conf = suggestion.confidence[k] ?? 0;
            const unsure = conf < CONFIDENT;
            return (
              <label
                key={k}
                className="row"
                style={{ alignItems: "flex-start", gap: 10, cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={ticked.has(k)}
                  onChange={() => toggle(k)}
                  style={{ marginTop: 3, width: 17, height: 17, accentColor: "var(--brand)" }}
                />
                <div className="g">
                  <div className="t" style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    {FIELD_LABEL[k]}
                    {unsure ? (
                      <span className="badge s" style={{ display: "inline-flex", gap: 4 }}>
                        <Icon name="info" size={10} /> not sure
                      </span>
                    ) : null}
                  </div>
                  <div className="s2" style={{ color: "var(--txt)", marginTop: 4 }}>
                    {value.length > 260 ? `${value.slice(0, 260)}…` : value}
                  </div>
                  {unsure ? (
                    <div className="s2" style={{ color: "var(--dim2)" }}>
                      We&rsquo;re not confident about this one, so it&rsquo;s off by default. Read it
                      before you tick it.
                    </div>
                  ) : null}
                </div>
              </label>
            );
          })}

          {/* Roles and education are shown but not applied — the profile has no
              fields for them. They feed the resume builder above instead, which
              is why they are worth showing here at all. */}
          {p.roles.length ? (
            <div className="note">
              <b>
                {p.roles.length} role{p.roles.length === 1 ? "" : "s"} and{" "}
                {p.education.length} education entr{p.education.length === 1 ? "y" : "ies"} read
                from your CV.
              </b>
              <br />
              These aren&rsquo;t profile fields, so there&rsquo;s nothing to tick — they feed the
              resume above, which now has your work history in it.
              <div className="s2" style={{ color: "var(--dim2)", marginTop: 6 }}>
                {p.roles
                  .map((r) => [r.title, r.company].filter(Boolean).join(" — "))
                  .join(" · ")}
              </div>
            </div>
          ) : null}

          {p.discarded.length ? (
            <div className="note">
              <b>Deliberately ignored:</b> {p.discarded.join(", ")}.
              <br />
              These can be used to discriminate, so Jobsy never stores them — not even
              when your CV states them plainly.
            </div>
          ) : null}

          <button className="btn" disabled={busy || ticked.size === 0} onClick={() => void apply()}>
            <Icon name="check" size={15} />
            {ticked.size ? `Apply ${ticked.size} to my profile` : "Tick something to apply"}
          </button>
        </>
      ) : null}

      {/* Files on record. */}
      {rows?.length ? (
        <>
          <div className="sect" style={{ marginTop: 18 }}>
            <h4>Files</h4>
          </div>
          {rows.map((r) => (
            <div key={r.id} className="row" style={{ alignItems: "center" }}>
              <div className="g">
                <div className="t">
                  {r.filename}
                  {r.isPrimary ? (
                    <span className="badge a" style={{ marginLeft: 8 }}>
                      Current
                    </span>
                  ) : null}
                </div>
                <div className="s2">
                  v{r.version} · {kb(r.bytes)} ·{" "}
                  {new Date(r.uploadedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </div>
                {r.parseStatus === "MANUAL" ? (
                  <div className="s2" style={{ color: "var(--gold)", display: "flex", gap: 6 }}>
                    <Icon name="alert" size={12} style={{ marginTop: 2 }} />
                    {r.parseError ??
                      "We stored this file but couldn't read the text — it looks like a scan. Your profile fields will need filling in by hand."}
                  </div>
                ) : null}
              </div>
              <a className="iconbtn" href={r.downloadUrl} title="Download">
                <Icon name="external" size={14} label="Download" />
              </a>
              <button
                className="iconbtn"
                disabled={busy}
                onClick={() => void remove(r.id)}
                title="Delete"
                style={{ marginLeft: 6 }}
              >
                <Icon name="close" size={14} label="Delete" />
              </button>
            </div>
          ))}
        </>
      ) : rows ? (
        <div className="emptylist">
          <span className="big">
            <Icon name="briefcase" size={34} />
          </span>
          No CV on file yet. Upload one and your work history appears in the resume above.
        </div>
      ) : null}
    </>
  );
}
