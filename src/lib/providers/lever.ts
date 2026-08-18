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
 * Lever public postings API. No key required.
 *   GET https://api.lever.co/v0/postings/{company}?mode=json
 */
type LeverJob = {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  createdAt?: number;
  descriptionPlain?: string;
  description?: string;
  lists?: { text: string; content: string }[];
  categories?: {
    location?: string;
    team?: string;
    commitment?: string;
    department?: string;
  };
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
};

export const leverProvider: JobProvider = {
  source: "LEVER",
  label: "Lever",

  isConfigured: () => env.jobs.lever.length > 0,
  boards: () => env.jobs.lever,

  async fetchBoard(board: string): Promise<NormalizedJob[]> {
    const url = `https://api.lever.co/v0/postings/${encodeURIComponent(board)}?mode=json`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Jobsy/1.0 (job aggregation)" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Lever ${board} → HTTP ${res.status}`);

    const jobs = (await res.json()) as LeverJob[];
    if (!Array.isArray(jobs)) return [];
    const companyName = board.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

    return jobs.map((j): NormalizedJob => {
      const listText = (j.lists ?? []).map((l) => `${l.text}\n${stripHtml(l.content)}`).join("\n\n");
      const description = (
        j.descriptionPlain?.trim() || stripHtml(j.description ?? "")
      ).concat(listText ? `\n\n${listText}` : "");
      const location = j.categories?.location?.trim() || "Not specified";

      // Lever gives annual figures in the local currency when present.
      const sr = j.salaryRange;
      const scale = sr?.interval === "per-year-salary" || !sr?.interval ? 1 : 0;
      const min = sr?.min && scale ? Math.round(sr.min / 1000) : null;
      const max = sr?.max && scale ? Math.round(sr.max / 1000) : null;

      return {
        source: "LEVER",
        externalId: j.id,
        sourceUrl: j.hostedUrl,
        title: j.text.trim(),
        companyName,
        location,
        remote: inferRemote(`${location} ${description.slice(0, 1200)}`, location),
        employmentType: j.categories?.commitment || inferEmploymentType(description.slice(0, 600)),
        seniority: inferSeniority(j.text, description),
        salaryMin: min,
        salaryMax: max,
        currency: sr?.currency ?? "USD",
        description: description.slice(0, 6000),
        skills: extractSkills(description),
        perks: [j.categories?.team, j.categories?.department].filter(Boolean).slice(0, 3) as string[],
        applyMethod: "EXTERNAL",
        applyUrl: j.applyUrl || j.hostedUrl,
        postedAt: j.createdAt ? new Date(j.createdAt) : new Date(),
        raw: { board, id: j.id },
      };
    });
  },
};
