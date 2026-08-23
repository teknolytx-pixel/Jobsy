/**
 * THE ICON SET
 *
 * Every icon in the app used to be an emoji — 🔥 for the logo, 💼 for jobs, 🎯
 * for a recruiter, 🎉 when something worked. Emoji are fast to write and wrong
 * for this product for three reasons that have nothing to do with taste:
 *
 *  1. They are not yours. Every platform draws them differently, so the logo
 *     mark is a different picture on Windows, macOS, Android and Samsung. A
 *     brand whose primary mark is rendered by the operating system does not
 *     have a mark.
 *  2. They are read aloud. A screen reader announces 🔥 as "fire" and 🎯 as
 *     "direct hit", in the middle of a sentence about a job application. These
 *     are decorative, so they carry aria-hidden and a real text label sits
 *     next to them.
 *  3. They are the wrong register. 🎉 on the screen that tells a candidate an
 *     employer replied is a party popper attached to someone's livelihood.
 *
 * These are stroke drawings on a 24-unit grid, inline so there is no icon-font
 * request and no layout shift, and they inherit `currentColor` so a single CSS
 * variable retints the entire set.
 */

export type IconName =
  | "logo"
  | "bolt"
  | "user"
  | "users"
  | "clock"
  | "globe"
  | "check"
  | "checkCircle"
  | "target"
  | "close"
  | "external"
  | "question"
  | "alert"
  | "thumbUp"
  | "message"
  | "power"
  | "briefcase"
  | "search"
  | "mail"
  | "building"
  | "hand"
  | "link"
  | "info"
  | "key"
  | "sparkle"
  | "pencil"
  | "sliders";

/**
 * One entry per icon. Stroke geometry only — no fills, so an icon reads the
 * same on a card, in a pill, and on a coloured button.
 */
const PATHS: Record<IconName, React.ReactNode> = {
  /**
   * The mark: two arrows passing in opposite directions.
   *
   * Jobsy is a two-sided market, and the one thing that distinguishes it from a
   * job board is that interest has to travel BOTH ways before anything happens.
   * That is what the mark says. A flame said "trending".
   */
  logo: (
    <>
      {/* Drawn to survive 17px. An earlier version had longer shafts and
          four-unit arrowheads, and at logo size the two arrows closed up into
          a single scribble. Short heads, wide vertical separation. */}
      <path d="M3.5 8.5h14" />
      <path d="m14 5 3.5 3.5L14 12" />
      <path d="M20.5 15.5h-14" />
      <path d="M10 12 6.5 15.5 10 19" />
    </>
  ),
  bolt: <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2Z" />,
  user: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  users: (
    <>
      <circle cx="9.5" cy="8" r="3.2" />
      <path d="M3 19.5a6.5 6.5 0 0 1 13 0" />
      <path d="M16.5 5.2a3.2 3.2 0 0 1 0 5.6" />
      <path d="M18 13.6a6.5 6.5 0 0 1 3 5.9" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.2l3.2 2" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z" />
    </>
  ),
  check: <path d="m4.5 12.5 5 5 10-11" />,
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.3 2.7 2.7L16 9.5" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1.1" />
    </>
  ),
  close: <path d="M6 6 18 18M18 6 6 18" />,
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 10 14" />
      <path d="M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H10" />
    </>
  ),
  question: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.3a2.6 2.6 0 0 1 5 1c0 1.7-2.5 2-2.5 3.7" />
      <path d="M12 17.4h.01" />
    </>
  ),
  alert: (
    <>
      <path d="M10.7 3.9 2.5 18.2A1.5 1.5 0 0 0 3.8 20.5h16.4a1.5 1.5 0 0 0 1.3-2.3L13.3 3.9a1.5 1.5 0 0 0-2.6 0Z" />
      <path d="M12 9.5v4" />
      <path d="M12 17h.01" />
    </>
  ),
  thumbUp: (
    <>
      <path d="M7 10.5 11 3a2.4 2.4 0 0 1 2.4 2.4V9.5h4.7a2 2 0 0 1 2 2.4l-1.3 6.4a2 2 0 0 1-2 1.6H7" />
      <rect x="2.8" y="10.5" width="4.2" height="9.4" rx="1.2" />
    </>
  ),
  message: (
    <>
      <path d="M20.5 12.4a7.9 7.9 0 0 1-8.5 7.8L5 21.5l1.4-4.2A7.9 7.9 0 1 1 20.5 12.4Z" />
    </>
  ),
  power: (
    <>
      <path d="M12 3v8.5" />
      <path d="M6.8 6.4a7.6 7.6 0 1 0 10.4 0" />
    </>
  ),
  briefcase: (
    <>
      <rect x="2.8" y="7.2" width="18.4" height="12.6" rx="2" />
      <path d="M8.6 7.2V5.6A1.6 1.6 0 0 1 10.2 4h3.6a1.6 1.6 0 0 1 1.6 1.6v1.6" />
      <path d="M2.8 12.4h18.4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.8" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  mail: (
    <>
      <rect x="2.8" y="5" width="18.4" height="14" rx="2" />
      <path d="m3.4 6.6 8.6 6 8.6-6" />
    </>
  ),
  building: (
    <>
      <path d="M4 20.5V5.4A1.4 1.4 0 0 1 5.4 4h7.2A1.4 1.4 0 0 1 14 5.4v15.1" />
      <path d="M14 10h4.6A1.4 1.4 0 0 1 20 11.4v9.1" />
      <path d="M2.6 20.5h18.8" />
      <path d="M7.2 8h3.6M7.2 12h3.6M7.2 16h3.6" />
    </>
  ),
  hand: (
    <>
      <path d="M7 11.5V5.6a1.6 1.6 0 0 1 3.2 0v5.2" />
      <path d="M10.2 10.6V4.6a1.6 1.6 0 0 1 3.2 0v6" />
      <path d="M13.4 10.9V6.4a1.6 1.6 0 0 1 3.2 0v6.4" />
      <path d="M16.6 12.8v-1a1.6 1.6 0 0 1 3.2 0v3.4A6 6 0 0 1 13.8 21h-1.2a6 6 0 0 1-5-2.7l-2.4-3.7a1.6 1.6 0 0 1 2.5-2L10 15" />
    </>
  ),
  link: (
    <>
      <path d="M10 13.8a4.2 4.2 0 0 0 6.3.5l2.6-2.6a4.2 4.2 0 0 0-6-6l-1.5 1.5" />
      <path d="M14 10.2a4.2 4.2 0 0 0-6.3-.5l-2.6 2.6a4.2 4.2 0 0 0 6 6l1.5-1.5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <path d="M12 7.6h.01" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="12" r="4.2" />
      <path d="M12.2 12H21" />
      <path d="M17.6 12v3.2" />
      <path d="M20.4 12v2.2" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3.2 13.9 9l5.8 1.9-5.8 1.9L12 18.6l-1.9-5.8L4.3 11 10.1 9 12 3.2Z" />
      <path d="M18.6 3.4v3M17.1 4.9h3" />
    </>
  ),
  /** Edit. The set had no way to say "change this", so buttons borrowed
      metaphors that meant something else. */
  pencil: (
    <>
      <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="M14.5 6.5l3 3" />
    </>
  ),
  /** Filters and settings — a control surface, not a magic wand. */
  sliders: (
    <>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2" />
      <path d="M16 6a2 2 0 1 0 0-.01M10 12a2 2 0 1 0 0-.01M16 18a2 2 0 1 0 0-.01" />
    </>
  ),
};

export type IconProps = {
  name: IconName;
  /** Pixel box. The stroke thins as it grows so large icons stay elegant. */
  size?: number;
  className?: string;
  /**
   * Give this ONLY when the icon is the sole content of a control — an icon
   * button with no visible text. Alongside a label it must stay decorative, or
   * a screen reader reads the same thing twice.
   */
  label?: string;
  style?: React.CSSProperties;
};

export function Icon({ name, size = 18, className, label, style }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={size >= 34 ? 1.4 : size >= 24 ? 1.6 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flex: "0 0 auto", display: "block", ...style }}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

/**
 * The logo lockup, in one place.
 *
 * It appears in eleven files. Every one of them used to hand-write the same
 * span with an emoji inside, which is how a mark drifts.
 */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="spark" style={{ width: size, height: size }}>
      <Icon name="logo" size={Math.round(size * 0.68)} />
    </span>
  );
}
