# Jobsy — Deployment, Step by Step

**This is an UPDATE to your existing live deployment**, not a fresh setup. You already have Vercel, Neon, and a GitHub repo. Nothing here replaces them.

**Time:** about 40 minutes.
**You need open:** Terminal, Finder, and three browser tabs — Neon, Vercel, GitHub Desktop.

---

## ⚠️ Read this first — two things that will bite you

**1. Order matters.** The database must be updated **before** you push the code. The new code reads columns that do not exist yet. If you push first, your live site returns errors until the migration runs. Do Part 4 before Part 6.

**2. Every existing account is about to be locked out — and there is a one-line fix.**

The new build requires a verified email before anyone can post a job, send a message, or appear in a recruiter's deck. Your existing accounts were created before email verification existed, so they are all marked unverified. Without the fix in **Step 12**, every account you already have — including yours — silently stops working.

Step 12 grandfathers them in. Do not skip it.

---

# PART 1 — Get the new code onto your Mac

### Step 1 — Unzip it

1. Download `jobsy.zip` from this conversation.
2. Double-click it. You get a folder called `jobsy`.
3. Open Finder → **Downloads** → your existing `jobsy` folder.
4. Drag the **contents** of the new `jobsy` folder into your existing one.
5. When macOS asks, click **Replace** (and tick "Apply to All").

Your `.env` file is **not** in the zip, so your existing settings survive. You will edit it in Step 8.

### Step 2 — Open Terminal in the folder

Open Terminal (Cmd+Space, type "Terminal", Enter) and paste this, then press Enter:

```
cd ~/Downloads/jobsy && pwd
```

You should see `/Users/modernmonk/Downloads/jobsy`. If you see anything else, your folder is somewhere different — find it in Finder, then drag the folder onto the Terminal window after typing `cd ` (with a space).

### Step 3 — Install

```
npm install
```

Takes about 30 seconds. Warnings are normal. **Do not run `npm audit fix --force`** — it will break the app.

---

# PART 2 — Rotate the three exposed secrets

Your database password, `AUTH_SECRET` and `CRON_SECRET` were all pasted into a chat. Treat them as public.

### Step 4 — New Neon database password

1. Go to **console.neon.tech** → your project.
2. Left sidebar → **Roles** (or **Settings → Roles**).
3. Find `neondb_owner` → **⋯** → **Reset password**.
4. Copy the **new full connection string**. It looks like:
   `postgresql://neondb_owner:npg_NEWVALUE@ep-...-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require`
5. **Paste it somewhere safe for a moment** — a new note. You need it three times.

> If Neon only shows you the password and not the whole string, take your old connection string and swap just the part between `:` and `@`.

### Step 5 — New AUTH_SECRET

In Terminal:

```
openssl rand -base64 32
```

Copy the output. That is your new `AUTH_SECRET`.

> This signs everyone out. That is intentional — the old one is compromised.

### Step 6 — New CRON_SECRET

```
openssl rand -base64 32
```

Copy that output too. Different value from Step 5.

### Step 7 — Keep them straight

You now have three new values. Label them in your note:

```
DATABASE_URL   = postgresql://neondb_owner:npg_...
AUTH_SECRET    = ...
CRON_SECRET    = ...
```

---

# PART 3 — Update your local settings file

### Step 8 — Edit `.env`

```
open -e .env
```

TextEdit opens. Replace the whole contents with this, pasting your own values in:

```
DATABASE_URL=paste_your_new_connection_string_here
AUTH_SECRET=paste_your_new_auth_secret_here
CRON_SECRET=paste_your_new_cron_secret_here
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
COMPANY_POSTAL_ADDRESS=Jobsy, 123 Your Street, Austin, TX 78701
RESEND_API_KEY=your_existing_resend_key_if_you_have_one
EMAIL_FROM=Jobsy <onboarding@resend.dev>
```

Three notes:

- **No quotes, no spaces around the `=`.**
- `NEXT_PUBLIC_APP_URL` must be your real Vercel URL with **no trailing slash**. Every link in every email is built from it.
- `COMPANY_POSTAL_ADDRESS` is **new and required**. US law requires a real physical postal address on commercial email. A home address is legal but a mailbox service is more sensible.

Save with **Cmd+S**, then close TextEdit.

---

# PART 4 — Update the production database ⚠️ DO THIS BEFORE PUSHING

### Step 9 — Check what state your database is in

```
npx drizzle-kit migrate
```

Expected output ends with:

```
[✓] migrations applied successfully!
```

You may see an SSL warning above it. That is normal — ignore it.

**If it says `password authentication failed`:** your connection string in `.env` is wrong. Go back to Step 4, copy it again carefully, and re-check for a stray space.

### Step 10 — Open the Neon SQL Editor

The next four steps are database commands. Run them in your browser, not the Terminal — it is far easier and you can see the result of each one.

Go to **console.neon.tech** → your project → **SQL Editor** in the left sidebar.

### Step 11 — Confirm the migration actually landed

Paste this and click **Run**:

```sql
SELECT count(*) AS tables
FROM information_schema.tables
WHERE table_schema = 'public';
```

**You should see `26`.**

If you see `11`, the migration did not run — go back to Step 9 and read the error.

### Step 12 — Grandfather your existing accounts ⚠️ DO NOT SKIP

Paste this into the SQL Editor and click **Run**:

```sql
UPDATE users
SET email_verified = true
WHERE email_verified = false
  AND deleted_at IS NULL;
```

It will report how many rows it updated. Those are the accounts that would otherwise have been locked out.

> **Why this is right:** these people signed up before verification existed. Making them re-verify an address they already gave you punishes them for your upgrade. Everyone who signs up from now on verifies normally.

### Step 13 — Delete the demo accounts

`candidate@demo.jobsy` and `recruiter@demo.jobsy` have a password that is written down in a chat log, on a public URL. Run this:

```sql
DELETE FROM users WHERE email LIKE '%@demo.jobsy';
```

### Step 14 — Confirm it worked

```sql
SELECT
  (SELECT count(*) FROM users WHERE email LIKE '%@demo.jobsy') AS demo_accounts_left,
  (SELECT count(*) FROM users WHERE email_verified = false AND deleted_at IS NULL) AS unverified_left,
  (SELECT count(*) FROM information_schema.tables WHERE table_schema='public') AS tables;
```

You want: **`demo_accounts_left = 0`**, **`unverified_left = 0`**, **`tables = 26`**.

---

# PART 5 — Update Vercel

### Step 15 — Open your environment variables

1. **vercel.com** → your Jobsy project.
2. **Settings** → **Environment Variables**.

### Step 16 — Update the three rotated secrets

For each of `DATABASE_URL`, `AUTH_SECRET`, `CRON_SECRET`:

1. Click the **⋯** next to it → **Edit**.
2. Paste the new value from your note.
3. Make sure **Production**, **Preview** and **Development** are all ticked.
4. **Save**.

### Step 17 — Add the new required variable

Click **Add New**:

- **Key:** `COMPANY_POSTAL_ADDRESS`
- **Value:** your real postal address, e.g. `Jobsy, 123 Your Street, Austin, TX 78701`
- Tick all three environments → **Save**.

### Step 18 — Check `NEXT_PUBLIC_APP_URL`

Confirm it is set to your live URL with **no trailing slash**. If it is missing or wrong, every verification and password-reset link will point somewhere broken.

> Environment variable changes do not take effect until the next deployment. The push in Part 6 is that deployment — you do not need to do anything extra.

---

# PART 6 — Push the code

### Step 19 — Open GitHub Desktop

You should see a long list of changed files in the left panel.

### Step 20 — Check three things are in the list

Scroll the file list and confirm you can see:

- `drizzle/0001_young_zodiak.sql`
- `drizzle/meta/_journal.json` ← **important**
- `.gitignore`

**If `drizzle/meta/_journal.json` is missing:** that folder used to be ignored, and the new `.gitignore` un-ignores it. In Terminal run `git add -f drizzle/meta` and then look again.

> This file is how the database knows which migrations have already run. Without it committed, your next migration will fail.

### Step 21 — Commit

Bottom left:

- **Summary:** `Security, safety and compliance build`
- Click **Commit to main**.

### Step 22 — Push

Top bar → **Push origin**. Wait for it to finish.

### Step 23 — Watch the deployment

1. **vercel.com** → your project → **Deployments**.
2. The newest one shows **Building**.
3. Wait 1–3 minutes for **Ready** (green).

**If it fails:** click the failed deployment → **Building** → read the last red lines. Copy them to me and I will tell you what it is.

---

# PART 7 — Verify it actually works

Do these in order. Each takes under a minute.

### Step 24 — The site loads

Open your live URL. The landing page should appear.

### Step 25 — The new legal pages exist

- `https://your-app.vercel.app/legal/terms`
- `https://your-app.vercel.app/legal/privacy`
- `https://your-app.vercel.app/legal/aedt`

All three should render. They are marked as drafts pending legal review — that is correct and deliberate.

### Step 26 — Signup now requires accepting the Terms

1. Go to `/login?mode=signup`.
2. Fill in a name, an email you can actually read, and a password.
3. **Click Create account without ticking the checkbox.** It must refuse.
4. Tick the box, click again. It should work.

### Step 27 — Verification email arrives

Check the inbox for that address. You should have a **"Verify your email address"** email.

**If nothing arrives:** Resend's free tier only delivers to the email address that owns the Resend account. That is a Resend limitation, not a bug. See "Email" below.

Click the link. You should land back on the app, verified.

### Step 28 — Password reset works

1. Go to `/reset`.
2. Enter your address, submit.
3. Check for a **"Reset your Jobsy password"** email, click through, set a new password.

### Step 29 — The pay-transparency gate fires

As a recruiter, try to post a job with **Location: San Francisco, CA** and **no salary range**.

It must be **refused**, naming California Labor Code § 432.3. That is the control working.

Now add a range. It should publish.

### Step 30 — The content screen fires

Try to post a job whose description contains **"Recent graduates only."**

It must be **refused** with an explanation. Remove the phrase and it should publish.

### Step 31 — Your data export works

Signed in, open the browser console (Cmd+Option+J) and run:

```js
fetch('/api/account/export',{method:'POST'}).then(r=>r.status).then(console.log)
```

You should see `200`.

### Step 32 — Old sessions really are dead

You should have been signed out everywhere when `AUTH_SECRET` changed. If you were still signed in on your phone, refresh it — you should be at the login screen.

---

# If something goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| Site shows a 500 on every page | Migration did not run before the push | Do Steps 9–10, then redeploy from Vercel (**Deployments → ⋯ → Redeploy**) |
| "column does not exist" in Vercel logs | Same as above | Same as above |
| Nobody can post a job or send a message | Step 12 was skipped | Run the Step 12 SQL now. It fixes it immediately, no redeploy needed |
| Recruiter decks are empty | Same as above | Same |
| `password authentication failed` | `.env` connection string is wrong | Re-copy from Neon, check for a trailing space |
| Emails not arriving | Resend free tier | See below |
| Build fails: "No Output Directory named public" | Framework Preset reset to "Other" | Vercel → Settings → General → Framework Preset → **Next.js** → redeploy |
| Deployment fails on `vercel.json` | Cron set to more often than daily | Hobby allows daily only. Keep `0 6 * * *` |

---

# Email — the one thing that will still be limited

Resend's free tier delivers **only to the email address that owns your Resend account**. Everyone else gets nothing, silently.

Since email verification now gates posting, messaging and deck visibility, this matters more than it used to.

**To fix it, in Resend:**

1. **Domains** → **Add Domain** → enter a domain you own.
2. Resend gives you DNS records. Add them at your registrar (GoDaddy, Namecheap, Cloudflare — wherever you bought the domain).
3. Wait for **Verified** (usually under an hour).
4. In Vercel, set `EMAIL_FROM` to something like `Jobsy <hello@yourdomain.com>`.
5. Redeploy.

**Until then**, you can verify any account manually in the Neon SQL Editor:

```sql
UPDATE users SET email_verified = true WHERE email = 'their@email.com';
```

**Do not launch to strangers before email works.** A user who cannot receive a verification email cannot use the product, and will not know why.

---

# What is still NOT done after this deployment

Deploying this does not make Jobsy ready for the public. Three things are genuinely open:

1. **Accessibility is unverified.** WCAG 2.1 AA has not been tested. The swipe deck may not be keyboard-operable. California attaches a **$4,000 statutory minimum per violation**. This is the largest remaining technical risk.

2. **Live job ingestion has never run against a real endpoint.** All 11 connectors were tested against recorded samples only, because the development environment blocks outbound network access. Connect one real company and watch the result before trusting it.

3. **The legal documents are drafts, and say so on the page.** They exist so the signup flow is complete and testable. Before you open signups to the public, counsel needs to review them, and you need the scope determination in §1.5 of `JOBSY-PRODUCTION-READINESS.md` — whether Jobsy is a sourcing tool or a screening tool. It changes how much of the AI-hiring regime applies to you.

Testing with friends: fine. Public launch: not yet.

---

*Founded and originated by Vinodh Vemireddy. © 2026.*
