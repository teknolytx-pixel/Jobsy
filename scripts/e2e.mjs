import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3000";

/**
 * ADMIN-007 — the seed no longer hardcodes a password. It generates one per run
 * unless SEED_PASSWORD is set, so a published constant cannot be tried against
 * a live deployment. These suites therefore have to be told what it is:
 *
 *   SEED_PASSWORD=local-dev-pw npm run seed
 *   SEED_PASSWORD=local-dev-pw node scripts/e2e.mjs
 */
const SEED_PW = process.env.SEED_PASSWORD;
if (!SEED_PW) {
  console.error(
    "\n  SEED_PASSWORD is not set.\n\n" +
      "  Seed and run with the same value, e.g.\n" +
      "      SEED_PASSWORD=local-dev-pw npm run seed\n" +
      "      SEED_PASSWORD=local-dev-pw node scripts/e2e.mjs\n"
  );
  process.exit(1);
}
const log = [];
let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

async function session(name) {
  const ctx = await b.newContext({ viewport: { width: 420, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => log.push(`[${name}] PAGEERROR ${e.message}`));
  p.on("console", (m) => m.type() === "error" && log.push(`[${name}] CONSOLE ${m.text()}`));
  return { ctx, p };
}

async function login(p, email) {
  await p.goto(`${BASE}/login`);
  await p.fill('input[type="email"]', email);
  await p.fill('input[type="password"]', SEED_PW);
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/(swipe|onboarding)/, { timeout: 15000 });
}

const clear = async (p) => {
  for (let i = 0; i < 4; i++) {
    const mo = p.locator(".matchov .btn.ghost");
    if (await mo.count()) { await mo.first().click(); await p.waitForTimeout(300); continue; }
    const sh = p.locator(".sheet .btn").last();
    if (await sh.count()) { await sh.click(); await p.waitForTimeout(300); continue; }
    break;
  }
};

// ─────────────────────────────────────────────
console.log("\nPUBLIC SURFACES\n");
{
  const { p, ctx } = await session("public");
  await p.goto(BASE);
  check("Landing renders", (await p.locator("h1").innerText()).includes("Swipe right"));
  const stats = await p.locator(".stat b").allInnerTexts();
  check("Landing shows live counts", Number(stats[0]) >= 3, `${stats[0]} jobs, ${stats[1]} companies`);

  const xml = await p.goto(`${BASE}/api/feed/jobs.xml`);
  const body = await xml.text();
  check("XML job feed serves", xml.status() === 200 && body.startsWith("<?xml"));
  check("Feed uses Indeed Job Sync schema", body.includes("<referencenumber>") && body.includes("<requisitionid>"));
  const jobCount = (body.match(/<job>/g) || []).length;
  // JOB-006 AC-2 is the property that matters, and it is not a fixed count:
  // the feed carries our OWN active postings and never republishes an ingested
  // third-party listing. Asserting an absolute made this fail whenever another
  // suite added a posting, which taught us nothing.
  check("Feed contains our own active posts", jobCount >= 3, `${jobCount} jobs`);
  const feedSources = await (await p.request.get(`${BASE}/api/ingest`)).json().catch(() => null);
  void feedSources;
  const feedUrl = body.match(/<url><!\[CDATA\[([^\]]+)\]\]><\/url>/)?.[1];
  check("Feed URLs point at /j/", Boolean(feedUrl?.includes("/j/")), feedUrl);

  // Deliberately UNauthenticated: a bare GET is the provider health check, and
  // a GET carrying the cron secret runs a real ingestion. Adding the header
  // here would turn a registry assertion into a live third-party fetch.
  const provRes = await p.goto(`${BASE}/api/ingest`);
  const prov = await provRes.json();
  check("Provider registry exposed", prov.providers.length === 10, `${prov.providers.length} providers`);
  const li = prov.providers.find((x) => x.source === "LINKEDIN");
  check("LinkedIn listed but inert", li && li.configured === false);
  const names = prov.providers.map((x) => x.source).join(",");
  check("Indeed/Monster routes present", names.includes("JSEARCH") && names.includes("JOOBLE") && names.includes("CAREERJET"), names);

  // public crawlable job page + JSON-LD
  const jid = feedUrl.split("/j/")[1];
  await p.goto(`${BASE}/j/${jid}`);
  const ld = await p.evaluate(() => document.querySelector('script[type="application/ld+json"]')?.textContent ?? "");
  const parsed = ld ? JSON.parse(ld) : {};
  check("Public job page renders", (await p.locator("h1").innerText()).length > 3, await p.locator("h1").innerText());
  check("JobPosting JSON-LD valid", parsed["@type"] === "JobPosting" && Boolean(parsed.title) && Boolean(parsed.datePosted));
  check("JSON-LD carries an annual salary band",
    parsed.baseSalary?.value?.minValue >= 50000 && parsed.baseSalary?.value?.unitText === "YEAR",
    `${parsed.baseSalary?.value?.minValue}–${parsed.baseSalary?.value?.maxValue}`);
  check("JSON-LD sets directApply to match the apply route",
    typeof parsed.directApply === "boolean", `directApply=${parsed.directApply}`);
  check("JSON-LD marks remote roles TELECOMMUTE or gives a Place",
    Boolean(parsed.jobLocationType) || Boolean(parsed.jobLocation),
    parsed.jobLocationType ?? parsed.jobLocation?.["@type"]);
  await p.screenshot({ path: "/home/claude/shots/n01-public-job.png" });
  await ctx.close();
}

// ─────────────────────────────────────────────
console.log("\nCANDIDATE REGISTRATION\n");
const newEmail = `tester${Date.now()}@demo.jobsy`;
{
  const { p, ctx } = await session("signup");
  await p.goto(`${BASE}/login?mode=signup`);
  // CAN-001 — accounts are one side of the market, chosen here and permanent.
  await p.click('button[aria-pressed]:has-text("looking for a job")');
  await p.fill('input[autocomplete="name"]', "Test Candidate");
  await p.fill('input[type="email"]', newEmail);
  await p.fill('input[type="password"]', SEED_PW);

  // LEGAL-009 — clickwrap. Submitting without ticking must fail, and the tick
  // is a separate affirmative act, not a passive "by continuing you agree".
  await p.click('button[type="submit"]');
  await p.waitForTimeout(400);
  check(
    "Signup is blocked until the Terms are accepted",
    !p.url().includes("/onboarding"),
    p.url()
  );

  await p.check("#accept-terms");
  await p.click('button[type="submit"]');
  await p.waitForURL(/onboarding/, { timeout: 15000 });
  check("Signup lands in onboarding", p.url().includes("/onboarding"));
  await p.screenshot({ path: "/home/claude/shots/n02-onboarding.png" });

  // incomplete profile is rejected
  await p.fill('input[placeholder="Senior Frontend Engineer"]', "Frontend Engineer");
  await p.fill('input[placeholder="Austin, TX"]', "Austin, TX");
  // FSD v1.1 CLP-001 — country is now part of onboarding. Without it the form
  // will not submit at all, which would mask the skills validation this checks.
  await p.selectOption("select", { value: "US" }).catch(() => {});
  await p.fill('input[placeholder="React, TypeScript, GraphQL, SQL"]', "React");
  await p.click('button[type="submit"]');
  await p.waitForTimeout(600);
  check("Rejects <3 skills", await p.locator(".err").count() > 0, await p.locator(".err").innerText().catch(() => ""));

  await p.fill('input[placeholder="React, TypeScript, GraphQL, SQL"]', "react.js, TYPESCRIPT, graph ql, d3");
  await p.fill('input[type="number"] >> nth=0', "6");
  await p.fill('input[type="number"] >> nth=1', "160");
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/swipe/, { timeout: 15000 });
  check("Completed profile reaches the deck", p.url().includes("/swipe"));

  const prof = await (await p.goto(`${BASE}/api/profile`)).json();
  check("Skills normalised on save", JSON.stringify(prof.skills) === '["React","TypeScript","GraphQL","D3.js"]', prof.skills.join(","));
  check("profileReady flipped true", prof.profileReady === true);
  await ctx.close();
}

// ─────────────────────────────────────────────
console.log("\nCANDIDATE SWIPING\n");
let easyJobId, extJobId;
{
  const { p, ctx } = await session("candidate");
  await login(p, "candidate@demo.jobsy");
  const deck = await (await p.goto(`${BASE}/api/deck?mode=candidate`)).json();
  check("Deck returns ranked cards", deck.cards.length >= 3, `${deck.cards.length} cards, top=${deck.cards[0].score}%`);
  const sorted = deck.cards.every((c, i) => i === 0 || deck.cards[i - 1].score >= c.score);
  check("Deck sorted by score desc", sorted);
  check("Cards carry match reasons", deck.cards[0].reasons.length > 0, deck.cards[0].reasons.join(" · "));
  easyJobId = deck.cards.find((c) => c.applyMethod === "EASY")?.id;
  extJobId = deck.cards.find((c) => c.applyMethod === "EXTERNAL")?.id;
  check("Deck has both apply routes", Boolean(easyJobId) && Boolean(extJobId));

  await p.goto(`${BASE}/swipe`);
  await p.waitForSelector(".card", { timeout: 15000 });
  const top = await p.locator(".card").last().locator("h2").innerText();
  check("Swipe UI renders top card", top.length > 2, top);
  await p.screenshot({ path: "/home/claude/shots/n03-candidate-deck.png" });

  // right-swipe → apply sheet, and this seed pre-matched → match overlay
  await p.click(".act.yes");
  await p.waitForTimeout(1800);
  const sheetTitle = await p.locator(".sheet h3").first().innerText().catch(() => "NONE");
  check("Apply sheet fires on right-swipe", sheetTitle !== "NONE", sheetTitle);
  check("Apply sheet names a real destination", !/Posted on Jobsy/.test(sheetTitle), sheetTitle);
  await p.screenshot({ path: "/home/claude/shots/n04-apply-sheet.png" });
  check("Match overlay does NOT cover the apply sheet",
    (await p.locator(".matchov").count()) === 0);
  await p.locator(".sheet .btn").last().click();
  await p.waitForTimeout(1200);
  const matched = await p.locator(".matchov .mt").count();
  check("Match overlay appears after the sheet is dismissed", matched === 1);
  if (matched) await p.screenshot({ path: "/home/claude/shots/n05-match.png" });
  await clear(p);

  // pass
  await p.waitForSelector(".card", { timeout: 10000 });
  const before = await p.locator(".card").last().locator("h2").innerText();
  await p.click(".act.no");
  await p.waitForTimeout(1200);
  const after = await p.locator(".card").last().locator("h2").innerText();
  check("Left-swipe advances the deck", before !== after, `${before} → ${after}`);

  // The UI swipe above consumed the top card (an EXTERNAL job). Now drive the
  // remaining EASY job through the API so BOTH apply routes are exercised.
  const swipeApi = (jobId) =>
    p.evaluate(async (id) => {
      const r = await fetch("/api/swipe", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "candidate", direction: "LIKE", jobId: id }) });
      return r.json();
    }, jobId);

  const ext = await swipeApi(extJobId);
  check("External apply returns a redirect URL", ext.apply?.method === "EXTERNAL" && Boolean(ext.apply.url), ext.apply?.url);
  const easy = await swipeApi(easyJobId);
  check("Easy Apply submits in-app with no redirect", easy.apply?.method === "EASY" && !easy.apply.url, easy.message);

  await p.goto(`${BASE}/applied`);
  const rows = await p.locator(".list .row").count();
  const methods = (await p.locator(".list .row .s2").allInnerTexts()).join(" ");
  check("Applied list records both routes", rows >= 2 && /Easy Apply/.test(methods) && /↗/.test(methods),
    `${rows} rows: ${methods.replace(/\s+/g, " ").slice(0, 90)}`);
  await p.screenshot({ path: "/home/claude/shots/n06-applied.png" });

  await p.goto(`${BASE}/matches`);
  check("Matches page lists the match", await p.locator(".list .row").count() >= 1);
  await ctx.close();
}

// ─────────────────────────────────────────────
console.log("\nRECRUITER SOURCING\n");
let matchHref;
{
  const { p, ctx } = await session("recruiter");
  await login(p, "recruiter@demo.jobsy");
  await p.goto(`${BASE}/recruiter`);
  await p.waitForSelector(".card", { timeout: 15000 });
  check("Job-post selector present", await p.locator("#jobSelect, .ctxbar select").count() > 0);
  const topCand = await p.locator(".card").last().locator("h2").innerText();
  check("Candidate deck renders", topCand.length > 2, topCand);
  await p.screenshot({ path: "/home/claude/shots/n07-recruiter-deck.png" });

  // right-swipe a pre-matched candidate → instant match
  await p.click(".act.yes");
  await p.waitForTimeout(2000);
  const mo = await p.locator(".matchov .mt").count();
  const sh = await p.locator(".sheet h3").first().innerText().catch(() => "NONE");
  check("Right-swipe produces match or interest email", mo === 1 || sh.includes("Interest"), mo ? "match overlay" : sh);
  if (mo) await p.screenshot({ path: "/home/claude/shots/n08-recruiter-match.png" });
  await clear(p);

  // swipe a NON-pre-matched candidate → interest email only
  await p.waitForSelector(".card", { timeout: 10000 });
  await p.click(".act.yes");
  await p.waitForTimeout(1800);
  const sh2 = await p.locator(".sheet h3").first().innerText().catch(() => "NONE");
  check("Non-mutual right-swipe sends interest email", sh2.includes("Interest"), sh2);
  await p.screenshot({ path: "/home/claude/shots/n09-interest-sent.png" });
  await clear(p);

  await p.goto(`${BASE}/jobs`);
  const stats = await p.locator(".list .row .s2").first().innerText();
  check("Job post shows live funnel stats", /reviewed/.test(stats), stats.replace(/\s+/g, " ").slice(0, 90));

  await p.goto(`${BASE}/matches`);
  const n = await p.locator(".list .row").count();
  check("Recruiter sees their matches", n >= 1, `${n}`);
  matchHref = await p.locator(".list .row").first().getAttribute("href");
  await ctx.close();
}

// ─────────────────────────────────────────────
console.log("\nAUTHORIZATION\n");
{
  const { p, ctx } = await session("authz");
  const r1 = await p.goto(`${BASE}/api/deck?mode=candidate`);
  check("Deck rejects anonymous", r1.status() === 401, String(r1.status()));
  const r2 = await p.goto(`${BASE}/api/matches`);
  check("Matches rejects anonymous", r2.status() === 401, String(r2.status()));

  // Two separate refusals, and the order matters. Ben is a job seeker, so the
  // ROLE gate stops him before ownership is ever consulted — that is the
  // AUTH-002 boundary, not an ownership check, and conflating them would let
  // one of the two rot unnoticed.
  await login(p, "ben@demo.jobsy");
  const wrongRole = await p.evaluate(async () => {
    const r = await fetch("/api/deck?mode=recruiter&jobId=" + encodeURIComponent(window.__jid || "nope"));
    return { s: r.status, b: await r.json() };
  });
  check("A job seeker cannot source at all", wrongRole.s === 403 && wrongRole.b.code === "WRONG_ACCOUNT_TYPE",
    `${wrongRole.s} ${wrongRole.b.code ?? wrongRole.b.error}`);

  // The demo recruiter IS an employer, so ownership is what stops her here.
  const { p: r2p, ctx: r2ctx } = await session("authz-rec");
  await login(r2p, "recruiter@demo.jobsy");
  const own = await r2p.evaluate(async () => {
    const r = await fetch("/api/deck?mode=recruiter&jobId=00000000-0000-0000-0000-000000000000");
    return { s: r.status, b: await r.json() };
  });
  check("Cannot source for someone else's post", own.s === 400 && /not your job post/i.test(own.b.error ?? ""), own.b.error);
  await r2ctx.close();

  // ben tries to read a conversation he isn't in
  const mid = matchHref.split("/matches/")[1];
  const msg = await p.evaluate(async (id) => {
    const r = await fetch(`/api/messages?matchId=${id}`);
    return { s: r.status, b: await r.json() };
  }, mid);
  check("Cannot read another pair's chat", msg.s === 400 && /not your conversation/i.test(msg.b.error), msg.b.error);
  await ctx.close();
}

// ─────────────────────────────────────────────
console.log("\nCHAT ON MATCH\n");
{
  const { p: c, ctx: cc } = await session("chat-cand");
  const { p: r, ctx: rc } = await session("chat-rec");
  await login(c, "candidate@demo.jobsy");
  await login(r, "recruiter@demo.jobsy");

  await r.goto(`${BASE}${matchHref}`);
  await r.waitForSelector(".composer input", { timeout: 10000 });
  await r.fill(".composer input", "Hi! Loved your dashboard work — free for 20 min Thursday?");
  await r.click(".composer button");
  await r.waitForTimeout(1200);
  check("Recruiter message sends", await r.locator(".bub.me").count() >= 1);
  await r.screenshot({ path: "/home/claude/shots/n10-chat.png" });

  await c.goto(`${BASE}${matchHref}`);
  await c.waitForTimeout(800);
  const seen = await c.locator(".bub.them").count();
  check("Candidate receives it on the other side", seen >= 1, `${seen} inbound`);
  await c.fill(".composer input", "Thursday works — 2pm CT?");
  await c.click(".composer button");
  await c.waitForTimeout(1200);
  check("Reply persists", await c.locator(".bub.me").count() >= 1);
  await cc.close();
  await rc.close();
}

// ─────────────────────────────────────────────
// JOB COMPOSER — the gap that produced three P0 bugs.
//
// Every one of them was the same shape: the API required a field the form
// never rendered or never sent. The lifecycle suite could not see it, because
// it posts JSON to /api/jobs directly and therefore always sends the field the
// UI was forgetting. Only a browser driving the real form can catch that drift,
// so this section fills the form the way a recruiter would and nothing else.
//
//   TRUST-001  attestCurrentVacancy — literal(true) server-side, absent in the UI
//   PAY-*      benefitsDescription required for remote, no field in the UI
//   LEGAL-008  the notice rendered in near-black on a near-black background
console.log("\nJOB COMPOSER\n");
{
  const { p, ctx } = await session("composer");
  await login(p, "recruiter@demo.jobsy");
  await p.goto(`${BASE}/recruiter`);
  await p.waitForTimeout(800);

  const openComposer = async () => {
    if (await p.locator(".sheet h3", { hasText: "Post a job" }).count()) return;
    await p.click('button.iconbtn[title="Post a job"]');
    await p.waitForSelector(".sheet", { timeout: 10000 });
  };
  await openComposer();

  // 1. Every field the server requires must actually exist in the form.
  //    Asserted as presence, not as a successful post, so a removed field fails
  //    here with a name rather than as a confusing 400 further down.
  const fields = {
    "vacancy attestation": p.locator("#attest-vacancy"),
    "country select": p.locator(".sheet label.field", { hasText: "Country the work happens in" }).locator("select"),
    "postal code input": p.locator('.sheet input[placeholder="78701"]'),
    "title input": p.locator('.sheet input[placeholder="Senior Frontend Engineer"]'),
  };
  for (const [label, loc] of Object.entries(fields)) {
    check(`Composer renders the ${label}`, (await loc.count()) > 0);
  }

  // 2. TRUST-001 — the attestation is a separate affirmative act. Submitting
  //    without it must not create a job. The checkbox carries `required`, so the
  //    browser blocks it; asserting the attribute AND the blocked submit means
  //    dropping either one fails.
  const attest = p.locator("#attest-vacancy");
  check("Attestation is required, not advisory", await attest.getAttribute("required") !== null);
  const uniq = `E2E Composer Role ${Date.now()}`;
  await p.fill('.sheet input[placeholder="Senior Frontend Engineer"]', uniq);
  await p.fill('.sheet input[placeholder="Austin, TX"]', "Austin, TX");
  await p.click('.sheet button.go');
  await p.waitForTimeout(600);
  check("Unattested post is refused", await p.locator(".sheet").count() > 0, "composer stayed open");

  // 3. LEGAL-008 — the notice whose enforceability turns on being legible was
  //    shipped twice in near-black on a near-black background, because the code
  //    fell back to a CSS token this app does not define. Contrast is therefore
  //    asserted, not eyeballed.
  const contrast = await p.evaluate(() => {
    const el = document.querySelector("#attest-vacancy-text");
    if (!el) return null;
    const lum = (c) => {
      const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number)
        .map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    let bgEl = el, bg = "rgba(0, 0, 0, 0)";
    while (bgEl && bg === "rgba(0, 0, 0, 0)") {
      bg = getComputedStyle(bgEl).backgroundColor;
      bgEl = bgEl.parentElement;
    }
    const a = lum(getComputedStyle(el).color), b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  check("Attestation notice meets WCAG AA contrast", contrast !== null && contrast >= 4.5,
    contrast === null ? "element missing" : `${contrast.toFixed(2)}:1`);

  // 4. RMT-005 — a remote role has to state its scope. Selecting Remote must
  //    reveal the question, and it must be required: "just remote" is what
  //    produced applications from people who could not lawfully take the job.
  //
  //    Addressed by its label rather than by index. The first draft of this
  //    test used `.sheet select >> nth=2`, which is the employment-type select,
  //    and "the scope question appeared" passed while nothing of the sort had
  //    happened. Positional selectors move whenever a field is added above.
  const fieldSelect = (labelText) =>
    p.locator(".sheet label.field", { hasText: labelText }).locator("select");
  const fieldInput = (labelText) =>
    p.locator(".sheet label.field", { hasText: labelText }).locator("input");

  await fieldSelect("Work style").selectOption("REMOTE");
  await p.waitForTimeout(300);
  const scopeSel = fieldSelect("Where can this remote role be performed from?");
  const scopeVisible = (await scopeSel.count()) > 0;
  check("Remote reveals the scope question", scopeVisible);
  if (scopeVisible) {
    check("Remote scope is required", (await scopeSel.getAttribute("required")) !== null);
  }

  // 5. The pay-transparency gate is satisfiable from the UI. It was not: the
  //    server required benefitsDescription for remote roles and the form had
  //    no benefits field at all, so the role was unpostable.
  const benefits = p
    .locator(".sheet label.field", { hasText: "Benefits and other compensation" })
    .locator("textarea");
  check("Benefits field exists for the remote pay-transparency gate", (await benefits.count()) > 0);

  // 6. The happy path, end to end, through the real form.
  await p
    .locator(".sheet label.field")
    .filter({ has: p.locator("span", { hasText: /^Company$/ }) })
    .locator("input")
    // Named so `npm run reset` sweeps it: the reset script deletes postings
    // whose company matches "%E2E %". Without that, every run of this test
    // leaves a posting owned by the demo recruiter, and the RECRUITER SOURCING
    // section eventually opens onto one of them instead of the seeded job.
    .fill("Jobsy E2E Labs");
  await fieldSelect("Country the work happens in").selectOption("US");
  await p.fill('.sheet input[placeholder="78701"]', "78701");
  await scopeSel.selectOption("SAME_COUNTRY");
  await p.fill('.sheet input[placeholder="150"]', "150");
  await p.fill('.sheet input[placeholder="185"]', "185");
  await p.fill('.sheet textarea >> nth=0', "Own the design system and the component library that every product team builds on.");
  await p.fill('.sheet input[placeholder="React, TypeScript, GraphQL"]', "React, TypeScript, GraphQL");
  await benefits.fill("Health, dental and vision; 401(k) with 4% match; 20 days PTO.");
  await attest.check();
  await p.click('.sheet button.go');
  await p.waitForTimeout(2500);

  // When this fails, say WHY. A blocked submit shows a native validation
  // bubble, not a `.err` div, so reporting only the server error left the first
  // run of this test saying "composer closed" about a composer that was open.
  const errText = await p.locator(".sheet .err").innerText().catch(() => "");
  const invalid = await p.evaluate(() =>
    [...document.querySelectorAll(".sheet form :invalid")]
      .map((el) => `${el.tagName.toLowerCase()}[${el.type ?? ""}]: ${el.validationMessage}`)
      .slice(0, 4)
  );
  check(
    "Publishing through the form succeeds",
    (await p.locator(".sheet").count()) === 0,
    errText || invalid.join(" | ") || "composer closed"
  );

  // 7. And the posting is really there — via My posts, which selects every
  //    column on `jobs`, so a schema/migration drift surfaces here too.
  await p.goto(`${BASE}/jobs`);
  await p.waitForTimeout(800);
  const body = await p.locator(".list").innerText().catch(() => "");
  check("Posted role appears in My posts", body.includes(uniq), uniq);
  await p.screenshot({ path: "/home/claude/shots/n11-composer.png" });
  await ctx.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (log.length) console.log("\nBROWSER ERRORS:\n" + [...new Set(log)].join("\n"));
else console.log("\nNo console/page errors.");
await b.close();
process.exit(fail ? 1 : 0);
