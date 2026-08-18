import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { companies, db, jobs } from "@/db";
import { env } from "@/lib/env";
import { Avatar } from "@/components/ui";
import { money, REMOTE_LABEL } from "@/components/format";

export const dynamic = "force-dynamic";

async function load(id: string) {
  const rows = await db
    .select({ job: jobs, company: companies })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(and(eq(jobs.id, id), eq(jobs.active, true)))
    .limit(1);
  return rows[0] ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const row = await load(id);
  if (!row) return { title: "Job not found — Jobsy" };
  return {
    title: `${row.job.title} at ${row.company.name} — Jobsy`,
    description: row.job.description.slice(0, 160),
    openGraph: {
      title: `${row.job.title} — ${row.company.name}`,
      description: row.job.description.slice(0, 200),
      type: "website",
    },
  };
}

/**
 * PUBLIC, CRAWLABLE JOB PAGE.
 *
 * Two jobs at once:
 *  1. The <url> target every job board's XML feed points at — boards reject
 *     feeds whose URLs 404 or sit behind a login.
 *  2. Carries schema.org JobPosting JSON-LD, which is what puts the role into
 *     Google for Jobs — and Google for Jobs is what most aggregators
 *     (including the ones Jobsy ingests from) index in turn. Free distribution.
 */
export default async function PublicJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await load(id);
  if (!row) notFound();
  const { job, company } = row;

  const jsonLd = {
    "@context": "https://schema.org/",
    "@type": "JobPosting",
    title: job.title,
    description: job.description,
    identifier: { "@type": "PropertyValue", name: company.name, value: job.id },
    datePosted: job.postedAt.toISOString(),
    employmentType: job.employmentType.toUpperCase().replace("-", "_"),
    hiringOrganization: {
      "@type": "Organization",
      name: company.name,
      ...(company.website ? { sameAs: company.website } : {}),
    },
    jobLocation:
      job.remote === "REMOTE"
        ? undefined
        : {
            "@type": "Place",
            address: {
              "@type": "PostalAddress",
              addressLocality: job.location.split(",")[0]?.trim(),
              addressRegion: job.location.split(",")[1]?.trim(),
              addressCountry: "US",
            },
          },
    ...(job.remote === "REMOTE" ? { jobLocationType: "TELECOMMUTE", applicantLocationRequirements: { "@type": "Country", name: "USA" } } : {}),
    ...(job.salaryMin || job.salaryMax
      ? {
          baseSalary: {
            "@type": "MonetaryAmount",
            currency: job.currency,
            value: {
              "@type": "QuantitativeValue",
              minValue: (job.salaryMin ?? job.salaryMax!) * 1000,
              maxValue: (job.salaryMax ?? job.salaryMin!) * 1000,
              unitText: "YEAR",
            },
          },
        }
      : {}),
    skills: job.skills.join(", "),
    directApply: job.applyMethod === "EASY",
    url: `${env.appUrl}/j/${job.id}`,
  };

  return (
    <div className="shell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <header className="top">
        <a href="/" className="logo">
          <span className="spark">🔥</span>
          <b>Jobsy</b>
        </a>
      </header>

      <div style={{ padding: "6px 16px 28px" }}>
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          <Avatar name={company.name} seed={job.id} />
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: 24, margin: 0, letterSpacing: "-.6px", lineHeight: 1.2 }}>
              {job.title}
            </h1>
            <div style={{ color: "var(--dim)", fontSize: 14, marginTop: 4 }}>
              {company.name} · {job.location}
            </div>
            <div className="meta">
              <span className="pill">{REMOTE_LABEL[job.remote] ?? job.remote}</span>
              <span className="pill">{job.seniority}</span>
              <span className="pill">{job.employmentType}</span>
              <span className="pill pay">{money(job.salaryMin, job.salaryMax)}</span>
            </div>
          </div>
        </div>

        {job.skills.length ? (
          <div className="sect">
            <h4>Skills</h4>
            <div className="tags">
              {job.skills.map((s) => (
                <span key={s} className="tag">
                  {s}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="sect">
          <h4>About the role</h4>
          <p>{job.description}</p>
        </div>

        {job.perks.length ? (
          <div className="sect">
            <h4>Perks</h4>
            <div className="tags">
              {job.perks.map((p) => (
                <span key={p} className="pill">
                  {p}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {job.applyMethod === "EASY" ? (
          <>
            <a className="btn" href="/login?mode=signup">
              ⚡ Apply with one swipe
            </a>
            <div className="note">
              <b>No forms.</b> Create a Jobsy profile once, then a single right-swipe sends it to the
              hiring team. If they swipe right too, chat opens immediately.
            </div>
          </>
        ) : (
          <>
            <a className="btn blue" href={job.applyUrl ?? job.sourceUrl ?? "#"} target="_blank" rel="noopener noreferrer">
              Apply on {job.publisher ?? "the company site"} ↗
            </a>
            <a className="btn ghost" href="/login?mode=signup">
              Or swipe similar jobs on Jobsy
            </a>
          </>
        )}
      </div>
    </div>
  );
}
