"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SwipeDeck, DeckActions, type DeckControls, type Dir } from "@/components/SwipeDeck";
import { Avatar, MatchOverlay, Sheet, useToast } from "@/components/ui";
import { REMOTE_LABEL } from "@/components/format";
import JobComposer from "./JobComposer";

type CandCard = {
  id: string; name: string; headline: string; location: string; remotePref: string;
  yearsExp: number; salaryTarget: number | null; availability: string; bio: string;
  skills: string[]; image: string | null; linkedinVerified: boolean;
  score: number; sharedSkills: string[]; missingSkills: string[]; reasons: string[];
};

type JobLite = { id: string; title: string; company: string; location: string; applyMethod: string };

export default function RecruiterSwipe({
  me,
  jobs,
  matchCount,
}: {
  me: { id: string; name: string; image: string | null };
  jobs: JobLite[];
  matchCount: number;
}) {
  const [activeJob, setActiveJob] = useState(jobs[0]?.id ?? "");
  const [cards, setCards] = useState<CandCard[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<CandCard | null>(null);
  const [detail, setDetail] = useState<CandCard | null>(null);
  const [match, setMatch] = useState<{ c: CandCard; id: string } | null>(null);
  const [composer, setComposer] = useState(jobs.length === 0);
  const [matches, setMatches] = useState(matchCount);
  const { toast, toastNode } = useToast();
  const controls = useRef<DeckControls | null>(null);

  const job = jobs.find((j) => j.id === activeJob);

  const load = useCallback(async (jobId: string) => {
    if (!jobId) return;
    setCards(null);
    const res = await fetch(`/api/deck?mode=recruiter&jobId=${encodeURIComponent(jobId)}`, {
      cache: "no-store",
    });
    const data = await res.json();
    setCards(data.cards ?? []);
  }, []);

  useEffect(() => {
    void load(activeJob);
  }, [activeJob, load]);

  const onSwipe = useCallback(
    async (c: CandCard, dir: Dir) => {
      setCards((p) => (p ? p.filter((x) => x.id !== c.id) : p));
      setBusy(true);
      try {
        const res = await fetch("/api/swipe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "recruiter",
            direction: dir,
            jobId: activeJob,
            candidateId: c.id,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast(data.error ?? "Swipe failed");
          return;
        }
        if (dir === "PASS") return;

        if (data.matched) {
          setMatches((m) => m + 1);
          setMatch({ c, id: data.matchId });
        } else {
          setSent(c);
        }
      } finally {
        setBusy(false);
      }
    },
    [activeJob, toast]
  );

  const renderCard = (c: CandCard) => (
    <>
      <div className="top">
        <Avatar name={c.name} seed={c.id} image={c.image} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>{c.name}</h2>
          <div className="sub">{c.headline}</div>
          <div className="meta">
            <span className="pill">{c.location}</span>
            <span className="pill">{c.yearsExp} yrs</span>
            {c.salaryTarget ? <span className="pill pay">Wants ${c.salaryTarget}k</span> : null}
            <span className="pill">{REMOTE_LABEL[c.remotePref] ?? c.remotePref}</span>
            {c.linkedinVerified ? <span className="pill li">in Verified</span> : null}
          </div>
        </div>
      </div>
      <div className="body">
        <div className="sect">
          <div className="fitrow">
            <span>Fit for {job?.title ?? "this role"}</span>
            <b>{c.score}%</b>
          </div>
          <div className="fitbar">
            <i style={{ width: `${c.score}%` }} />
          </div>
          {c.reasons.length ? <div className="why">{c.reasons.join(" · ")}</div> : null}
        </div>

        <div className="sect">
          <h4>Skills — {c.sharedSkills.length} match your post</h4>
          <div className="tags">
            {c.skills.map((s) => (
              <span key={s} className={`tag ${c.sharedSkills.includes(s) ? "match" : ""}`}>
                {s}
              </span>
            ))}
          </div>
        </div>

        {c.bio ? (
          <div className="sect">
            <h4>About</h4>
            <p>{c.bio}</p>
          </div>
        ) : null}

        {c.missingSkills.length ? (
          <div className="sect">
            <h4>Gaps vs your post</h4>
            <div className="tags">
              {c.missingSkills.map((s) => (
                <span key={s} className="tag miss">
                  {s}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="sect">
          <h4>Availability</h4>
          <p>{c.availability}</p>
        </div>
      </div>
    </>
  );

  return (
    <div className="shell fixed">
      <header className="top">
        <div className="logo">
          <span className="spark">🔥</span>
          <b>Jobsy</b>
        </div>
        <div className="spacer" />
        <button className="iconbtn" onClick={() => setComposer(true)} title="Post a job">
          ＋
        </button>
      </header>

      <div className="roleswitch">
        <a
          href="/swipe"
          style={{ flex: 1, padding: "9px 6px", borderRadius: 10, fontSize: 13, fontWeight: 700, color: "var(--dim)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
        >
          💼 Candidate
        </a>
        <button className="on">🎯 Recruiter</button>
      </div>

      <div className="tabs">
        <button className="on">Source</button>
        <a href="/matches">
          Matches{matches ? <span className="n">{matches}</span> : null}
        </a>
        <a href="/jobs">My posts{jobs.length ? <span className="n">{jobs.length}</span> : null}</a>
        <a href="/sources">Companies</a>
      </div>

      {jobs.length ? (
        <div className="ctxbar">
          <span className="lbl">Hiring for</span>
          <select value={activeJob} onChange={(e) => setActiveJob(e.target.value)}>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title} · {j.location}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {!jobs.length ? (
        <div className="deckwrap">
          <div className="empty">
            <div className="big">🎯</div>
            <h3>Post a job to start sourcing</h3>
            <p>
              You swipe candidates against one specific role, so the fit score means something. Takes
              about a minute.
            </p>
            <button className="btn" style={{ maxWidth: 220 }} onClick={() => setComposer(true)}>
              Post a job
            </button>
          </div>
        </div>
      ) : cards === null ? (
        <div className="deckwrap">
          <div className="empty">
            <div className="big">⏳</div>
            <h3>Ranking candidates…</h3>
            <p>Scoring every open-to-offers profile against {job?.title}.</p>
          </div>
        </div>
      ) : (
        <SwipeDeck
          items={cards}
          controls={controls}
          busy={busy}
          renderCard={renderCard}
          onSwipe={onSwipe}
          emptyState={
            <div className="empty">
              <div className="big">🔍</div>
              <h3>No candidates left for this role</h3>
              <p>
                Switch job posts above to keep sourcing, or wait for more candidates to finish
                onboarding.
              </p>
            </div>
          }
        />
      )}

      {jobs.length ? (
        <DeckActions
          onPass={() => controls.current?.pass()}
          onLike={() => controls.current?.like()}
          onInfo={() => cards?.[0] && setDetail(cards[0])}
          disabled={!cards?.length || busy}
          hint="Swipe right to email interest · left to pass"
        />
      ) : null}

      {sent ? (
        <Sheet onClose={() => setSent(null)}>
          <h3>📧 Interest email sent</h3>
          <p className="lead">
            {sent.name} was asked whether they want to move forward with <b>{job?.title}</b>. If they
            tap <b>I&rsquo;m interested</b>, it becomes a match and chat opens for both of you.
          </p>
          <div className="note">
            Sent to <b>{sent.name.split(" ")[0]}</b> with the {sent.score}% fit and{" "}
            {sent.sharedSkills.slice(0, 3).join(", ") || "their background"} called out. Every send is
            recorded in the EmailLog table.
          </div>
          <button className="btn go" onClick={() => setSent(null)}>
            Keep sourcing
          </button>
        </Sheet>
      ) : null}

      {detail ? (
        <Sheet onClose={() => setDetail(null)}>
          <h3>{detail.name}</h3>
          <p className="lead">
            {detail.headline} · {detail.yearsExp} yrs · {detail.location}
          </p>
          {detail.bio ? (
            <div className="sect">
              <h4>About</h4>
              <p>{detail.bio}</p>
            </div>
          ) : null}
          <div className="sect">
            <h4>All skills</h4>
            <div className="tags">
              {detail.skills.map((s) => (
                <span key={s} className={`tag ${detail.sharedSkills.includes(s) ? "match" : ""}`}>
                  {s}
                </span>
              ))}
            </div>
          </div>
          <div className="sect">
            <h4>Logistics</h4>
            <p>
              {REMOTE_LABEL[detail.remotePref] ?? detail.remotePref} ·{" "}
              {detail.salaryTarget ? `wants $${detail.salaryTarget}k · ` : ""}available{" "}
              {detail.availability}
            </p>
          </div>
          <button className="btn ghost" onClick={() => setDetail(null)}>
            Close
          </button>
        </Sheet>
      ) : null}

      {composer ? (
        <JobComposer
          onClose={() => setComposer(false)}
          onCreated={() => {
            setComposer(false);
            window.location.reload();
          }}
        />
      ) : null}

      {match ? (
        <MatchOverlay
          leftName={me.name}
          leftImage={me.image}
          rightName={match.c.name}
          rightImage={match.c.image}
          jobTitle={job?.title ?? ""}
          line={`${match.c.name.split(" ")[0]} had already swiped right on`}
          chatHref={`/matches/${match.id}`}
          onClose={() => setMatch(null)}
        />
      ) : null}

      {toastNode}
    </div>
  );
}
