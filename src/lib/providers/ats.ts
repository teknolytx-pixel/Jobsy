import { extractSkills, inferSeniority } from "../skills";
import { pageAll } from "./paging";
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

/**
 * PULLING A BOARD THAT IS BIGGER THAN ONE RUN.
 *
 * Most ATS accounts answer in a single request and finish in under a second.
 * A few — a global consultancy on Workday, say — have thousands of postings
 * behind a twenty-per-page endpoint, which is minutes of polite requesting.
 * A 60-second serverless function cannot do that in one go.
 *
 * So a fetch may stop early and say where it stopped. The sync loop stores that
 * position and the next run continues from it, which is the same contract the
 * careers-site crawler already uses. `nextOffset: 0` means the board was read to
 * the end — and starting over next time is how changes get picked up.
 */
export type AtsFetchOpts = {
  /** Absolute stop time, from the caller that knows the run's remaining budget. */
  deadline?: number;
  /** Where the last run stopped. */
  startOffset?: number;
};

export type AtsPage = {
  jobs: NormalizedJob[];
  /** Where to resume; 0 means finished. */
  nextOffset: number;
  /** False when a guard or the clock stopped us with pages left. */
  complete: boolean;
};

/** Workday refuses more than 20 per request, so this is its number, not ours. */
const WORKDAY_PAGE = 20;
/** SmartRecruiters allows 100 and documents `offset`. */
const SMARTRECRUITERS_PAGE = 100;
/**
 * Descriptions are one extra request per job, so they are fetched for the most
 * recent postings rather than all of them. The rest still import with title,
 * location and apply URL — a job with a thin description beats no job at all.
 */
const DETAIL_BUDGET = 60;

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

async function smartrecruiters(companyId: string, company?: string, opts: AtsFetchOpts = {}): Promise<AtsPage> {
  type P = { id: string; name: string; releasedDate?: string; company?: { name?: string };
             location?: { city?: string; region?: string; country?: string; remote?: boolean };
             typeOfEmployment?: { label?: string }; department?: { label?: string };
             ref?: string; applyUrl?: string; jobAd?: { sections?: Record<string, { text?: string }> } };
  /*
   * `?limit=100` without `offset` is one page, not the whole board. An employer
   * with 400 openings imported 100 and looked complete.
   */
  const { items, truncated, nextOffset } = await pageAll<P>(
    async (offset, pageSize) => {
      const d = await getJson<{ content?: P[] }>(
        `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyId)}` +
          `/postings?limit=${pageSize}&offset=${offset}`
      );
      return d.content ?? [];
    },
    (p) => p.id,
    SMARTRECRUITERS_PAGE,
    { deadline: opts.deadline, startOffset: opts.startOffset }
  );
  const name = company || titleCase(companyId);
  // The list endpoint omits the description; fetch details for the newest few.
  const out: NormalizedJob[] = [];
  /*
   * Every posting is kept; only the DESCRIPTION is budgeted.
   *
   * The previous loop iterated `.slice(0, 40)` and dropped posting 41 onward
   * entirely — a second silent truncation sitting behind the first. A job with
   * a thin description is still a job somebody can apply for.
   */
  for (const [i, p] of items.entries()) {
    let description = "";
    if (i < DETAIL_BUDGET) try {
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
  return { jobs: out, nextOffset, complete: !truncated };
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
async function workday(token: string, company?: string, opts: AtsFetchOpts = {}): Promise<AtsPage> {
  const [tenant, wd, site] = token.split("|");
  if (!tenant || !wd || !site) {
    throw new Error(`Workday token must be "tenant|wdN|site" — got "${token}"`);
  }
  const base = `https://${tenant}.${wd}.myworkdayjobs.com`;
  type P = { title: string; externalPath: string; locationsText?: string; postedOn?: string;
             bulletFields?: string[] };

  /*
   * Workday's list endpoint caps a page at 20 and expects you to walk `offset`.
   *
   * The previous version sent `{ limit: 20, offset: 0 }` once. Accenture, with
   * thousands of openings, imported twenty — and the number looked like a
   * plausible answer rather than a page size, which is why it survived so long.
   */
  const { items, truncated, nextOffset } = await pageAll<P>(
    async (offset, pageSize) => {
      const d = await getJson<{ jobPostings?: P[] }>(`${base}/wday/cxs/${tenant}/${site}/jobs`, {
        method: "POST",
        headers: { ...UA, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ appliedFacets: {}, limit: pageSize, offset, searchText: "" }),
      });
      return d.jobPostings ?? [];
    },
    (p) => p.externalPath,
    WORKDAY_PAGE,
    { deadline: opts.deadline, startOffset: opts.startOffset }
  );

  const name = company || titleCase(tenant);
  const jobs = items.map((p) =>
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
  return { jobs, nextOffset, complete: !truncated };
}

/**
 * Adapters that return a whole board in one call. Kept separate from the paged
 * ones so their signatures stay honest: they have no offset to resume from.
 */
const ADAPTERS: Record<AtsKind, (token: string, company?: string) => Promise<NormalizedJob[] | AtsPage>> = {
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
/** The adapters that page, and can therefore be resumed. */
const PAGED_ADAPTERS: Partial<
  Record<AtsKind, (token: string, company?: string, opts?: AtsFetchOpts) => Promise<AtsPage>>
> = {
  WORKDAY: workday,
  SMARTRECRUITERS: smartrecruiters,
};

export async function fetchCompanyJobs(
  kind: AtsKind,
  token: string,
  companyName?: string,
  opts: AtsFetchOpts = {}
): Promise<AtsPage> {
  const paged = PAGED_ADAPTERS[kind];
  if (paged) return paged(token, companyName, opts);

  const fn = ADAPTERS[kind];
  if (!fn) throw new Error(`Unknown ATS: ${kind}`);
  // A board that arrives in one payload is complete by definition.
  const jobs = await fn(token, companyName);
  return Array.isArray(jobs) ? { jobs, nextOffset: 0, complete: true } : jobs;
}

export const ATS_KINDS = Object.keys(ADAPTERS) as AtsKind[];
