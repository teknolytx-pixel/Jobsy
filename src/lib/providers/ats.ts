import { extractSkills, inferSeniority } from "../skills";
import {
  type NormalizedJob,
  inferEmploymentType,
  inferRemote,
  stripHtml,
} from "./types";
import type { JobSource } from "@/db";

/**
 * COMPANY CONNECTORS — pull ONE named company's entire job board.
 *
 * This is the answer to "a corporate recruiter posted on their own website".
 * Almost no company hand-builds a careers page any more: it's rendered by an
 * ATS, and every major ATS exposes that company's postings on a public,
 * unauthenticated endpoint. Those endpoints exist so the company's own site
 * (and job boards, and Google) can embed the listings — reading them is the
 * intended use, not a workaround.
 *
 * Unlike the query-based aggregators, these are *targeted*: you name the
 * company once and every job they post from then on flows into Jobsy on the
 * next sync, automatically.
 *
 * ┌──────────────────┬────────────────────────────────────────────────────────┐
 * │ Greenhouse       │ boards-api.greenhouse.io/v1/boards/{token}/jobs        │
 * │ Lever            │ api.lever.co/v0/postings/{slug}?mode=json               │
 * │ Ashby            │ api.ashbyhq.com/posting-api/job-board/{name}            │
 * │ Workable         │ apply.workable.com/api/v1/widget/accounts/{account}     │
 * │ SmartRecruiters  │ api.smartrecruiters.com/v1/companies/{id}/postings      │
 * │ Recruitee        │ {company}.recruitee.com/api/offers/                     │
 * │ Personio         │ {company}.jobs.personio.de/xml            (XML)         │
 * │ BambooHR         │ {company}.bamboohr.com/careers/list                     │
 * │ Workday          │ {tenant}.wd{n}.myworkdayjobs.com/wday/cxs/... (POST)    │
 * └──────────────────┴────────────────────────────────────────────────────────┘
 *
 * All GET, all unauthenticated, except Workday which is POST.
 *
 * NOTE on Workday: unlike the others this endpoint is undocumented — it's what
 * the company's own careers page calls to render itself. Jobsy only ever hits
 * it for a company someone has explicitly connected, never by crawling at
 * large, and it is the single most likely adapter to need maintenance.
 */

export type AtsKind =
  | "GREENHOUSE"
  | "LEVER"
  | "ASHBY"
  | "WORKABLE"
  | "SMARTRECRUITERS"
  | "RECRUITEE"
  | "PERSONIO"
  | "BAMBOOHR"
  | "WORKDAY";

export const ATS_LABEL: Record<AtsKind, string> = {
  GREENHOUSE: "Greenhouse",
  LEVER: "Lever",
  ASHBY: "Ashby",
  WORKABLE: "Workable",
  SMARTRECRUITERS: "SmartRecruiters",
  RECRUITEE: "Recruitee",
  PERSONIO: "Personio",
  BAMBOOHR: "BambooHR",
  WORKDAY: "Workday",
};

export const ATS_SOURCE: Record<AtsKind, JobSource> = {
  GREENHOUSE: "GREENHOUSE",
  LEVER: "LEVER",
  ASHBY: "ASHBY",
  WORKABLE: "WORKABLE",
  SMARTRECRUITERS: "SMARTRECRUITERS",
  RECRUITEE: "RECRUITEE",
  PERSONIO: "PERSONIO",
  BAMBOOHR: "BAMBOOHR",
  WORKDAY: "WORKDAY",
};

const UA = { "User-Agent": "Jobsy/1.0 (+job aggregation; contact: hello@jobsy.app)" };

const titleCase = (s: string) =>
  s.replace(/[-_.]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: UA, cache: "no-store", ...init });
  if (!res.ok) throw new Error(`${new URL(url).hostname} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: UA, cache: "no-store" });
  if (!res.ok) throw new Error(`${new URL(url).hostname} → HTTP ${res.status}`);
  return res.text();
}

/** Shared shaping so every connector emits identical records. */
function shape(
  kind: AtsKind,
  o: {
    externalId: string;
    url: string;
    title: string;
    company: string;
    location: string;
    description: string;
    postedAt?: Date;
    employmentType?: string;
    remoteHint?: boolean;
    salaryMin?: number | null;
    salaryMax?: number | null;
    currency?: string;
    perks?: string[];
  }
): NormalizedJob {
  const desc = o.description.slice(0, 6000);
  return {
    source: ATS_SOURCE[kind],
    publisher: `${ATS_LABEL[kind]} · ${o.company}`,
    externalId: `${kind.toLowerCase()}:${o.externalId}`,
    sourceUrl: o.url,
    title: o.title.trim(),
    companyName: o.company,
    location: o.location || "Not specified",
    remote: o.remoteHint ? "REMOTE" : inferRemote(desc.slice(0, 1500), o.location),
    employmentType: o.employmentType || inferEmploymentType(desc.slice(0, 600)),
    seniority: inferSeniority(o.title, desc),
    salaryMin: o.salaryMin ?? null,
    salaryMax: o.salaryMax ?? null,
    currency: o.currency ?? "USD",
    description: desc,
    skills: extractSkills(desc),
    perks: o.perks ?? [],
    applyMethod: "EXTERNAL",
    applyUrl: o.url,
    postedAt: o.postedAt && !Number.isNaN(o.postedAt.getTime()) ? o.postedAt : new Date(),
    raw: { kind, externalId: o.externalId },
  };
}

const unescapeHtml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
   .replace(/&#39;/g, "'").replace(/&amp;/g, "&");

// ─────────────────────────────────────────────────────────────
// ADAPTERS
// ─────────────────────────────────────────────────────────────

async function greenhouse(token: string, company?: string): Promise<NormalizedJob[]> {
  type J = { id: number; title: string; absolute_url: string; updated_at: string; content: string;
             location?: { name?: string }; departments?: { name: string }[] };
  const d = await getJson<{ jobs?: J[] }>(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`
  );
  const name = company || titleCase(token);
  return (d.jobs ?? []).map((j) =>
    shape("GREENHOUSE", {
      externalId: String(j.id), url: j.absolute_url, title: j.title, company: name,
      location: j.location?.name?.trim() ?? "", description: stripHtml(unescapeHtml(j.content ?? "")),
      postedAt: j.updated_at ? new Date(j.updated_at) : undefined,
      perks: (j.departments ?? []).map((x) => x.name).slice(0, 3),
    })
  );
}

async function lever(slug: string, company?: string): Promise<NormalizedJob[]> {
  type J = { id: string; text: string; hostedUrl: string; applyUrl?: string; createdAt?: number;
             descriptionPlain?: string; description?: string;
             categories?: { location?: string; team?: string; commitment?: string };
             salaryRange?: { min?: number; max?: number; currency?: string; interval?: string } };
  const jobs = await getJson<J[]>(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`);
  const name = company || titleCase(slug);
  if (!Array.isArray(jobs)) return [];
  return jobs.map((j) => {
    const sr = j.salaryRange;
    const yearly = !sr?.interval || sr.interval === "per-year-salary";
    return shape("LEVER", {
      externalId: j.id, url: j.applyUrl || j.hostedUrl, title: j.text, company: name,
      location: j.categories?.location?.trim() ?? "",
      description: j.descriptionPlain?.trim() || stripHtml(j.description ?? ""),
      postedAt: j.createdAt ? new Date(j.createdAt) : undefined,
      employmentType: j.categories?.commitment,
      salaryMin: sr?.min && yearly ? Math.round(sr.min / 1000) : null,
      salaryMax: sr?.max && yearly ? Math.round(sr.max / 1000) : null,
      currency: sr?.currency,
      perks: j.categories?.team ? [j.categories.team] : [],
    });
  });
}

async function ashby(board: string, company?: string): Promise<NormalizedJob[]> {
  type J = { id: string; title: string; location?: string; department?: string; employmentType?: string;
             isListed?: boolean; isRemote?: boolean; descriptionPlain?: string; descriptionHtml?: string;
             publishedAt?: string; jobUrl?: string; applyUrl?: string;
             compensation?: { summaryComponents?: { compensationType?: string; interval?: string;
               currencyCode?: string; minValue?: number; maxValue?: number }[] } };
  const d = await getJson<{ jobs?: J[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`
  );
  const name = company || titleCase(board);
  return (d.jobs ?? []).filter((j) => j.isListed !== false).map((j) => {
    const c = j.compensation?.summaryComponents?.find(
      (x) => x.compensationType === "Salary" && x.interval === "1 YEAR"
    );
    return shape("ASHBY", {
      externalId: j.id, url: j.applyUrl ?? j.jobUrl ?? `https://jobs.ashbyhq.com/${board}/${j.id}`,
      title: j.title, company: name, location: j.location?.trim() ?? "",
      description: j.descriptionPlain?.trim() || stripHtml(j.descriptionHtml ?? ""),
      postedAt: j.publishedAt ? new Date(j.publishedAt) : undefined,
      employmentType: j.employmentType, remoteHint: j.isRemote,
      salaryMin: c?.minValue ? Math.round(c.minValue / 1000) : null,
      salaryMax: c?.maxValue ? Math.round(c.maxValue / 1000) : null,
      currency: c?.currencyCode, perks: j.department ? [j.department] : [],
    });
  });
}

async function workable(account: string, company?: string): Promise<NormalizedJob[]> {
  type J = { id?: string | number; shortcode?: string; title: string; description?: string;
             requirements?: string; benefits?: string; url?: string; application_url?: string;
             published_on?: string; created_at?: string; employment_type?: string;
             telecommuting?: boolean; department?: string; state?: string; city?: string;
             country?: string; location?: { city?: string; region?: string; country?: string;
               telecommuting?: boolean } };
  const d = await getJson<{ name?: string; jobs?: J[] }>(
    `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(account)}?details=true`
  );
  const name = company || d.name || titleCase(account);
  return (d.jobs ?? []).map((j) => {
    const loc = [j.location?.city ?? j.city, j.location?.region ?? j.state].filter(Boolean).join(", ");
    const code = String(j.shortcode ?? j.id ?? "");
    return shape("WORKABLE", {
      externalId: code,
      url: j.application_url || j.url || `https://apply.workable.com/${account}/j/${code}/`,
      title: j.title, company: name, location: loc || j.location?.country || j.country || "",
      description: stripHtml([j.description, j.requirements, j.benefits].filter(Boolean).join("\n\n")),
      postedAt: j.published_on ? new Date(j.published_on) : j.created_at ? new Date(j.created_at) : undefined,
      employmentType: j.employment_type,
      remoteHint: j.telecommuting ?? j.location?.telecommuting,
      perks: j.department ? [j.department] : [],
    });
  });
}

async function smartrecruiters(companyId: string, company?: string): Promise<NormalizedJob[]> {
  type P = { id: string; name: string; releasedDate?: string; company?: { name?: string };
             location?: { city?: string; region?: string; country?: string; remote?: boolean };
             typeOfEmployment?: { label?: string }; department?: { label?: string };
             ref?: string; applyUrl?: string; jobAd?: { sections?: Record<string, { text?: string }> } };
  const d = await getJson<{ content?: P[] }>(
    `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyId)}/postings?limit=100`
  );
  const name = company || titleCase(companyId);
  // The list endpoint omits the description; fetch details for the first 40.
  const out: NormalizedJob[] = [];
  for (const p of (d.content ?? []).slice(0, 40)) {
    let description = "";
    try {
      const full = await getJson<P>(
        `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyId)}/postings/${p.id}`
      );
      description = Object.values(full.jobAd?.sections ?? {})
        .map((s) => stripHtml(s?.text ?? ""))
        .filter(Boolean)
        .join("\n\n");
    } catch {
      /* detail fetch is best-effort — keep the posting either way */
    }
    out.push(
      shape("SMARTRECRUITERS", {
        externalId: p.id,
        url: p.applyUrl ?? `https://jobs.smartrecruiters.com/${companyId}/${p.id}`,
        title: p.name, company: p.company?.name || name,
        location: [p.location?.city, p.location?.region].filter(Boolean).join(", ") || p.location?.country || "",
        description, postedAt: p.releasedDate ? new Date(p.releasedDate) : undefined,
        employmentType: p.typeOfEmployment?.label, remoteHint: p.location?.remote,
        perks: p.department?.label ? [p.department.label] : [],
      })
    );
  }
  return out;
}

async function recruitee(company_: string, company?: string): Promise<NormalizedJob[]> {
  type O = { id: number; slug?: string; title: string; description?: string; requirements?: string;
             careers_url?: string; careers_apply_url?: string; created_at?: string; employment_type?: string;
             remote?: boolean; city?: string; country?: string; department?: string; company_name?: string };
  const d = await getJson<{ offers?: O[] }>(
    `https://${encodeURIComponent(company_)}.recruitee.com/api/offers/`
  );
  const name = company || d.offers?.[0]?.company_name || titleCase(company_);
  return (d.offers ?? []).map((o) =>
    shape("RECRUITEE", {
      externalId: String(o.id),
      url: o.careers_apply_url || o.careers_url || `https://${company_}.recruitee.com/o/${o.slug ?? o.id}`,
      title: o.title, company: name,
      location: [o.city, o.country].filter(Boolean).join(", "),
      description: stripHtml([o.description, o.requirements].filter(Boolean).join("\n\n")),
      postedAt: o.created_at ? new Date(o.created_at) : undefined,
      employmentType: o.employment_type, remoteHint: o.remote,
      perks: o.department ? [o.department] : [],
    })
  );
}

/** Personio serves XML rather than JSON. */
async function personio(company_: string, company?: string): Promise<NormalizedJob[]> {
  const xml = await getText(`https://${encodeURIComponent(company_)}.jobs.personio.de/xml`);
  const name = company || titleCase(company_);
  const pick = (block: string, tag: string) =>
    stripHtml(
      block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.replace(/^<!\[CDATA\[|\]\]>$/g, "") ?? ""
    ).trim();

  const positions = [...xml.matchAll(/<position>([\s\S]*?)<\/position>/g)].map((m) => m[1]);
  return positions.map((block) => {
    const id = pick(block, "id");
    const descBlocks = [...block.matchAll(/<value>([\s\S]*?)<\/value>/g)]
      .map((m) => stripHtml(m[1].replace(/^<!\[CDATA\[|\]\]>$/g, "")))
      .join("\n\n");
    return shape("PERSONIO", {
      externalId: id,
      url: `https://${company_}.jobs.personio.de/job/${id}`,
      title: pick(block, "name"), company: name,
      location: [pick(block, "office"), pick(block, "subcompany")].filter(Boolean).join(", "),
      description: descBlocks || pick(block, "keywords"),
      postedAt: pick(block, "createdAt") ? new Date(pick(block, "createdAt")) : undefined,
      employmentType: pick(block, "employmentType"),
      perks: [pick(block, "department")].filter(Boolean),
    });
  });
}

async function bamboohr(subdomain: string, company?: string): Promise<NormalizedJob[]> {
  type J = { id: number | string; jobOpeningName: string; employmentStatusLabel?: string;
             departmentLabel?: string; isRemote?: boolean;
             location?: { city?: string; state?: string; country?: string } };
  const d = await getJson<{ result?: J[] }>(
    `https://${encodeURIComponent(subdomain)}.bamboohr.com/careers/list`
  );
  const name = company || titleCase(subdomain);
  return (d.result ?? []).map((j) =>
    shape("BAMBOOHR", {
      externalId: String(j.id),
      url: `https://${subdomain}.bamboohr.com/careers/${j.id}`,
      title: j.jobOpeningName, company: name,
      location: [j.location?.city, j.location?.state].filter(Boolean).join(", ") || j.location?.country || "",
      // BambooHR's list endpoint carries no description; the title + department
      // is all we get without a per-job fetch, so skills stay sparse here.
      description: `${j.jobOpeningName}${j.departmentLabel ? ` — ${j.departmentLabel}` : ""}`,
      employmentType: j.employmentStatusLabel, remoteHint: j.isRemote,
      perks: j.departmentLabel ? [j.departmentLabel] : [],
    })
  );
}

/**
 * Workday. Token format: "tenant|wdN|site", e.g. "nvidia|wd5|NVIDIAExternalCareerSite".
 * All three parts are visible in the company's own careers URL.
 */
async function workday(token: string, company?: string): Promise<NormalizedJob[]> {
  const [tenant, wd, site] = token.split("|");
  if (!tenant || !wd || !site) {
    throw new Error(`Workday token must be "tenant|wdN|site" — got "${token}"`);
  }
  const base = `https://${tenant}.${wd}.myworkdayjobs.com`;
  type P = { title: string; externalPath: string; locationsText?: string; postedOn?: string;
             bulletFields?: string[] };
  const d = await getJson<{ jobPostings?: P[] }>(
    `${base}/wday/cxs/${tenant}/${site}/jobs`,
    {
      method: "POST",
      headers: { ...UA, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: "" }),
    }
  );
  const name = company || titleCase(tenant);
  return (d.jobPostings ?? []).map((p) =>
    shape("WORKDAY", {
      externalId: p.externalPath,
      url: `${base}/${site}${p.externalPath}`,
      title: p.title, company: name, location: p.locationsText ?? "",
      // The list endpoint has no body; the detail endpoint is one call per job,
      // so we keep the title/req-id summary and let the apply URL carry the rest.
      description: `${p.title}${p.bulletFields?.length ? ` (${p.bulletFields.join(", ")})` : ""}`,
      postedAt: /today/i.test(p.postedOn ?? "") ? new Date() : undefined,
    })
  );
}

const ADAPTERS: Record<AtsKind, (token: string, company?: string) => Promise<NormalizedJob[]>> = {
  GREENHOUSE: greenhouse,
  LEVER: lever,
  ASHBY: ashby,
  WORKABLE: workable,
  SMARTRECRUITERS: smartrecruiters,
  RECRUITEE: recruitee,
  PERSONIO: personio,
  BAMBOOHR: bamboohr,
  WORKDAY: workday,
};

/** Pull every job a single company currently has posted. */
export function fetchCompanyJobs(
  kind: AtsKind,
  token: string,
  companyName?: string
): Promise<NormalizedJob[]> {
  const fn = ADAPTERS[kind];
  if (!fn) throw new Error(`Unknown ATS: ${kind}`);
  return fn(token, companyName);
}

export const ATS_KINDS = Object.keys(ADAPTERS) as AtsKind[];
