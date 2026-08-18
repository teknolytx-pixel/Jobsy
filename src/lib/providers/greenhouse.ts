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
 * Greenhouse public job board API.
 *
 * No key, no registration, no rate limit published — these endpoints exist
 * specifically so job boards and aggregators can syndicate a company's roles.
 * The board token is the slug in boards.greenhouse.io/<token>.
 *
 *   GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
 */
type GhJob = {
  id: number;
  title: string;
  absolute_url: string;
  updated_at: string;
  content: string; // HTML-escaped HTML
  location?: { name?: string };
  metadata?: { name: string; value: unknown }[] | null;
  departments?: { name: string }[];
  offices?: { name: string }[];
};

const unescapeHtml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

export const greenhouseProvider: JobProvider = {
  source: "GREENHOUSE",
  label: "Greenhouse",

  isConfigured: () => env.jobs.greenhouse.length > 0,
  boards: () => env.jobs.greenhouse,

  async fetchBoard(board: string): Promise<NormalizedJob[]> {
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Jobsy/1.0 (job aggregation)" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Greenhouse ${board} → HTTP ${res.status}`);

    const data = (await res.json()) as { jobs?: GhJob[] };
    const jobs = data.jobs ?? [];
    const companyName = board.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

    return jobs.map((j): NormalizedJob => {
      const description = stripHtml(unescapeHtml(j.content ?? ""));
      const location = j.location?.name?.trim() || j.offices?.[0]?.name || "Not specified";
      return {
        source: "GREENHOUSE",
        externalId: String(j.id),
        sourceUrl: j.absolute_url,
        title: j.title.trim(),
        companyName,
        location,
        remote: inferRemote(description.slice(0, 1200), location),
        employmentType: inferEmploymentType(`${j.title} ${description.slice(0, 600)}`),
        seniority: inferSeniority(j.title, description),
        salaryMin: null,
        salaryMax: null,
        currency: "USD",
        description: description.slice(0, 6000),
        skills: extractSkills(description),
        perks: (j.departments ?? []).map((d) => d.name).slice(0, 3),
        applyMethod: "EXTERNAL",
        applyUrl: j.absolute_url,
        postedAt: j.updated_at ? new Date(j.updated_at) : new Date(),
        raw: { board, id: j.id },
      };
    });
  },
};
