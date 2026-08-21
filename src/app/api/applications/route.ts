import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { applications, db, jobs, users } from "@/db";
import { AuthError, authErrorResponse, requireRole } from "@/lib/auth";
import { APPLICATION_STATUS_LABEL, type ApplicationStatus } from "@/lib/applicationStatus";

export const dynamic = "force-dynamic";

/**
 * APP-003 — the list of people who applied to a role.
 *
 * Until now a recruiter got a count on the My Posts screen and a single email
 * at the moment of application. There was no list, no detail view, and no
 * endpoint — so an application that arrived while you weren't reading email was
 * effectively invisible.
 */
export async function GET(req: Request) {
  try {
    const me = await requireRole("RECRUITER");
    const jobId = new URL(req.url).searchParams.get("jobId");
    if (!jobId) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }

    // Ownership, not just role: a recruiter may only read applications to their
    // own postings. Being an employer is not authorisation to read every
    // employer's applicants.
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    if (job.postedById !== me.id && !me.isPlatformAdmin) {
      return NextResponse.json({ error: "Not your job post" }, { status: 403 });
    }

    const rows = await db
      .select({ app: applications, candidate: users })
      .from(applications)
      .innerJoin(users, eq(applications.candidateId, users.id))
      .where(and(eq(applications.jobId, jobId)))
      .orderBy(desc(applications.createdAt));

    return NextResponse.json({
      jobId,
      jobTitle: job.title,
      applications: rows.map((r) => ({
        id: r.app.id,
        status: r.app.status,
        statusLabel: APPLICATION_STATUS_LABEL[r.app.status as ApplicationStatus] ?? r.app.status,
        appliedAt: r.app.createdAt.toISOString(),
        candidate: {
          id: r.candidate.id,
          name: r.candidate.name,
          headline: r.candidate.headline,
          // NFR-002 — least privilege. A recruiter reading an applicant list
          // gets what they need to triage it. Contact details stay behind the
          // match, which is the point of the mutual-interest model.
          location: r.candidate.location,
          yearsExp: r.candidate.yearsExp,
          skills: r.candidate.skills,
        },
      })),
    });
  } catch (e) {
    const status = e instanceof AuthError ? 401 : 400;
    return authErrorResponse(e) ?? NextResponse.json({ error: (e as Error).message }, { status });
  }
}
