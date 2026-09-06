"use client";

import { useEffect, useState } from "react";

/**
 * UI-001 — light / dark / follow-the-system.
 *
 * ── Why three options and not a switch ──
 *
 * A two-position toggle has to pick a starting side, and whichever it picks is
 * wrong for half the people who arrive: someone who has set their laptop to
 * dark at 11pm has already told their machine what they want, and an app that
 * ignores that has overridden an accessibility setting to show off its own
 * default. "System" is therefore the initial state and the honest one — the
 * explicit choices exist for the person whose preference differs *here*, which
 * is common for a site read in a bright office on a dark-themed machine.
 *
 * ── Where the choice lives ──
 *
 * localStorage, not a cookie and not the database. It is a per-device display
 * preference: the same account on a phone at night and a monitor at noon
 * genuinely wants different answers, and syncing it would be a bug wearing a
 * feature's clothes. It is also the reason this cannot be a server component.
 */

export type ThemeChoice = "system" | "light" | "dark";

export const THEME_KEY = "jobsy-theme";

/** Read the stored choice. Safe on the server and in a locked-down browser. */
export function storedTheme(): ThemeChoice {
  if (typeof window === "undefined") return "system";
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    // Private mode, or site data blocked. Following the system is the correct
    // fallback, not an error worth surfacing.
    return "system";
  }
}

/**
 * Apply a choice to the document.
 *
 * "system" REMOVES the attribute rather than writing "system" into it, because
 * the CSS is built so that the absence of `data-theme` is what lets
 * `prefers-color-scheme` decide. A `data-theme="system"` value would match
 * neither the light nor the dark selector and quietly strand the page on the
 * light palette.
 */
export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

const OPTIONS: { value: ThemeChoice; label: string; title: string }[] = [
  { value: "light", label: "Light", title: "Light theme" },
  { value: "system", label: "Auto", title: "Follow my device setting" },
  { value: "dark", label: "Dark", title: "Dark theme" },
];

function Glyph({ kind }: { kind: ThemeChoice }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (kind === "light") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  }
  if (kind === "dark") {
    return (
      <svg {...common}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="2" y="4" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 18v3" />
    </svg>
  );
}

export default function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  // Read AFTER mount. Reading during render would make the server-rendered
  // markup disagree with the client's first paint and trip hydration; the
  // inline script in layout.tsx has already painted the right theme by now, so
  // this only syncs the control's own highlighted state.
  useEffect(() => setChoice(storedTheme()), []);

  function pick(next: ThemeChoice) {
    setChoice(next);
    applyTheme(next);
    try {
      if (next === "system") window.localStorage.removeItem(THEME_KEY);
      else window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // The theme still applies for this page view. Failing to persist is not
      // worth an error message about a colour scheme.
    }
  }

  return (
    <div className="themeswitch" role="group" aria-label="Colour theme">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => pick(o.value)}
          aria-pressed={choice === o.value}
          title={o.title}
        >
          <Glyph kind={o.value} />
          <span className="sr-only">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
