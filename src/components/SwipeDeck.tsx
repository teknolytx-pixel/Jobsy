"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type Dir = "LIKE" | "PASS";

/**
 * Generic swipe deck. Knows nothing about jobs or candidates — it renders
 * whatever you give it and reports the direction. Pointer events cover mouse,
 * touch and pen with one code path.
 */
/** Lets the parent's button bar drive the same animation a drag would. */
export type DeckControls = { like: () => void; pass: () => void };

export function SwipeDeck<T extends { id: string }>({
  items,
  renderCard,
  onSwipe,
  busy,
  emptyState,
  controls,
}: {
  items: T[];
  renderCard: (item: T) => React.ReactNode;
  onSwipe: (item: T, dir: Dir) => void | Promise<void>;
  busy?: boolean;
  emptyState: React.ReactNode;
  controls?: React.MutableRefObject<DeckControls | null>;
}) {
  const [flying, setFlying] = useState<{ id: string; dir: Dir } | null>(null);
  const topRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef({ active: false, x0: 0, y0: 0, dx: 0, dy: 0 });

  const top = items[0];

  const commit = useCallback(
    (dir: Dir) => {
      if (!top || flying) return;
      setFlying({ id: top.id, dir });
      const el = topRef.current;
      if (el) {
        el.classList.add("anim");
        el.style.transform = `translate(${dir === "LIKE" ? 520 : -520}px, 60px) rotate(${dir === "LIKE" ? 26 : -26}deg)`;
        el.style.opacity = "0";
        const stamp = el.querySelector<HTMLElement>(dir === "LIKE" ? ".stamp.like" : ".stamp.nope");
        if (stamp) stamp.style.opacity = "1";
      }
      window.setTimeout(() => {
        void onSwipe(top, dir);
        setFlying(null);
      }, 260);
    },
    [top, flying, onSwipe]
  );

  // expose imperative like/pass to the parent's action bar
  useEffect(() => {
    if (controls) controls.current = { like: () => commit("LIKE"), pass: () => commit("PASS") };
  }, [controls, commit]);

  // keyboard
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (document.querySelector(".sheet, .matchov")) return;
      if (e.key === "ArrowRight") commit("LIKE");
      if (e.key === "ArrowLeft") commit("PASS");
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [commit]);

  const stamps = (el: HTMLElement | null, dx: number) => {
    if (!el) return;
    const like = el.querySelector<HTMLElement>(".stamp.like");
    const nope = el.querySelector<HTMLElement>(".stamp.nope");
    const p = Math.min(1, Math.abs(dx) / 110);
    if (like) like.style.opacity = dx > 0 ? String(p) : "0";
    if (nope) nope.style.opacity = dx < 0 ? String(p) : "0";
  };

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (flying || busy) return;
    drag.current = { active: true, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 };
    const el = e.currentTarget;
    el.classList.remove("anim");
    el.setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d.active) return;
    d.dx = e.clientX - d.x0;
    d.dy = e.clientY - d.y0;
    // vertical intent wins — let the card body scroll
    if (Math.abs(d.dx) < 8 && Math.abs(d.dy) > 12) return;
    const el = e.currentTarget;
    el.style.transform = `translate(${d.dx}px,${d.dy * 0.35}px) rotate(${d.dx / 22}deg)`;
    stamps(el, d.dx);
  };

  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d.active) return;
    d.active = false;
    const el = e.currentTarget;
    el.classList.add("anim");
    if (Math.abs(d.dx) > 105) {
      commit(d.dx > 0 ? "LIKE" : "PASS");
    } else {
      el.style.transform = "";
      stamps(el, 0);
    }
    d.dx = 0;
    d.dy = 0;
  };

  if (!items.length) return <div className="deckwrap">{emptyState}</div>;

  const stack = items.slice(0, 3);

  return (
    <div className="deckwrap">
      {stack
        .map((item, idx) => ({ item, idx }))
        .reverse()
        .map(({ item, idx }) => (
          <div
            key={item.id}
            ref={idx === 0 ? topRef : undefined}
            className="card"
            style={{
              transform: `translateY(${idx * 10}px) scale(${1 - idx * 0.04})`,
              zIndex: 10 - idx,
              pointerEvents: idx === 0 ? "auto" : "none",
            }}
            onPointerDown={idx === 0 ? onDown : undefined}
            onPointerMove={idx === 0 ? onMove : undefined}
            onPointerUp={idx === 0 ? onUp : undefined}
            onPointerCancel={idx === 0 ? onUp : undefined}
          >
            <div className="stamp like">LIKE</div>
            <div className="stamp nope">NOPE</div>
            {renderCard(item)}
          </div>
        ))}
    </div>
  );
}

export function DeckActions({
  onPass,
  onLike,
  onInfo,
  disabled,
  hint,
}: {
  onPass: () => void;
  onLike: () => void;
  onInfo: () => void;
  disabled: boolean;
  hint: string;
}) {
  return (
    <>
      <p className="hint">{hint}</p>
      <div className="actions">
        <button className="act no" onClick={onPass} disabled={disabled} aria-label="Pass">
          ✕
        </button>
        <button className="act yes" onClick={onLike} disabled={disabled} aria-label="Interested">
          ❤
        </button>
        <button className="act sm info" onClick={onInfo} disabled={disabled} aria-label="Details">
          ℹ
        </button>
      </div>
    </>
  );
}
