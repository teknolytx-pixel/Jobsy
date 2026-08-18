import { and, desc, eq } from "drizzle-orm";
import { companies, db, jobs } from "@/db";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * OUTBOUND DISTRIBUTION — gets Jobsy-native job posts onto other boards.
 *
 * This emits the Indeed "Job Sync" XML schema, which Monster, ZipRecruiter,
 * Glassdoor, Talroo, Jooble and most other boards also accept (it's the de-facto
 * standard feed format). You hand the feed URL to each board once, they crawl
 * it on their own schedule, and every job a recruiter posts in Jobsy shows up
 * there without any further work.
 *
 *   Feed URL:  {APP_URL}/api/feed/jobs.xml
 *
 * Reality check on Indeed specifically: in 2026 Indeed ended free visibility for
 * single-source XML feeds, so organic-only distribution there now has limited
 * reach — expect to sponsor jobs for real volume. The feed is still the correct
 * and required mechanism, and it works as-is for the other boards.
 *
 * Requirements the boards enforce, which this feed satisfies:
 *   · every field CDATA-wrapped
 *   · a stable <referencenumber> per job
 *   · <url> pointing at a public, crawlable job page (see /j/[id])
 *   · ISO-8601 <date>
 *   · the feed must contain ALL your live jobs, not a subset
 */
const cdata = (v: string | number | null | undefined) =>
  `<![CDATA[${String(v ?? "").replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;

const splitLocation = (loc: string) => {
  const parts = loc.split(",").map((s) => s.trim());
  return {
    city: parts[0] ?? "",
    state: parts[1] ?? "",
    country: parts[2] ?? (parts[1] ? "US" : ""),
  };
};

export async function GET() {
  const rows = await db
    .select({ job: jobs, company: companies })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    // Only jobs authored in Jobsy — never re-syndicate another board's inventory.
    .where(and(eq(jobs.active, true), eq(jobs.source, "JOBSY")))
    .orderBy(desc(jobs.postedAt))
    .limit(5000);

  const items = rows
    .map(({ job, company }) => {
      const { city, state, country } = splitLocation(job.location);
      const salary =
        job.salaryMin && job.salaryMax
          ? `${job.salaryMin * 1000} - ${job.salaryMax * 1000} ${job.currency} per year`
          : job.salaryMin
            ? `${job.salaryMin * 1000} ${job.currency} per year`
            : "";

      return `  <job>
    <title>${cdata(job.title)}</title>
    <date>${cdata(job.postedAt.toISOString())}</date>
    <referencenumber>${cdata(job.id)}</referencenumber>
    <requisitionid>${cdata(job.id)}</requisitionid>
    <url>${cdata(`${env.appUrl}/j/${job.id}`)}</url>
    <company>${cdata(company.name)}</company>
    <city>${cdata(city)}</city>
    <state>${cdata(state)}</state>
    <country>${cdata(country || "US")}</country>
    <postalcode>${cdata("")}</postalcode>
    <description>${cdata(job.description)}</description>
    <salary>${cdata(salary)}</salary>
    <education>${cdata("")}</education>
    <jobtype>${cdata(job.employmentType.toLowerCase())}</jobtype>
    <category>${cdata(job.skills.slice(0, 3).join(", "))}</category>
    <experience>${cdata(job.seniority)}</experience>
    <remotetype>${cdata(job.remote === "REMOTE" ? "Fully remote" : job.remote === "HYBRID" ? "Hybrid remote" : "")}</remotetype>
  </job>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<source>
  <publisher>Jobsy</publisher>
  <publisherurl>${cdata(env.appUrl)}</publisherurl>
  <lastBuildDate>${cdata(new Date().toUTCString())}</lastBuildDate>
${items}
</source>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=1800, s-maxage=1800",
    },
  });
}
