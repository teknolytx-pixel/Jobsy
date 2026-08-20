# Jobsy — Production Readiness

**Founded and originated by Vinodh Vemireddy.**

This is the checklist between the current build and putting Jobsy in front of strangers. It is ordered by consequence, not by effort. Items marked **BLOCKER** should stop a launch.

---

## 0. What was built, and what it was verified against

| Suite | Cases | Covers |
|---|---:|---|
| `test:matching` | 43 | Scoring, role families, qualification gating, hard filters |
| `test:providers` | 31 | 11 ATS and aggregator connectors, against recorded fixtures |
| `test:sources` | 44 | Careers-URL detection, sync, three-strikes auto-disable |
| `test:compliance` | 85 | Pay transparency (25), discriminatory content (24), AEDT notices (16), jurisdiction (12), scam heuristics (8) |
| `test:security` | 53 | Tokens, rate limiting, signed URLs, file sniffing, resume parsing and the discard list |
| `e2e-lifecycle` | 71 | The real HTTP API end to end: signup → verification → posting gates → seats → deck → safety → privacy rights → admin access control |
| `e2e` (browser) | 47 | Playwright against the rendered UI |
| `e2e-sources` (browser) | 20 | The source-connection UI |
| **Total** | **394** | |

Plus the **MATCH-030 guard**, which fails the build if a protected attribute becomes reachable from the matching engine. It was verified by deliberately introducing a `graduationYear` field and confirming the build broke.

### Bugs these tests found, and what they were

| Found by | Defect | Why it mattered |
|---|---|---|
| `TC-JOB-001-07` | **Stored XSS in the JSON-LD block.** `JSON.stringify` escapes quotes but not `<` or `/`, so an employer-supplied description containing `</script><script>…` broke out of the structured-data element on the public job page | Arbitrary script execution on a page we deliberately make crawlable. Fixed in `src/lib/safeJson.ts` |
| `TC-AUTH-012-12` | **A closed account could sign back in.** Login checked `deletedAt` but not `deletionRequestedAt`, so an account closed today could log in tomorrow — the purge is 30 days out | Deletion that does not delete. Fixed in the login route and in `currentUser()` |
| `TC-RESUME-003-12` | **The resume discard list detected but did not remove.** A date of birth was reported as "discarded" while the line carrying it still reached the parsed output | A compliance control that reports success while failing. Fixed with a per-pattern LINE/TOKEN strategy |
| `TC-RESUME-003-09` | The first fix was too coarse and dropped whole education lines | Silently losing a candidate's education. Fixed by distinguishing the two cases |
| Browser E2E | `drizzle/meta` was gitignored | `_journal.json` is how drizzle knows which migrations ran. A fresh clone or CI would re-apply migration 0000 and fail |
| Browser E2E | Test reset left ownerless JOBSY postings behind | `posted_by_id` is ON DELETE SET NULL, so deleting a test account orphaned its posting and poisoned the next run |

---

## 1. BLOCKERS — do these before anyone else can reach the site

### 1.1 Rotate every exposed credential

These were pasted into a chat transcript and must be treated as public.

| Secret | Action |
|---|---|
| Neon database password (`npg_tc1u4LeafDdX`) | Rotate in the Neon console → update `DATABASE_URL` in Vercel **and** local `.env` |
| `AUTH_SECRET` | Generate a new one: `openssl rand -base64 32`. **This signs out every user**, which is the desired effect |
| `CRON_SECRET` | Generate a new one and update the Vercel env var |

Then confirm nothing is committed:

```bash
git log --all -p | grep -nE 'npg_|AUTH_SECRET=|CRON_SECRET=' || echo "clean"
git ls-files | grep -x '.env' && echo "PROBLEM: .env is tracked"
```

### 1.2 Delete the demo accounts

`candidate@demo.jobsy` and `recruiter@demo.jobsy` exist on the live deployment.

```sql
DELETE FROM users WHERE email LIKE '%@demo.jobsy';
```

The seed script now refuses to run against a hosted database without `ALLOW_PROD_SEED=yes-i-am-sure`, and generates its password per run rather than using a constant. Verify with:

```bash
DATABASE_URL="<your production url>" npm run seed   # should refuse
```

### 1.3 Configure email properly

Nothing below works without deliverable email: verification gates job posting, messaging and deck visibility.

1. Verify a sending domain in Resend (the free tier delivers **only** to the account owner's own address).
2. Configure **SPF, DKIM and DMARC** on that domain.
3. Set `EMAIL_FROM` to an address at it.
4. Set `COMPANY_POSTAL_ADDRESS` — **CAN-SPAM requires a real physical address on every commercial message**, and the templates render whatever is in this variable.

### 1.4 Object storage for resumes

Resume upload falls back to the local filesystem when `BLOB_READ_WRITE_TOKEN` is unset. **On Vercel that filesystem is ephemeral and per-instance**, so an upload will appear to succeed and then vanish.

Create a Vercel Blob store and set `BLOB_READ_WRITE_TOKEN`, or disable resume upload until you have one.

### 1.5 Have counsel review the legal documents

`/legal/terms` and `/legal/privacy` render **drafts**, and say so on the page. They exist so the consent flow is complete and testable. Before opening signups:

- Have counsel review both, plus the AEDT notice, against `JOBSY-US-LEGAL-SURVEY.md`
- Resolve every `[DECIDE]` and `[COUNSEL]` marker in the source documents
- Make the `LEGAL-003` scope determination in writing: **is Jobsy a sourcing tool or a screening tool?** It changes how much of the AEDT regime applies
- Get the `LEGAL-005` FCRA determination
- Register in New Jersey before taking New Jersey employer revenue — an unregistered entity **cannot sue there to collect its own fees**
- Request a New York DOL opinion letter on GBL § 171

---

## 2. REQUIRED BEFORE SCALE

### 2.1 Cron

Vercel Hobby permits **daily cron only**. `0 */6 * * *` **fails the deployment** — it is an error, not a warning. The current `vercel.json` is `0 6 * * *`, which runs ingestion *and* the maintenance tasks (job expiry, data purge, rate-limit sweep).

For more frequent runs, either upgrade to Pro or point an external scheduler at:

```
POST /api/ingest
Authorization: Bearer $CRON_SECRET
```

### 2.2 Rate limiting at volume

Rate limiting is a Postgres fixed-window counter. Correct across instances, and fine at MVP volume, but it is one write per throttled request. Move to Vercel KV or Upstash Redis when login traffic makes that a cost or latency problem — `src/lib/ratelimit.ts` keeps the same interface.

### 2.3 Live ingestion verification (`PLAT-007`)

**All 11 connectors are verified against recorded fixtures only.** Live ingestion has never run against a real endpoint, because the development sandbox blocks non-registry egress. Parser correctness against a fixture is not end-to-end correctness against an API that may have changed shape.

From production, run each connector once against a known-good employer board and record the result. Then add a weekly canary that alerts on a zero-job result where jobs are expected.

### 2.4 Accessibility (`LEGAL-008`)

**Not yet verified.** This is a P0 in the PRD and remains open. Before launch:

- axe-core scan on signup, deck, profile, matches and thread — zero serious or critical
- The swipe deck must be fully keyboard-operable. A swipe interface that needs a pointing device is an accessibility failure on an employment site
- Screen-reader pass over signup, swipe, match and message
- Publish a VPAT

The Title III circuit split decides who *wins*, not who gets *sued*. California's Unruh Act attaches a **$4,000 statutory minimum per violation**.

### 2.5 Bias audit instrumentation (`MATCH-031`)

Not built. Required if the `LEGAL-003` determination puts Jobsy on the screening side. The database table (`eeo_self_id`) and the isolation guard exist; the collection UI, the audit computation and the public summary do not.

---

## 3. ENVIRONMENT VARIABLES

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | **Yes** | Neon pooled connection string. TLS is fully verified — never disable it |
| `AUTH_SECRET` | **Yes** | ≥32 random bytes. Signs sessions and resume download links |
| `NEXT_PUBLIC_APP_URL` | **Yes** | Your production URL, no trailing slash. Every emailed link is built from it |
| `CRON_SECRET` | **Yes in production** | The ingest endpoint refuses to run in production without it |
| `COMPANY_POSTAL_ADDRESS` | **Yes** | CAN-SPAM. Appears in every commercial email footer |
| `RESEND_API_KEY` | **Yes** | Without it, email is logged to the database and stdout only |
| `EMAIL_FROM` | **Yes** | An address at your verified sending domain |
| `BLOB_READ_WRITE_TOKEN` | For resumes | Without it, uploads go to an ephemeral local filesystem |
| `LINKEDIN_CLIENT_ID` / `_SECRET` | Optional | Enables "Continue with LinkedIn". The OIDC tier is self-serve |
| `ADZUNA_APP_ID` / `_KEY`, `RAPIDAPI_KEY`, `JOOBLE_API_KEY`, `CAREERJET_AFFID` | Optional | Aggregator ingestion. Each disables cleanly when absent |
| `ALLOW_PROD_SEED` | **Never set in production** | Only bypasses the seed guard |
| `SEED_PASSWORD` | Local only | Sets the demo password; otherwise generated per run |

---

## 4. RUNNING IT

```bash
npm ci
npx drizzle-kit migrate      # drizzle/meta is committed; do not ignore it

# Local development
SEED_PASSWORD=local-dev-pw npm run seed
npm run dev

# Everything CI runs
npm run verify               # typecheck + guard + all unit suites + build

# End-to-end (needs a running server)
npm run build && npm start &
npm run test:lifecycle       # 71 API cases
npm run test:e2e             # 47 browser cases
npm run test:e2e:sources     # 20 browser cases

# Maintenance, on demand
npm run maintenance          # job expiry, data purge, rate-limit sweep
```

**Do not run `npm audit fix --force`** — it will break the pinned Next and React versions.

---

## 5. WHAT TO WATCH ONCE IT IS LIVE

| Signal | Where | Why |
|---|---|---|
| Overdue privacy requests | `GET /api/admin/compliance` | An overdue request is a compliance failure, not a backlog. 45 days for access and deletion, 15 for opt-outs, 30 for human review |
| Moderation queue age | `GET /api/admin/reports` | Anything past 48 hours is flagged. A safety queue nobody watches is not a safety feature |
| Ingest run failures | `ingest_runs` table | A connector broken by an upstream API change looks like "no new jobs" |
| Email delivery failures | `email_logs` where `status='FAILED'` | Verification failing silently means nobody can post or message |
| `auth.rate_limited` events | `audit_log` | A spike is either an attack or a limit set too tight |
| Explanation reconciliation | stderr, `[explain] RECONCILIATION FAILED` | If the components stop summing to the score, the explanation has become a plausible-looking fiction |
| Jobs auto-expired | maintenance report | If this is always zero, the ghost-job control is not running |

---

## 6. HONEST STATEMENT OF WHAT IS STILL OPEN

The PRD marks build status per feature. As of this pass:

**Built and tested this round:** email verification, password reset, session revocation, rate limiting, block and report, moderation queue, discriminatory-content screening, pay-transparency gate, ghost-job attestation and auto-expiry, the explanation service, AEDT notices, profiling opt-out with GPC, human review, data export, account deletion with a verified purge, company creation and domain verification, seats and invitations with server-side permissions, job editing, resume upload with content sniffing and parsing, the compliance console, the prohibited-input CI guard, and enforceable clickwrap.

**Still open:**

| ID | Feature | Status |
|---|---|---|
| `LEGAL-008` | WCAG 2.1 AA verification | **Not started.** P0 |
| `MATCH-031` | Bias audit instrumentation | Schema and isolation guard only |
| `PLAT-007` | Live ingestion verification | Fixtures only |
| `SEARCH-001/002` | Search and filtering | Not built. `SEARCH-002` needs counsel review of the filter taxonomy before it is written |
| `NOTIF-001` | Notification preference centre | Schema and defaults only; no UI, and the mailer does not yet consult it |
| `RESUME-004` | Resume builder | Not built |
| `APPLY-003` | Application status lifecycle | Enum and events table exist; no UI |
| `ADMIN-002/004` | Platform metrics, user administration | Not built |
| `RPT-001/002/003` | Reporting | Not built |
| `MATCH-040` | Embeddings, learning, LLM rerank | Roadmap |

**One sentence on where this leaves you:** the account-integrity, safety and legal-control gaps that made the previous build unshippable are closed and tested; what remains is accessibility verification, the bias-audit workstream if the scope memo puts you on the screening side, and a set of product features that are valuable but not blocking.

---

*© 2026. Founded and originated by Vinodh Vemireddy. Engineering guidance, not legal advice — §1.5 is not optional.*
