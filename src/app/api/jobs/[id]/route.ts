import { NextResponse } from "next/server";
import { canTransition, isVisible, transitionError, JOB_STATUSES, type JobStatus } from "@/lib/jobStatus";
import { z } from "zod";
import { and, count, eq } from "drizzle-orm";
import { db, companies, jobs } from "@/db";
import { requireVerifiedUser, authErrorResponse } from "@/lib/auth";
import { membershipOf } from "@/lib/company";
import { checkPayTransparency } from "@/lib/compliance/payTransparency";
import { explainScreen, screenPosting } from "@/lib/compliance/contentScreen";
import { extractSkills, inferSeniority, normalizeSkills } from "@/lib/skills";
import { audit, safeDetail } from "@/lib/audit";
import { clientIp, consume, tooMany } from "@/lib/ratelimit";

/**
 * JOB-002 / JOB-003 — edit, confirm, and close a posting.
 *
 * AC-5 is the one worth stating: an INGESTED job is not editable here. The
 * employer's ATS is the source of truth, and an edit we made locally would be
 * silently reverted by the next sync — which is worse than refusing.
 */
const PatchBody = z.object({
  title: z.string().min(2).optional(),
  location: z.string().min(1).optional(),
  remote: z.enum(["ONSITE", "HYBRID", "REMOTE", "ANY"]).optional(),
  employmentType: z.string().optional(),
  salaryMin: z.number().int().min(0).max(2000).nullable().optional(),
  salaryMax: z.number().int().min(0).max(2000).nullable().optional(),
  benefitsDescription: z.string().max(4000).nullable().optional(),
  description: z.string().min(20).optional(),
  skills: z.array(z.string()).max(30).optional(),
  perks: z.array(z.string()).max(10).optional(),
  applyMethod: z.enum(["EASY", "EXTERNAL"]).optional(),
  applyUrl: z.string().url().nullable().optional(),
  sponsorshipAvailable: z.boolean().nullable().optional(),
  active: z.boolean().optional(),
  /**
   * FSD §8.1 — the lifecycle transition. `active` is still accepted for
   * backwards compatibility and is treated as shorthand: true means PUBLISHED,
   * false means CLOSED. Sending both is allowed; `status` wins, because it is
   * the more specific statement of intent.
   */
  status: z.enum(JOB_STATUSES).optional(),
  /**
   * LEGAL-002 — resent at publish time, because it is not stored on the job.
   *
   * `employeeCount` decides which state thresholds bite. Omitting it is treated
   * as "unknown", and unknown means every rule applies — the strict reading.
   * That is the right default (a missing fact should not create an exemption),
   * but it means a genuinely exempt small employer must resend the number when
   * publishing a draft, or be held to rules that do not apply to them.
   */
  employeeCount: z.number().int().min(1).max(5_000_000).nullable().optional(),
  /** JOB-003 / TRUST-001 — "yes, this is still open". */
  confirmStillOpen: z.boolean().optional(),
});

async function loadOwned(jobId: string, userId: string) {
  const rows = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  const job = rows[0];
  if (!job) return { error: NextResponse.json({ error: "Job not found" }, { status: 404 }) };

  if (job.source !== "JOBSY") {
    return {
      error: NextResponse.json(
        {
          error:
            "This posting comes from the employer's own careers site or applicant tracking system, so it's edited there rather than here. Any change we made would be overwritten by the next sync.",
          code: "INGESTED_NOT_EDITABLE",
        },
        { status: 400 }
      ),
    };
  }

  // AC-2 — the owner, or a COMPANY_ADMIN at the same company (SEAT-003).
  if (job.postedById !== userId) {
    const m = await membershipOf(userId);
    if (!m || !m.isAdmin || m.companyId !== job.companyId) {
      return {
        error: NextResponse.json(
          { error: "You can only edit your own postings", code: "NOT_YOUR_JOB" },
          { status: 403 }
        ),
      };
    }
  }
  return { job };
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const rows = await db
    .select({ job: jobs, company: companies })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(eq(jobs.id, id))
    .limit(1);
  const found = rows[0];
  if (!found) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  return NextResponse.json({
    job: {
      ...found.job,
      company: found.company.name,
      companyVerified: found.company.verified,
      postedAt: found.job.postedAt.toISOString(),
    },
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ip = clientIp(req);

  let me;
  try {
    me = await requireVerifiedUser();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const rl = await consume("write", me.id);
  if (!rl.ok) return tooMany(rl);

  const owned = await loadOwned(id, me.id);
  if (owned.error) return owned.error;
  const job = owned.job!;

  const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const b = parsed.data;

  // JOB-003 / TRUST-001 — the "still open" confirmation resets the expiry clock.
  if (b.confirmStillOpen) {
    await db
      .update(jobs)
      .set({ lastConfirmedAt: new Date(), expiryWarnedAt: null, active: true })
      .where(eq(jobs.id, id));
    await audit({ action: "job.attested", actorId: me.id, subjectType: "job", subjectId: id, ip });
    if (Object.keys(b).length === 1) {
      return NextResponse.json({ ok: true, confirmed: true });
    }
  }

  // Closing needs no compliance screen — nothing is being published.
  if (b.active === false && Object.keys(b).length === 1) {
    await db.update(jobs).set({ active: false, status: "CLOSED" }).where(eq(jobs.id, id));
    await audit({ action: "job.closed", actorId: me.id, subjectType: "job", subjectId: id, ip });
    return NextResponse.json({ ok: true, active: false });
  }

  const next = {
    title: b.title ?? job.title,
    description: b.description ?? job.description,
    location: b.location ?? job.location,
    remote: b.remote ?? job.remote,
    salaryMin: b.salaryMin !== undefined ? b.salaryMin : job.salaryMin,
    salaryMax: b.salaryMax !== undefined ? b.salaryMax : job.salaryMax,
    benefitsDescription:
      b.benefitsDescription !== undefined ? b.benefitsDescription : job.benefitsDescription,
    perks: b.perks ?? job.perks,
  };

  if (next.salaryMin != null && next.salaryMax != null && next.salaryMin > next.salaryMax) {
    return NextResponse.json(
      { error: "The minimum salary can't be above the maximum", field: "salaryMin" },
      { status: 400 }
    );
  }

  // TRUST-004 and LEGAL-002 run on every edit, not just creation. Otherwise a
  // recruiter can post a clean job and then edit in the language that would
  // have been blocked.
  const screen = screenPosting({
    title: next.title,
    description: next.description,
    perks: next.perks,
  });
  if (!screen.ok) {
    await audit({
      action: "trust.posting_blocked",
      actorId: me.id,
      subjectType: "job",
      subjectId: id,
      detail: safeDetail({ categories: screen.blocking.map((f) => f.category), phase: "edit" }),
      ip,
    });
    return NextResponse.json(
      { error: explainScreen(screen), code: "DISCRIMINATORY_CONTENT", findings: screen.blocking },
      { status: 400 }
    );
  }

  const pay = checkPayTransparency({
    location: next.location,
    remote: next.remote,
    salaryMin: next.salaryMin,
    salaryMax: next.salaryMax,
    benefitsDescription: next.benefitsDescription,
    consentSource: "EMPLOYER_SUBMITTED",
  });
  if (!pay.ok) {
    return NextResponse.json(
      {
        error: pay.message,
        code: "PAY_TRANSPARENCY_REQUIRED",
        problems: pay.problems,
        laws: pay.applicable.map((a) => ({ scope: a.scope, cite: a.rule.cite })),
      },
      { status: 400 }
    );
  }

  const skills = b.skills?.length
    ? normalizeSkills(b.skills)
    : b.description
      ? extractSkills(b.description)
      : job.skills;

  /**
   * FSD §8.1 — resolve the requested lifecycle change, and refuse an illegal
   * one rather than writing it.
   *
   * `active` and `status` are kept in lockstep here and nowhere else. Letting
   * any other code write one without the other is how they drift, and a drifted
   * pair means a posting that is invisible but still accepting applications —
   * or worse, the reverse.
   */
  const requested: JobStatus | null =
    b.status ?? (b.active === undefined ? null : b.active ? "PUBLISHED" : "CLOSED");

  if (requested && !canTransition(job.status as JobStatus, requested)) {
    return NextResponse.json(
      { error: transitionError(job.status as JobStatus, requested), code: "ILLEGAL_TRANSITION" },
      { status: 400 }
    );
  }

  const nextStatus: JobStatus = requested ?? (job.status as JobStatus);

  /**
   * LEGAL-002 — the pay-transparency gate, at the moment of PUBLISHING.
   *
   * Creating a DRAFT deliberately skips this check: the obligation attaches to
   * an advertised posting, and refusing to save an unfinished one enforces
   * nothing while pushing people to publish in order to keep their work.
   *
   * Which makes THIS the load-bearing check. A draft that has never been
   * validated is about to become public, so the same rules run here against the
   * job as it will actually be published — the merged values, not the ones it
   * was created with. Without this the draft feature would be a hole straight
   * through pay transparency in sixteen states.
   */
  if (nextStatus === "PUBLISHED" && job.status !== "PUBLISHED") {
    const pay = checkPayTransparency({
      location: next.location,
      remote: next.remote,
      salaryMin: next.salaryMin,
      salaryMax: next.salaryMax,
      benefitsDescription: next.benefitsDescription,
      employeeCount: b.employeeCount ?? null,
      consentSource: "EMPLOYER_SUBMITTED",
    });
    if (!pay.ok) {
      return NextResponse.json(
        {
          error: pay.message,
          code: "PAY_TRANSPARENCY_REQUIRED",
          problems: pay.problems,
          laws: pay.applicable.map((a) => ({ scope: a.scope, cite: a.rule.cite })),
        },
        { status: 400 }
      );
    }
  }

  const statusPatch = { status: nextStatus, active: isVisible(nextStatus) };

  await db
    .update(jobs)
    .set({
      title: next.title,
      description: next.description,
      location: next.location,
      remote: next.remote,
      employmentType: b.employmentType ?? job.employmentType,
      seniority: b.title || b.description ? inferSeniority(next.title, next.description) : job.seniority,
      salaryMin: next.salaryMin,
      salaryMax: next.salaryMax,
      benefitsDescription: next.benefitsDescription,
      employerSuppliedPay: next.salaryMin != null || next.salaryMax != null,
      skills,
      perks: next.perks,
      applyMethod: b.applyMethod ?? job.applyMethod,
      applyUrl: b.applyUrl !== undefined ? b.applyUrl : job.applyUrl,
      sponsorshipAvailable:
        b.sponsorshipAvailable !== undefined ? b.sponsorshipAvailable : job.sponsorshipAvailable,
      ...statusPatch,
      lastConfirmedAt: new Date(),
      expiryWarnedAt: null,
    })
    .where(eq(jobs.id, id));

  await audit({
    action: "job.updated",
    actorId: me.id,
    subjectType: "job",
    subjectId: id,
    detail: safeDetail({ fields: Object.keys(b) }),
    ip,
  });

  // AC-3 — editing does NOT reset existing swipes or matches. A typo fix must
  // not throw away everyone who already engaged with the posting.
  const [{ n: swipeCount }] = await db
    .select({ n: count() })
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.active, true)));

  return NextResponse.json({
    ok: true,
    skills,
    payLawsApplied: pay.applicable.map((a) => ({ scope: a.scope, cite: a.rule.cite })),
    advisories: screen.advisory,
    preserved: { swipesAndMatches: true, activeRows: swipeCount },
  });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let me;
  try {
    me = await requireVerifiedUser();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const owned = await loadOwned(id, me.id);
  if (owned.error) return owned.error;

  // AC-4 — closing, not deleting. Existing matches and threads survive, and the
  // card shows "This role has closed" rather than vanishing mid-conversation.
  await db.update(jobs).set({ active: false, status: "CLOSED" }).where(eq(jobs.id, id));
  await audit({
    action: "job.closed",
    actorId: me.id,
    subjectType: "job",
    subjectId: id,
    ip: clientIp(req),
  });
  return NextResponse.json({
    ok: true,
    message: "Closed. Anyone already matched keeps their conversation.",
  });
}
