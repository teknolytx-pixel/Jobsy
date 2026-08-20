import { and, count, eq } from "drizzle-orm";
import { db, companies, companyMembers, jobs, users, type SeatRole, type User } from "@/db";
import { audit } from "./audit";

/**
 * COMP-002 / COMP-003 / SEAT-001 / SEAT-003 — company membership and permissions.
 *
 * Everything here is enforced server-side. Hiding a button in the UI is not
 * access control, and SEAT-003 AC-11 is a test that calls every admin endpoint
 * directly with a plain recruiter session and expects 403 from all of them.
 */

/** Free webmail domains never satisfy company domain verification (COMP-003 AC-5). */
const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "ymail.com", "rocketmail.com", "aol.com", "icloud.com", "me.com",
  "mac.com", "proton.me", "protonmail.com", "pm.me", "gmx.com", "gmx.net",
  "mail.com", "zoho.com", "yandex.com", "tutanota.com", "fastmail.com",
  "hey.com", "duck.com", "hushmail.com", "inbox.com", "mail.ru",
  // Disposable providers — a throwaway address is not proof of employment either.
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com",
  "yopmail.com", "trashmail.com", "sharklasers.com", "throwawaymail.com",
]);

export const isFreeMailDomain = (domain: string) => FREE_MAIL.has(domain.toLowerCase().trim());

export const domainOf = (email: string): string | null => {
  const at = email.lastIndexOf("@");
  return at > 0 ? email.slice(at + 1).toLowerCase().trim() : null;
};

export const slugify = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

export type Membership = {
  companyId: string;
  seatRole: SeatRole;
  isAdmin: boolean;
  verified: boolean;
  seatLimit: number;
};

/** The caller's membership, or null. One query, used by every permission check. */
export async function membershipOf(userId: string): Promise<Membership | null> {
  const rows = await db
    .select({
      companyId: companyMembers.companyId,
      seatRole: companyMembers.seatRole,
      status: companyMembers.status,
      verified: companies.verified,
      seatLimit: companies.seatLimit,
    })
    .from(companyMembers)
    .innerJoin(companies, eq(companyMembers.companyId, companies.id))
    .where(eq(companyMembers.userId, userId))
    .limit(1);

  const m = rows[0];
  // A suspended member has a row but no rights — treat them as having none,
  // rather than as an admin whose actions merely fail later.
  if (!m || m.status !== "ACTIVE") return null;
  return {
    companyId: m.companyId,
    seatRole: m.seatRole,
    isAdmin: m.seatRole === "COMPANY_ADMIN",
    verified: m.verified,
    seatLimit: m.seatLimit,
  };
}

export type Gate = { ok: true } | { ok: false; reason: string; code: string };

const deny = (reason: string, code: string): Gate => ({ ok: false, reason, code });

/** SEAT-003 — admin-only actions. */
export async function requireCompanyAdmin(userId: string): Promise<Membership> {
  const m = await membershipOf(userId);
  if (!m) throw new Error("You're not a member of a company on Jobsy");
  if (!m.isAdmin) throw new Error("Only a company admin can do this");
  return m;
}

/**
 * COMP-002 AC-3/4 + COMP-003 AC-3 — may this user post under this company slug?
 *
 * Three separate gates, in order of how badly getting them wrong would go:
 *
 *  1. TRUST-005 — you cannot post under a company someone else has verified.
 *     Without this check anyone can advertise a job as Stripe.
 *  2. COMP-002 — a member may only post under their own company.
 *  3. COMP-003 AC-3 — an unverified company is capped at 3 active jobs, which
 *     bounds the damage a bad actor can do before anyone notices.
 */
export async function canPostForCompany(user: User, slug: string): Promise<Gate> {
  const rows = await db.select().from(companies).where(eq(companies.slug, slug)).limit(1);
  const existing = rows[0];

  // A slug nobody has claimed yet is fine — the job route creates it, and the
  // creator becomes its first poster.
  if (!existing) return { ok: true };

  const m = await membershipOf(user.id);

  // TRUST-005 — a verified employer's name is theirs. Without this check
  // anyone can advertise a job as Stripe.
  if (existing.verified && (!m || m.companyId !== existing.id)) {
    return deny(
      `${existing.name} is a verified employer on Jobsy. Only members of that company can post roles for it. If you work there, ask a colleague to invite you.`,
      "COMPANY_VERIFIED_BY_OTHER"
    );
  }

  // COMP-002 AC-3/4 — a member posts under their own company, not another one.
  if (m && m.companyId !== existing.id) {
    return deny(
      "You're a member of a different company. Leave it first, or ask an admin to invite you.",
      "WRONG_COMPANY"
    );
  }

  // COMP-003 AC-3 — an unverified company is capped at 3 active postings, which
  // bounds what a bad actor can do before anyone notices.
  if (!existing.verified) {
    const [row] = await db
      .select({ n: count() })
      .from(jobs)
      .where(and(eq(jobs.companyId, existing.id), eq(jobs.active, true)));
    if ((row?.n ?? 0) >= 3) {
      return deny(
        "Unverified companies can have up to 3 active postings at a time. Verify your company's email domain to remove the limit.",
        "UNVERIFIED_JOB_CAP"
      );
    }
  }

  return { ok: true };
}

/**
 * SEAT-001 — create a company and seat the creator as its admin.
 *
 * Both writes go in one transaction. A company with no admin is unrecoverable
 * without database access, so a partial success here is worse than a failure.
 */
export async function createCompany(
  user: User,
  input: { name: string; website?: string | null; description?: string | null }
): Promise<{ companyId: string }> {
  const existingMembership = await membershipOf(user.id);
  if (existingMembership) {
    throw new Error("You already belong to a company. Leave it before creating another.");
  }

  const slug = slugify(input.name);
  if (!slug) throw new Error("Please enter a company name");

  const clash = await db.select().from(companies).where(eq(companies.slug, slug)).limit(1);
  if (clash[0]?.verified) {
    throw new Error(
      `${clash[0].name} is already a verified employer on Jobsy. If you work there, ask a colleague to invite you.`
    );
  }

  const emailDomain = domainOf(user.email);

  return db.transaction(async (tx) => {
    const [company] = clash[0]
      ? await tx
          .update(companies)
          .set({
            website: input.website ?? clash[0].website,
            description: input.description ?? clash[0].description,
            emailDomain: emailDomain && !isFreeMailDomain(emailDomain) ? emailDomain : clash[0].emailDomain,
          })
          .where(eq(companies.id, clash[0].id))
          .returning()
      : await tx
          .insert(companies)
          .values({
            name: input.name.trim(),
            slug,
            website: input.website ?? null,
            description: input.description ?? null,
            emailDomain: emailDomain && !isFreeMailDomain(emailDomain) ? emailDomain : null,
            source: "JOBSY",
          })
          .returning();

    await tx.insert(companyMembers).values({
      companyId: company.id,
      userId: user.id,
      seatRole: "COMPANY_ADMIN",
    });

    await tx
      .update(users)
      .set({
        companyId: company.id,
        role: user.role === "CANDIDATE" ? "BOTH" : user.role,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    return { companyId: company.id };
  });
}

/** SEAT-001 AC-2 — occupied seats, counting only ACTIVE members. */
export async function seatsUsed(companyId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.status, "ACTIVE")));
  return row?.n ?? 0;
}

/** SEAT-001 AC-4 — a company must always retain at least one admin. */
export async function adminCount(companyId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(companyMembers)
    .where(
      and(
        eq(companyMembers.companyId, companyId),
        eq(companyMembers.seatRole, "COMPANY_ADMIN"),
        eq(companyMembers.status, "ACTIVE")
      )
    );
  return row?.n ?? 0;
}

/** COMP-003 — mark a company verified and record how. */
export async function markVerified(
  companyId: string,
  method: "EMAIL" | "DNS",
  domain: string,
  actorId: string
): Promise<void> {
  await db
    .update(companies)
    .set({ verified: true, verifiedAt: new Date(), verifiedMethod: method, emailDomain: domain })
    .where(eq(companies.id, companyId));
  await audit({
    action: "company.verified",
    actorId,
    subjectType: "company",
    subjectId: companyId,
    detail: { method, domain },
  });
}
