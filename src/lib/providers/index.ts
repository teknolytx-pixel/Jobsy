import type { JobProvider } from "./types";
import { greenhouseProvider } from "./greenhouse";
import { leverProvider } from "./lever";
import { ashbyProvider } from "./ashby";
import { adzunaProvider } from "./adzuna";
import {
  arbeitnowProvider,
  careerjetProvider,
  joobleProvider,
  jsearchProvider,
  remotiveProvider,
} from "./aggregators";
import { linkedinTalentProvider } from "./linkedin";

/**
 * Every provider Jobsy knows about, active or not.
 *
 * Three tiers:
 *   1. ATS boards      — public, no key, per-company (Greenhouse/Lever/Ashby)
 *   2. Aggregators     — how Indeed and Monster listings reach Jobsy
 *   3. Partner-gated   — LinkedIn Talent, inert until a partnership exists
 */
export const ALL_PROVIDERS: JobProvider[] = [
  // 1. direct ATS boards — highest quality, zero cost, no key
  greenhouseProvider,
  leverProvider,
  ashbyProvider,
  // 2. keyless public boards
  remotiveProvider,
  arbeitnowProvider,
  // 3. licensed aggregators (Indeed / Monster / LinkedIn listings come in here)
  jsearchProvider,
  joobleProvider,
  careerjetProvider,
  adzunaProvider,
  // 4. partner-gated
  linkedinTalentProvider,
];

/** Only the ones with credentials/boards present right now. */
export const activeProviders = (): JobProvider[] => ALL_PROVIDERS.filter((p) => p.isConfigured());

export const providerBySource = (source: string): JobProvider | undefined =>
  ALL_PROVIDERS.find((p) => p.source === source);

export * from "./types";
