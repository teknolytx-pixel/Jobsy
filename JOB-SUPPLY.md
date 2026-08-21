# Getting more jobs into Jobsy

You asked for every job from every company site worldwide, plus Google Jobs.
Here is what is actually reachable, what is already built, and the two things
only you can do.

---

## Google Jobs: the honest version

**Google for Jobs has no API, and its search pages cannot be scraped.**
`google.com/search` is disallowed by Google's own robots.txt and scraping it
breaks their terms — so that door is closed, and I won't route around it.

That matters less than it sounds, because **Google for Jobs is not a source.**
It is an index. It has no jobs of its own — it reads schema.org `JobPosting`
markup from company career sites, Indeed, LinkedIn, Glassdoor and the rest, and
shows you theirs. Anything Google has, someone else published first.

So there are two legitimate ways to get the same postings, and Jobsy already
has code for both.

### 1. JSearch — a licensed Google-for-Jobs index

`src/lib/providers/aggregators.ts` already carries a full JSearch provider. Its
own description of its coverage: *Indeed, LinkedIn, Glassdoor, ZipRecruiter,
Monster, company sites.* That is the Google for Jobs corpus, reached through a
paid-for index rather than by scraping the results page.

It is written, tested, and **switched off**, because `RAPIDAPI_KEY` is not set.

### 2. Publish INTO Google for Jobs

`/j/{id}` already emits valid `JobPosting` JSON-LD, which is how a Jobsy posting
gets indexed by Google itself. That side is working and, as of this release,
finally tells the truth about where a job is (see below).

---

## The actual reason coverage feels thin

Ten providers are wired. **Two are running.**

| Provider | Status | What unlocks it |
|---|---|---|
| Remotive | ✅ running | keyless |
| Arbeitnow | ✅ running | keyless |
| **JSearch** (Google for Jobs, Indeed, LinkedIn, Glassdoor, ZipRecruiter, Monster) | ⛔ off | `RAPIDAPI_KEY` |
| Jooble | ⛔ off | `JOOBLE_API_KEY` |
| Careerjet | ⛔ off | `CAREERJET_AFFID` |
| Adzuna | ⛔ off | `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` |
| Greenhouse | ⛔ off | company board tokens |
| Lever | ⛔ off | company board tokens |
| Ashby | ⛔ off | company board tokens |
| LinkedIn Talent | ⛔ inert by design | partner agreement only |

Your 762 jobs come from two remote-only boards. That is the whole story. Nothing
is broken and nothing needs building — eight providers are sitting idle waiting
for a credential.

**The four aggregator keys are free tiers.** Adding them is a Vercel settings
change, not a code change:

Vercel → your project → **Settings → Environment Variables** → add to
**Production** and **Preview** (not Development — Vercel blocks sensitive values
there), then redeploy.

## "Every company website across the globe"

No one can do this, Google included — there is no registry of every company's
careers page, and most of them are hand-rolled HTML behind a login or a widget.

What *is* real: **Greenhouse, Lever and Ashby are company career sites.** When a
company hosts its careers page on one of them, every posting is available as
public JSON, no key, no scraping, no rate limit worth worrying about. That is
tens of thousands of employers, and it is the closest honest thing to what you
asked for.

The bottleneck is not access — it is knowing *which companies*. That is exactly
what the v1.1 source-discovery feature (SRC-001–013) does: give it a company
name or careers URL and it detects the ATS and connects the board. Every company
you connect there is a permanent, complete, free feed of that employer's jobs.

So the growth path for supply is: **connect companies**, not "crawl the web".

---

## What this release changes: supply follows demand

Your example was the right one — *if a candidate is an ML/AI engineer, go search
for those roles.* That is now how ingestion works.

Until now the aggregator queries were five hardcoded strings written before the
platform had any users:

```
software engineer in usa · frontend engineer in usa · data engineer in usa
product designer in usa  · machine learning engineer in usa
```

Every query said `in usa`, so a candidate in Berlin was ranked against a corpus
that structurally could not contain their job. Now the phrases are derived from
the candidates actually on the platform — their role and the country they are
searching in (`src/lib/demand.ts`, SRC-014).

Three details worth knowing, because each one is a decision rather than an
implementation:

- **Seniority is stripped before grouping.** "Senior ML Engineer" and "ML
  Engineer" become one bucket, not two half-size ones that each fall under the
  threshold and get queried never. The aggregators return every level anyway,
  and Jobsy ranks seniority itself.
- **Abbreviations are expanded.** "ML Engineer" is searched as "machine learning
  engineer", because that is what the boards index it as.
- **A phrase needs at least 3 distinct candidates behind it.** With one ML
  engineer registered, "machine learning engineer in germany" is not an
  aggregate — it is that person, and the job table becomes a durable record of
  what one identifiable individual is looking for. Below the threshold the old
  static list runs instead. This costs some coverage while you are small, and it
  is not a knob I would turn.

Nothing here touches matching. Demand shapes *which jobs exist in the database*;
it never influences which candidate sees which job. `npm run guard` still fails
the build if the matching engine so much as imports this.

---

## Two other fixes in this release

**The public job page was lying to Google.** `/j/{id}` hardcoded
`addressCountry: "US"` and, for remote roles, `applicantLocationRequirements:
USA`. Fine when every posting was American; wrong the moment v1.1 landed. A
London role was being published to Google for Jobs as a US role, and an EU-scoped
remote role was advertised to US applicants who could not take it — the exact
failure BR-017 exists to prevent, leaking out through the structured data instead
of through the deck. It now derives all of it from the real geography, and
**omits** the country when it genuinely doesn't know rather than guessing.

**The seed shipped a broken demo.** `scripts/seed.ts` predated v1.1 and never
wrote the geography columns, so under the fail-closed eligibility gate every demo
candidate was invisible and a freshly seeded environment came up with an empty
recruiter deck. It now derives structured location from the same fixtures.

---

## Tests

547 passing, up from 451.

The new ones worth naming: **12 browser tests that drive the real job composer.**
Three separate P0 bugs — the signup clickwrap, the vacancy attestation, the pay
transparency gate — were all the same shape: the API required a field the form
never rendered or never sent. The API-level suite could not catch it, because it
posts JSON directly and therefore always sends the field the UI was forgetting.
That gap is now closed, including a contrast assertion on the attestation notice,
because that notice shipped twice in near-black on a near-black background and
its enforceability depends on being legible.

```
npm run test              # 397 unit, incl. the new demand suite
npm run test:lifecycle    # 71 API lifecycle
npm run test:e2e          # 59 browser, incl. 12 composer
npm run test:e2e:sources  # 20 ingestion browser
```
