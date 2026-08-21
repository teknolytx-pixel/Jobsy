import { demandQueries } from "../demand";
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
 * Adzuna Job Search API — free developer tier, instant key, no approval.
 * https://developer.adzuna.com/
 *
 *   GET https://api.adzuna.com/v1/api/jobs/{country}/search/{page}
 *       ?app_id=&app_key=&results_per_page=50&what=&where=&max_days_old=
 *
 * "Boards" here are search queries, encoded as "what|where".
 */
type AdzunaJob = {
  id: string;
  title: string;
  description: string;
  redirect_url: string;
  created: string;
  salary_min?: number;
  salary_max?: number;
  salary_is_predicted?: string;
  contract_time?: string;
  contract_type?: string;
  company?: { display_name?: string };
  location?: { display_name?: string; area?: string[] };
  category?: { label?: string };
};

const DEFAULT_QUERIES = [
  "software engineer|",
  "frontend engineer|",
  "data engineer|",
  "product designer|",
  "machine learning engineer|",
];

export const adzunaProvider: JobProvider = {
  source: "ADZUNA",
  label: "Adzuna",

  isConfigured: () => Boolean(env.jobs.adzunaId && env.jobs.adzunaKey),
  boards: () => demandQueries("PIPE", DEFAULT_QUERIES),

  async fetchBoard(board: string): Promise<NormalizedJob[]> {
    const [what, where] = board.split("|");
    const p = new URLSearchParams({
      app_id: env.jobs.adzunaId!,
      app_key: env.jobs.adzunaKey!,
      results_per_page: "50",
      max_days_old: "30",
      content_type: "application/json",
    });
    if (what?.trim()) p.set("what", what.trim());
    if (where?.trim()) p.set("where", where.trim());

    const url = `https://api.adzuna.com/v1/api/jobs/us/search/1?${p.toString()}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Jobsy/1.0 (job aggregation)" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Adzuna "${board}" → HTTP ${res.status}`);

    const data = (await res.json()) as { results?: AdzunaJob[] };

    return (data.results ?? []).map((j): NormalizedJob => {
      const description = stripHtml(j.description ?? "");
      const location = j.location?.display_name?.trim() || "United States";
      // Adzuna salaries are annual dollars; predicted ones are noisy so drop them.
      const predicted = j.salary_is_predicted === "1";
      const min = !predicted && j.salary_min ? Math.round(j.salary_min / 1000) : null;
      const max = !predicted && j.salary_max ? Math.round(j.salary_max / 1000) : null;

      return {
        source: "ADZUNA",
        externalId: String(j.id),
        sourceUrl: j.redirect_url,
        title: j.title.replace(/<[^>]+>/g, "").trim(),
        companyName: j.company?.display_name?.trim() || "Undisclosed",
        location,
        remote: inferRemote(`${location} ${description}`, location),
        employmentType:
          j.contract_time === "part_time"
            ? "Part-time"
            : j.contract_type === "contract"
              ? "Contract"
              : inferEmploymentType(description.slice(0, 600)),
        seniority: inferSeniority(j.title, description),
        salaryMin: min,
        salaryMax: max,
        currency: "USD",
        description: description.slice(0, 6000),
        skills: extractSkills(description),
        perks: j.category?.label ? [j.category.label] : [],
        applyMethod: "EXTERNAL",
        applyUrl: j.redirect_url,
        postedAt: j.created ? new Date(j.created) : new Date(),
        raw: { query: board, id: j.id },
      };
    });
  },
};
