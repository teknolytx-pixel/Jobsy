import { env } from "../env";
import { extractSkills, inferSeniority } from "../skills";
import {
  type JobProvider,
  type NormalizedJob,
  inferEmploymentType,
  inferRemote,
  stripHtml,
} from "./types";

/**
 * Ashby public job board API. No key required.
 *   GET https://api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true
 */
type AshbyJob = {
  id: string;
  title: string;
  location?: string;
  secondaryLocations?: { location: string }[];
  department?: string;
  team?: string;
  employmentType?: string;
  isListed?: boolean;
  isRemote?: boolean;
  descriptionPlain?: string;
  descriptionHtml?: string;
  publishedAt?: string;
  jobUrl?: string;
  applyUrl?: string;
  compensation?: {
    compensationTierSummary?: string;
    summaryComponents?: {
      compensationType?: string;
      interval?: string;
      currencyCode?: string;
      minValue?: number;
      maxValue?: number;
    }[];
  };
};

export const ashbyProvider: JobProvider = {
  source: "ASHBY",
  label: "Ashby",

  isConfigured: () => env.jobs.ashby.length > 0,
  boards: () => env.jobs.ashby,

  async fetchBoard(board: string): Promise<NormalizedJob[]> {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Jobsy/1.0 (job aggregation)" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Ashby ${board} → HTTP ${res.status}`);

    const data = (await res.json()) as { jobs?: AshbyJob[] };
    const jobs = (data.jobs ?? []).filter((j) => j.isListed !== false);
    const companyName = board.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

    return jobs.map((j): NormalizedJob => {
      const description = j.descriptionPlain?.trim() || stripHtml(j.descriptionHtml ?? "");
      const location = j.location?.trim() || j.secondaryLocations?.[0]?.location || "Not specified";

      const salaryComp = j.compensation?.summaryComponents?.find(
        (c) => c.compensationType === "Salary" && c.interval === "1 YEAR"
      );
      const min = salaryComp?.minValue ? Math.round(salaryComp.minValue / 1000) : null;
      const max = salaryComp?.maxValue ? Math.round(salaryComp.maxValue / 1000) : null;

      return {
        source: "ASHBY",
        externalId: j.id,
        sourceUrl: j.jobUrl ?? `https://jobs.ashbyhq.com/${board}/${j.id}`,
        title: j.title.trim(),
        companyName,
        location,
        remote: j.isRemote ? "REMOTE" : inferRemote(description.slice(0, 1200), location),
        employmentType: j.employmentType || inferEmploymentType(description.slice(0, 600)),
        seniority: inferSeniority(j.title, description),
        salaryMin: min,
        salaryMax: max,
        currency: salaryComp?.currencyCode ?? "USD",
        description: description.slice(0, 6000),
        skills: extractSkills(description),
        perks: [j.department, j.team].filter(Boolean).slice(0, 3) as string[],
        applyMethod: "EXTERNAL",
        applyUrl: j.applyUrl ?? j.jobUrl ?? `https://jobs.ashbyhq.com/${board}/${j.id}`,
        postedAt: j.publishedAt ? new Date(j.publishedAt) : new Date(),
        raw: { board, id: j.id },
      };
    });
  },
};
