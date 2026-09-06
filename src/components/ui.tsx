"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icon";

/**
 * Avatar backgrounds.
 *
 * Deterministic from the name so the same person is the same colour every time
 * — that is what makes an initials avatar scannable in a list.
 *
 * The old set was eight saturated consumer gradients (hot pink to coral, violet
 * to magenta). Held next to a photo of a real person on a card a recruiter is
 * deciding about, they were the loudest thing on screen. These are the same
 * eight positions in a professional register: slate, steel, teal, indigo,
 * clay. Every one clears 4.5:1 against the off-white initials on top —
 * asserted, not assumed: see TC-DESIGN-061.
 */
const HUES = [
  // Warmed and darkened from the previous set, for one measured reason: the
  // old comment claimed every stop cleared 4.5:1 against the initials and the
  // brightest (#3d6ff0) was 4.33:1. A claim in a comment is not a check, which
  // is why TC-DESIGN-061 now computes this list on every run. Worst pair here
  // is 5.72:1.
  "#2f57c4,#24449e", // indigo
  "#1c6f52,#155741", // pine
  "#4a5570,#363f56", // slate
  "#6b4f96,#523a76", // plum
  "#2b6b80,#1f5162", // steel
  "#8a5a2e,#6b4522", // clay
  "#3a6076,#2b4859", // dusty blue
  "#546b34,#3f5226", // olive
];

export const hueFor = (key: string) =>
  HUES[Math.abs([...String(key)].reduce((a, c) => a + c.charCodeAt(0), 0)) % HUES.length];

export const initials = (n: string) =>
  n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

export function Avatar({
  name,
  seed,
  image,
  className = "",
}: {
  name: string;
  seed?: string;
  image?: string | null;
  className?: string;
}) {
  return (
    <div className={`av ${className}`} style={{ background: `linear-gradient(135deg,${hueFor(seed ?? name)})` }}>
      {image ? <img src={image} alt="" /> : initials(name)}
    </div>
  );
}

export function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);

  return (
    <div className="sheet" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="inner">
        <div className="grab" />
        {children}
      </div>
    </div>
  );
}

export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [onDone]);
  return <div className="toast">{text}</div>;
}

export function useToast() {
  const [text, setText] = useState<string | null>(null);
  const node = text ? <Toast text={text} onDone={() => setText(null)} /> : null;
  return { toast: setText, toastNode: node };
}

export function MatchOverlay({
  leftName,
  leftImage,
  rightName,
  rightImage,
  jobTitle,
  line,
  chatHref,
  onClose,
}: {
  leftName: string;
  leftImage?: string | null;
  rightName: string;
  rightImage?: string | null;
  jobTitle: string;
  line: string;
  chatHref?: string;
  onClose: () => void;
}) {
  const bits = Array.from({ length: 26 }, (_, i) => i);
  return (
    <div className="matchov" onClick={(e) => e.target === e.currentTarget && onClose()}>
      {bits.map((i) => (
        <i
          key={i}
          className="confetti"
          style={{
            left: `${(i * 37) % 100}%`,
            background: ["#c4566a", "#c9973f", "#3f9b76", "#5b84e8", "#b9703f"][i % 5],
            animationDuration: `${1.1 + ((i * 7) % 11) / 10}s`,
            animationDelay: `${((i * 13) % 35) / 100}s`,
          }}
        />
      ))}
      <div className="duo">
        <Avatar name={leftName} image={leftImage} />
        <Avatar name={rightName} image={rightImage} />
      </div>
      <div className="mt">It&rsquo;s a Match!</div>
      <p>
        {line} <b>{jobTitle}</b>. Chat is open and an intro email just went to both of you.
      </p>
      <div style={{ width: "100%", maxWidth: 300 }}>
        {chatHref ? (
          <a className="btn" href={chatHref}>
            <Icon name="message" size={16} /> Open the conversation
          </a>
        ) : null}
        <button className="btn ghost" onClick={onClose}>
          Keep swiping
        </button>
      </div>
    </div>
  );
}
