# PRODUCT DESIGN DOCUMENT (PDD)

**Product:** Jobsy · **Version:** 1.0.0-Release Candidate · **Source:** commit `53e0531` (v2.52)
**Audience:** Product Designers, Frontend Engineers, QA / Software Testers

> Companion documents: `DESIGN-SYSTEM.md` (what changed in v2.52 and why) · `SECURITY-AUDIT.md` (security posture) · `scripts/test-design.mts` (the executable form of §2)

---

## 1. EXECUTIVE SUMMARY & DESIGN PHILOSOPHY

Jobsy is a two-sided swipe-based hiring product: candidates swipe job postings, recruiters swipe candidate profiles, and a mutual right-swipe opens a conversation. It is a **Next.js web application — one platform, delivered through the browser.**

### Scope, stated plainly

There is no Windows, macOS, iOS or Android client. Platform-specific controls — Keychain storage, certificate pinning, screenshot suppression — are **N/A** and are marked as such rather than given passing rows. A checklist that reports green for a platform that does not exist teaches you the checklist is trustworthy when it isn't.

### Core vision

An interface a person can sit inside for an hour without their eyes hurting. Job hunting and hiring are both long, repetitive, high-stakes sessions — hundreds of swipes across weeks — so the surface has to be built for endurance rather than first impression.

### The five UX pillars

| Pillar | What it means here | Verified by |
|---|---|---|
| **Ergonomic luminance** | Neither extreme: no `#000000`, no `#FFFFFF` anywhere text is read. Desaturated, warm-leaning accents. | `TC-DESIGN-*-not-pure` |
| **WCAG 2.1 AA** | 4.5:1 for text, 3:1 for non-text, in *both* themes | `TC-DESIGN-{light,dark}-*` |
| **High legibility** | Integer type scale, 1.6 body line-height, 68ch measure enforced not declared | `TC-DESIGN-010 … 014` |
| **Zero-clutter hierarchy** | Three font weights, one accent, colour spent only where it carries meaning | `TC-DESIGN-011` |
| **Cross-platform security** | CSP, frame-ancestors, HSTS, rate limits enforced rather than declared | `TC-SEC-001 … 005` |

### Philosophy

Every claim in this document is a number, and every number is recomputed from source on each test run. A contrast ratio written into a comment is a claim; a claim nothing checks is wrong within three commits. The previous palette carried a comment asserting its avatar colours cleared 4.5:1 while the brightest measured **4.33:1** — that is the failure mode this document is shaped to prevent.

---

## 2. UI DESIGN SYSTEM & EYE-CARE SPECIFICATIONS

### 2.1 Colour palette & ergonomics

Two principles govern every value.

1. **Neither extreme.** Pure black behind light text maximises *halation* — the smeared glow that makes dark mode tiring after twenty minutes. Pure white at full display brightness is the largest single source of light-mode strain. Dark ground lifted to `#12151c`; light ground warmed to `#f7f5f2`.
2. **Warm and muted.** Saturated colour on a dark ground shimmers at its edges (chromatic aberration in the eye's own optics). The blue is desaturated; greens, roses and ambers pulled toward earth. Colour still *means* something — green proceeds, rose declines — it has stopped shouting.

```css
/* LIGHT (default) */
--bg: #f7f5f2;  --bg2: #f2efeb;  --card: #fffdfa;  --card2: #f5f2ee;
--txt: #22262e; --dim: #535a67;  --dim2: #666d7b;
--brand: #2f57c4; --go: #1c6f52; --no: #a83a4c;  --gold: #7a5416;
--brand-fill: #2f57c4;  --go-fill: #1c6f52;
--on-brand: #fdfcfa;    --on-go: #fdfcfa;

/* DARK */
--bg: #12151c;  --bg2: #171b24;  --card: #1c212b;  --card2: #222834;
--txt: #e7e4de; --dim: #a9b0bd;  --dim2: #8b93a3;
--brand: #5b84e8; --go: #4fae86; --no: #d9808c;  --gold: #d0a558;
--brand-fill: #3a63d0;  --go-fill: #1f7a5a;
--on-brand: #f2efe9;    --on-go: #f2efe9;
```

#### The fill-versus-text rule

The least obvious decision in the system and the easiest to undo by accident.

`--brand` is the colour of brand **text** — a link, an accent icon. On a dark ground it must be light enough to read, so it rises. `--brand-fill` is the colour of a brand **surface** — the button behind a label. It must be dark enough for a light label to sit on it, so it falls. Same value in light; they pull apart in dark.

> The first dark draft ignored this and produced navy text on a bright blue button. It measured **5.26:1** — comfortably compliant — and read to every eye that saw it as a *disabled control*. Passing the check is not the same as being right; the screenshot review caught what the test could not.

**Gradients are not used on controls.** A gradient makes a label sit on two backgrounds, so it must pass against the darker stop rather than the average. Solving that in dark mode put the two stops within 3% of each other — a gradient too shallow to be one. The only surviving gradient is the logo mark, which carries no text and is governed by the 3:1 non-text rule.

#### Measured contrast

| Pair | Light | Dark | Floor | Status |
|---|---:|---:|---:|---|
| Body text on card | 14.94 | 12.71 | 4.5 | PASS |
| Body text on page | 13.94 | 14.39 | 4.5 | PASS |
| Secondary text on card | 6.83 | 7.40 | 4.5 | PASS |
| **Form labels on card** *(was 3.60)* | 5.12 | 5.22 | 4.5 | **FIXED** |
| Links / accent on card | 6.30 | 6.50 | 4.5 | PASS |
| Success text on card | 6.00 | 5.94 | 4.5 | PASS |
| Error text on card | 6.13 | 5.70 | 4.5 | PASS |
| Caution text on card | 6.66 | 7.07 | 4.5 | PASS |
| **Primary button label** *(was 4.44)* | 6.24 | 4.72 | 4.5 | **FIXED** |
| **"Yes" button label** *(was 3.35)* | 5.95 | 4.59 | 4.5 | **FIXED** |
| Button edge vs page | 5.88 | 3.37 | 3.0 | PASS |
| Focus indicator vs page | 5.88 | 7.36 | 3.0 | PASS |

### 2.2 Typography scale & line length

Stack: `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`

| Token | Size | Use |
|---|---:|---|
| `--t-4xl` | 38px | Hero |
| `--t-3xl` | 30px | Page titles |
| `--t-2xl` | 24px | Card titles at ≥700px |
| `--t-xl` | 20px | Card titles, KPI figures |
| `--t-lg` | 17px | Section headings, lede |
| `--t-base` | 15px | **Body** |
| `--t-md` | 14px | Descriptions |
| `--t-sm` | 13px | Metadata |
| `--t-xs` | 12px | Pills, tags, hints |
| `--t-2xs` | 11px | Uppercase field labels |

| Rule | Value | Why |
|---|---|---|
| All sizes integer | 11–38px | The old scale used 13.5px, 12.8px, 11.5px, 10.5px. Fractional sizes round differently per browser and zoom level, so the "same" label was a different height on two machines. |
| Body line-height | 1.6 | Inside the 1.5–1.65 band where reading speed peaks |
| Long prose | 1.65 | Legal pages, job descriptions |
| Headings | 1.2–1.35 | A heading is scanned, not read |
| Weights | 400 / 600 / 700 | Three, not four. A fourth on a system UI stack makes the browser *synthesise* one, and synthetic bold is the smeared kind. |
| Measure | 68ch | Applied to `.prose`, `.lede`, `.sect p`, `.note` — enforced, not merely declared |

### 2.3 Interactive standards & target sizes

| Control | Before | Now | Mechanism |
|---|---:|---:|---|
| `.iconbtn` | 36×36 | 44×44 | `::after` hit-area expander |
| `.tabs button` | ≈33 tall | 44 min | `::after` expander |
| `.roleswitch button` | ≈38 tall | 44 min | `::after` expander |
| `.act.sm` (landscape) | 36×36 | 44×44 | Shrinks to the floor and stops |
| `.field input` | ≈45 | 44 min | `min-height: var(--tap)` |
| `.btn` | ≈51 | 44 min | `min-height: var(--tap)` |

The expander is a pseudo-element rather than a larger box on purpose: several controls are visually correct at 36px and only the *target* is wrong.

```css
.iconbtn::after, .tabs button::after, .tabs a::after,
.roleswitch button::after, .act::after, .foot a::after {
  content: "";
  position: absolute; top: 50%; left: 50%;
  width:  max(100%, var(--tap));
  height: max(100%, var(--tap));
  transform: translate(-50%, -50%);
}
```

| Standard | Specification |
|---|---|
| Focus ring | `outline: 2px solid var(--blue)`, `outline-offset: 2px`. Two layers so it reads against a coloured button face. 5.88:1 light / 7.36:1 dark. |
| Transitions | 150 / 180 / 220ms. Below 100ms reads as a jump; above 250ms feels like thinking. |
| `prefers-reduced-motion` | Durations to `.01ms` — **not** `none`, which breaks components waiting on `transitionend`. Confetti suppressed. Vestibular setting: the fly-off and match burst can make someone nauseated. |
| `prefers-contrast: more` | Hairlines to real lines, borders 2px, ambient wash removed entirely |
| `forced-colors: active` | Explicit borders where a boundary was carried by a background |
| Pinch-zoom | Enabled. `maximumScale: 1` removed — WCAG 1.4.4 failure. A test fails if it returns. |
| Colour independence | Inline links in running text underlined; state = shape + word + colour |

---

## 3. ARCHITECTURE & COMPONENT SPECIFICATIONS

### 3.1 Layout architecture

Every screen renders inside `.shell`. The one distinction that matters is `.shell.fixed` — the swipe deck and chat thread — which must **not** grow with the window: a swipe card the width of a monitor is unusable, and chat bubbles spanning 1400px are unreadable.

| Breakpoint | `.shell` | `.shell.fixed` | Other |
|---|---:|---:|---|
| < 380px | 100% | 100% | Gutters 16→12px; action buttons 60→56px |
| 380–699 | 460px | 460px | Base mobile layout |
| 700–1079 | 560px | 500px | Deck min-height 420px; sheet becomes a centred card |
| 1080–1499 | 620px | 520px | Shell gains hairline sides and lifted ground; gutters 20px |
| ≥ 1500 | 640px | 540px | Capped — the reading measure sets the width, not the window |
| Landscape < 500px tall | — | — | Deck 180px; controls to the 44px floor; hint hidden |

**Chrome, top to bottom:** `header.top` (logo, spacer, icon buttons; theme control on `/profile` and the landing footer only) → `.roleswitch` → `.tabs` (+ `.tabs .n` count badge) → `.ctxbar` → `.deckwrap` → `.card` ×3 or `.empty` → `.actions` + `.hint`.

### 3.2 Component specifications

| Component | Class | States to review & test |
|---|---|---|
| Primary button | `.btn` | default · hover (brightness 1.08) · active (scale .99) · disabled · focus-visible |
| Button variants | `.btn.ghost/.go/.blue/.li` | Same five each; `.li` keeps LinkedIn blue by contract |
| Swipe card | `.card` | rest · dragging · `.anim` committing · third-in-stack · empty |
| Swipe stamps | `.stamp.like/.nope` | opacity 0→1 across 110px drag; ±14° |
| Action buttons | `.act.no/.yes/.sm` | default · active (scale .92) · disabled · focus-visible |
| Match score | `.fitbar/.fitrow` | normal · `.under` (muted; must not borrow `--no`) |
| Confidence | `.conf.high/.medium/.low` | LOW must read as "look closer", never rejection |
| Skill tags | `.tag/.match/.miss` | neutral · matched · missing |
| Pills | `.pill.pay/.hot/.src/.li` | Four tinted variants |
| Badges | `.badge.m/.s/.a` | attention · info · accepted; `.m` must not share a hue with the action colour |
| Text field | `.field input` | empty · filled · focus · error · disabled |
| Inline feedback | `.err/.ok` | 3px stripe + tint + icon; errors take `--no`, never `--brand` |
| Bottom sheet | `.sheet > .inner` | entering (220ms) · scrolled · dismissing; centred card ≥700px |
| Chat bubble | `.bub.me/.them` | Filled vs outlined; asymmetric corner marks the sender |
| Theme toggle | `.themeswitch` | light · auto · dark via `aria-pressed` |
| Toast | `.toast` | Enters 180ms, auto-dismisses |
| Empty states | `.empty/.emptylist` | Dashed border, icon, title, one sentence of what to do next |

#### Deck interaction specification (QA reference)

| Behaviour | Exact value |
|---|---|
| Commit threshold | > 105px horizontal displacement on release |
| Stamp opacity ramp | `min(1, |dx| / 110)` |
| Rotation while dragging | `dx / 22` degrees |
| Vertical drag tolerance | `|dx| < 8 && |dy| > 12` → card body scrolls instead |
| Fly-off transform | ±520px x, +60px y, ±26°, opacity 0 |
| Delay before `onSwipe` | 260ms |
| Keyboard | → = LIKE, ← = PASS |
| Cards in stack | 3 |
| Daily ceiling | 100 candidate / 200 recruiter, server-enforced |

> **Copy decision:** the "like" control is a **check mark, not a heart**. On a product where a right-swipe sends someone's profile to an employer, a heart is the wrong promise — this is "yes, this one", not affection. Accessible name: `Interested`.

#### Reference implementation — theme switching

```css
:root { /* complete light palette */ }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* dark palette */ }
}
:root[data-theme="dark"] { /* dark palette, again */ }
```

1. **The dark palette is written twice.** The media query follows the OS; the attribute lets an explicit choice override it *in either direction*. Custom properties cannot share one block between the two without a preprocessor. `TC-DESIGN-003` parses both and fails on any drift — that test is why the duplication is safe.
2. **"Auto" removes the attribute** rather than setting it. `data-theme="system"` matches neither selector and would strand the page on light. The *absence* is what lets `prefers-color-scheme` decide.
3. **The anti-flash script is synchronous, in `<head>`.** It cannot be a React effect — effects run after hydration, several hundred ms and at least one paint too late.

```ts
const NO_FLASH = `(function(){try{
  var t=localStorage.getItem('jobsy-theme');
  if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}
}catch(e){}})()`;
```

`localStorage` *throws* rather than returning null in private mode, so every access sits inside a `try` — an unguarded read in a header component takes the header down over a colour preference. The choice is per-device and deliberately not synced.

#### Reference implementation — deck action bar

```tsx
<div className="actions">
  <button className="act no"      onClick={onPass} disabled={disabled} aria-label="Pass">
    <Icon name="close" size={24} />
  </button>
  <button className="act yes"     onClick={onLike} disabled={disabled} aria-label="Interested">
    <Icon name="check" size={26} />
  </button>
  <button className="act sm info" onClick={onInfo} disabled={disabled} aria-label="Details">
    <Icon name="info" size={18} />
  </button>
</div>
```

Every control is icon-only, so every one carries an `aria-label`. The icon set is 27 stroke SVGs on a 24px grid, all inheriting `currentColor`.

---

## 4. VISUAL IMPLEMENTATION & SCREENSHOT BLUEPRINTS

Captured from the running build at v2.52, 430×932 at 2×, seeded demo data. **Light left, dark right** in every pair. Full-size boards are in the published PDD artifact.

| # | View | What it exercises |
|---|---|---|
| 4.1 | Candidate deck (`/swipe`) | Card, match bar, confidence, matched/missing tags, action bar. The "yes" green is a *fill* token, distinct from the match-score text green. |
| 4.2 | Recruiter sourcing (`/recruiter`) | Tabs + count badge, `.ctxbar` job selector, dashed `.empty` that says what to do next |
| 4.3 | Profile editor (`/profile`) | Densest form; 11px uppercase `--dim2` labels, 44px inputs, theme control in header |
| 4.4 | Resume builder (`/resume`) | Long-form at 68ch / 1.65. Both `<select>` elements here previously had no accessible name — see §5 |
| 4.5 | Matches (`/matches`) | Row component; avatar palette worst pair 5.72:1 against initials |
| 4.6 | Applications (`/applied`) | Lifecycle badges; status carried by shape and label as well as hue |
| 4.7 | Job list (`/jobs`) | Recruiter's postings, lifecycle state, stat strip |

---

## 5. QA VERIFICATION MATRIX

### Automated — `npm run test:design` (67 tests, database-free, CI-safe)

| ID | Assertion | Count |
|---|---|---:|
| `TC-DESIGN-{light,dark}-*` | Every text pair ≥ 4.5:1, every non-text pair ≥ 3:1, per theme | 38 |
| `TC-DESIGN-003` | The two dark palette declarations have not drifted apart | 1 |
| `TC-DESIGN-010 … 014` | Line-height band; three weights; no fractional sizes; measure 60–75ch *and applied* | 5 |
| `TC-DESIGN-020, 021` | Space tokens on the 4px base; no raw pixel padding in layout rules | 2 |
| `TC-DESIGN-030 … 033` | 44px token; hit-area expander; form controls at the floor; landscape never below it | 4 |
| `TC-DESIGN-040 … 043` | Motion band; reduced-motion; high-contrast + forced-colors; shadow softness | 4 |
| `TC-DESIGN-050 … 054` | Anti-flash script in head; pinch-zoom; theme-color matches `--bg`; "auto" clears the attribute; storage wrapped | 5 |
| `TC-DESIGN-060, 061` | No hardcoded colour in a themed component; avatar palette legible against its own initials | 2 |

Related: `npm run test:hardening` (50) · `npm test` (1031 total)

### Independent — axe-core, WCAG 2.0/2.1 A + AA

| Views | Light | Dark |
|---|---|---|
| `/` `/login` `/reset` `/legal/privacy` `/legal/terms` | clean | clean |
| `/swipe` `/profile` `/matches` `/applied` `/resume` | clean | clean |

Three violations found and fixed during this pass:

| Rule | Impact | Where | Fix |
|---|---|---|---|
| `select-name` | critical | Availability unit, `/profile` | The visible "AVAILABLE IN" label belongs to the number field beside it, so the dropdown announced as an unnamed combo box. Given an `aria-label`. |
| `select-name` | critical | "Tailor to", `/resume` | `.lbl` is a styled `<span>`, not a `<label>`, so it named nothing. `aria-labelledby` points at the visible text so a wording change carries through. |
| `link-in-text-block` | serious | `/resume` | Inline link distinguished only by colour. Fixed systemically — all links in running text now underlined. |

> **Process note for testers.** The first authenticated audit run reported *five clean pages that were all the login screen* — the post-login redirect had not landed and every navigation bounced back. The script now asserts its location before running and reports a skip rather than a pass. **A green result whose setup you have not verified is worse than a red one.**

### Manual review checklist

| ID | Check | Expected |
|---|---|---|
| MAN-01 | OS dark, load any page cold | No white flash before paint |
| MAN-02 | Choose Light on a dark OS, reload | Light persists; explicit choice beats the OS |
| MAN-03 | Choose Auto after Dark | `data-theme` removed; follows the OS again |
| MAN-04 | Private / incognito window | Page renders; no console error from storage |
| MAN-05 | Tab through every control on `/swipe` | Visible ring on each; no trap; order matches visual order |
| MAN-06 | Reduce Motion on, force a match | No confetti; no fly-off; card still advances |
| MAN-07 | Pinch to zoom, iOS Safari | Zoom works to full browser range |
| MAN-08 | Landscape on a short phone | Action bar on screen; controls ≥ 44px |
| MAN-09 | Windows High Contrast | Every control retains a visible boundary |
| MAN-10 | VoiceOver / NVDA over the action bar | "Pass", "Interested", "Details" announced |
| MAN-11 | Browser zoom 200% | No horizontal page scroll; wide content scrolls in its own container |
| MAN-12 | Grayscale filter over `/applied` | Every status still distinguishable without hue |

---

## 6. KNOWN GAPS & OPEN ITEMS

Recorded rather than omitted. A specification that lists only what passes is not a specification.

| Item | Status | Detail |
|---|---|---|
| CSP `script-src` carries `'unsafe-inline'` | accepted | The Next App Router emits inline bootstrap and flight-data scripts on every server render, and the anti-flash script must run inline. A nonce-based policy means threading a per-request nonce through all of them — a rendering change, not a header edit. `frame-ancestors 'none'`, `base-uri`, `form-action`, `object-src` unaffected. |
| Automated audit covers 10 of 23 routes | partial | Admin, onboarding, chat, job composer and the public job page are not yet in the axe sweep |
| No visual regression baseline | **open** | Contrast and structure are tested; rendered appearance is not. A palette edit that passes every ratio can still look wrong. |
| Windows / macOS / iOS / Android controls | N/A | No such client exists. If one is built: certificate pinning, Keychain/Keystore session storage, screenshot suppression on the resume viewer, deep-link input validation. |
| 5 moderate npm advisories | accepted | All `esbuild` dev-server issues via `drizzle-kit`. devDependency, never deployed; fixing needs a major downgrade of the migration tooling. |
| Credential rotation | **blocking** | `AUTH_SECRET`, `CRON_SECRET`, database password and RapidAPI key all disclosed and unrotated; repository still public. Not design items, but both gate release. |

---

*Generated from source at v2.52. Every ratio in §2 is recomputed by `scripts/test-design.mts` on each run; every screenshot in §4 is from the running build. Where a number here disagrees with the code, the code is right and this document is stale — regenerate it.*
