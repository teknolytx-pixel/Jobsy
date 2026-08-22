#!/usr/bin/env tsx
/**
 * Why did that email not arrive?
 *
 *   npm run email-check
 *   npm run email-check -- someone@example.com
 *
 * `sendEmail()` writes an `email_logs` row for every message before it tries to
 * send, then updates the status. So the answer is always already recorded — it
 * has simply never been readable without a database client.
 *
 * The four outcomes and what each one means:
 *
 *   SENT         Resend accepted it. If it did not arrive, the problem is
 *                downstream — spam filtering, or Resend's own restriction (see
 *                the note this script prints when it sees onboarding@resend.dev).
 *   FAILED       Resend rejected it. The reason is in the row.
 *   LOGGED_ONLY  RESEND_API_KEY was not set. The message was printed to the
 *                server console and discarded. This is the one that looks
 *                healthy from the outside: the app still says "we've sent a
 *                reset link".
 *   SUPPRESSED   The recipient turned this notification off.
 */
await import("dotenv/config");
const { db, emailLogs } = await import("../src/db");
const { desc, eq } = await import("drizzle-orm");

const who = process.argv.slice(2).find((a) => !a.startsWith("--"))?.trim().toLowerCase();

const rows = await db
  .select()
  .from(emailLogs)
  .where(who ? eq(emailLogs.to, who) : undefined)
  .orderBy(desc(emailLogs.createdAt))
  .limit(25);

if (!rows.length) {
  console.log(
    who
      ? `\n  No email has ever been attempted to ${who}.\n  If they asked for a reset, the account may not exist — the request endpoint\n  deliberately says "if an account exists" either way, so it cannot be used to\n  discover which addresses are registered.\n`
      : "\n  No email has ever been attempted on this database.\n"
  );
  process.exit(0);
}

const from = process.env.EMAIL_FROM ?? "Jobsy <onboarding@resend.dev>";
const hasKey = Boolean(process.env.RESEND_API_KEY?.trim());

console.log(`\n  ── this machine's .env (NOT the server that sent the messages) ──`);
console.log(`  RESEND_API_KEY   ${hasKey ? "set" : "not set"}`);
console.log(`  EMAIL_FROM       ${from}`);
console.log(`  APP_URL          ${process.env.NEXT_PUBLIC_APP_URL ?? "(unset — links will point at localhost)"}`);
console.log(`\n  Last ${rows.length} message${rows.length === 1 ? "" : "s"}${who ? ` to ${who}` : ""}:\n`);

const counts: Record<string, number> = {};
for (const r of rows) {
  counts[r.status] = (counts[r.status] ?? 0) + 1;
  const when = r.createdAt.toISOString().replace("T", " ").slice(0, 16);
  console.log(`    ${when}  ${r.status.padEnd(12)} ${r.template.padEnd(22)} ${r.to}`);
  if (r.error) console.log(`                 └─ ${r.error.slice(0, 160)}`);
}

console.log("\n  ── What this means ──\n");

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
if (/jobsy-weld/i.test(appUrl)) {
  console.log("  NEXT_PUBLIC_APP_URL points at jobsy-weld, the OLD Vercel project.");
  console.log("  Even once email sends, every reset and verification link will take");
  console.log("  people to a stale site where the token is not valid.");
  console.log("  Fix: set it to https://jobsy-git-main-jobsy3.vercel.app and redeploy.\n");
}

if (counts.LOGGED_ONLY) {
  console.log("  LOGGED_ONLY means the SERVER that handled the request had no");
  console.log("  RESEND_API_KEY, so those messages were printed to its log and thrown");
  console.log("  away. Nobody received them. A key set on this laptop does not count —");
  console.log("  production reads Vercel's environment, which is separate.");
  console.log("  Fix: add RESEND_API_KEY in Vercel → Settings → Environment Variables,");
  console.log("  tick all three environments, then redeploy.\n");
}

if (counts.FAILED) {
  console.log("  FAILED means Resend rejected the message. The reason is on the line above.\n");
}

if (counts.SENT && /onboarding@resend\.dev/i.test(from)) {
  // The single most common cause of "it says sent but nothing arrived".
  console.log("  SENT, but EMAIL_FROM is still Resend's shared test sender.");
  console.log("  Resend only delivers from onboarding@resend.dev to the email address that");
  console.log("  owns the Resend account. Every other recipient is accepted and dropped —");
  console.log("  which is exactly what 'it says sent and nothing arrives' looks like.");
  console.log("  Fix: verify your own domain in Resend, then set EMAIL_FROM to an address");
  console.log("  at that domain.\n");
} else if (counts.SENT) {
  console.log("  SENT means Resend accepted it. If it did not arrive, check the spam folder");
  console.log("  and the Resend dashboard for a bounce.\n");
}

if (counts.SUPPRESSED) {
  console.log("  SUPPRESSED means the recipient turned that notification off in settings.\n");
}

process.exit(0);
