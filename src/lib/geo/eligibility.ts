/**
 * FSD v1.1 §30 / §32 / §33 — geographic eligibility, as a HARD GATE.
 *
 * BR-018: geographic incompatibility prevents a pair from entering the eligible
 * pool. It does not reduce a score. A candidate who cannot hold the role is not
 * a weaker match, they are not a match, and surfacing them wastes both sides'
 * attention.
 *
 * WHERE THIS RUNS MATTERS. This module is Stage 1 of §34 — the eligibility
 * layer, which decides which pairs are considered at all. It must never be
 * imported from src/lib/matching/**, which decides how strong a considered pair
 * is. The MATCH-030 guard fails the build if that boundary is crossed, because
 * precise geography (postcode, coordinates) is a documented proxy for race and
 * socioeconomic status, and work-authorisation fields are a proxy for national
 * origin under 8 U.S.C. § 1324b. Radius arithmetic therefore happens here, on
 * data the scoring engine never sees. See FSD §38.2.
 *
 * Every `reason` string below is phrased in terms of WORK LOCATION, never in
 * terms of who the candidate is. That is GEO-007, and it is not cosmetic: an
 * exclusion message that says "this role is not open in your location" is a
 * statement about a job, and one that names a nationality is evidence.
 */

import {
  UNKNOWN_COUNTRY,
  countryName,
  isCountryInRegion,
  type CountryCode,
} from "./countries";
import { centroid, distanceMiles } from "./cities";
import { postalCentroid } from "./postal";

export type WorkModel = "ONSITE" | "HYBRID" | "REMOTE";

/** RMT-002 — the geographic scope of a remote role. */
export type RemoteScope = "SAME_COUNTRY" | "COUNTRIES" | "STATES" | "REGION" | "WORLDWIDE";

export const REMOTE_SCOPES: RemoteScope[] = [
  "SAME_COUNTRY",
  "COUNTRIES",
  "STATES",
  "REGION",
  "WORLDWIDE",
];

export type RelocationWillingness = "NONE" | "DOMESTIC" | "INTERNATIONAL";

/**
 * D-4, decided. A job whose work country we cannot determine is not eligible
 * for anyone. The alternative — treating it as "wherever the candidate is" —
 * is exactly the assumption RMT-005 exists to forbid, and it silently produces
 * cross-border matches from missing data.
 *
 * The cost is that legacy rows are invisible until the backfill resolves them,
 * which is why scripts/backfill-geo.mts exists and why country is now required
 * when a recruiter posts. One constant, so the policy is one line to revisit.
 */
export const UNKNOWN_JOB_COUNTRY_IS_ELIGIBLE = false;

export type JobGeo = {
  country: CountryCode;
  stateProvince: string | null;
  city: string | null;
  /** Identity and radius only. Never a scoring input — see postal.ts. */
  postalCode: string | null;
  workModel: WorkModel;
  /** null means the employer did not state a scope — RMT-005 applies. */
  remoteScope: RemoteScope | null;
  remoteScopeCountries: CountryCode[];
  remoteScopeStates: string[];
  remoteScopeRegion: string | null;
  localOnly: boolean;
  localRadiusMiles: number | null;
  allowedCountries: CountryCode[];
  excludedCountries: CountryCode[];
  relocationAccepted: boolean;
};

export type CandidateGeo = {
  currentCountry: CountryCode;
  currentStateProvince: string | null;
  currentCity: string | null;
  /** Optional. Improves radius accuracy for local-only roles and nothing else. */
  currentPostalCode: string | null;
  /** CLP-002. Defaults to currentCountry when unset. */
  searchCountry: CountryCode | null;
  preferredCountries: CountryCode[];
  preferredRegions: string[];
  preferredCities: string[];
  /** CLP-004. Off by default — cross-border matching is opt-in. */
  internationalSearchEnabled: boolean;
  /**
   * CLP-005. Empty means UNSTATED. "SAME" means same country only, "*" means
   * anywhere subject to employer and legal eligibility, and anything else is a
   * list of country codes.
   */
  remoteEligibleCountries: CountryCode[];
  relocationWillingness: RelocationWillingness;
};

export type GeoVerdict = {
  eligible: boolean;
  /** The FSD rule that decided it, for the audit trail and for QA. */
  rule: string;
  /** Candidate-safe explanation. Work location only — never identity. */
  reason: string;
};

const ok = (rule: string, reason: string): GeoVerdict => ({ eligible: true, rule, reason });
const no = (rule: string, reason: string): GeoVerdict => ({ eligible: false, rule, reason });

const up = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();
const lc = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** The country the candidate is searching in — CLP-002 falls back to residence. */
export function effectiveSearchCountry(c: CandidateGeo): CountryCode {
  return c.searchCountry && c.searchCountry !== UNKNOWN_COUNTRY
    ? up(c.searchCountry)
    : up(c.currentCountry);
}

/**
 * RMT-005 — the scope actually in force.
 *
 * A remote job with no stated scope is treated as remote WITHIN THE COUNTRY OF
 * ITS WORK LOCATION. It is never treated as worldwide. This is BR-017, and it
 * is the single most consequential default in this file: the opposite default
 * produces applications the employer cannot lawfully accept.
 */
export function effectiveRemoteScope(job: JobGeo): RemoteScope {
  if (job.workModel !== "REMOTE") return "SAME_COUNTRY";
  return job.remoteScope ?? "SAME_COUNTRY";
}

/** Does a remote role's scope reach the candidate's country? */
function remoteScopeReaches(job: JobGeo, candidateCountry: CountryCode): boolean {
  const scope = effectiveRemoteScope(job);
  const cc = up(candidateCountry);
  switch (scope) {
    case "WORLDWIDE":
      return true;
    case "COUNTRIES":
      return job.remoteScopeCountries.map(up).includes(cc);
    case "REGION":
      return job.remoteScopeRegion ? isCountryInRegion(cc, job.remoteScopeRegion) : false;
    case "STATES":
      // A state-scoped role is inherently within the job's own country.
      return cc === up(job.country);
    case "SAME_COUNTRY":
    default:
      return cc === up(job.country);
  }
}

/**
 * CLP-005 — may the candidate work remotely for an employer in this country?
 *
 * The empty list means UNSTATED, not "same country only". This distinction is
 * load-bearing: the FSD §32.1 matrix says a worldwide-remote role is eligible
 * for a candidate who has not configured anything, and treating silence as a
 * restriction would hide exactly the roles BR-015(c) exists to surface. A
 * candidate who genuinely wants same-country-only says so, and that is stored
 * as the explicit sentinel "SAME".
 */
function candidateRemoteEligible(cand: CandidateGeo, jobCountry: CountryCode): boolean {
  const list = cand.remoteEligibleCountries.map(up);
  if (!list.length) return true;
  if (list.includes("*")) return true;
  if (list.includes("SAME")) return up(jobCountry) === up(cand.currentCountry);
  return list.includes(up(jobCountry));
}

/** LOC-001 – LOC-003 — the local-candidate boundary. */
function withinLocalBoundary(job: JobGeo, cand: CandidateGeo): GeoVerdict {
  const where = job.city ? `${job.city}` : job.stateProvince || countryName(job.country);

  if (up(cand.currentCountry) !== up(job.country)) {
    return no("LOC-003", `This role is open to candidates near ${where} only.`);
  }

  // Preferred path: real distance, when we hold a centroid for both sides.
  //
  // A postal centroid is tried first because it is the most accurate input we
  // have — but only at ZIP3 granularity, which is a sectional centre tens of
  // miles across. That coarseness is deliberate: it is ample for a 25-to-50
  // mile radius and far too blunt to isolate a neighbourhood, which is the
  // line between a distance check and redlining. See postal.ts.
  if (job.localRadiusMiles && job.localRadiusMiles > 0) {
    const a =
      postalCentroid(job.postalCode, job.country) ??
      centroid(job.city, job.stateProvince, job.country);
    const b =
      postalCentroid(cand.currentPostalCode, cand.currentCountry) ??
      centroid(cand.currentCity, cand.currentStateProvince, cand.currentCountry);
    const d = distanceMiles(a, b);
    if (d !== null) {
      return d <= job.localRadiusMiles
        ? ok("LOC-002", `Within ${job.localRadiusMiles} miles of ${where}.`)
        : no(
            "LOC-003",
            `This role is open to candidates within ${job.localRadiusMiles} miles of ${where}.`
          );
    }
    // Fall through to name matching. A missing centroid must never mean
    // "eligible" — see cities.ts.
  }

  // Fallback: name equality. Coarser, but it fails closed.
  if (job.city && cand.currentCity) {
    return lc(job.city) === lc(cand.currentCity)
      ? ok("LOC-002", `Based in ${job.city}.`)
      : no("LOC-003", `This role is open to candidates in ${job.city} only.`);
  }
  if (job.stateProvince && cand.currentStateProvince) {
    return up(job.stateProvince) === up(cand.currentStateProvince)
      ? ok("LOC-002", `Based in ${job.stateProvince}.`)
      : no("LOC-003", `This role is open to candidates in ${job.stateProvince} only.`);
  }
  return no("LOC-003", `This role is open to local candidates near ${where} only.`);
}

/**
 * The gate. Returns eligible/ineligible plus the rule that decided it.
 *
 * Order is deliberate: employer exclusions, then unresolvable geography, then
 * the local-only boundary, then country compatibility. Each step can only
 * narrow, never widen.
 */
export function checkGeoEligibility(job: JobGeo, cand: CandidateGeo): GeoVerdict {
  const jobCountry = up(job.country);
  const candCountry = up(cand.currentCountry);

  // ── 0. The employer's own explicit lists win over everything. ──
  if (job.excludedCountries.map(up).includes(candCountry)) {
    return no("GEO-004", `The employer is not hiring into ${countryName(candCountry)} for this role.`);
  }
  if (job.allowedCountries.length && !job.allowedCountries.map(up).includes(candCountry)) {
    return no(
      "GEO-004",
      `The employer is hiring into ${job.allowedCountries.map(countryName).join(", ")} for this role.`
    );
  }

  // ── 1. Unresolvable geography fails closed (GEO-006 / RMT-005). ──
  if (jobCountry === UNKNOWN_COUNTRY || !jobCountry) {
    return UNKNOWN_JOB_COUNTRY_IS_ELIGIBLE
      ? ok("GEO-006", "This posting does not state a work location.")
      : no("GEO-006", "This posting does not state where the work happens.");
  }
  if (candCountry === UNKNOWN_COUNTRY || !candCountry) {
    return no("GEO-006", "Add your current country to see roles you are eligible for.");
  }

  // ── 2. Local-only is a hard filter, whatever the skills say (BR-016). ──
  if (job.localOnly) {
    const local = withinLocalBoundary(job, cand);
    if (!local.eligible) return local;
  }

  // ── 3. Same country is the default-eligible case (BR-014). ──
  if (candCountry === jobCountry) {
    // A state-scoped remote role still has to reach the candidate's state.
    if (job.workModel === "REMOTE" && effectiveRemoteScope(job) === "STATES") {
      const states = job.remoteScopeStates.map(up);
      if (states.length && !states.includes(up(cand.currentStateProvince))) {
        return no(
          "RMT-002",
          `This remote role can only be performed from ${job.remoteScopeStates.join(", ")}.`
        );
      }
    }
    return ok("BR-014", `Work location is in ${countryName(jobCountry)}.`);
  }

  // ── 4. Cross-border. Off unless something explicitly opens it (BR-015). ──

  // 4a. The candidate asked for this country by name.
  if (cand.preferredCountries.map(up).includes(jobCountry)) {
    return ok("BR-015", `You listed ${countryName(jobCountry)} as a preferred location.`);
  }
  if (cand.preferredRegions.some((r) => isCountryInRegion(jobCountry, r))) {
    return ok("BR-015", `${countryName(jobCountry)} is in a region you listed as preferred.`);
  }

  // 4b. The job explicitly permits remote work from the candidate's country.
  if (job.workModel === "REMOTE") {
    const reaches = remoteScopeReaches(job, candCountry);
    if (reaches && candidateRemoteEligible(cand, jobCountry)) {
      const scope = effectiveRemoteScope(job);
      return ok(
        "BR-015",
        scope === "WORLDWIDE"
          ? "This role is open to remote workers anywhere."
          : `This role is open to remote workers in ${countryName(candCountry)}.`
      );
    }
    if (reaches && !candidateRemoteEligible(cand, jobCountry)) {
      return no(
        "CLP-005",
        `Add ${countryName(jobCountry)} to the countries you can work remotely for to see roles like this.`
      );
    }
  }

  // 4c. The candidate opted into international search at all.
  if (cand.internationalSearchEnabled) {
    return ok("BR-015", `International search is on, and this role is in ${countryName(jobCountry)}.`);
  }

  // 4d. The candidate will relocate internationally and the employer accepts it.
  if (cand.relocationWillingness === "INTERNATIONAL" && job.relocationAccepted) {
    return ok("BR-015", `You are open to relocating, and this employer considers relocation.`);
  }

  // 4e. Otherwise the default in BR-014 stands.
  return no(
    "BR-014",
    `This role is based in ${countryName(jobCountry)}. Turn on international search, or add ${countryName(
      jobCountry
    )} to your preferred locations, to see roles there.`
  );
}

/** Convenience for the deck: eligible pairs only. */
export function isGeoEligible(job: JobGeo, cand: CandidateGeo): boolean {
  return checkGeoEligibility(job, cand).eligible;
}
