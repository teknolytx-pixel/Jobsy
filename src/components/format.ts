/**
 * Pure formatting helpers — deliberately NOT in a "use client" module so both
 * server components and client components can call them directly.
 */
export const money = (min: number | null, max: number | null) =>
  min && max ? `$${min}k–$${max}k` : min ? `$${min}k+` : max ? `up to $${max}k` : "Comp not listed";

export const REMOTE_LABEL: Record<string, string> = {
  ONSITE: "Onsite",
  HYBRID: "Hybrid",
  REMOTE: "Remote",
  ANY: "Flexible",
};

export const SOURCE_LABEL: Record<string, string> = {
  JOBSY: "Posted on Jobsy",
  GREENHOUSE: "Greenhouse",
  LEVER: "Lever",
  ASHBY: "Ashby",
  ADZUNA: "Adzuna",
  JSEARCH: "Google for Jobs",
  JOOBLE: "Jooble",
  CAREERJET: "Careerjet",
  REMOTIVE: "Remotive",
  ARBEITNOW: "Arbeitnow",
  LINKEDIN: "LinkedIn",
};
