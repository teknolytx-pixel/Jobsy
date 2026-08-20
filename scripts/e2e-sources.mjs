/**
 * Live end-to-end test of the connect-a-company flow, against a running server.
 * Uses the manual (kind + token) path plus a stub HTTP origin so it works
 * without reaching real ATS endpoints.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";

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
let pass = 0, fail = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "✓" : "✗"} ${l}${d ? ` — ${d}` : ""}`); ok ? pass++ : fail++; };

// A stand-in "company careers site" the app can actually fetch: it publishes
// schema.org JobPosting data, exactly like a real bespoke careers page.
const JOBS = [
  { t: "Staff Platform Engineer", d: "Kubernetes, Go, Terraform and AWS. Hybrid in Austin.", min: 170, max: 210, id: "SC-1" },
  { t: "Senior Data Engineer", d: "dbt, Snowflake, SQL and Python modelling. Fully remote.", min: 150, max: 185, id: "SC-2" },
];
const ld = JOBS.map((j) => ({
  "@context": "https://schema.org/", "@type": "JobPosting", title: j.t, description: `<p>${j.d}</p>`,
  identifier: { "@type": "PropertyValue", name: "StubCo", value: j.id },
  datePosted: "2026-08-15", employmentType: "FULL_TIME",
  hiringOrganization: { "@type": "Organization", name: "StubCo", url: "http://127.0.0.1:4310" },
  jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Austin", addressRegion: "TX", addressCountry: "US" } },
  baseSalary: { "@type": "MonetaryAmount", currency: "USD", value: { "@type": "QuantitativeValue", minValue: j.min * 1000, maxValue: j.max * 1000, unitText: "YEAR" } },
  url: `http://127.0.0.1:4310/jobs/${j.id}`,
}));

const stub = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`<!doctype html><html><head><title>StubCo Careers</title>
    <meta property="og:site_name" content="StubCo">
    <script type="application/ld+json">${JSON.stringify(ld)}</script>
    </head><body><h1>Careers at StubCo</h1></body></html>`);
});
await new Promise((r) => stub.listen(4310, "127.0.0.1", r));

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 420, height: 900 } });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(`PAGEERROR ${e.message}`));

// sign in as the recruiter
await p.goto(`${BASE}/login`);
await p.fill('input[type="email"]', "recruiter@demo.jobsy");
await p.fill('input[type="password"]', SEED_PW);
await p.click('button[type="submit"]');
await p.waitForURL(/\/(swipe|onboarding)/, { timeout: 15000 });

console.log("\nCONNECT A COMPANY\n");

await p.goto(`${BASE}/sources`);
check("Sources page renders", (await p.locator("h1").innerText()).includes("Connected companies"));
await p.screenshot({ path: "/home/claude/shots/s01-sources-empty.png" });

// paste the stub careers URL — exercises detection → save → immediate pull
await p.fill('.field input', "http://127.0.0.1:4310/careers");
await p.click('button[type="submit"]');
await p.waitForSelector(".ok, .err", { timeout: 45000 });

const okText = await p.locator(".ok").innerText().catch(() => null);
const errText = await p.locator(".err").innerText().catch(() => null);
check("Detection + first pull succeeded", Boolean(okText), okText ?? errText);
check("It explains HOW it detected the site", /structured data|JobPosting/i.test(okText ?? ""), (okText ?? "").slice(0, 110));
check("It imported the jobs immediately", /Imported 2 jobs/.test(okText ?? ""), (okText ?? "").match(/Imported \d+ jobs?/)?.[0]);
await p.screenshot({ path: "/home/claude/shots/s02-connected.png" });

const rows = await p.locator(".list .row").count();
check("Company appears in the connected list", rows === 1, `${rows} rows`);
const rowText = (await p.locator(".list .row").first().innerText()).replace(/\s+/g, " ");
check("Row shows company, connector and counts", /StubCo/.test(rowText) && /2 live/.test(rowText), rowText.slice(0, 110));
const badge = await p.locator(".list .row .badge").first().innerText();
check("Row is marked Live", /live/i.test(badge), badge);

console.log("\nRE-SYNC IS IDEMPOTENT\n");

await p.locator('.list .row button:has-text("Sync now")').click();
await p.waitForSelector(".toast", { timeout: 45000 });
const toast = await p.locator(".toast").innerText();
check("Manual sync runs", /StubCo/.test(toast), toast);
check("Re-sync creates no duplicates", /0 new, 2 refreshed/.test(toast), toast);

const api = await (await p.goto(`${BASE}/api/sources`)).json();
check("API reports the source", api.sources.length === 1 && api.sources[0].company === "StubCo", api.sources[0]?.company);
check("API reports totalImported", api.sources[0].totalImported === 2, String(api.sources[0]?.totalImported));
check("API lists all 11 supported connectors", api.supportedKinds.length === 11, api.supportedKinds.join(","));

console.log("\nPULLED JOBS REACH THE SWIPE DECK\n");

// swap to a candidate account to prove the pulled jobs are swipeable
const logout = async () => {
  await p.goto(`${BASE}/sources`);
  await p.evaluate(() => fetch("/api/auth/logout", { method: "POST" }));
};
await logout();
await p.goto(`${BASE}/login`);
await p.fill('input[type="email"]', "candidate@demo.jobsy");
await p.fill('input[type="password"]', SEED_PW);
await p.click('button[type="submit"]');
await p.waitForURL(/\/swipe/, { timeout: 15000 });

const cdeck = await (await p.goto(`${BASE}/api/deck?mode=candidate`)).json();
const stubCards = cdeck.cards.filter((c) => c.company === "StubCo");
check("Ingested jobs are swipeable", stubCards.length === 2, `${stubCards.length} StubCo cards of ${cdeck.cards.length}`);
check("Ingested jobs carry a fit score", stubCards.every((c) => c.score > 0), stubCards.map((c) => `${c.title} ${c.score}%`).join(" | "));
check("Ingested jobs are EXTERNAL apply", stubCards.every((c) => c.applyMethod === "EXTERNAL"));
check("Skills were mined from the description",
  stubCards.some((c) => c.skills.includes("Kubernetes")) && stubCards.some((c) => c.skills.includes("Snowflake")),
  stubCards.map((c) => c.skills.join(",")).join(" | "));
check("Salary parsed from JSON-LD", stubCards.every((c) => c.salaryMin > 0), stubCards.map((c) => `$${c.salaryMin}k`).join(","));

await p.goto(`${BASE}/swipe`);
await p.waitForSelector(".card", { timeout: 15000 });
await p.screenshot({ path: "/home/claude/shots/s03-ingested-card.png" });

console.log("\nPAUSE / DISCONNECT\n");

await logout();
await p.goto(`${BASE}/login`);
await p.fill('input[type="email"]', "recruiter@demo.jobsy");
await p.fill('input[type="password"]', SEED_PW);
await p.click('button[type="submit"]');
await p.waitForURL(/\/(swipe|onboarding)/, { timeout: 15000 });
await p.goto(`${BASE}/sources`);
await p.locator('.list .row button:has-text("Pause")').click();
await p.waitForTimeout(1500);
const pausedBadge = await p.locator(".list .row .badge").first().innerText();
check("Pause flips the badge", /paused/i.test(pausedBadge), pausedBadge);

await p.locator('.list .row button:has-text("Disconnect")').click();
await p.waitForTimeout(1500);
check("Disconnect removes the source", (await p.locator(".list .row").count()) === 0);

const stillThere = await p.evaluate(async () => {
  const r = await fetch("/api/ingest");
  const d = await r.json();
  return d.connectedCompanies.length;
});
check("Disconnect clears the connector", stillThere === 0, `${stillThere} connectors`);

console.log(`\n${pass} passed, ${fail} failed`);
if (errs.length) console.log("\nPAGE ERRORS:\n" + [...new Set(errs)].join("\n"));
await b.close();
stub.close();
process.exit(fail ? 1 : 0);
