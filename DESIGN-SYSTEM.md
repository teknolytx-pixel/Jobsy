# Jobsy Design System

**v2.52** · Eye-care light and dark themes, WCAG 2.1 AA verified · 67 automated design tests

---

## 0. What was actually wrong

I measured the old theme before changing it, because "make it nicer" and "make it correct" are different jobs and only one of them can be checked.

**Contrast — three real AA failures:**

| Pair | Ratio | Where it showed |
|---|---|---|
| `--dim2` on `--card` | **3.60:1** | *Every* uppercase form label, `.hint`, `.conf`, `.emptylist` |
| `#fff` on `--brand` | **4.44:1** | The label on every primary button |
| `#fff` on `--go` | **3.35:1** | The label on the primary **yes** button |

The last two are the most-pressed controls in the product. Their own text was below the readable threshold on the colour underneath it.

**Touch targets — four of six control types under 44×44 (WCAG 2.5.5):**

`.iconbtn` 36×36 · `.tabs button` ≈33px tall · `.roleswitch button` ≈38px · `.act.sm` dropped to 36×36 in landscape

**And one outright barrier:** `maximumScale: 1` in `layout.tsx` disabled pinch-zoom. That is a straight WCAG 1.4.4 failure and it removes the single accessibility affordance people with low vision reach for first.

**No light theme existed at all** — and the reason was structural, not oversight: colour lived in 23 different files as hardcoded hex.

---

## 1. Design System Tokens

### 1.1 Two principles the palette is built on

**Neither extreme.** No `#000000` and no `#FFFFFF` anywhere a person reads text. Pure black behind light text maximises *halation* — the smeared glow that makes dark mode tiring after twenty minutes. Pure white at full display brightness is the largest single source of light-mode eye strain. The dark ground is lifted to `#12151c`; the light ground is warmed to `#f7f5f2`.

**Warm and muted.** The old accents were saturated and cool. Saturated colour on a dark ground shimmers at its edges — chromatic aberration in the eye's own optics — so the blue is desaturated and the greens, roses and ambers are pulled toward earth. Colour still *means* something (green proceeds, rose declines); it has stopped shouting.

### 1.2 Colour

```css
/* LIGHT (default) */
--bg: #f7f5f2;  --bg2: #f2efeb;  --card: #fffdfa;  --card2: #f5f2ee;
--txt: #22262e;  --dim: #535a67;  --dim2: #666d7b;
--brand: #2f57c4;  --go: #1c6f52;  --no: #a83a4c;  --gold: #7a5416;
--brand-fill: #2f57c4;  --go-fill: #1c6f52;
--on-brand: #fdfcfa;    --on-go: #fdfcfa;

/* DARK */
--bg: #12151c;  --bg2: #171b24;  --card: #1c212b;  --card2: #222834;
--txt: #e7e4de;  --dim: #a9b0bd;  --dim2: #8b93a3;
--brand: #5b84e8;  --go: #4fae86;  --no: #d9808c;  --gold: #d0a558;
--brand-fill: #3a63d0;  --go-fill: #1f7a5a;
--on-brand: #f2efe9;    --on-go: #f2efe9;
```

**The one non-obvious token pair.** `--brand` and `--brand-fill` are the same value in light and pull apart in dark, because *the same hue cannot do both jobs on a dark ground*:

- `--brand` is brand **text** — a link, `.path-go`, an accent icon. On a dark ground it must be light enough to read, so it rises.
- `--brand-fill` is a brand **surface** — the button behind a label. It must be dark enough for a light label to sit on it, so it falls.

My first dark draft ignored this and produced navy text on a bright blue button. It measured 5.26:1 — perfectly compliant, and it read to every eye that saw it as a *disabled control*. Passing the check is not the same as being right, which is why the screenshots mattered as much as the tests.

**Gradients are gone from buttons, and here is the reasoning.** A gradient makes a label sit on two backgrounds, so it must pass against the *darker stop*, not the average. Solving that in dark mode put the two stops within 3% of each other — a gradient so shallow it was no longer a gradient. A flat fill contrasts predictably and is calmer. The one surviving gradient is `.spark`, the logo mark, which carries no text and is therefore governed by the 3:1 non-text rule rather than 4.5:1.

### 1.3 Typography

```css
--t-2xs: 11px;  --t-xs: 12px;  --t-sm: 13px;   --t-md: 14px;   --t-base: 15px;
--t-lg:  17px;  --t-xl: 20px;  --t-2xl: 24px;  --t-3xl: 30px;  --t-4xl: 38px;

--lh-tight: 1.2;   /* display and headings only */
--lh-snug:  1.35;  /* card titles, list rows */
--lh-body:  1.6;   /* everything a person actually reads */
--lh-loose: 1.65;  /* long prose */

--w-normal: 400;  --w-medium: 600;  --w-bold: 700;

--measure: 68ch;
```

Font stack: `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, …`

- **All integers.** The old file used 13.5px, 12.8px, 11.5px and 10.5px. Fractional sizes round differently per browser and per zoom level, so the "same" label was a different height on two machines.
- **Three weights, not four.** 600/700/800/900 on a system UI stack means the browser *synthesises* at least one, and synthetic bold is the smeared, uneven kind.
- **Body at 1.6** — inside the 1.5–1.65 band where reading speed peaks. Headings go tighter because a heading is scanned, not read.
- **68ch measure**, enforced on `.prose`, `.lede`, `.sect p`, `.note` — not just declared.

### 1.4 Space, radius, motion, elevation

```css
--s-1: 4px;  --s-2: 8px;   --s-3: 12px;  --s-4: 16px;
--s-5: 24px; --s-6: 32px;  --s-7: 40px;  --s-8: 48px;

--r-1: 8px;  --r-2: 12px;  --r-3: 16px;  --r-4: 20px;  --r-full: 999px;

--m-fast: 150ms;  --m-base: 180ms;  --m-slow: 220ms;
--ease: cubic-bezier(.2, .7, .3, 1);

--tap: 44px;   /* WCAG 2.5.5 */

/* Soft and wide, never a hard drop */
--sh-1: 0 1px 2px rgba(34,38,46,.04);
--sh-2: 0 4px 20px -2px rgba(34,38,46,.05);
--sh-3: 0 12px 32px -6px rgba(34,38,46,.08);
```

**8px rhythm on a 4px base.** A strict 8px grid cannot express the gap between an icon and its label, so the unit is 4 and every structural step is a multiple of 8.

**Motion at 150–220ms.** Below 100ms a transition reads as a jump; above 250ms the interface feels like it is thinking about it.

**In dark mode, shadow does almost nothing** — elevation is carried by the hairline border instead, and the shadow only softens the edge.

---

## 2. Implementation Code

### 2.1 Theme switching, and the three things that make it correct

```css
:root { /* complete light palette */ }

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* dark palette */ }
}
:root[data-theme="dark"] { /* dark palette, again */ }
```

**Why the dark palette is written twice.** The media query follows the OS; the attribute lets an explicit choice override it *in either direction*. CSS custom properties offer no way to share one block between them without a preprocessor. The failure mode of duplication is drift, so `TC-DESIGN-003` parses both blocks and fails if a single value differs. That test is the whole reason the duplication is safe to keep.

**Why "system" removes the attribute rather than setting it.** A `data-theme="system"` value matches neither selector and would strand the page on light. The *absence* of the attribute is what lets `prefers-color-scheme` decide.

**The anti-flash script** runs synchronously in `<head>`, before first paint:

```ts
const NO_FLASH = `(function(){try{var t=localStorage.getItem('jobsy-theme');
  if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}})()`;
```

It cannot be a React effect — effects run after hydration, several hundred milliseconds and at least one paint too late. Without it, someone who chose dark gets a full white frame first, which at night is not a cosmetic glitch but a bright light in a dark room: precisely what choosing a dark theme is meant to prevent.

**Three options, not a switch.** A two-position toggle has to pick a starting side, and whichever it picks is wrong for half of arrivals. Someone whose laptop is dark at 11pm has already told their machine what they want. "System" is the initial state; the explicit choices exist for the person whose preference differs *here* — common for a site read in a bright office on a dark-themed machine.

**Storage is per-device, in `localStorage`, every access inside `try`.** It is a display preference: the same account on a phone at night and a monitor at noon genuinely wants different answers, so syncing it to the database would be a bug wearing a feature's clothes. And `localStorage` *throws* rather than returning null in private mode — an unguarded read in a header component takes the header down over a colour preference.

### 2.2 The 44×44 hit area

```css
.iconbtn::after, .tabs button::after, .tabs a::after,
.roleswitch button::after, .act::after, .foot a::after {
  content: "";
  position: absolute; top: 50%; left: 50%;
  width: max(100%, var(--tap));
  height: max(100%, var(--tap));
  transform: translate(-50%, -50%);
}
```

By pseudo-element rather than by growing the boxes. Several of these controls are visually correct at 36px and only the *target* is wrong; inflating the box would have meant re-tuning every layout containing one. This expands what the finger hits and leaves what the eye sees alone.

Form controls take the floor directly — `min-height: var(--tap)` on `.field input`, `.composer input`, `.composer button`, `.btn`. And the landscape breakpoint now shrinks *to* 44px and stops, where it used to pass straight through to 36.

### 2.3 Accessibility preferences

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    transition-duration: .01ms !important;
  }
  .confetti { display: none; }
}
```

This is a **vestibular** setting, not a preference for a plainer interface. Someone who has switched it on can be made nauseated by the swipe card's fly-off and by the match confetti. Note `.01ms` rather than `none`: `transition: none` breaks components that wait on `transitionend` to clean up, so the event still fires — immediately — and the state machine stays intact.

`prefers-contrast: more` turns every hairline into a real line and **drops the ambient wash entirely** — a gradient behind text is a slowly varying background contrast, which is the exact thing that setting exists to eliminate. `forced-colors: active` gives explicit borders to elements whose boundary was carried by a background.

### 2.4 The inline-link rule

```css
:where(p, li, .lede, .note, .prose, .path-sub, .emptylist, .hint) a {
  text-decoration: underline;
  text-underline-offset: 2px;
}
```

WCAG 1.4.1 — a link inside running text must be distinguishable by something other than colour, or a reader with a colour vision deficiency sees a sentence with no link in it. Scoped to running text on purpose: a nav item or a card is identifiable by its box; only a link buried mid-sentence has nothing else to go on. axe found exactly one of these, and this rule is why there will not be a second.

---

## 3. Accessibility & Eye-Care Highlights

### 3.1 Measured contrast — every pair, both themes

| Pair | Light | Dark |
|---|---|---|
| Body text on card | 14.94 | 12.71 |
| Secondary text on card | 6.83 | 7.40 |
| **Form labels on card** (`--dim2`) | **5.12** *(was 3.60)* | **5.22** *(was 3.60)* |
| Links / accent on card | 6.30 | 6.50 |
| Success text on card | 6.00 | 5.94 |
| Error text on card | 6.13 | 5.70 |
| **Primary button label** | **6.24** *(was 4.44)* | **4.72** *(was 4.44)* |
| **"Yes" button label** | **5.95** *(was 3.35)* | **4.59** *(was 3.35)* |
| Button edge vs page (1.4.11, 3:1) | 5.88 | 3.37 |
| Focus indicator vs page (3:1) | 5.88 | 7.36 |

Every text pair clears 4.5:1. Every non-text pair clears 3:1. All computed by `scripts/test-design.mts` from the stylesheet itself on every run — a ratio written into a comment is a claim, and a claim nothing checks is wrong within three commits.

### 3.2 Independent audit

**axe-core, WCAG 2.0/2.1 A + AA, ten page-theme combinations:**

| | Light | Dark |
|---|---|---|
| `/` `/login` `/reset` `/legal/privacy` `/legal/terms` | clean | clean |
| `/swipe` `/profile` `/matches` `/applied` `/resume` | clean | clean |

**Three violations were found and fixed** on the authenticated pass:

- `select-name` (**critical**) — the availability *unit* dropdown on `/profile`. The visible "AVAILABLE IN" label belongs to the number field beside it, so a screen reader reached the dropdown and announced an unnamed combo box. Fixed with `aria-label`.
- `select-name` (**critical**) — "Tailor to" on `/resume` is a styled `<span class="lbl">`, not a `<label>`, so it named nothing. Fixed with `aria-labelledby` pointing at the visible text, so if the wording changes the announced name follows.
- `link-in-text-block` (**serious**) — an inline link distinguished only by colour. Fixed systemically, per §2.4.

One process note worth recording: my first authenticated audit reported *five clean pages that were all the login screen* — the post-login redirect had not landed and every navigation bounced back. The script now asserts it is actually where it thinks it is before running, and reports a skip rather than a pass. A green result you have not verified the setup of is worse than a red one.

### 3.3 Eye-care specifics

- **No `#000000`, no `#FFFFFF`** in either palette, asserted by test. The dark ground sits at `#12151c` and the light at `#f7f5f2`.
- **The ambient wash is a pseudo-element, not a body background**, so it can be removed wholesale at `prefers-contrast: more`. It is also far weaker than before — a gradient *behind reading text* is a slowly varying background contrast, which is what makes long sessions tiring.
- **Warm off-white text** (`#e7e4de`) rather than white on dark: lower luminance at the same legibility, less halation.
- **Pinch-zoom restored.** `maximumScale` is gone, and a test fails if it returns. The usual reason for adding it — iOS auto-zooming on a focused input — is solved properly by the 15px+ input font the form styles now carry.
- **`theme-color` is declared per scheme** and a test asserts both values still match `--bg`. A single value is visibly the wrong shade of browser chrome for half of users.

---

## 4. Verification

```
npm run test:design      67 tests   design system
npm test               1031 tests   full suite, 0 failures
npm run build                       clean
```

The design suite is deliberately **database-free**, so it runs in CI on a pull request with no secrets attached — a control verified only by a suite needing production-shaped credentials stops being verified the first time CI is set up properly.

It parses `globals.css` and asserts, among others:

- every text pair ≥ 4.5:1 and every non-text pair ≥ 3:1, **in both themes**
- the two dark declarations have not drifted apart
- no fractional font sizes, no raw numeric `font-weight`, no raw pixel padding
- `--measure` is 60–75ch **and is actually applied** to the long-form blocks
- every previously-undersized control carries the 44px hit area, and landscape never shrinks below it
- reduced-motion, high-contrast and forced-colors blocks all exist and do the right thing
- **no hardcoded colour in any themed component** — the reason no light theme existed before
- the avatar gradient palette is legible against its own initials (the old comment *claimed* 4.5:1; the brightest stop was 4.33)

Three of these tests first "failed" on their own documentation — the rule explaining why `maximumScale` was removed contains the word `maximumScale`. The scanners now strip comments before reading structure.
