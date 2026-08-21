import type { ApplyMethod, JobSource, RemotePref } from "@/db";

/** The shape every provider must produce. Nothing downstream knows the source. */
export type NormalizedJob = {
  source: JobSource;
  externalId: string;
  sourceUrl: string;
  /** Original board an aggregator pulled it from: "Indeed", "Monster", … */
  publisher?: string;
  title: string;
  companyName: string;
  companyWebsite?: string;
  location: string;
  remote: RemotePref;
  employmentType: string;
  seniority: string;
  salaryMin: number | null; // thousands, USD
  salaryMax: number | null;
  currency: string;
  description: string;
  skills: string[];
  perks: string[];
  applyMethod: ApplyMethod;
  applyUrl: string;
  postedAt: Date;
  raw?: unknown;
};

export interface JobProvider {
  /** Stable id used in logs and the JobSource enum. */
  readonly source: JobSource;
  readonly label: string;
  /** False when required credentials are absent — ingestion skips it cleanly. */
  isConfigured(): boolean;
  /**
   * One "board" per call (a Greenhouse token, an Adzuna query, …).
   *
   * May be async: the query-based aggregators derive their phrases from live
   * candidate demand (SRC-014) rather than a constant, and that needs a read.
   * ATS providers stay synchronous — their boards are a config list.
   */
  boards(): string[] | Promise<string[]>;
  fetchBoard(board: string): Promise<NormalizedJob[]>;
}

export class ProviderNotAvailableError extends Error {
  constructor(source: string, reason: string) {
    super(`[${source}] ${reason}`);
    this.name = "ProviderNotAvailableError";
  }
}

/** Shared helpers ------------------------------------------------------- */

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function inferRemote(text: string, location?: string): RemotePref {
  const hay = `${location ?? ""} ${text}`.toLowerCase();
  if (/\b(hybrid)\b/.test(hay)) return "HYBRID";
  if (/\b(fully remote|remote-first|100% remote|work from home|wfh|remote)\b/.test(hay)) return "REMOTE";
  if (/\b(on-?site|in-?office|in person)\b/.test(hay)) return "ONSITE";
  return "ONSITE";
}

/** Normalise assorted salary shapes to thousands-USD. */
export function toThousands(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  if (n > 1000) return Math.round(n / 1000); // annual dollars
  if (n < 300) return Math.round(n); // already thousands
  return Math.round(n); // hourly-ish; caller should pre-scale
}

export function inferEmploymentType(text: string): string {
  const t = text.toLowerCase();
  if (/\b(intern|internship)\b/.test(t)) return "Internship";
  if (/\b(contract|contractor|freelance|c2c)\b/.test(t)) return "Contract";
  if (/\b(part[- ]time)\b/.test(t)) return "Part-time";
  if (/\b(temporary|temp)\b/.test(t)) return "Temporary";
  return "Full-time";
}
