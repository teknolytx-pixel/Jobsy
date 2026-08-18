# Taking Jobsy live

**Time: ~25 minutes. Cost: $0.**

Everything below runs on free tiers. Nothing here requires a credit card.

You need three accounts: **GitHub**, **Neon** (database), **Vercel** (hosting). Sign up for all three with the same email now — that makes the connect steps one-click later.

---

## Step 1 — Get the code onto your machine

Unzip `jobsy.zip` wherever you keep projects, then:

```bash
cd jobsy
npm install
```

Takes a minute or two. If `npm` isn't found, install Node 20+ from https://nodejs.org first.

---

## Step 2 — Create the database (Neon)

1. Go to https://neon.tech → **Sign up** (GitHub login is fastest)
2. **Create project**. Name it `jobsy`. Pick the region closest to your users.
3. On the project dashboard, find **Connection string** and copy it. It looks like:
   ```
   postgresql://neondb_owner:npg_xxxx@ep-cool-name-12345.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
   Make sure you copy the **pooled** connection string if given a choice.

Keep that tab open — you'll paste this string twice.

---

## Step 3 — Create the schema and seed it

Back in your terminal, in the `jobsy` folder:

```bash
cp .env.example .env
```

Open `.env` in any text editor. Change exactly two lines:

```bash
DATABASE_URL="<paste the Neon connection string here>"
AUTH_SECRET="<paste the output of the command below>"
```

Generate the secret:

```bash
openssl rand -base64 48
```

> On Windows without `openssl`: run `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"` instead.

Now build the schema and load demo data:

```bash
npm run db:migrate    # creates all 11 tables in Neon
npm run seed          # demo accounts + 3 job posts
```

You should see `✅ Seeded.` with two logins printed.

**Sanity check before deploying** — run it locally first:

```bash
npm run dev
```

Open http://localhost:3000, sign in as `candidate@demo.jobsy` / `password123`, swipe right on *Product Designer*. If you get the match overlay, everything works. Stop the server with `Ctrl+C`.

---

## Step 4 — Push to GitHub

```bash
git init
git add .
git commit -m "Jobsy"
```

Then create an **empty private repo** at https://github.com/new — no README, no .gitignore, nothing. Copy the two commands GitHub shows you under *"…or push an existing repository"*. They look like:

```bash
git remote add origin https://github.com/YOURNAME/jobsy.git
git branch -M main
git push -u origin main
```

> `.env` is already in `.gitignore`, so your secrets are not going to GitHub. Verify with `git status` — `.env` should not be listed.

---

## Step 5 — Deploy to Vercel

1. Go to https://vercel.com → **Sign up with GitHub**
2. **Add New… → Project** → find `jobsy` → **Import**
3. Leave every build setting on default. Vercel detects Next.js correctly.
4. **Before clicking Deploy**, expand **Environment Variables** and add these three:

| Name | Value |
|---|---|
| `DATABASE_URL` | the same Neon string from Step 2 |
| `AUTH_SECRET` | the same secret from Step 3 |
| `CRON_SECRET` | run `openssl rand -base64 32` and paste a *new* random value |

5. Click **Deploy**. Wait ~2 minutes.

You'll get a URL like `https://jobsy-abc123.vercel.app`. **Copy it.**

---

## Step 6 — Tell the app its own address

The app needs to know its public URL to build links inside emails.

1. In Vercel: **Settings → Environment Variables → Add**
   - Name: `NEXT_PUBLIC_APP_URL`
   - Value: your full URL, no trailing slash — `https://jobsy-abc123.vercel.app`
2. Go to **Deployments**, click the **⋯** on the newest one → **Redeploy**

This redeploy is required — that variable is baked in at build time.

---

## Step 7 — Confirm it's live

Open your Vercel URL. You should see the Jobsy landing page with live job counts.

Sign in with `candidate@demo.jobsy` / `password123` and swipe. If the deck loads, **you're live**.

Then check the two machine surfaces:

- `https://your-url.vercel.app/api/ingest` → JSON listing all 10 providers and your connected companies
- `https://your-url.vercel.app/api/feed/jobs.xml` → your outbound XML job feed

---

## Step 8 — Pull in real jobs

Sign in as `recruiter@demo.jobsy` / `password123` → **Recruiter** tab → **Companies**.

Paste a careers URL and hit **Detect & connect**. Try these to prove it works:

```
https://boards.greenhouse.io/stripe
https://jobs.lever.co/plaid
https://job-boards.greenhouse.io/figma
```

Each pulls that company's entire live job board in seconds. Then connect whatever companies you actually care about — paste their normal careers page, Jobsy figures out the rest.

**Change the demo passwords now.** Sign in as each demo account → profile icon → and either change them or delete the accounts once you've made your own.

---

## Step 9 — Keep it fed automatically

`vercel.json` already schedules `/api/ingest` daily at 06:00 UTC.

⚠️ **Vercel's free Hobby plan only permits cron once per day.** Anything more frequent *fails the deployment* with `Hobby accounts are limited to daily cron jobs`. I've set it to daily so your first deploy succeeds.

To sync more often, pick one:

- **Vercel Pro ($20/mo)** — edit `vercel.json` to `"0 */6 * * *"` and push
- **Free external cron** — leave Vercel alone, and have [cron-job.org](https://cron-job.org) (free) hit your endpoint on any schedule:
  ```
  URL:     https://your-url.vercel.app/api/ingest
  Method:  POST
  Header:  Authorization: Bearer <your CRON_SECRET>
  ```

You can always trigger a pull by hand from the **Companies** page → **Sync now**.

---

## Optional extras

Add these later from **Vercel → Settings → Environment Variables**, then redeploy. Each one is independent — the app runs fine without all of them.

### Real emails (Resend)

Without this, interest and match emails are written to the database and printed to logs, not delivered.

1. https://resend.com → sign up → **API Keys → Create**
2. Add `RESEND_API_KEY` in Vercel
3. Leave `EMAIL_FROM` as `Jobsy <onboarding@resend.dev>` until you own a domain

Free tier: 3,000 emails/month.

### LinkedIn sign-in

Gives candidates one-click signup and a **Verified** badge. You need a LinkedIn *Page* to create the app (making one takes 2 minutes).

1. https://developer.linkedin.com → **Create app** → attach your Page
2. **Products** tab → request **Sign In with LinkedIn using OpenID Connect** (auto-approved, usually instant)
3. **Auth** tab → add redirect URL, exactly:
   ```
   https://your-url.vercel.app/api/auth/linkedin/callback
   ```
4. Copy Client ID + Secret → add `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` in Vercel

The button appears on your login page automatically once both are set.

### Aggregator feeds (Indeed / Monster listings)

- **Adzuna** — https://developer.adzuna.com, instant key → `ADZUNA_APP_ID` + `ADZUNA_APP_KEY`
- **JSearch** — https://rapidapi.com, subscribe to JSearch → `RAPIDAPI_KEY`

### Custom domain

**Vercel → Settings → Domains → Add**, then follow the DNS records it shows you. Afterwards you **must** update `NEXT_PUBLIC_APP_URL` and, if you set it up, the LinkedIn redirect URL — then redeploy.

---

## When something breaks

| Symptom | Cause | Fix |
|---|---|---|
| Deploy fails: *"Hobby accounts are limited to daily cron jobs"* | `vercel.json` schedule runs more than once a day | Set it back to `0 6 * * *` |
| Landing page loads but shows 0 jobs | Migration or seed never ran against Neon | Re-run `npm run db:migrate && npm run seed` with the Neon `DATABASE_URL` in `.env` |
| Any page 500s | `DATABASE_URL` missing or wrong in Vercel | Check **Settings → Environment Variables**, then **redeploy** — env changes need one |
| Emails never arrive | No `RESEND_API_KEY` (expected default) | Check the `email_logs` table — every message is stored whether or not it sends |
| LinkedIn: *"redirect_uri does not match"* | The URL in LinkedIn ≠ `NEXT_PUBLIC_APP_URL` | They must match character for character, including `https://` and no trailing slash |
| A connected company shows **Failing** | That board's endpoint changed or the slug is wrong | The exact error is on the card. Three strikes auto-pauses it so nothing gets hammered. |
| Ingest times out | Too many companies for one 300s function | Connect fewer, or move ingestion to a background worker |

**Where to look:** Vercel → your project → **Logs** shows every request and error in real time. Neon → **SQL Editor** lets you query the database directly — `select * from email_logs order by created_at desc limit 20;` is the fastest way to see what the app tried to send.

---

## Before you show this to real users

The app works, but a few things are missing that matter once strangers can sign up:

- **No email verification and no password reset.** Anyone can register any address.
- **No rate limiting** on signup or swipe endpoints.
- **Demo accounts have known passwords.** Delete them.
- **No privacy policy or terms**, which you'll need before collecting real candidate data — and before LinkedIn will approve anything beyond the basic sign-in tier.
- **Jobs pulled from company boards are other people's content.** Linking out to the original apply URL (what Jobsy does) is the defensible posture; re-hosting full descriptions long-term is worth a lawyer's opinion once you have real traffic.
