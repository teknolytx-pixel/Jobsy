/**
 * Adapters: database rows → the shapes checkGeoEligibility works on.
 *
 * These exist so the eligibility rules stay pure and testable, and so the one
 * place that knows about legacy free-text `location` is here rather than
 * scattered through the rules. Rows are typed structurally rather than against
 * the Drizzle model, which keeps this module importable from scripts and tests
 * without dragging the database client along.
 */

import { UNKNOWN_COUNTRY, toCountryCode, type CountryCode } from "./countries";
import { resolveLocation } from "./resolve";
import type {
  CandidateGeo,
  JobGeo,
  RelocationWillingness,
  RemoteScope,
  WorkModel,
} from "./eligibility";

export type JobRowLike = {
  location?: string | null;
  remote?: string | null;
  countryCode?: string | null;
  stateProvince?: string | null;
  city?: string | null;
  postalCode?: string | null;
  remoteScope?: string | null;
  remoteScopeCountries?: string[] | null;
  remoteScopeStates?: string[] | null;
  remoteScopeRegion?: string | null;
  localOnly?: boolean | null;
  localRadiusMiles?: number | null;
  relocationAccepted?: boolean | null;
  allowedCountries?: string[] | null;
  excludedCountries?: string[] | null;
};

export type UserRowLike = {
  location?: string | null;
  currentCountry?: string | null;
  currentStateProvince?: string | null;
  currentCity?: string | null;
  currentPostalCode?: string | null;
  searchCountry?: string | null;
  preferredCountries?: string[] | null;
  preferredRegions?: string[] | null;
  preferredCities?: string[] | null;
  internationalSearchEnabled?: boolean | null;
  remoteEligibleCountries?: string[] | null;
  relocationWillingness?: string | null;
};

const toWorkModel = (remote: string | null | undefined): WorkModel => {
  const v = (remote ?? "").toUpperCase();
  if (v === "REMOTE") return "REMOTE";
  if (v === "HYBRID") return "HYBRID";
  return "ONSITE";
};

/**
 * Structured columns win. Where they are null — a legacy row the backfill has
 * not reached — we resolve the free-text string, which may still come back
 * UNKNOWN. That is the intended outcome: unknown fails closed (GEO-006).
 */
export function toJobGeo(job: JobRowLike): JobGeo {
  const fallback = job.countryCode ? null : resolveLocation(job.location);

  const country: CountryCode = job.countryCode
    ? toCountryCode(job.countryCode)
    : fallback?.country ?? UNKNOWN_COUNTRY;

  const workModel = toWorkModel(job.remote);
  const scope = (job.remoteScope as RemoteScope | null) ?? null;

  return {
    country,
    stateProvince: job.stateProvince ?? fallback?.stateProvince ?? null,
    city: job.city ?? fallback?.city ?? null,
    postalCode: job.postalCode ?? fallback?.postalCode ?? null,
    workModel,
    remoteScope: scope,
    remoteScopeCountries: (job.remoteScopeCountries ?? []).map(toCountryCode),
    remoteScopeStates: job.remoteScopeStates ?? [],
    remoteScopeRegion: job.remoteScopeRegion ?? null,
    localOnly: Boolean(job.localOnly),
    localRadiusMiles: job.localRadiusMiles ?? null,
    allowedCountries: (job.allowedCountries ?? []).map(toCountryCode),
    excludedCountries: (job.excludedCountries ?? []).map(toCountryCode),
    relocationAccepted: Boolean(job.relocationAccepted),
  };
}

export function toCandidateGeo(user: UserRowLike): CandidateGeo {
  const fallback = user.currentCountry ? null : resolveLocation(user.location);

  const currentCountry: CountryCode = user.currentCountry
    ? toCountryCode(user.currentCountry)
    : fallback?.country ?? UNKNOWN_COUNTRY;

  const relocation = (user.relocationWillingness ?? "NONE").toUpperCase();

  return {
    currentCountry,
    currentStateProvince: user.currentStateProvince ?? fallback?.stateProvince ?? null,
    currentCity: user.currentCity ?? fallback?.city ?? null,
    currentPostalCode: user.currentPostalCode ?? fallback?.postalCode ?? null,
    searchCountry: user.searchCountry ? toCountryCode(user.searchCountry) : null,
    preferredCountries: (user.preferredCountries ?? []).map(toCountryCode),
    preferredRegions: user.preferredRegions ?? [],
    preferredCities: user.preferredCities ?? [],
    internationalSearchEnabled: Boolean(user.internationalSearchEnabled),
    // "*" and "SAME" are sentinels, not countries — see CLP-005 in
    // eligibility.ts for why an empty list must NOT be read as "SAME".
    remoteEligibleCountries: (user.remoteEligibleCountries ?? []).map((c) =>
      c === "*" || c === "SAME" ? c : toCountryCode(c)
    ),
    relocationWillingness: (["NONE", "DOMESTIC", "INTERNATIONAL"].includes(relocation)
      ? relocation
      : "NONE") as RelocationWillingness,
  };
}
