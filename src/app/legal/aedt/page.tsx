import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import { buildNotice } from "@/lib/compliance/aedtContent";
import { detectJurisdiction } from "@/lib/compliance/jurisdiction";

export const metadata: Metadata = { title: "How our matching works — Jobsy" };
export const dynamic = "force-dynamic";

/**
 * XPLAIN-002 — the AEDT notice, rendered.
 *
 * Built from the same module the delivery log records, so the text a candidate
 * reads and the version we assert we gave them cannot drift apart. Signed-in
 * users get the additions for their own jurisdiction; everyone else gets the
 * base notice, which is the one that says what the engine never uses.
 */
export default async function AedtNoticePage() {
  const me = await currentUser();
  const jur = detectJurisdiction(me?.location);
  const notice = buildNotice(me?.jurisdiction ?? jur.state, { locality: jur.locality });

  return (
    <>
      <h1 style={{ fontSize: 26, letterSpacing: "-.6px" }}>How our matching works</h1>
      <p style={{ color: "var(--dim)", fontSize: 13 }}>
        Automated Employment Decision Tool Notice · version {notice.version}
        {notice.jurisdiction !== "US" ? ` · ${notice.jurisdiction}` : ""}
      </p>

      {notice.usableFrom ? (
        <div className="note" style={{ margin: "16px 0" }}>
          <b>Advance notice.</b> Where you are, we give this notice at least 10 business days before
          an automated tool is used to assess you for a role. For your account that is{" "}
          <b>{notice.usableFrom.toDateString()}</b>.
        </div>
      ) : null}

      {notice.sections.map((s) => (
        <section key={s.heading}>
          <h2>{s.heading}</h2>
          {s.body.map((p, i) =>
            p.startsWith("• ") ? (
              <p key={i} style={{ margin: "2px 0 2px 16px" }}>
                {p}
              </p>
            ) : (
              <p key={i}>{p}</p>
            )
          )}
        </section>
      ))}

      {notice.cites.length ? (
        <>
          <h2>The law this reflects</h2>
          <ul>
            {notice.cites.map((c) => (
              <li key={c} style={{ fontSize: 13.5, color: "var(--dim)" }}>
                {c}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h2>Getting in touch</h2>
      <p>
        To opt out of automated ranking, ask a person to review an outcome, request an alternative
        process, or ask for an accommodation, use your{" "}
        <a href="/profile" style={{ textDecoration: "underline" }}>
          account settings
        </a>{" "}
        or contact us.
      </p>
    </>
  );
}
