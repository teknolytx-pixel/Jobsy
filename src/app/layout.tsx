import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jobsy — Swipe. Match. Get hired.",
  description:
    "Two-sided swipe hiring. Candidates swipe jobs, recruiters swipe candidates, and a mutual right-swipe opens the conversation.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  /**
   * `maximumScale: 1` used to be here and has been removed.
   *
   * It disabled pinch-zoom on every mobile browser that honours it, which is a
   * straight WCAG 1.4.4 (Resize Text) failure and takes away the single
   * accessibility affordance people with low vision reach for first. It is
   * usually added to stop iOS auto-zooming when a small input is focused — the
   * real fix for that is a 16px input font, which the form styles now have.
   *
   * Two theme colours rather than one: this is the shade the OS paints the
   * browser chrome with, so a single value is visibly the wrong shade for half
   * the users. Each must track --bg for its theme in globals.css.
   */
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f5f2" },
    { media: "(prefers-color-scheme: dark)", color: "#12151c" },
  ],
};

/**
 * The anti-flash script.
 *
 * This runs before first paint, synchronously, in the document head. Without
 * it a person who has chosen dark gets a full white frame first — the "flash
 * of wrong theme" — which at night is not a cosmetic glitch but a bright light
 * in a dark room, and is precisely what someone choosing a dark theme is
 * trying to avoid.
 *
 * It cannot be a React effect: effects run after hydration, which is several
 * hundred milliseconds and at least one paint too late. It is deliberately
 * tiny, dependency-free and wrapped in try/catch, because it blocks rendering
 * and a throw here would leave the page blank.
 *
 * Note it writes nothing when the choice is "system" — the CSS is built so the
 * ABSENCE of data-theme is what lets prefers-color-scheme decide.
 */
const NO_FLASH = `(function(){try{var t=localStorage.getItem('jobsy-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
