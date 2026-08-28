import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, users, termsAcceptances, notificationPrefs, companies, companyMembers } from "@/db";
import { createSession, hashPassword, setSessionCookie } from "@/lib/auth";
import { clientIp, consume, tooMany } from "@/lib/ratelimit";
import { audit } from "@/lib/audit";
import { sendVerification } from "@/lib/verification";
import { newToken, hashToken } from "@/lib/tokens";
import { CURRENT_TERMS, CURRENT_PRIVACY } from "@/lib/legalVersions";
import { stateOf } from "@/lib/compliance/jurisdiction";
import { createProfile } from "@/lib/profiles";
import { deliverAedtNotice } from "@/lib/compliance/aedt";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  /**
   * Asked as two fields, stored as three.
   *
   * `name` stays the display string every existing screen already reads, and is
   * derived here rather than asked for twice. Splitting a full name reliably is
   * not possible — "Maria del Carmen Ortiz Gómez" has no safe midpoint — so the
   * parts are collected at the only moment somebody can tell us which is which.
   */
  firstName: z.string().min(1, "Please enter your first name").max(120),
  lastName: z.string().min(1, "Please enter your last name").max(120),
  phone: z.string().max(60).optional(),
  /**
   * CAN-001 / REC-001 — chosen once, at signup, and only ever one of two.
   * BOTH is gone: it existed only as the side effect of a candidate posting a
   * job. Platform staff are flagged by isPlatformAdmin, which no request body
   * can reach.
   */
  role: z.enum(["CANDIDATE", "RECRUITER"]).default("CANDIDATE"),
  location: z.string().max(200).optional(),

  // ── candidate ──
  /** Primary skills, so the first deck is relevant instead of random. */
  /*
   * No min(1) on the entries. A comma-separated field trivially produces a
   * trailing empty string, and rejecting the whole registration over it would
   * be an absurd way to lose a candidate. They are trimmed and dropped below,
   * where the cleanup belongs.
   */
  skills: z.array(z.string().max(60)).max(40).optional(),
  /**
   * "Will you now or in the future require sponsorship for employment visa
   * status?" — the standard, EEO-safe form of this question.
   *
   * It asks about SPONSORSHIP, which is a fact about the job, and never about
   * citizenship, national origin or immigration status, which are protected and
   * which IRCA forbids screening on. The matching engine already reads this
   * field to avoid showing people roles that cannot hire them — a filter that
   * helps the candidate rather than excluding them.
   */
  requiresSponsorship: z.boolean().optional(),

  // ── recruiter ──
  /** Optional at registration; a recruiter can post before naming a company. */
  companyName: z.string().max(160).optional(),
  /** Whether this person administers the company account or just recruits. */
  companyAdmin: z.boolean().optional(),
  /**
   * LEGAL-009 — clickwrap. The UI presents a separate checkbox directly above
   * the Create Account button with matching button text. This field is the
   * server-side half: without it there is no account, so the assent cannot be
   * bypassed by calling the API directly.
   */
  acceptedTerms: z.literal(true, {
    message: "Please accept the Terms of Service and Privacy Policy to continue",
  }),
});

export async function POST(req: Request) {
  const ip = clientIp(req);

  const rl = await consume("signupIp", ip);
  if (!rl.ok) {
    await audit({ action: "auth.rate_limited", detail: { endpoint: "signup" }, ip });
    return tooMany(rl, "Too many accounts created from this network. Please try again later.");
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input", field: parsed.error.issues[0]?.path?.[0] },
      { status: 400 }
    );
  }
  const {
    email, password, firstName, lastName, phone, role, location,
    skills, requiresSponsorship, companyName, companyAdmin,
  } = parsed.data;
  const name = `${firstName.trim()} ${lastName.trim()}`.trim();
  const lower = email.toLowerCase().trim();

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, lower)).limit(1);
  if (existing[0]) {
    return NextResponse.json({ error: "An account with that email already exists" }, { status: 409 });
  }

  const [user] = await db
    .insert(users)
    .values({
      email: lower,
      name,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: phone?.trim() || null,
      passwordHash: await hashPassword(password),
      role,
      location: location?.trim() || null,
      /*
       * Only ever set from what THIS person told us about themselves, and only
       * for a candidate. A recruiter's answer would be meaningless and a
       * recruiter's account must never carry a field the matcher reads.
       */
      skills: role === "CANDIDATE" ? (skills ?? []).map((v) => v.trim()).filter(Boolean).slice(0, 40) : [],
      requiresSponsorship: role === "CANDIDATE" ? requiresSponsorship ?? null : null,
      // Used ONLY to select which legal notices apply. Never a matching input.
      jurisdiction: stateOf(location) ?? null,
    })
    .returning();

  // LEGAL-009 AC-5 — record exactly what was accepted, in which version, from
  // where. Without this row there is no evidence of assent, and the arbitration
  // clause binds nobody.
  await db.insert(termsAcceptances).values([
    {
      userId: user.id,
      document: "TERMS_OF_SERVICE",
      version: CURRENT_TERMS,
      ip,
      userAgent: req.headers.get("user-agent")?.slice(0, 1000) ?? null,
    },
    {
      userId: user.id,
      document: "PRIVACY_POLICY",
      version: CURRENT_PRIVACY,
      ip,
      userAgent: req.headers.get("user-agent")?.slice(0, 1000) ?? null,
    },
  ]);

  // NOTIF-001 — defaults, plus the token that makes an unsubscribe link work
  // without a login.
  await db.insert(notificationPrefs).values({
    userId: user.id,
    unsubscribeTokenHash: hashToken(newToken()),
  });

  /*
   * REC-002 — a recruiter who named a company gets one, and administers it.
   *
   * Created here rather than in a later step because the ask is that a
   * recruiter can post the moment they register. A company is optional: an
   * independent recruiter posts perfectly well without one, and inventing a
   * shell company for them would put a meaningless employer name on every job
   * they publish.
   */
  if (role === "RECRUITER" && companyName?.trim()) {
    const slug =
      companyName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) ||
      `company-${user.id.slice(0, 8)}`;
    const [company] = await db
      .insert(companies)
      .values({ name: companyName.trim().slice(0, 160), slug, source: "JOBSY" })
      .onConflictDoNothing({ target: companies.slug })
      .returning();

    const attached =
      company ??
      (await db.select().from(companies).where(eq(companies.slug, slug)).limit(1))[0];

    if (attached) {
      await db.update(users).set({ companyId: attached.id }).where(eq(users.id, user.id));
      await db
        .insert(companyMembers)
        .values({
          companyId: attached.id,
          userId: user.id,
          // Someone registering a company IS its first administrator; there is
          // nobody else to grant it.
          seatRole: companyAdmin === false ? "RECRUITER" : "COMPANY_ADMIN",
        })
        .onConflictDoNothing();
    }
  }

  /*
   * CAN-00x — the general profile, created at registration.
   *
   * A candidate with no profile matches nothing, and would have no way to tell
   * why: the profile screen would offer to create one, which reads as a chore
   * rather than a cause. Seeded from what they just typed, so the first profile
   * already contains their skills rather than being an empty shell.
   */
  if (role === "CANDIDATE") {
    await createProfile(user.id, {
      label: "General",
      headline: null,
      skills: user.skills,
      yearsExp: 0,
      salaryTarget: null,
      availability: null,
      bio: null,
    });
  }

  // XPLAIN-002 — the AEDT notice is delivered at signup, before any automated
  // assessment runs. In NYC it also starts the 10-business-day clock.
  await deliverAedtNotice(user.id, user.jurisdiction);

  await sendVerification(user.id, user.email, user.name);

  await setSessionCookie(await createSession(user.id, user.email, user.sessionVersion));

  await audit({
    action: "auth.signup",
    actorId: user.id,
    subjectType: "user",
    subjectId: user.id,
    detail: { role, jurisdiction: user.jurisdiction },
    ip,
  });
  await audit({
    action: "legal.terms_accepted",
    actorId: user.id,
    subjectType: "user",
    subjectId: user.id,
    detail: { terms: CURRENT_TERMS, privacy: CURRENT_PRIVACY },
    ip,
  });

  return NextResponse.json(
    {
      ok: true,
      userId: user.id,
      role: user.role,
      /** Where the client should go next. A recruiter can post immediately. */
      next: role === "RECRUITER" ? "/jobs" : "/onboarding",
      profileReady: false,
      emailVerified: false,
      message: "Check your email to verify your address.",
    },
    { status: 201 }
  );
}
