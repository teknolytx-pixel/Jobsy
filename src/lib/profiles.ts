import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, candidateProfiles, resumes, users, type CandidateProfileRow } from "@/db";

/**
 * MULTIPLE PROFILES FOR ONE PERSON.
 *
 * ── The shape, and why it is this shape ──
 *
 * `users` holds the person: name, email, where they live, whether they need
 * sponsorship. Asked once, true regardless of what they are applying for.
 *
 * `candidate_profiles` holds a DIRECTION: a headline, a set of skills, a salary
 * expectation, an availability, a CV. Someone moving from delivery management
 * into product needs two of these, and forcing them into one makes every
 * application a compromise.
 *
 * ── Exactly one is primary, and only that one is matched ──
 *
 * Matching every profile would sound generous and would not be. It doubles a
 * person's presence in every recruiter's deck, makes their score incoherent
 * (which profile was scored?), and hands the candidate with five profiles five
 * times the exposure of the one with a single honest profile. So the primary is
 * the live one; the rest are drafts to promote when the search turns.
 *
 * ── The mirror, stated plainly because it is a deliberate duplication ──
 *
 * The matching engine and both deck queries read these fields off `users` in
 * about a dozen places. Rewriting all of them to join a profile table would put
 * the blast radius of this feature on the one part of the product that must not
 * regress — and it would regress silently, as a slightly worse deck rather than
 * an error.
 *
 * So the primary profile is the source of truth and `users` carries a copy,
 * written by `syncPrimaryToUser` and by nothing else. Every path that changes
 * which profile is primary, or edits the primary, ends in that one function.
 */

/** The user columns that mirror the primary profile. Nothing else may write them. */
export type MirroredFields = {
  headline: string | null;
  skills: string[];
  yearsExp: number;
  salaryTarget: number | null;
  availability: string | null;
  bio: string | null;
};

export const mirrorOf = (p: CandidateProfileRow): MirroredFields => ({
  headline: p.headline,
  skills: p.skills,
  yearsExp: p.yearsExp,
  salaryTarget: p.salaryTarget,
  availability: p.availability,
  bio: p.bio,
});

/**
 * Copy the primary profile onto the user row.
 *
 * Called after every change that could alter which profile is primary or what
 * it contains. A no-op when the person has no profiles, which is the case for
 * recruiters and must not clear anything.
 */
export async function syncPrimaryToUser(userId: string): Promise<CandidateProfileRow | null> {
  const [primary] = await db
    .select()
    .from(candidateProfiles)
    .where(and(eq(candidateProfiles.userId, userId), eq(candidateProfiles.isPrimary, true)))
    .limit(1);

  if (!primary) return null;
  await db.update(users).set(mirrorOf(primary)).where(eq(users.id, userId));
  return primary;
}

export async function listProfiles(userId: string): Promise<CandidateProfileRow[]> {
  return db
    .select()
    .from(candidateProfiles)
    .where(eq(candidateProfiles.userId, userId))
    // Primary first — it is the one that matters, and a list that buries it
    // under three drafts invites promoting the wrong one.
    .orderBy(desc(candidateProfiles.isPrimary), asc(candidateProfiles.createdAt));
}

/** How many profiles one person may keep. */
export const MAX_PROFILES = 5;

export class ProfileLimit extends Error {
  constructor() {
    super(`You can keep up to ${MAX_PROFILES} profiles.`);
    this.name = "ProfileLimit";
  }
}

/**
 * Create a profile.
 *
 * The FIRST one is primary automatically — a person with exactly one profile
 * and no primary would match nothing, which is a worse outcome than any
 * default could be. Subsequent ones start secondary: promoting is a decision,
 * and quietly redirecting somebody's job search because they drafted a second
 * profile would be the wrong one to make for them.
 */
export async function createProfile(
  userId: string,
  input: { label: string } & Partial<MirroredFields> & { resumeId?: string | null }
): Promise<CandidateProfileRow> {
  const existing = await listProfiles(userId);
  if (existing.length >= MAX_PROFILES) throw new ProfileLimit();

  const [created] = await db
    .insert(candidateProfiles)
    .values({
      userId,
      label: input.label.trim().slice(0, 80),
      isPrimary: existing.length === 0,
      headline: input.headline ?? null,
      skills: input.skills ?? [],
      yearsExp: input.yearsExp ?? 0,
      salaryTarget: input.salaryTarget ?? null,
      availability: input.availability ?? null,
      bio: input.bio ?? null,
      resumeId: input.resumeId ?? null,
    })
    .returning();

  if (created.isPrimary) await syncPrimaryToUser(userId);
  return created;
}

/**
 * Update one profile.
 *
 * Scoped by userId in the WHERE clause rather than checked beforehand: a
 * profile id is guessable, and an ownership check that happens in a separate
 * query is a check somebody can forget to write on the next endpoint. Here the
 * only way to name a row is to also name its owner.
 */
export async function updateProfile(
  userId: string,
  profileId: string,
  patch: Partial<MirroredFields> & { label?: string; resumeId?: string | null }
): Promise<CandidateProfileRow | null> {
  const [updated] = await db
    .update(candidateProfiles)
    .set({
      ...(patch.label === undefined ? {} : { label: patch.label.trim().slice(0, 80) }),
      ...(patch.headline === undefined ? {} : { headline: patch.headline }),
      ...(patch.skills === undefined ? {} : { skills: patch.skills }),
      ...(patch.yearsExp === undefined ? {} : { yearsExp: patch.yearsExp }),
      ...(patch.salaryTarget === undefined ? {} : { salaryTarget: patch.salaryTarget }),
      ...(patch.availability === undefined ? {} : { availability: patch.availability }),
      ...(patch.bio === undefined ? {} : { bio: patch.bio }),
      ...(patch.resumeId === undefined ? {} : { resumeId: patch.resumeId }),
      updatedAt: new Date(),
    })
    .where(and(eq(candidateProfiles.id, profileId), eq(candidateProfiles.userId, userId)))
    .returning();

  if (!updated) return null;
  // Editing the live profile has to reach the matcher, or the candidate updates
  // their skills and keeps seeing yesterday's jobs.
  if (updated.isPrimary) await syncPrimaryToUser(userId);
  return updated;
}

/**
 * Promote a profile.
 *
 * In one transaction, because between demoting the old primary and promoting
 * the new one the person has NO primary — and a request that dies in that gap
 * leaves them matching nothing, silently, until they notice. The partial unique
 * index would also reject the second write if the order were reversed.
 */
export async function setPrimary(userId: string, profileId: string): Promise<boolean> {
  const promoted = await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: candidateProfiles.id })
      .from(candidateProfiles)
      .where(and(eq(candidateProfiles.id, profileId), eq(candidateProfiles.userId, userId)))
      .limit(1);
    if (!target) return false;

    await tx
      .update(candidateProfiles)
      .set({ isPrimary: false })
      .where(and(eq(candidateProfiles.userId, userId), eq(candidateProfiles.isPrimary, true)));

    await tx
      .update(candidateProfiles)
      .set({ isPrimary: true, updatedAt: new Date() })
      .where(eq(candidateProfiles.id, target.id));

    return true;
  });

  if (promoted) await syncPrimaryToUser(userId);
  return promoted;
}

/**
 * Delete a profile.
 *
 * The primary cannot be deleted while another exists — promote first. That is a
 * refusal rather than an automatic hand-off because "which one is live now?" is
 * the candidate's decision, and picking for them is how somebody ends up
 * job-hunting under a profile they abandoned.
 *
 * The LAST profile cannot be deleted at all: a candidate with none matches
 * nothing and has no obvious way to discover why.
 */
export async function deleteProfile(
  userId: string,
  profileId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const all = await listProfiles(userId);
  const target = all.find((p) => p.id === profileId);
  if (!target) return { ok: false, reason: "That profile doesn't exist." };
  if (all.length === 1) {
    return { ok: false, reason: "This is your only profile — editing it is the way to change direction." };
  }
  if (target.isPrimary) {
    return { ok: false, reason: "Make another profile primary first, then delete this one." };
  }

  await db
    .delete(candidateProfiles)
    .where(and(eq(candidateProfiles.id, profileId), eq(candidateProfiles.userId, userId)));
  return { ok: true };
}

/**
 * Attach an uploaded CV to a profile.
 *
 * Both ids are checked against the owner in the same statement. A resume id
 * belonging to somebody else must not be attachable to your profile — that
 * would be a way to read another person's CV through your own profile page.
 */
export async function attachResume(
  userId: string,
  profileId: string,
  resumeId: string | null
): Promise<boolean> {
  if (resumeId) {
    const [owned] = await db
      .select({ id: resumes.id })
      .from(resumes)
      .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId)))
      .limit(1);
    if (!owned) return false;
  }

  const [updated] = await db
    .update(candidateProfiles)
    .set({ resumeId, updatedAt: new Date() })
    .where(and(eq(candidateProfiles.id, profileId), eq(candidateProfiles.userId, userId)))
    .returning({ id: candidateProfiles.id });

  return Boolean(updated);
}

/**
 * Make sure a candidate has at least one profile.
 *
 * Called on first sight of a candidate who predates this feature or whose
 * registration created a user before the profile. Idempotent, and seeded from
 * the user row so nothing they had already entered is lost.
 */
export async function ensureProfile(userId: string): Promise<CandidateProfileRow> {
  const existing = await listProfiles(userId);
  if (existing.length) return existing[0];

  const [u] = await db
    .select({
      headline: users.headline,
      skills: users.skills,
      yearsExp: users.yearsExp,
      salaryTarget: users.salaryTarget,
      availability: users.availability,
      bio: users.bio,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return createProfile(userId, { label: "General", ...(u ?? {}) });
}

/** Profiles with their CV filename, for the profile screen. */
export async function profilesWithResumes(userId: string) {
  return db
    .select({
      profile: candidateProfiles,
      resumeFilename: resumes.filename,
    })
    .from(candidateProfiles)
    .leftJoin(resumes, eq(resumes.id, candidateProfiles.resumeId))
    .where(eq(candidateProfiles.userId, userId))
    .orderBy(desc(candidateProfiles.isPrimary), asc(candidateProfiles.createdAt));
}

/** How many people have more than one. Used by the admin health view. */
export async function multiProfileCount(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(
      db
        .select({ userId: candidateProfiles.userId })
        .from(candidateProfiles)
        .groupBy(candidateProfiles.userId)
        .having(sql`count(*) > 1`)
        .as("multi")
    );
  return row?.n ?? 0;
}
