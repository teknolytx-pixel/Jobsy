#!/usr/bin/env tsx
/**
 * MULTIPLE PROFILES — the invariants, and the boundary.
 *
 * Ordinary CRUD is not what deserves tests here. Three things do, because each
 * one fails silently and hurts a real person:
 *
 *   1. EXACTLY ONE PRIMARY. A candidate with none matches nothing and has no
 *      way to discover why. A candidate with two has an incoherent score —
 *      which profile was scored? — and twice the presence of an honest one.
 *   2. THE MIRROR STAYS TRUE. The matching engine reads `users`, not profiles.
 *      If promotion doesn't reach it, somebody switches direction and keeps
 *      being shown yesterday's jobs.
 *   3. ONE PERSON'S PROFILES ARE THEIRS. A profile id is guessable, and a CV
 *      attached across an ownership boundary would render somebody else's
 *      resume on your page.
 *
 *   npx tsx scripts/test-profiles.mts
 */
import "dotenv/config";
const { assertNotProduction } = await import("./_not-production.mts");
assertNotProduction("test-profiles");

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const { and, eq } = await import("drizzle-orm");
const { db, users, candidateProfiles, resumes } = await import("../src/db");
const {
  createProfile, listProfiles, setPrimary, updateProfile, deleteProfile,
  attachResume, ensureProfile, MAX_PROFILES, ProfileLimit,
} = await import("../src/lib/profiles");

const stamp = `proftest-${Date.now()}`;
const mkUser = async (suffix: string) => {
  const [u] = await db
    .insert(users)
    .values({
      email: `${stamp}-${suffix}@example.com`,
      name: "Prof Test",
      role: "CANDIDATE",
      passwordHash: "x".repeat(60),
      skills: ["Python", "SQL"],
      headline: "Data Engineer",
      yearsExp: 7,
    })
    .returning();
  return u;
};

const alice = await mkUser("a");
const mallory = await mkUser("b");

// ─────────────────────────────────────────────────────────────
console.log("\nEXACTLY ONE PRIMARY\n");

const first = await createProfile(alice.id, { label: "Data Engineering", skills: ["Python", "PySpark"] });
check("TC-PROF-01 the first profile is primary automatically", first.isPrimary,
  "a candidate with no primary matches nothing");

const second = await createProfile(alice.id, { label: "ML Engineering", skills: ["PyTorch"] });
check("TC-PROF-02 later profiles start as drafts", !second.isPrimary,
  "promoting is a decision, not a side effect of drafting");

const countPrimaries = async (userId: string) =>
  (await listProfiles(userId)).filter((p) => p.isPrimary).length;
check("TC-PROF-03 there is still exactly one primary", (await countPrimaries(alice.id)) === 1);

await setPrimary(alice.id, second.id);
check("TC-PROF-04 promoting swaps rather than adds", (await countPrimaries(alice.id)) === 1);
const afterSwap = await listProfiles(alice.id);
check("TC-PROF-05 and the right one is live",
  afterSwap.find((p) => p.isPrimary)?.id === second.id,
  afterSwap.find((p) => p.isPrimary)?.label);

/**
 * The database refuses two primaries even if application code is bypassed.
 * "Exactly one" is an invariant, and invariants belong where a race cannot
 * reach them.
 */
let dbRefused = false;
try {
  await db.update(candidateProfiles).set({ isPrimary: true }).where(eq(candidateProfiles.id, first.id));
} catch {
  dbRefused = true;
}
check("TC-PROF-06 the DATABASE refuses a second primary", dbRefused,
  "partial unique index, not application code");

// ─────────────────────────────────────────────────────────────
console.log("\nTHE MIRROR THE MATCHER READS\n");

const readUser = async (id: string) =>
  (await db.select().from(users).where(eq(users.id, id)))[0];

let u = await readUser(alice.id);
check("TC-PROF-10 promoting rewrites the matched skills",
  u.skills.join() === "PyTorch", u.skills.join());
check("TC-PROF-11 and the matched headline follows too",
  u.headline === second.headline, String(u.headline));

await updateProfile(alice.id, second.id, { skills: ["PyTorch", "MLOps"], yearsExp: 9 });
u = await readUser(alice.id);
check("TC-PROF-12 editing the live profile reaches the matcher",
  u.skills.join() === "PyTorch,MLOps" && u.yearsExp === 9, `${u.skills.join()} / ${u.yearsExp}`);

await updateProfile(alice.id, first.id, { skills: ["Python", "Airflow"] });
u = await readUser(alice.id);
check("TC-PROF-13 editing a DRAFT does not",
  u.skills.join() === "PyTorch,MLOps", u.skills.join());

await setPrimary(alice.id, first.id);
u = await readUser(alice.id);
check("TC-PROF-14 switching back restores that profile's skills",
  u.skills.join() === "Python,Airflow", u.skills.join());

// ─────────────────────────────────────────────────────────────
console.log("\nONE PERSON'S PROFILES ARE THEIRS\n");

const stolen = await updateProfile(mallory.id, first.id, { label: "Mine now" });
check("TC-PROF-20 another user cannot edit your profile", stolen === null);
const stillMine = (await listProfiles(alice.id)).find((p) => p.id === first.id);
check("TC-PROF-21 and it is unchanged", stillMine?.label === "Data Engineering", stillMine?.label);

check("TC-PROF-22 nor promote it", (await setPrimary(mallory.id, first.id)) === false);
const del = await deleteProfile(mallory.id, second.id);
check("TC-PROF-23 nor delete it", del.ok === false, del.ok ? "" : del.reason);

/** A CV belonging to somebody else must not be attachable to your profile. */
const [malloryCv] = await db
  .insert(resumes)
  .values({
    userId: mallory.id,
    storageKey: `${stamp}/cv.pdf`,
    filename: "mallory.pdf",
    mime: "application/pdf",
    bytes: 1024,
  })
  .returning();

check("TC-PROF-24 you cannot attach someone else's CV to your profile",
  (await attachResume(alice.id, first.id, malloryCv.id)) === false,
  "would render their CV on your page");
check("TC-PROF-25 and your own attaches fine",
  (await attachResume(mallory.id, (await ensureProfile(mallory.id)).id, malloryCv.id)) === true);

// ─────────────────────────────────────────────────────────────
console.log("\nDELETION RULES\n");

const delPrimary = await deleteProfile(alice.id, first.id);
check("TC-PROF-30 the live profile cannot be deleted while another exists",
  delPrimary.ok === false, delPrimary.ok ? "" : delPrimary.reason);

const delDraft = await deleteProfile(alice.id, second.id);
check("TC-PROF-31 a draft can be", delDraft.ok === true);

const delLast = await deleteProfile(alice.id, first.id);
check("TC-PROF-32 the last profile cannot be deleted at all",
  delLast.ok === false, delLast.ok ? "" : delLast.reason);

// ─────────────────────────────────────────────────────────────
console.log("\nLIMITS AND BACKFILL\n");

for (let i = 0; i < MAX_PROFILES - 1; i++) {
  await createProfile(alice.id, { label: `Extra ${i}` });
}
let limited = false;
try {
  await createProfile(alice.id, { label: "One too many" });
} catch (e) {
  limited = e instanceof ProfileLimit;
}
check(`TC-PROF-40 no more than ${MAX_PROFILES} profiles`, limited);

/** Someone who predates the feature is seeded from what they already had. */
const legacy = await mkUser("c");
const seeded = await ensureProfile(legacy.id);
check("TC-PROF-41 an older candidate is seeded from their user row",
  seeded.isPrimary && seeded.skills.join() === "Python,SQL" && seeded.yearsExp === 7,
  `${seeded.label}: ${seeded.skills.join()} / ${seeded.yearsExp}`);
check("TC-PROF-42 and calling it again is a no-op",
  (await ensureProfile(legacy.id)).id === seeded.id);

// ── cleanup ──
for (const id of [alice.id, mallory.id, legacy.id]) {
  await db.delete(candidateProfiles).where(eq(candidateProfiles.userId, id));
  await db.delete(resumes).where(eq(resumes.userId, id));
  await db.delete(users).where(and(eq(users.id, id)));
}

console.log(`\n${pass} passed, ${fail} failed  —  candidate profiles\n`);
process.exit(fail ? 1 : 0);
