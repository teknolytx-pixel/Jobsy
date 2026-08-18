"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SwipeDeck, DeckActions, type DeckControls, type Dir } from "@/components/SwipeDeck";
import { Avatar, MatchOverlay, Sheet, useToast } from "@/components/ui";
import { money, REMOTE_LABEL, SOURCE_LABEL } from "@/components/format";

type JobCard = {
  id: string; title: string; company: string; location: string; remote: string;
  employmentType: string; seniority: string; salaryMin: number | null; salaryMax: number | null;
  description: string; skills: string[]; perks: string[];
  applyMethod: "EASY" | "EXTERNAL"; applyUrl: string | null;
  source: string; sourceUrl: string | null; recruiterName: string | null;
  score: number; sharedSkills: string[]; missingSkills: string[]; reasons: string[];
};

type ApplyState =
  | { kind: "easy"; job: JobCard; emailSent: boolean }
  | { kind: "external"; job: JobCard; url: string };

/**
 * Where a right-swipe actually sends the candidate. For ingested jobs that's
 * the board we got it from; for a Jobsy-native post with an external apply URL
 * it's whatever host the recruiter pointed at (LinkedIn, Indeed, Greenhouse,
 * their own careers page), which the source label would get wrong.
 */
function applyDestination(job: JobCard, url: string): string {
  if (job.source !== "JOBSY") return SOURCE_LABEL[job.source] ?? job.source;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const known: Record<string, string> = {
      "linkedin.com": "LinkedIn",
      "indeed.com": "Indeed",
      "monster.com": "Monster",
      "glassdoor.com": "Glassdoor",
      "ziprecruiter.com": "ZipRecruiter",
      "boards.greenhouse.io": "Greenhouse",
      "jobs.lever.co": "Lever",
      "jobs.ashbyhq.com": "Ashby",
    };
    return known[host] ?? host;
  } catch {
    return "the company site";
  }
}

export default function CandidateSwipe({
  me,
  counts,
  hasJobPosts,
}: {
  me: { id: string; name: string; image: string | null };
  counts: { applied: number; matches: number };
  hasJobPosts: boolean;
}) {
  const [cards, setCards] = useState<JobCard[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [apply, setApply] = useState<ApplyState | null>(null);
  const [detail, setDetail] = useState<JobCard | null>(null);
  const [match, setMatch] = useState<{ job: JobCard; id: string } | null>(null);
  // A right-swipe can produce BOTH an apply sheet and a match. They must be
  // shown in sequence — the match overlay sits above the sheet and would
  // otherwise cover it with no way to reach the sheet's buttons.
  const [pendingMatch, setPendingMatch] = useState<{ job: JobCard; id: string } | null>(null);
  const [stats, setStats] = useState(counts);
  const { toast, toastNode } = useToast();
  const controls = useRef<DeckControls | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/deck?mode=candidate", { cache: "no-store" });
    if (res.status === 428) {
      window.location.href = "/onboarding";
      return;
    }
    const data = await res.json();
    setCards(data.cards ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onSwipe = useCallback(
    async (job: JobCard, dir: Dir) => {
      setCards((c) => (c ? c.filter((x) => x.id !== job.id) : c));
      setBusy(true);
      try {
        const res = await fetch("/api/swipe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "candidate", direction: dir, jobId: job.id }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast(data.error ?? "Swipe failed");
          return;
        }
        if (dir === "PASS") return;

        setStats((s) => ({ ...s, applied: s.applied + 1 }));

        if (data.apply?.method === "EASY") {
          setApply({ kind: "easy", job, emailSent: Boolean(data.emailSent) });
        } else if (data.apply?.url) {
          setApply({ kind: "external", job, url: data.apply.url });
        }

        if (data.matched) {
          setStats((s) => ({ ...s, matches: s.matches + 1 }));
          const m = { job, id: data.matchId as string };
          // If an apply sheet is showing, hold the match until it's dismissed.
          if (data.apply) setPendingMatch(m);
          else setMatch(m);
        }
      } finally {
        setBusy(false);
      }
    },
    [toast]
  );

  /** Dismiss the apply sheet, then reveal a queued match if there is one. */
  const closeApply = useCallback(() => {
    setApply(null);
    setPendingMatch((m) => {
      if (m) setMatch(m);
      return null;
    });
  }, []);

  const renderCard = (j: JobCard) => (
    <>
      <div className="top">
        <Avatar name={j.company} seed={j.id} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>{j.title}</h2>
          <div className="sub">
            {j.company} · {j.location}
          </div>
          <div className="meta">
            <span className="pill">{REMOTE_LABEL[j.remote] ?? j.remote}</span>
            <span className="pill">{j.seniority}</span>
            <span className="pill pay">{money(j.salaryMin, j.salaryMax)}</span>
            {j.applyMethod === "EASY" ? (
              <span className="pill hot">⚡ Easy Apply</span>
            ) : (
              <span className="pill src">↗ {SOURCE_LABEL[j.source] ?? j.source}</span>
            )}
          </div>
        </div>
      </div>
      <div className="body">
        <div className="sect">
          <div className="fitrow">
            <span>Match score</span>
            <b>{j.score}%</b>
          </div>
          <div className="fitbar">
            <i style={{ width: `${j.score}%` }} />
          </div>
          {j.reasons.length ? <div className="why">{j.reasons.join(" · ")}</div> : null}
        </div>

        {j.skills.length ? (
          <div className="sect">
            <h4>
              Skills — {j.sharedSkills.length}/{j.skills.length} you have
            </h4>
            <div className="tags">
              {j.skills.map((s) => (
                <span key={s} className={`tag ${j.sharedSkills.includes(s) ? "match" : "miss"}`}>
                  {s}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="sect">
          <h4>The role</h4>
          <p>{j.description.slice(0, 900)}</p>
        </div>

        {j.perks.length ? (
          <div className="sect">
            <h4>Team</h4>
            <div className="tags">
              {j.perks.map((p) => (
                <span key={p} className="pill">
                  {p}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="sect">
          <h4>Source</h4>
          <p style={{ color: "var(--dim2)" }}>
            {SOURCE_LABEL[j.source] ?? j.source}
            {j.recruiterName ? ` · posted by ${j.recruiterName}` : ""} · {j.employmentType}
          </p>
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
        <a className="iconbtn" href="/profile" title="Profile">
          👤
        </a>
      </header>

      <div className="roleswitch">
        <button className="on">💼 Candidate</button>
        <a
          href="/recruiter"
          style={{ flex: 1, padding: "9px 6px", borderRadius: 10, fontSize: 13, fontWeight: 700, color: "var(--dim)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
        >
          🎯 {hasJobPosts ? "Recruiter" : "Post a job"}
        </a>
      </div>

      <div className="tabs">
        <button className="on">Discover</button>
        <a href="/applied">
          Applied{stats.applied ? <span className="n">{stats.applied}</span> : null}
        </a>
        <a href="/matches">
          Matches{stats.matches ? <span className="n">{stats.matches}</span> : null}
        </a>
      </div>

      {cards === null ? (
        <div className="deckwrap">
          <div className="empty">
            <div className="big">⏳</div>
            <h3>Finding your jobs…</h3>
            <p>Ranking live postings against your skills, location and salary target.</p>
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
              <div className="big">🎉</div>
              <h3>You&rsquo;ve seen every job</h3>
              <p>
                New postings land every time ingestion runs. Check your matches, or widen your skills
                in your profile to pull in more.
              </p>
              <a className="btn ghost" href="/matches" style={{ maxWidth: 220 }}>
                See matches
              </a>
            </div>
          }
        />
      )}

      <DeckActions
        onPass={() => controls.current?.pass()}
        onLike={() => controls.current?.like()}
        onInfo={() => cards?.[0] && setDetail(cards[0])}
        disabled={!cards?.length || busy}
        hint="Swipe right to apply · left to pass · ← → keys work too"
      />

      {apply?.kind === "easy" ? (
        <Sheet onClose={closeApply}>
          <h3>⚡ Applied in one swipe</h3>
          <p className="lead">
            Your profile went straight to whoever owns <b>{apply.job.title}</b> at {apply.job.company}.
            No forms, no re-typing your work history.
            {apply.emailSent ? "" : " (Email is in log-only mode — add RESEND_API_KEY to actually send.)"}
          </p>
          <button className="btn go" onClick={closeApply}>
            Keep swiping
          </button>
        </Sheet>
      ) : null}

      {apply?.kind === "external" ? (
        <Sheet onClose={closeApply}>
          <h3>Finish on {applyDestination(apply.job, apply.url)}</h3>
          <p className="lead">
            {apply.job.company} takes applications for this role on their own posting. We saved it to
            your Applied list either way — open it now or come back later.
          </p>
          <a
            className="btn blue"
            href={apply.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setTimeout(closeApply, 150)}
          >
            Open {applyDestination(apply.job, apply.url)} ↗
          </a>
          <button className="btn ghost" onClick={closeApply}>
            Later — keep swiping
          </button>
        </Sheet>
      ) : null}

      {detail ? (
        <Sheet onClose={() => setDetail(null)}>
          <h3>{detail.title}</h3>
          <p className="lead">
            {detail.company} · {detail.location} · {money(detail.salaryMin, detail.salaryMax)}
          </p>
          <div className="sect">
            <h4>Full description</h4>
            <p>{detail.description}</p>
          </div>
          {detail.missingSkills.length ? (
            <div className="sect">
              <h4>Skills you&rsquo;re missing</h4>
              <div className="tags">
                {detail.missingSkills.map((s) => (
                  <span key={s} className="tag miss">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <button className="btn ghost" onClick={() => setDetail(null)}>
            Close
          </button>
        </Sheet>
      ) : null}

      {match ? (
        <MatchOverlay
          leftName={me.name}
          leftImage={me.image}
          rightName={match.job.company}
          jobTitle={match.job.title}
          line="The hiring side had already swiped right on you for"
          chatHref={`/matches/${match.id}`}
          onClose={() => setMatch(null)}
        />
      ) : null}

      {toastNode}
    </div>
  );
}
