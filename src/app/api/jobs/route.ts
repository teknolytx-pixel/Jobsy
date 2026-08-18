import { NextResponse } from "next/server";
import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { applications, companies, db, jobs, matches, recruiterSwipes, users } from "@/db";
import { AuthError, requireUser } from "@/lib/auth";
import { extractSkills, inferSeniority, normalizeSkills } from "@/lib/skills";

const Body = z.object({
  title: z.string().min(2),
  companyName: z.string().min(1),
  location: z.string().min(1),
  remote: z.enum(["ONSITE", "HYBRID", "REMOTE", "ANY"]).default("ONSITE"),
  employmentType: z.string().default("Full-time"),
  salaryMin: z.number().int().min(0).max(2000).nullable().optional(),
  salaryMax: z.number().int().min(0).max(2000).nullable().optional(),
  description: z.string().min(20),
  skills: z.array(z.string()).max(30).optional(),
  perks: z.array(z.string()).max(10).optional(),
  /** Spec #7: the poster decides how candidates apply. */
  applyMethod: z.enum(["EASY", "EXTERNAL"]).default("EASY"),
  applyUrl: z.string().url().optional().nullable(),
});

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await db
      .select({
        job: jobs,
        company: companies,
        applicants: sql<number>`(select count(*)::int from ${applications} where ${applications.jobId} = ${jobs.id})`,
        matched: sql<number>`(select count(*)::int from ${matches} where ${matches.jobId} = ${jobs.id})`,
        reviewed: sql<number>`(select count(*)::int from ${recruiterSwipes} where ${recruiterSwipes.jobId} = ${jobs.id})`,
      })
      .from(jobs)
      .innerJoin(companies, eq(jobs.companyId, companies.id))
      .where(eq(jobs.postedById, user.id))
      .orderBy(desc(jobs.postedAt));

    return NextResponse.json({
      jobs: rows.map((r) => ({
        id: r.job.id,
        title: r.job.title,
        company: r.company.name,
        location: r.job.location,
        remote: r.job.remote,
        salaryMin: r.job.salaryMin,
        salaryMax: r.job.salaryMax,
        applyMethod: r.job.applyMethod,
        applyUrl: r.job.applyUrl,
        skills: r.job.skills,
        active: r.job.active,
        applicants: r.applicants,
        matches: r.matched,
        reviewed: r.reviewed,
      })),
    });
  } catch {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
    }
    const b = parsed.data;

    if (b.applyMethod === "EXTERNAL" && !b.applyUrl) {
      return NextResponse.json(
        { error: "External apply needs an applyUrl (your LinkedIn/Indeed/careers posting)" },
        { status: 400 }
      );
    }

    const slug = b.companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const [company] = await db
      .insert(companies)
      .values({ name: b.companyName, slug, source: "JOBSY" })
      .onConflictDoUpdate({ target: companies.slug, set: { name: b.companyName } })
      .returning();

    // Author-supplied skills win; otherwise mine them out of the description.
    const skills = b.skills?.length ? normalizeSkills(b.skills) : extractSkills(b.description);

    const [job] = await db
      .insert(jobs)
      .values({
        source: "JOBSY",
        externalId: null,
        title: b.title,
        companyId: company.id,
        location: b.location,
        remote: b.remote,
        employmentType: b.employmentType,
        seniority: inferSeniority(b.title, b.description),
        salaryMin: b.salaryMin ?? null,
        salaryMax: b.salaryMax ?? null,
        description: b.description,
        skills,
        perks: b.perks ?? [],
        applyMethod: b.applyMethod,
        applyUrl: b.applyUrl ?? null,
        postedById: user.id,
      })
      .returning();

    // Posting a job makes you a recruiter (or both).
    await db
      .update(users)
      .set({
        role: user.role === "CANDIDATE" ? "BOTH" : user.role,
        companyId: user.companyId ?? company.id,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    return NextResponse.json({ ok: true, jobId: job.id, skills });
  } catch (e) {
    const status = e instanceof AuthError ? 401 : 400;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
