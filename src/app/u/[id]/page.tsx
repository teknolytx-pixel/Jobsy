import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, users } from "@/db";
import { currentUser } from "@/lib/auth";
import { Avatar } from "@/components/ui";
import { REMOTE_LABEL } from "@/components/format";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

/** The profile link inside Easy Apply emails. Requires a signed-in viewer. */
export default async function CandidateProfile({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await currentUser();
  if (!viewer) redirect("/login");

  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  const u = rows[0];
  if (!u) notFound();

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
