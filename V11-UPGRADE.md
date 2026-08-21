# Jobsy v1.1 — what changed and how to deploy it

This release implements FSD v1.1: geographic eligibility as a hard gate, and the
gaps in job source discovery.

Everything here is additive. No column is dropped, no data is deleted, and the
migration is safe to run against the live database.

---

## The one thing that will surprise you

**Geographic incompatibility now hides a job completely.** It is not a scoring
penalty any more (BR-018). A candidate in the United States will not see a role
in India unless they explicitly opt in, and a candidate whose country we cannot
determine sees nothing at all.

That last part matters for your existing data. Every job and candidate created
before this release stores location as a single free-text string, and the
eligibility layer fails closed on an unknown country (GEO-006). **Run the
backfill in Step 4 or your deck will look broken.**

---

## The order to do this in

The migration files ship inside the release zip, so the code has to be on disk
before there is anything to migrate. Do it in exactly this order:

1. **Step 1** — get the new code onto your machine (1a, 1b, 1c below)
2. **Step 2** — run the migration
3. **Step 3** — commit and push, so the live site gets the new code
4. **Step 4** — backfill the structured locations
5. **Step 5** — verify

Running the migration before the code is on disk fails because the `.sql` files
are not there yet. Pushing the code before the migration runs is worse: the new
code selects columns that do not exist, so every page touching jobs or users
errors until the migration catches up.

## Step 1 — Get the new code onto your machine

Nothing is deployed in this step and nothing is committed. You are only putting
files on disk, which is what makes the migration possible.

No new environment variables are needed anywhere in this upgrade.

### 1a. Unzip into a staging folder

Do this in Terminal rather than by double-clicking. macOS treats `Jobsy` and
`jobsy` as the same name, so unzipping in Finder can silently merge into an
existing folder or create a confusing `jobsy 2`.

```
unzip -o ~/Downloads/jobsy-v1.1.zip -d ~/Downloads/jobsy-v11-staging
```

### 1b. Copy the new code into the repo

The repo is `~/Downloads/Jobsy_Dev/jobsy`. That is the folder GitHub Desktop
watches, and it is NOT `~/Downloads/Jobsy`.

```
rsync -a --delete --exclude '.git' --exclude 'node_modules' --exclude '.next' --exclude '.vercel' --exclude '.env' --exclude '.env.*' --exclude '.DS_Store' ~/Downloads/jobsy-v11-staging/jobsy/ ~/Downloads/Jobsy_Dev/jobsy/
```

`.env` is excluded on purpose. The release zip contains no `.env`, so without
that exclusion `--delete` would remove the one holding your live credentials.

### 1c. Install dependencies in the repo folder

```
cd ~/Downloads/Jobsy_Dev/jobsy && npm install
```

No new packages were added, but the repo folder needs `node_modules` for the
Step 4 backfill to run. From here on, work in this folder only.

### 1d. Check before committing

```
cd ~/Downloads/Jobsy_Dev/jobsy; echo "ENV:"; ls -l .env; echo "MIGRATIONS:"; ls drizzle/*.sql; echo "CHANGED:"; git status --short | wc -l; echo "DONE"
```

Expect: `.env` still present, four migration files ending `0003_...sql`, and a
changed-file count in the dozens or more.

**Do not commit yet.** The migration comes first.

## Step 2 — Migrate the database

From the repo folder, so it reads the `.env` sitting there:

```
cd ~/Downloads/Jobsy_Dev/jobsy && npx drizzle-kit migrate
```

This applies migrations 0002 and 0003 together: three enums and 29 columns.
Purely additive — no `DROP`, no `TRUNCATE`, no `DELETE`, and every `NOT NULL`
column carries a default, so existing rows are valid the moment the column
appears.

Confirm in the Neon SQL editor:

```sql
SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';
```

Still 26 tables — v1.1 adds columns, not tables. If you want to check the
columns themselves arrived:

```sql
SELECT count(*) FROM information_schema.columns
WHERE table_name = 'jobs' AND column_name IN ('country_code', 'postal_code', 'remote_scope');
```

Expect `3`. A `column ... does not exist` error anywhere means this step has not
run yet.

## Step 3 — Commit and push

GitHub Desktop, with **Current Repository** set to `jobsy`:

1. Summary: `v1.1 — geographic eligibility, postal identity, cross-source dedupe`
2. **Commit to main**
3. **Push origin**

Vercel builds automatically. Watch it at your project's Deployments tab.

Then confirm the right build went live: the newest deployment should show your
commit hash and branch `main`, not "Redeploy of…". If the blue **Production**
badge sits on an older redeploy, open your commit's row and use **Promote to
Production**.

Load your site and open the job composer. The new **Postal / ZIP code** and
**Country** fields should be there. If they are, the code is live.

## Step 4 — Backfill the structured locations

This resolves `"Austin, TX"` into `US / TX / Austin` for every existing row.

Dry run first — it writes nothing and prints what it would do:

```
npx tsx scripts/backfill-geo.mts
```

You will get a report like:

```
jobs: 412 without a country
  resolved   389 (94%), of which 21 inferred from a city name
  unresolved 23 (6%) — these stay hidden until a human fixes them
  examples: "Remote", "Multiple locations", ""
```

When the numbers look right:

```
npx tsx scripts/backfill-geo.mts --apply
```

It is idempotent — it only writes rows whose country is still null, so running
it twice is a no-op and it never overwrites a value a human supplied.

The unresolved remainder is the honest cost of the conservative choice: a
posting that does not say where the work happens does not reach anyone. Those
jobs stay hidden until a recruiter edits them.

## Step 5 — Check the result

```sql
SELECT
  count(*) FILTER (WHERE country_code IS NOT NULL) AS jobs_with_country,
  count(*) FILTER (WHERE country_code IS NULL)     AS jobs_without,
  count(*) FILTER (WHERE canonical_job_id IS NOT NULL) AS duplicates_folded
FROM jobs WHERE active;
```

```sql
SELECT count(*) FILTER (WHERE current_country IS NOT NULL) AS candidates_placed,
       count(*) FILTER (WHERE current_country IS NULL)     AS candidates_unplaced
FROM users;
```

Candidates in the unplaced column are asked for their country the next time they
open their profile. Nothing breaks for them in the meantime except an empty
deck, which now explains itself.

---

## What recruiters will notice

- **Country is now required** when posting. It decides who the posting reaches.
- **A remote role must state its scope** — same country, named states, named
  countries, a region, or worldwide. There is no "just remote" any more, because
  that is what produced applications from people who could not take the job.
- **Local-only needs a reason.** If you tick "local candidates only" you have to
  say why in one line. A radius around a workplace is a geographic screen, and
  those can exclude a whole community without anyone intending it; the recorded
  reason is what shows the requirement was job-related if it is ever questioned.

## What candidates will notice

- A **country** field at onboarding, and a **"Where you want to work"** section
  in the profile: countries and regions they would consider, an explicit opt-in
  for international roles, and who they can work remotely for.
- International search is **off by default**. Roles abroad may need authorisation
  they do not have, so they are not shown unless asked for.
- An empty deck now says *why* — with a link to change it.

---

## Postal code as the unique location identity

`country | state | postal code` is now the canonical identity of a place, and it
is what cross-source de-duplication keys on.

The reason is that a city string is not an identifier. One New York job arrives
from three boards as "New York", "NYC" and "Manhattan"; key on that and you
either miss real duplicates or, if you loosen the comparison, merge genuinely
different roles. A postal code is a single canonical token, and country plus
state disambiguates codes that repeat across borders — 78701 is Austin in the
US and a Black Forest village in Germany.

Where a job has no postal code the key degrades to `country|state|city`, which
is where it was before. It never degrades to country alone.

Three deliberate details:

- **ZIP+4 is truncated to five digits on the way in.** The +4 identifies a block
  face or a single building, which is more precision than a hiring decision has
  any business holding.
- **A ZIP that contradicts its state is rejected, not silently corrected.**
  Posting "Austin, CA 78701" returns an error naming both readings, because
  guessing which one is right decides who sees the posting.
- **A US ZIP fills in a missing state.** "78701" is enough to know Texas.

### The line this feature sits on

Illinois HB 3773 names ZIP code **explicitly** as a prohibited proxy for a
protected class in AI-assisted employment decisions, and the history it reacts
to is residential segregation. Screening candidates by ZIP is redlining with a
spreadsheet. So the codebase separates two uses that look similar and are not:

| Use | Question it answers | Status |
|---|---|---|
| Identity | "which place is this posting about?" | **Allowed** — discriminates against nobody |
| Screening | "is this candidate acceptable?" | **Prohibited** — never a feature, filter or tiebreak |

Radius matching is where the two nearly touch, and two choices keep it on the
right side:

1. **Distance uses the three-digit ZIP prefix, never the full code.** A ZIP3 is
   a sectional centre tens of miles across — ample for a 25-to-50-mile radius
   and far too blunt to isolate a neighbourhood. `TC-ZIP-12` asserts that 78701
   and 78799 are literally indistinguishable for distance purposes. That is the
   privacy property, not an approximation bug.
2. **The eligibility layer returns a boolean.** No distance, no ZIP and no
   derived value is ever handed to the ranking code.

`npm run guard` fails the build if the token `zip` or `postalCode` appears
anywhere under `src/lib/matching`, and `TC-ZIP-15` asserts the engine's input
types expose no postal field at all — so there is nothing to read even if
someone tried.

Candidate ZIP is **optional and stays optional**. It improves radius accuracy
for local-only roles and does nothing else: it is never shown to recruiters and
never affects a match score.

---

## The rule that is easiest to get wrong later

**Remote does not mean worldwide** (BR-017 / RMT-005). An ingested job that says
"Remote" with no geographic scope is treated as remote *within its own country*,
and the row records `remote_scope_source = 'DEFAULTED'` so a later reader can
tell the scope was inferred rather than stated. Flipping that default to
WORLDWIDE would look like a one-word change and would quietly produce
applications employers cannot lawfully accept.

## The boundary the CI guard protects

Geography is evaluated in the **eligibility layer** (`src/lib/geo`), never in the
scoring engine (`src/lib/matching`). Precise location is a documented proxy for
race and socioeconomic status, and work-authorisation fields are a proxy for
national origin under 8 U.S.C. § 1324b.

`npm run guard` fails the build in **both** directions: if the engine imports
the geo module, and if the geo module imports the engine. That is deliberate —
keeping them apart only in the comments is how the separation gets lost.

---

## Tests

```
npm run test          # 313 unit tests including the new geo suite
npm run test:lifecycle # 71 API lifecycle tests
npm run test:e2e      # 47 browser tests
npm run test:e2e:sources # 20 ingestion browser tests
```

The new `npm run test:geo` covers TC-GEO-01 … TC-GEO-16 from FSD §37 verbatim,
plus the resolver and de-duplication behaviour they depend on.

One of those tests exists because of a bug found during this build: **"San
Francisco, CA" resolved to Canada.** `CA` is both a US state and an ISO country
code, and so are `DE`, `IN`, `LA`, `PA`, `MD`, `VA`, `GA` and others. The
resolver now leaves ambiguous two-letter tokens for the city to arbitrate —
Berlin, DE is Germany; San Francisco, CA is California — and TC-GEO-32b pins
every one of those pairs.
