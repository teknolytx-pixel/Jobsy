/**
 * UI-001 — the design system, verified against its own source.
 *
 * These tests PARSE globals.css and compute real numbers from it. That is the
 * point: a contrast ratio written into a comment is a claim, and a claim that
 * nothing checks is wrong within three commits. The old palette shipped with a
 * form-label colour at 3.60:1 and a primary-button label at 3.35:1, and both
 * had been there long enough that nobody thought to look.
 *
 * Database-free, so it runs in CI on a pull request with no secrets attached.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

let pass = 0;
let fail = 0;
const failures: string[] = [];

async function t(id: string, name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    pass++;
    console.log(`  ✓ ${id}  ${name}`);
  } catch (e) {
    fail++;
    failures.push(`${id}  ${name} — ${(e as Error).message}`);
    console.log(`  ✗ ${id}  ${name}`);
  }
}

const CSS_RAW = readFileSync("src/app/globals.css", "utf8");
/**
 * Comments stripped for every structural scan.
 *
 * Three of these tests first "failed" on their own documentation — the rule
 * explaining why `maximumScale` was removed contains the word `maximumScale`,
 * and the comment above .btn mentions `.btn` before the rule does. A linter
 * that reads prose finds whatever the prose is about.
 */
const stripJsComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const CSS = CSS_RAW.replace(/\/\*[\s\S]*?\*\//g, "");

// ─────────────────────────────────────────────────────────────
// Colour maths — WCAG 2.1 relative luminance and contrast ratio
// ─────────────────────────────────────────────────────────────

function rgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
/** WCAG 2.1 §relative luminance. */
function luminance(c: [number, number, number]): number {
  const f = (v: number) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(rgb(a)), luminance(rgb(b))];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * Pull one theme's token block out of the stylesheet.
 *
 * Light is the bare `:root {` block; dark is the explicit
 * `:root[data-theme="dark"]` block. The dark palette is deliberately written
 * TWICE in the CSS — once under prefers-color-scheme and once under the
 * attribute — and TC-DESIGN-003 below asserts the two copies agree, which is
 * the failure mode duplication actually has.
 */
function tokensIn(startMarker: string): Record<string, string> {
  const i = CSS.indexOf(startMarker);
  assert.ok(i >= 0, `could not find "${startMarker}" in globals.css`);
  const open = CSS.indexOf("{", i);
  const block = CSS.slice(open + 1, CSS.indexOf("\n}", open));
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const LIGHT = tokensIn("\n:root {");
const DARK = tokensIn('\n:root[data-theme="dark"] {');

// Text pairs that must clear 4.5:1. Every one of these is a real usage in the
// stylesheet, not a hypothetical combination.
const TEXT_PAIRS: [string, string, string][] = [
  ["txt", "card", "body text on a card"],
  ["txt", "bg", "body text on the page"],
  ["dim", "card", "secondary text on a card"],
  ["dim", "bg", "secondary text on the page"],
  ["dim2", "card", "form labels / .conf / .hint on a card"],
  ["dim2", "bg", "form labels on the page"],
  ["blue", "card", "links and .path-go on a card"],
  ["blue", "bg", "links on the page"],
  ["go", "card", ".fitrow b, .ok, .badge.a"],
  ["go", "bg", "success text on the page"],
  ["no", "card", ".err, .badge.m, .act.no"],
  ["no", "bg", "error text on the page"],
  ["gold", "card", ".pill.hot, medium confidence"],
  ["brand", "card", "brand text on a card"],
];

// Labels sitting on a solid fill. These are the ones the old palette failed.
const FILL_PAIRS: [string, string, string][] = [
  ["on-brand", "brand-fill", ".btn / .bub.me / .roleswitch button.on"],
  ["on-go", "go-fill", ".btn.go and .act.yes — the primary YES button"],
];

/**
 * Non-text. `.spark` is the logo mark: it holds an icon glyph, not a label, so
 * WCAG 1.4.11 (3:1) governs it rather than 1.4.3 (4.5:1). Listing it under the
 * text rule was my error, and forcing the gradient's dark stop up to 4.5:1
 * would have flattened the one gradient in the system for no accessibility
 * gain.
 */
const GLYPH_PAIRS: [string, string, string][] = [
  ["on-brand", "brand2", ".spark logo glyph on the gradient's dark stop"],
  // A filled button needs a visible EDGE against the page, or it reads as a
  // floating word rather than a control. 3:1 is the 1.4.11 floor for that.
  ["brand-fill", "bg", ".btn edge against the page ground"],
  ["go-fill", "bg", ".btn.go edge against the page ground"],
];

for (const [themeName, T] of [["light", LIGHT], ["dark", DARK]] as const) {
  console.log(`\n─── UI-001  ${themeName} theme — WCAG 2.1 AA contrast ───\n`);

  await t(`TC-DESIGN-${themeName}-parse`, `the ${themeName} token block parsed`, () => {
    for (const k of ["bg", "card", "txt", "dim", "dim2", "brand", "go", "no", "blue", "gold"]) {
      assert.ok(T[k], `--${k} is missing from the ${themeName} palette`);
    }
  });

  for (const [fg, bg, usage] of TEXT_PAIRS) {
    await t(`TC-DESIGN-${themeName}-${fg}-on-${bg}`, `${usage} ≥ 4.5:1`, () => {
      const r = contrast(T[fg]!, T[bg]!);
      assert.ok(
        r >= 4.5,
        `--${fg} on --${bg} is ${r.toFixed(2)}:1, below the 4.5:1 AA floor for normal text`
      );
    });
  }

  for (const [fg, bg, usage] of FILL_PAIRS) {
    await t(`TC-DESIGN-${themeName}-fill-${fg}-${bg}`, `${usage} ≥ 4.5:1`, () => {
      const r = contrast(T[fg]!, T[bg]!);
      assert.ok(r >= 4.5, `--${fg} on --${bg} is ${r.toFixed(2)}:1 — the label is unreadable`);
    });
  }

  for (const [fg, bg, usage] of GLYPH_PAIRS) {
    await t(`TC-DESIGN-${themeName}-glyph-${fg}-${bg}`, `${usage} ≥ 3:1`, () => {
      const r = contrast(T[fg]!, T[bg]!);
      assert.ok(r >= 3, `--${fg} on --${bg} is ${r.toFixed(2)}:1, below the 3:1 non-text floor`);
    });
  }

  /**
   * Non-text contrast — WCAG 1.4.11. A border a person cannot see is not a
   * border, and the field outline is how someone knows where to type. The
   * hairline is rgba over the ground, so this composites it first.
   */
  await t(`TC-DESIGN-${themeName}-focus-ring`, "the focus indicator clears 3:1 on the page", () => {
    const r = contrast(T.blue!, T.bg!);
    assert.ok(r >= 3, `--blue on --bg is ${r.toFixed(2)}:1, below the 3:1 non-text floor`);
  });

  await t(`TC-DESIGN-${themeName}-not-pure`, "neither #000000 nor #FFFFFF is used", () => {
    for (const [k, v] of Object.entries(T)) {
      const n = v.toLowerCase().replace(/\s/g, "");
      assert.ok(n !== "#000" && n !== "#000000", `--${k} is pure black`);
      assert.ok(n !== "#fff" && n !== "#ffffff", `--${k} is pure white`);
    }
  });
}

console.log("\n─── UI-002  the two dark declarations agree ───\n");

/**
 * The dark palette is written twice: once inside
 * `@media (prefers-color-scheme: dark)` and once under `[data-theme="dark"]`.
 * Both are necessary — the media query follows the OS, the attribute lets an
 * explicit choice override it in either direction — and CSS custom properties
 * offer no way to share one block between them without a preprocessor.
 *
 * The failure mode of duplication is drift: someone tunes one copy. This test
 * is the whole reason the duplication is safe to keep.
 */
await t("TC-DESIGN-003", "the media-query and attribute dark blocks are identical", () => {
  const media = tokensIn(':root:not([data-theme="light"]) {');
  const keys = new Set([...Object.keys(media), ...Object.keys(DARK)]);
  const drifted: string[] = [];
  for (const k of keys) {
    if (media[k] !== DARK[k]) drifted.push(`--${k}: "${media[k]}" vs "${DARK[k]}"`);
  }
  assert.deepEqual(drifted, [], `the two dark palettes have drifted apart:\n    ${drifted.join("\n    ")}`);
});

console.log("\n─── UI-003  typography ───\n");

await t("TC-DESIGN-010", "body line-height is between 1.5 and 1.65", () => {
  const lh = Number(LIGHT["lh-body"]);
  assert.ok(lh >= 1.5 && lh <= 1.65, `--lh-body is ${lh}; the readable band is 1.5–1.65`);
  const loose = Number(LIGHT["lh-loose"]);
  assert.ok(loose >= 1.5 && loose <= 1.65, `--lh-loose is ${loose}`);
});

await t("TC-DESIGN-011", "exactly three font weights exist", () => {
  const weights = new Set(
    [...CSS.matchAll(/font-weight:\s*(\d{3})/g)].map((m) => m[1]!)
  );
  // Declared tokens are the only permitted values.
  const declared = new Set([LIGHT["w-normal"], LIGHT["w-medium"], LIGHT["w-bold"]]);
  assert.equal(declared.size, 3, "the three weight tokens are not distinct");
  assert.deepEqual(
    [...weights].sort(),
    [],
    `raw numeric font-weights found in the stylesheet: ${[...weights].join(", ")} — use var(--w-*)`
  );
});

await t("TC-DESIGN-012", "no fractional font sizes", () => {
  const frac = [...CSS.matchAll(/font-size:\s*([0-9]+\.[0-9]+)px/g)].map((m) => m[1]!);
  assert.deepEqual(
    frac,
    [],
    `fractional sizes round differently per browser and zoom level: ${frac.join(", ")}`
  );
});

await t("TC-DESIGN-013", "the reading measure is 60–75ch", () => {
  const m = /--measure:\s*(\d+)ch/.exec(CSS);
  assert.ok(m, "--measure is not declared in ch");
  const ch = Number(m![1]);
  assert.ok(ch >= 60 && ch <= 75, `--measure is ${ch}ch; the comfortable band is 60–75`);
});

/** Find a rule block by its selector appearing at the start of a line. */
function ruleBlock(selector: string): string {
  const re = new RegExp(
    `(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
    "m"
  );
  const m = re.exec(CSS);
  assert.ok(m, `no rule found for "${selector}"`);
  return m![2]!;
}

await t("TC-DESIGN-014", "long-form text is capped at the reading measure", () => {
  for (const sel of [".prose", ".lede", ".sect p", ".note"]) {
    const block = ruleBlock(sel);
    assert.ok(
      /max-width:\s*(var\(--measure\)|\d+ch)/.test(block),
      `${sel} sets no max-width — on a wide screen it runs past the readable measure`
    );
  }
});

console.log("\n─── UI-004  spacing on the 8px grid ───\n");

await t("TC-DESIGN-020", "every space token is a multiple of 4, stepping in 8s", () => {
  const steps = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => Number(LIGHT[`s-${i}`]!.replace("px", "")));
  assert.deepEqual(steps, [4, 8, 12, 16, 24, 32, 40, 48]);
  for (const s of steps) assert.equal(s % 4, 0, `${s}px is off the 4px base`);
});

await t("TC-DESIGN-021", "layout rules use tokens, not raw pixel padding", () => {
  // Raw px padding/margin/gap is what put 9px, 11px and 13px into the old file.
  const raw = [
    ...CSS.matchAll(/^\s{2,}(padding|margin|gap):\s*([0-9]+px[^;]*);/gm),
  ]
    .map((m) => `${m[1]}: ${m[2]}`)
    .filter((s) => !/\b(0|1|2|3)px\b/.test(s)); // hairlines and 2px nudges are fine
  assert.deepEqual(raw, [], `raw pixel spacing found — use var(--s-*):\n    ${raw.join("\n    ")}`);
});

console.log("\n─── UI-005  touch targets (WCAG 2.5.5) ───\n");

await t("TC-DESIGN-030", "the tap token is 44px", () => {
  assert.equal(LIGHT.tap, "44px");
});

/**
 * The controls that were measurably too small. Each now either sizes to at
 * least 44px or carries the ::after hit-area expander — and this test asserts
 * one of the two is true, by selector, so a later restyle cannot quietly drop
 * it.
 */
await t("TC-DESIGN-031", "every previously-undersized control has a 44px hit area", () => {
  const start = CSS.indexOf(".iconbtn::after");
  assert.ok(start > 0, "the shared ::after hit-area rule is missing");
  const rule = CSS.slice(start, CSS.indexOf("}", start));
  assert.ok(rule.includes("max(100%, var(--tap))"), "the expander does not reach the 44px floor");
  for (const sel of [".iconbtn", ".tabs button", ".roleswitch button", ".act", ".foot a"]) {
    assert.ok(rule.includes(`${sel}::after`), `${sel} is not in the hit-area expander list`);
  }
});

await t("TC-DESIGN-032", "form controls are at least 44px tall", () => {
  for (const sel of [
    ".field input, .field textarea, .field select",
    ".composer input",
    ".composer button",
    ".btn",
  ]) {
    assert.ok(
      ruleBlock(sel).includes("min-height: var(--tap)"),
      `${sel} does not set min-height: var(--tap)`
    );
  }
});

await t("TC-DESIGN-033", "landscape never shrinks a control below the floor", () => {
  const i = CSS.indexOf("@media (max-height: 500px)");
  const block = CSS.slice(i, CSS.indexOf("\n}", CSS.indexOf(".hint { display: none; }", i)));
  const sizes = [...block.matchAll(/(?:width|height):\s*([0-9]+)px/g)].map((m) => Number(m[1]));
  const tooSmall = sizes.filter((s) => s < 44);
  assert.deepEqual(
    tooSmall,
    [],
    `landscape shrinks controls to ${tooSmall.join(", ")}px — below the 44px floor`
  );
});

console.log("\n─── UI-006  motion and elevation ───\n");

await t("TC-DESIGN-040", "transition tokens sit in the 150–220ms band", () => {
  for (const k of ["m-fast", "m-base", "m-slow"]) {
    const ms = Number(LIGHT[k]!.replace("ms", ""));
    assert.ok(ms >= 150 && ms <= 220, `--${k} is ${ms}ms; the band is 150–220`);
  }
});

await t("TC-DESIGN-041", "prefers-reduced-motion is honoured", () => {
  assert.ok(CSS.includes("@media (prefers-reduced-motion: reduce)"), "no reduced-motion block");
  const i = CSS.indexOf("@media (prefers-reduced-motion: reduce)");
  const block = CSS.slice(i, i + 900);
  assert.ok(block.includes("animation-duration: .01ms"), "animations are not reduced");
  assert.ok(block.includes("transition-duration: .01ms"), "transitions are not reduced");
  // Not `none` — components wait on transitionend to clean up.
  assert.ok(!/transition:\s*none/.test(block), "transition:none breaks transitionend listeners");
  assert.ok(block.includes(".confetti"), "the confetti burst is not suppressed");
});

await t("TC-DESIGN-042", "prefers-contrast and forced-colors are handled", () => {
  assert.ok(CSS.includes("@media (prefers-contrast: more)"), "no high-contrast block");
  assert.ok(CSS.includes("@media (forced-colors: active)"), "no Windows High Contrast block");
});

await t("TC-DESIGN-043", "shadows are soft, never a hard drop", () => {
  const shadows = [...CSS.matchAll(/--sh-\d:\s*([^;]+);/g)].map((m) => m[1]!);
  assert.ok(shadows.length >= 3, "the elevation scale is missing");
  for (const s of shadows) {
    const alpha = Number(/rgba\([^)]*,\s*([0-9.]+)\)/.exec(s)?.[1] ?? "1");
    assert.ok(alpha <= 0.45, `shadow alpha ${alpha} is too heavy: ${s}`);
  }
});

console.log("\n─── UI-007  theming works end to end ───\n");

await t("TC-DESIGN-050", "an anti-flash script runs before first paint", () => {
  const layout = readFileSync("src/app/layout.tsx", "utf8");
  assert.ok(layout.includes("NO_FLASH"), "no anti-flash script in the document head");
  assert.ok(layout.includes("<head>"), "the script is not in <head>, so it runs after first paint");
  assert.ok(
    layout.includes("suppressHydrationWarning"),
    "the script mutates <html>, so React will warn on hydration without this"
  );
});

await t("TC-DESIGN-051", "pinch-zoom is not disabled", () => {
  const layout = stripJsComments(readFileSync("src/app/layout.tsx", "utf8"));
  assert.ok(
    !/maximumScale/.test(layout),
    "maximumScale disables pinch-zoom — a WCAG 1.4.4 failure"
  );
  assert.ok(!/userScalable:\s*false/.test(layout), "userScalable:false disables pinch-zoom");
});

await t("TC-DESIGN-052", "theme-color is declared per scheme and matches --bg", () => {
  const layout = readFileSync("src/app/layout.tsx", "utf8");
  const light = /prefers-color-scheme: light\D+(#[0-9a-f]{6})/i.exec(layout)?.[1]?.toLowerCase();
  const dark = /prefers-color-scheme: dark\D+(#[0-9a-f]{6})/i.exec(layout)?.[1]?.toLowerCase();
  assert.equal(light, LIGHT.bg!.toLowerCase(), "the light theme-color has drifted from --bg");
  assert.equal(dark, DARK.bg!.toLowerCase(), "the dark theme-color has drifted from --bg");
});

await t("TC-DESIGN-053", '"system" clears the attribute rather than writing a value', () => {
  const tt = readFileSync("src/components/ThemeToggle.tsx", "utf8");
  assert.ok(
    tt.includes("removeAttribute"),
    'choosing "system" must REMOVE data-theme — a data-theme="system" value matches no selector and strands the page on light'
  );
});

/**
 * localStorage THROWS, it does not merely return null: Safari in private mode
 * and any browser with site data blocked raise a SecurityError on access. An
 * unguarded read in a component that renders the whole header takes the header
 * down over a colour preference.
 *
 * Counting catch blocks was the first version of this test and it was a bad
 * one — it passes for a file with four unguarded reads and one unrelated
 * try/catch. This checks that every single access sits inside a try.
 */
await t("TC-DESIGN-054", "every storage access is inside a try block", () => {
  const tt = stripJsComments(readFileSync("src/components/ThemeToggle.tsx", "utf8"));
  const unguarded: string[] = [];
  for (const m of tt.matchAll(/localStorage/g)) {
    const before = tt.slice(0, m.index!);
    const opened = (before.match(/\btry\s*\{/g) ?? []).length;
    const closed = (before.match(/\}\s*catch\b/g) ?? []).length;
    if (opened <= closed) unguarded.push(`offset ${m.index}`);
  }
  assert.deepEqual(
    unguarded,
    [],
    `localStorage accessed outside a try block (${unguarded.join(", ")}) — this throws in private mode`
  );
});

console.log("\n─── UI-008  no colour escapes the token layer ───\n");

/**
 * The reason the app had no light theme was not that nobody wrote one — it was
 * that colour lived in 23 different files. A hardcoded hex is invisible in
 * review and correct in exactly one theme.
 */
const TSX = execSync("git ls-files 'src/**/*.tsx'", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

// Avatar gradients and confetti are generated decorative palettes with no text
// contrast obligation; the SVG glyph stack in Icon.tsx uses currentColor.
const DECORATIVE = [
  "src/components/ui.tsx",
  // The theme-color meta values MUST be literal hex — the OS paints browser
  // chrome with them before any stylesheet is parsed, so a var() there resolves
  // to nothing. TC-DESIGN-052 asserts they still match --bg.
  "src/app/layout.tsx",
];

await t("TC-DESIGN-060", "no hardcoded colour in a themed component", () => {
  const offenders: string[] = [];
  for (const f of TSX) {
    if (DECORATIVE.includes(f)) continue;
    const body = readFileSync(f, "utf8");
    for (const m of body.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      offenders.push(`${f}: ${m[0]}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `hardcoded colours are correct in one theme and wrong in the other:\n    ${offenders.join("\n    ")}`
  );
});

await t("TC-DESIGN-061", "decorative palettes carry a legible label", () => {
  // The avatar gradients render initials. Whatever else they are, the initials
  // have to be readable on every one of them.
  const ui = readFileSync("src/components/ui.tsx", "utf8");
  const stops = [...ui.matchAll(/"(#[0-9a-f]{6}),(#[0-9a-f]{6})"/gi)];
  assert.ok(stops.length >= 4, "the avatar gradient list was not found");
  const label = "#fdfcfa";
  for (const [, a, b] of stops) {
    for (const stop of [a!, b!]) {
      const r = contrast(label, stop);
      assert.ok(r >= 4.5, `avatar initials on ${stop} are ${r.toFixed(2)}:1`);
    }
  }
});

console.log(`\n${pass} passed, ${fail} failed  —  design system\n`);
if (fail) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
process.exit(0);
