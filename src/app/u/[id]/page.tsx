import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, users, applications, matches, jobs } from "@/db";
import { currentUser } from "@/lib/auth";
import { Avatar } from "@/components/ui";
import { REMOTE_LABEL } from "@/components/format";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

/**
 * NFR-002 — a candidate's profile is visible to people they have a
 * relationship with, and to nobody else.
 *
 * ── What this was ──
 *
 * "Requires a signed-in viewer", and that was the whole check. Any account on
 * the platform could walk /u/<id> for any id and read that person's full
 * profile INCLUDING their email address — salary target, availability,
 * whether they are quietly open to offers, and a mailto: link. Candidates
 * could read each other. A recruiter who had never encountered someone could
 * harvest addresses by iterating ids.
 *
 * The page exists to serve the profile link inside an Easy Apply email, so the
 * legitimate audience was always narrow. "Signed in" is not that audience.
 *
 * ── Who may see it now ──
 *
 *   • the candidate themselves;
 *   • a recruiter the candidate has APPLIED to (that is the Easy Apply case —
 *     the candidate initiated it and expects to be looked at);
 *   • either party to a mutual MATCH.
 *
 * Everyone else gets notFound() rather than a 403, because "this candidate
 * exists but you may not see them" is itself a disclosure when the id is being
 * guessed.
 */
async function viewerMaySee(viewerId: string, candidateId: string): Promise<boolean> {
  if (viewerId === candidateId) return true;

  // Applied to one of the viewer's postings.
  const applied = await db
    .select({ id: applications.id })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .where(and(eq(applications.candidateId, candidateId), eq(jobs.postedById, viewerId)))
    .limit(1);
  if (applied.length) return true;

  // Mutually matched, from either side.
  const matched = await db
    .select({ id: matches.id })
    .from(matches)
    .where(and(eq(matches.candidateId, candidateId), eq(matches.recruiterId, viewerId)))
    .limit(1);
  return matched.length > 0;
}

/** The profile link inside Easy Apply emails. */
export default async function CandidateProfile({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await currentUser();
  if (!viewer) redirect("/login");

  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  const u = rows[0];
  if (!u) notFound();

  if (!(await viewerMaySee(viewer.id, u.id))) notFound();

  return (
    <div className="shell">
      <header className="top">
        <a className="iconbtn" href="/recruiter">
          <Icon name="external" size={15} label="Back" style={{ transform: "scaleX(-1)" }} />
        </a>
        <div className="spacer" />
      </header>

      <div style={{ padding: "0 16px 24px" }}>
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          <Avatar name={u.name} seed={u.id} image={u.image} />
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: 22, margin: 0, letterSpacing: "-.5px" }}>{u.name}</h1>
            <div style={{ color: "var(--dim)", fontSize: 13.5, marginTop: 3 }}>
              {u.headline ?? "Candidate"}
            </div>
            <div className="meta">
              {u.location ? <span className="pill">{u.location}</span> : null}
              <span className="pill">{u.yearsExp} yrs</span>
              <span className="pill">{REMOTE_LABEL[u.remotePref] ?? u.remotePref}</span>
              {u.linkedinSub ? <span className="pill li">in Verified</span> : null}
            </div>
          </div>
        </div>

        {u.bio ? (
          <div className="sect">
            <h4>About</h4>
            <p>{u.bio}</p>
          </div>
        ) : null}

        <div className="sect">
          <h4>Skills</h4>
          <div className="tags">
            {u.skills.map((s) => (
              <span key={s} className="tag">
                {s}
              </span>
            ))}
          </div>
        </div>

        <div className="sect">
          <h4>Logistics</h4>
          <p>
            Available {u.availability ?? "—"}
            {u.salaryTarget ? ` · targeting $${u.salaryTarget}k` : ""}
            {u.openToOffers ? " · open to offers" : " · not currently looking"}
          </p>
        </div>

        <div className="sect">
          <h4>Contact</h4>
          <p>
            <a href={`mailto:${u.email}`} style={{ color: "var(--blue)" }}>
              {u.email}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
