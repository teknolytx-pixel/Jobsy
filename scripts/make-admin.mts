#!/usr/bin/env tsx
/**
 * Promote an existing account to platform administrator.
 *
 *   npm run make-admin -- you@example.com
 *   npm run make-admin -- you@example.com --revoke
 *
 * ── Why this is a script and not a screen ──
 *
 * There is no UI for granting admin, on purpose. An admin can read every
 * moderation report, every privacy request and, through `hasRole()`, both sides
 * of the marketplace. A button that grants that is a button worth attacking:
 * the first thing anyone who compromises an account looks for is the path to
 * more privilege. Requiring database credentials to hand out administrator
 * rights means the attacker already had to have them.
 *
 * ── What being an admin actually does ──
 *
 * `hasRole()` returns true for an admin against BOTH roles, so one admin
 * account can use the candidate deck and the recruiter surface. That is the
 * only exception to one-account-one-role, and it exists so the two sides can be
 * tested end to end without keeping two logins.
 *
 * Ordinary accounts are unchanged: a job seeker still cannot post a role and a
 * recruiter still cannot apply for one.
 */
// Same as every other script here: the DB client reads process.env at import
// time, so dotenv has to win the race.
await import("dotenv/config");
const { db, users } = await import("../src/db");
const { eq } = await import("drizzle-orm");
const { audit } = await import("../src/lib/audit");

const args = process.argv.slice(2);
const revoke = args.includes("--revoke");
const email = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();

if (!email) {
  console.error("\nUsage: npm run make-admin -- you@example.com [--revoke]\n");
  process.exit(1);
}

const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);

if (!existing) {
  // Deliberately does not create one. An admin account should be an account a
  // real person already signed up for and can already log into, not a second
  // credential invented by a script and then forgotten about.
  console.error(`\nNo account with the email ${email}.`);
  console.error("Sign up normally first, then run this against that address.\n");
  process.exit(1);
}

if (existing.deletedAt) {
  console.error(`\n${email} is a deleted account. Refusing.\n`);
  process.exit(1);
}

const [updated] = await db
  .update(users)
  .set({ isPlatformAdmin: !revoke, updatedAt: new Date() })
  .where(eq(users.id, existing.id))
  .returning();

await audit({
  action: revoke ? "admin.user_unsuspended" : "admin.user_suspended",
  actorId: updated.id,
  subjectType: "user",
  subjectId: updated.id,
  detail: { change: revoke ? "platform_admin_revoked" : "platform_admin_granted", via: "cli" },
});

console.log(`\n  ${updated.email}`);
console.log(`  platform admin: ${updated.isPlatformAdmin ? "YES" : "no"}`);
console.log(`  account role:   ${updated.role}  (unchanged — admin is in addition, not instead)`);
if (updated.isPlatformAdmin) {
  console.log("\n  This account can now open /admin, and can use both the job seeker");
  console.log("  and recruiter surfaces. Sign out and back in to pick it up.\n");
} else {
  console.log("\n  Administrator rights removed.\n");
}
process.exit(0);
