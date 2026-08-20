# 🔥 Jobsy

**Two-sided swipe hiring.** Candidates swipe jobs. Recruiters swipe candidates. A mutual right-swipe is a match, and the conversation opens instantly.

Next.js 15 · React 19 · TypeScript · Postgres · Drizzle ORM

---

## Quick start

```bash
cp .env.example .env          # only DATABASE_URL + AUTH_SECRET are required
docker compose up -d          # Postgres on :5432  (or point DATABASE_URL at Neon)
npm install
npm run db:push               # create the schema
npm run seed                  # demo accounts + 3 job posts + pre-seeded swipes
npm run ingest                # pull real live jobs (optional, works with no keys)
npm run dev
```

Open http://localhost:3000

| Login | Password |
|---|---|
| `candidate@demo.jobsy` | `password123` |
| `recruiter@demo.jobsy` | `password123` |

**See a match in 5 seconds:**
- As the **candidate**, right-swipe *Product Designer* or *Data Visualization Engineer* — the recruiter already swiped right on you.
- As the **recruiter** on *Senior Frontend Engineer*, right-swipe **Amara Osei** or **Diego Marchetti** — they already swiped right on the job.

---

## Read this first: what LinkedIn will and won't give you

You asked to pull jobs and candidates from LinkedIn on a premium plan. **That is not purchasable.** Verified against LinkedIn's own developer documentation:

| LinkedIn product | Status | What it would give you |
|---|---|---|
| **Sign In with LinkedIn (OIDC)** | ✅ **Self-serve, instant** | `sub, name, email, picture` — nothing else |
| Job Posting API | ❌ *"We are currently not accepting new partnerships"* | Post jobs to LinkedIn |
| Recruiter System Connect | ❌ Enterprise partnership; requires prior Job Posting API work | ATS↔Recruiter sync. **Not** candidate search |
| Apply Connect | ❌ Requires your *customer* to hold a Recruiter Corporate licence | Receive LinkedIn applicants |
| Sales Navigator (SNAP) | ❌ Closed to new partners | — |
| LinkedIn Premium / Recruiter Lite | ❌ **Zero API access** — these are UI seats | — |

**Do not solve this by scraping.** LinkedIn sued Proxycurl — the largest LinkedIn data API, ~$10M ARR — in January 2025. It shut down rather than litigate against Microsoft. Scraped profiles would also make your own GDPR/CCPA position indefensible, since those candidates never consented to being in your database.

**So Jobsy uses LinkedIn for what it actually offers:** identity and profile import (`src/lib/auth.ts`). Candidates sign in with LinkedIn, get a **Verified** badge on their card, and skip typing their name and email. Job inventory comes from sources that *want* developer traffic.

`src/lib/providers/linkedin.ts` is a complete, deliberately inert adapter. If you ever get partner approval, implement one method and add it to the registry — nothing else in the codebase knows or cares where a job came from.

---

## Where the jobs come from

Ten providers behind one `JobProvider` interface. Each degrades independently: a provider without credentials is skipped, and a board that errors is logged to `ingest_runs` without aborting the run.

### Tier 1 — direct ATS boards (no key, no signup, highest quality)
| Provider | Endpoint |
|---|---|
| **Greenhouse** | `boards-api.greenhouse.io/v1/boards/{token}/jobs` |
| **Lever** | `api.lever.co/v0/postings/{company}` |
| **Ashby** | `api.ashbyhq.com/posting-api/job-board/{name}` |

These exist *specifically* so aggregators can syndicate a company's roles. Set `GREENHOUSE_BOARDS="stripe,figma,databricks"` and you have real jobs immediately.

### Tier 2 — keyless public boards (on by default)
**Remotive** (remote tech roles) and **Arbeitnow** (EU + visa sponsorship). Zero configuration.

### Tier 3 — how Indeed and Monster reach Jobsy
Neither offers a self-serve search API any more — Indeed retired its Publisher API to new signups, and Monster's is enterprise-only. Both are indexed by licensed aggregators, which is the legitimate route in:

| Provider | Covers | Key |
|---|---|---|
| **JSearch** (RapidAPI) | Google for Jobs index: **Indeed, LinkedIn, Glassdoor, ZipRecruiter, Monster** | `RAPIDAPI_KEY` |
| **Jooble** | **Indeed, Monster**, CareerBuilder | `JOOBLE_API_KEY` (free, on request) |
| **Careerjet** | Multi-board, 90+ countries | `CAREERJET_AFFID` (free, instant) |
| **Adzuna** | 16 countries, strong UK/EU | `ADZUNA_APP_ID` + `_KEY` (free, instant) |

Every ingested job keeps its **original apply URL** and records the true origin in `jobs.publisher`, so a right-swipe on an Indeed-sourced role sends the candidate to Indeed to finish applying — exactly the `EXTERNAL` route the product already models. The card shows *"via Indeed"*.

```bash
npm run ingest        # one-off
# on Vercel, vercel.json already schedules POST /api/ingest every 6 hours
```

---

## Getting jobs in automatically

Two mechanisms, deliberately separate. **Discovery** answers *"what jobs exist out there?"*; **Connected companies** answers *"what is this specific employer hiring for, right now?"* — and keeps answering it. `/api/ingest` runs both; Vercel Cron fires it every 6 hours.

### Connected companies — the one that matters

Go to **/sources**, paste a careers URL, done. Jobsy detects how that site is built and pulls every job that employer has posted — then keeps pulling forever, with no further action from anyone.

```
POST /api/sources  { "url": "https://acme.com/careers" }
```

Detection runs four strategies in order:

| # | Strategy | Catches |
|---|---|---|
| 1 | **URL fingerprint** | The pasted URL *is* an ATS board (`boards.greenhouse.io/acme`, `acme.recruitee.com`, `acme.wd5.myworkdayjobs.com/Careers`) |
| 2 | **HTML fingerprint** | A company-branded careers page that *embeds* an ATS — the board token is in an iframe, script tag or link |
| 3 | **JSON-LD** | No known ATS, but the page publishes schema.org `JobPosting` data — which every site wanting to appear in Google for Jobs must do |
| 4 | **Feed autodiscovery** | A declared `<link rel="alternate">` XML feed, or one at a conventional path |

Nine ATS connectors, all public and unauthenticated — **Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee, Personio, BambooHR, Workday** — plus the two universal fallbacks. Between them that's the overwhelming majority of corporate career sites, because almost nobody hand-builds one any more.

If all four strategies miss, Jobsy says so plainly and offers three manual routes rather than guessing: click through to the page that actually lists jobs, name the ATS and slug directly, or ask the employer for the XML feed they already give Indeed — Jobsy reads that format.

Each source tracks its own status. Three consecutive failures auto-disable it so a broken endpoint isn't hammered, and the last error is shown on the card.

```
GET    /api/sources           list connected companies + status
POST   /api/sources           connect by URL, or by { kind, token }
POST   /api/sources/{id}      sync this company now
PATCH  /api/sources/{id}      { enabled } — pause / resume
DELETE /api/sources/{id}      disconnect (already-imported jobs stay live)
```

### "A recruiter posted on Indeed" — the honest answer

You cannot subscribe to one employer's Indeed postings. Indeed retired its Publisher API to new signups and its Job Search API is partner-only, so there is no per-company Indeed feed to point at. Three real routes instead, best first:

1. **Connect the company's own careers page** (above). Indeed is downstream of the employer's ATS — that job was in Greenhouse or Workday before it was ever on Indeed. Going to the source gets you the job *earlier*, with a better description and a working apply link.
2. **Aggregator sweep.** JSearch, Jooble and Careerjet all license Indeed/Monster inventory. Query-based rather than company-based, so it's for discovery, not for tracking one employer.
3. **Ask the employer for their feed URL.** Every company posting to Indeed at volume already maintains an XML feed. That same URL works in Jobsy unchanged — paste it and Jobsy detects it as `XML_FEED`.

### On Workday specifically

Eight of the nine ATS endpoints are documented and exist so job boards can syndicate. Workday's `wday/cxs` endpoint is different: it's what the company's own careers page calls to render itself — public and unauthenticated, but undocumented. Jobsy only hits it for a company someone has explicitly connected, never by crawling at large, and it's the adapter most likely to need maintenance.

---

## Posting your own jobs — and getting them onto other boards

Recruiters post natively in-app (**＋** in the Recruiter tab). Each post carries the apply route its author chose:

- **⚡ Easy Apply** — the candidate's profile is emailed to the poster the instant they swipe right. No forms.
- **↗ External** — the candidate is handed to *your* posting on LinkedIn, Indeed, Greenhouse or your careers page. The swipe is recorded either way.

**Outbound distribution** pushes those posts back out to the wider market:

| Surface | What it does |
|---|---|
| `GET /api/feed/jobs.xml` | Indeed **Job Sync XML** schema — also accepted by Monster, ZipRecruiter, Glassdoor, Talroo and Jooble. Hand each board the URL once; they crawl on their own schedule. |
| `GET /j/{id}` | Public crawlable job page carrying **schema.org `JobPosting` JSON-LD** → gets the role into **Google for Jobs**, which most aggregators then index. Free distribution. |

Only `source = JOBSY` jobs appear in the feed — Jobsy never re-syndicates another board's inventory.

⚠️ **One caveat, so it doesn't surprise you:** Indeed ended free visibility for single-source XML feeds in 2026. The feed is still the correct and required mechanism and works as-is for the other boards, but expect to sponsor jobs for real volume on Indeed specifically.

---

## Candidate registration

Two paths, both landing in the same place:

1. **Email + password** — `/login?mode=signup`
2. **Continue with LinkedIn** — appears automatically once `LINKEDIN_CLIENT_ID` / `_SECRET` are set

Both route to `/onboarding`, which collects the things LinkedIn's OIDC scope *won't* give you: headline, location, work-style preference, years of experience, salary target, availability, and skills. A profile needs a headline, a location and **3+ skills** before `profileReady` flips true — below that the candidate can't swipe and won't appear in any recruiter's deck.

Skills are normalised on save: `"react.js, TYPESCRIPT, graph ql, d3"` → `["React", "TypeScript", "GraphQL", "D3.js"]`, so the match engine compares like with like.

---

## The match engine

`src/lib/match.ts` — one symmetric function, two entry points. A 78% means the same thing to a candidate looking at a job as it does to a recruiter looking at a candidate.

| Signal | Weight | Detail |
|---|---|---|
| Skills | 55 | Canonical overlap, weighted by what the job needs |
| Location | 15 | Remote compatibility first, then metro match |
| Compensation | 20 | Does the band clear the candidate's target |
| Seniority | 10 | Years vs level, penalised in **both** directions |

Every card shows the score, which skills matched, which are missing, and a plain-English reason: *"D3.js, React, TypeScript all line up · Fully remote · Band clears your $160k target"*.

`src/lib/skills.ts` holds the taxonomy — ~65 canonical skills with aliases, used both to normalise user input and to mine skills out of unstructured job descriptions.

---

## The match engine

`src/lib/matching/` — three files: `taxonomy.ts` (skill relatedness + role families), `requirements.ts` (parses a JD into must-have vs nice-to-have), `engine.ts` (the scorer).

### How a score is built

| Feature | Weight | Notes |
|---|---|---|
| Required skills | 40 | Weighted by position in the posting; partial credit for adjacent skills |
| Preferred skills | 12 | The "nice to have" block. If a posting has none, this weight moves to required rather than being given away |
| Experience | 18 | Against the years the posting actually names, not a guess from the title |
| Compensation | 16 | Does the band clear the candidate's target |
| Work style | 14 | Remote/hybrid/onsite feasibility |

Two multipliers sit on top:

- **Role family** gates the skill score. A Product Designer and a Backend Engineer share tokens like "Design Systems" by coincidence, so cross-family compatibility (0.25 for distant families) multiplies skills rather than subtracting points.
- **Qualification gates logistics.** Experience + comp + work style are 48 points between them. Ungated, anyone in the right city with a plausible salary target floored near 50% — a designer scored **53%** on a backend role on logistics alone. Those three are now scaled by `0.25 + 0.75 × qualification`, so they only count once someone can actually do the job. That designer now scores **16%**.

Multiplying the components rather than capping the total keeps `score === sum(breakdown)` exactly, which is what makes a score explainable to a candidate and auditable by an assessor.

### What it fixed

| Case | Before | After |
|---|---|---|
| Product Designer on a Backend role | 53% | **16%** |
| Vue developer on a React role | 0 skill credit | **75%**, vs 12% for an unrelated candidate |
| Nice-to-haves scored like must-haves | equal | **80% vs 32%** |
| Remote-only candidate, onsite job | ranked normally | **excluded**, with the reason shown |

Every score also returns `concerns` (why it might not work), `transferableSkills` (which of your skills earned credit for what), `qualification`, and a `breakdown` — so a low score never looks arbitrary.

### Compliance — why it isn't an LLM

Jobsy ranks candidates for employers, making it an **Automated Employment Decision Tool**:

| Law | Status | Requires |
|---|---|---|
| NYC Local Law 144 | In force | Annual independent bias audit, published 6+ months; 10 business days' notice; opt-out |
| Colorado SB 24-205 | In force since June 2026 | Annual impact assessments, NIST AI RMF alignment, notice before adverse decisions |
| Illinois HB 3773 | In force Jan 2026 | AI employment discrimination liability |

So the engine is deterministic and decomposable by design. **Features never used:** name, photo, school, graduation year, exact address, age, gender, or any proxy for them. Location is used only as commute feasibility, never as a neighbourhood signal. An unclassifiable job title scores neutral (0.8), never punitive — silently burying anyone with an unusual title is exactly what an audit would flag.

**Not yet done, and required before you rely on this commercially:** the bias audit itself, the candidate notice, and the opt-out flow. None of that is built.

### Designed-for extensions

- **L2 semantic** — embed JD and profile, cosine as one more feature. Neon supports pgvector; needs a migration and an embedding key. Catches what the keyword taxonomy misses.
- **L3 learned weights** — every swipe is a labelled example. Learn per-recruiter weights and global weights that predict *mutual* matches, not just likes. The data is already being collected in `candidate_swipes` and `recruiter_swipes` and is currently unused.
- **L4 LLM rerank** on the top ~20 only, with written rationale. Never on the full corpus.

---

## How a match happens

```
candidate right-swipes job ──┐
                             ├──► both sides liked? ──► MATCH
recruiter right-swipes cand ─┘         │                 ├─ chat opens for both
                                       │                 └─ intro email to both
                                       │
                       no ──► recruiter side: interest email to the candidate
                                    "Are you interested?"  [Yes] [Not now]
                                            │
                                     Yes ───┴──► /i/{jobId}/{candidateId}?r=yes ──► MATCH
```

Match creation is idempotent and race-safe (`onConflictDoNothing` + read-back), so both sides can swipe simultaneously without double-notifying.

---

## Email

Real delivery via **Resend**, with a keyless fallback so the app is fully testable out of the box. Every send is written to `email_logs` *before* dispatch — nothing is lost. With no `RESEND_API_KEY`, messages print to stdout and are marked `LOGGED_ONLY`.

Four templates (`src/lib/email.ts`), all with text + HTML: recruiter interest (with the Yes/No buttons), application received, and match notifications for each side.

---

## Project layout

```
src/
  db/schema.ts            Drizzle schema — users, jobs, swipes, matches, messages, email log
  lib/
    auth.ts               JWT cookie sessions + the full LinkedIn OIDC flow
    matching/
      taxonomy.ts         skill adjacency graph + role families
      requirements.ts     must-have vs nice-to-have extraction from a JD
      engine.ts           the scorer — explainable, deterministic, auditable
    match.ts              compatibility shim over matching/engine
    skills.ts             skill taxonomy, normalisation, extraction from prose
    swipe.ts              swipe outcomes: applications, emails, match creation
    deck.ts               deck building + re-ranking
    ingest.ts             provider runner, upserts, stale-job retirement
    email.ts              Resend + templates
    discovery.ts          paste a careers URL → work out how to pull it
    sources.ts            connected-company registry, sync, auto-disable
    providers/
      ats.ts              9 company connectors (Greenhouse…Workday)
      universal.ts        JSON-LD scraper + XML feed reader
      aggregators.ts      JSearch/Jooble/Careerjet — the Indeed/Monster route
      linkedin.ts         the inert partner-gated stub
  app/
    swipe/                candidate deck
    recruiter/            recruiter deck + job composer
    matches/[id]/         chat
    onboarding/ profile/  candidate registration + editing
    sources/              connect-a-company admin UI
    j/[id]/               public crawlable job page (JSON-LD)
    i/[jobId]/[candId]/   interest-email landing page
    api/                  auth, deck, swipe, jobs, matches, messages, ingest, feed
scripts/
  seed.ts                 demo data with pre-seeded mutual likes
  reset-demo.ts           wipe transactional state
  ingest.ts               CLI ingestion
  test-providers.mts      31 aggregator + match-engine assertions (no network)
  test-sources.mts        44 connector + detection assertions (no network)
  e2e.mjs                 46 browser assertions against a running server
  e2e-sources.mjs         20 browser assertions for the connect-a-company flow
```

---

## Tests

```bash
npm run test:matching    # 43 — scoring, requirement parsing, taxonomy, explainability
npm run test:providers   # 31 — aggregator parsers, salary maths
npm run test:sources     # 44 — 9 ATS connectors, 4 detection strategies, fallbacks
npm run test:e2e         # 46 — browser: registration, swiping, matching, chat
node scripts/e2e-sources.mjs  # 20 — browser: connect a company end to end
```

The unit suites run every adapter against recorded payloads in the exact shape each live API returns, with `fetch` stubbed. The browser suites drive a real Chromium against a running server — the sources one stands up a fake careers site publishing real JSON-LD, connects it, and verifies the pulled jobs become swipeable cards.

All five are currently green: **43 + 31 + 44 + 46 + 20 = 184/184**.

---

## Deploying to Vercel + Neon

1. Create a Neon project, copy the pooled connection string into `DATABASE_URL`.
2. Push to GitHub, import to Vercel, add the env vars from `.env.example`.
3. Set `NEXT_PUBLIC_APP_URL` to your real domain — LinkedIn's redirect URI must match it exactly.
4. Add `https://yourdomain.com/api/auth/linkedin/callback` to your LinkedIn app's Auth tab.
5. `vercel.json` already registers the 6-hourly ingestion cron; set `CRON_SECRET` so nobody else can trigger it.
6. Run `npm run db:push` once against the production database.

---

## Known gaps

- **No resume upload or parsing.** Candidates type their skills. A parser would lift completion rates a lot.
- **Chat polls every 6s** rather than using websockets — fine at this scale, swap for Pusher/Ably when it isn't.
- **No email verification** on signup, and no password reset.
- **`raw` JSONB is unbounded** — add a retention job before the jobs table gets large.
- **Ingestion is sequential** across boards and companies. Fine for dozens; parallelise with a concurrency cap once you connect hundreds.
- **BambooHR and Workday list endpoints carry no job description**, so those cards have sparse skills until you add a per-job detail fetch. Everything else returns full text.
- **SmartRecruiters detail fetch is capped at 40 jobs per sync** to bound the request count — raise it when you care about full coverage of large employers.
- **Detection reads one page.** A careers page that lists jobs only after JavaScript runs, with no JSON-LD and no feed, will not be detected; that needs a headless browser in the ingestion path.
- **No rate limiting** on the swipe endpoint.
