import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { companies, db, jobs } from "@/db";
import { env } from "@/lib/env";
import { Avatar } from "@/components/ui";
import { money, REMOTE_LABEL } from "@/components/format";
import { safeJsonLd, stripHtml } from "@/lib/safeJson";
import { toJobGeo, type JobRowLike } from "@/lib/geo/adapt";
import { effectiveRemoteScope } from "@/lib/geo/eligibility";
import { countriesInRegion, countryName, UNKNOWN_COUNTRY, US_STATES } from "@/lib/geo/countries";
import { Icon, Logo } from "@/components/Icon";

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
 * schema.org location, built from the v1.1 structured geography.
 *
 * The previous version hardcoded `addressCountry: "US"` and, for remote roles,
 * `applicantLocationRequirements: Country USA`. That was survivable while every
 * posting was American and "remote" meant nothing in particular. It is not
 * survivable now: a London role would be published to Google for Jobs as a US
 * role, and a role scoped to the EU would be advertised to US applicants who
 * cannot take it — which is the exact failure BR-017 exists to prevent, leaking
 * out through the structured data instead of through the deck.
 *
 * Where the country is genuinely unknown the field is OMITTED rather than
 * guessed. Wrong structured data is worse than absent structured data: Google
 * demotes feeds it finds inaccurate, and a candidate who travels for an
 * interview that was never in their country pays for the guess.
 */
function placeFor(job: JobRowLike & { location: string }) {
  const geo = toJobGeo(job);

  // All-or-nothing. Splicing a structured city together with a legacy region
  // produced "London, TX, GB" on a row whose free text still read "Austin, TX"
  // — each half individually defensible, the pair nonsense. The legacy string
  // is consulted only when the resolver got nothing from it at all.
  const legacy = job.location.split(",");
  const structured = geo.city || geo.stateProvince;
  const locality = (structured ? geo.city : legacy[0]?.trim()) || undefined;
  const region = (structured ? geo.stateProvince : legacy[1]?.trim()) || undefined;

  return {
    "@type": "Place",
    address: {
      "@type": "PostalAddress",
      ...(locality ? { addressLocality: locality } : {}),
      ...(region ? { addressRegion: region } : {}),
      // The workplace's postal code, which is the employer's own published
      // address. Nothing here is ever read back as a matching input.
      ...(geo.postalCode ? { postalCode: geo.postalCode } : {}),
      ...(geo.country !== UNKNOWN_COUNTRY ? { addressCountry: geo.country } : {}),
    },
  };
}

const asCountry = (code: string) => ({ "@type": "Country", name: countryName(code) });

/**
 * RMT-005 in schema.org form. An unscoped remote role is remote within its own
 * country, never worldwide — so the default narrows the audience rather than
 * widening it. WORLDWIDE omits the key entirely, which is how Google reads
 * "anywhere"; claiming every country by name would be both wrong and unbounded.
 */
function applicantLocationRequirements(job: JobRowLike & { location: string }) {
  const geo = toJobGeo(job);
  const scope = effectiveRemoteScope(geo);

  if (scope === "WORLDWIDE") return {};

  const countries: string[] =
    scope === "COUNTRIES"
      ? geo.remoteScopeCountries
      : scope === "REGION"
        ? countriesInRegion(geo.remoteScopeRegion ?? "")
        : geo.country !== UNKNOWN_COUNTRY
          ? [geo.country]
          : [];

  if (scope === "STATES" && geo.remoteScopeStates.length) {
    return {
      applicantLocationRequirements: geo.remoteScopeStates.map((s) => ({
        "@type": "State",
        name: US_STATES[s.toUpperCase()] ?? s,
      })),
    };
  }

  const known = countries.filter((c) => c && c !== UNKNOWN_COUNTRY);
  if (!known.length) return {};
  return {
    applicantLocationRequirements:
      known.length === 1 ? asCountry(known[0]) : known.map(asCountry),
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
    // Plain text: JSON-LD is not a place to relay an employer's markup.
    description: stripHtml(job.description),
    identifier: { "@type": "PropertyValue", name: company.name, value: job.id },
    datePosted: job.postedAt.toISOString(),
    employmentType: job.employmentType.toUpperCase().replace("-", "_"),
    hiringOrganization: {
      "@type": "Organization",
      name: company.name,
      ...(company.website ? { sameAs: company.website } : {}),
    },
    jobLocation: job.remote === "REMOTE" ? undefined : placeFor(job),
    ...(job.remote === "REMOTE"
      ? { jobLocationType: "TELECOMMUTE", ...applicantLocationRequirements(job) }
      : {}),
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
        dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
      />

      <header className="top">
        <a href="/home" className="logo">
          <Logo />
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
              <Icon name="bolt" size={16} /> Apply with one swipe
            </a>
            <div className="note">
              <b>No forms.</b> Create a Jobsy profile once, then a single right-swipe sends it to the
              hiring team. If they swipe right too, chat opens immediately.
            </div>
          </>
        ) : (
          <>
            <a className="btn blue" href={job.applyUrl ?? job.sourceUrl ?? "#"} target="_blank" rel="noopener noreferrer">
              Apply on {job.publisher ?? "the company site"} <Icon name="external" size={15} />
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
