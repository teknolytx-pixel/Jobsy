"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui";

type Msg = { id: string; body: string; at: string; mine: boolean };

export default function Chat({
  matchId,
  other,
  job,
  score,
  initial,
}: {
  matchId: string;
  other: { id: string; name: string; image: string | null; subtitle: string; email: string };
  job: { title: string; company: string; location: string };
  score: number;
  initial: Msg[];
}) {
  const [msgs, setMsgs] = useState<Msg[]>(initial);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length]);

  // light polling keeps the thread live without a websocket layer
  useEffect(() => {
    const t = setInterval(async () => {
      const res = await fetch(`/api/messages?matchId=${matchId}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setMsgs(data.messages ?? []);
    }, 6000);
    return () => clearInterval(t);
  }, [matchId]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setText("");
    const optimistic: Msg = { id: `tmp-${Date.now()}`, body, at: new Date().toISOString(), mine: true };
    setMsgs((m) => [...m, optimistic]);

    const res = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchId, body }),
    });
    if (!res.ok) setMsgs((m) => m.filter((x) => x.id !== optimistic.id));
    setBusy(false);
  }

  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <div className="shell fixed">
      <header className="top">
        <a className="iconbtn" href="/matches">
          ‹
        </a>
        <Avatar name={other.name} seed={other.id} image={other.image} className="row-av" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-.2px" }}>{other.name}</div>
          <div style={{ color: "var(--dim)", fontSize: 12 }}>{other.subtitle}</div>
        </div>
      </header>

      <div
        style={{
          margin: "0 16px 8px",
          padding: "10px 12px",
          borderRadius: 13,
          background: "var(--card)",
          border: "1px solid var(--line)",
          fontSize: 12.5,
        }}
      >
        <b>{job.title}</b>
        <span style={{ color: "var(--dim)" }}>
          {" "}
          · {job.company} · {job.location} · {score}% fit
        </span>
      </div>

      <div className="thread">
        {msgs.length === 0 ? (
          <div className="emptylist" style={{ padding: "26px 16px" }}>
            <span className="big">👋</span>
            You matched — someone has to go first. Ask about the team, the timeline, or the comp band.
          </div>
        ) : (
          msgs.map((m) => (
            <div key={m.id} className={`bub ${m.mine ? "me" : "them"}`}>
              {m.body}
              <span className="at">{time(m.at)}</span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <form className="composer" onSubmit={send}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Message ${other.name.split(" ")[0]}…`}
          aria-label="Message"
        />
        <button type="submit" disabled={busy || !text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
