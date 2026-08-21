/**
 * Postal code as LOCATION IDENTITY.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE USING ANYTHING IN THIS FILE.
 *
 * A postal code is the most legally loaded field in this codebase. Illinois
 * HB 3773 names ZIP code EXPLICITLY as a prohibited proxy for a protected
 * class in AI-assisted employment decisions, and the reason is history:
 * postal boundaries in the United States were drawn over, and still trace,
 * the lines of residential segregation. Screening candidates by ZIP is
 * redlining with a spreadsheet.
 *
 * So this module draws a hard line between two different uses:
 *
 *   IDENTITY  — "which place is this posting about?"  ALLOWED.
 *               A ZIP is a far better identifier than a city string, which
 *               is misspelled, abbreviated, duplicated across states and
 *               written six ways by six job boards. Using it to decide that
 *               two postings are the same posting discriminates against
 *               nobody.
 *
 *   SCREENING — "is this candidate acceptable?"       PROHIBITED.
 *               A ZIP must never be a feature the scoring engine can see,
 *               never a filter a recruiter can set directly, and never a
 *               tiebreak. The MATCH-030 guard fails the build if the string
 *               `zip` or `postalCode` appears anywhere under src/lib/matching,
 *               and this module is unreachable from there by construction.
 *
 * The one place the two nearly touch is radius matching (LOC-002), where a
 * ZIP centroid is genuinely the most accurate input available. Two deliberate
 * choices keep that on the right side of the line:
 *
 *   1. Distance is computed from the ZIP3 PREFIX, not the full code. A three
 *      digit prefix is a sectional centre — tens of miles across — which is
 *      ample for a 25-to-50-mile radius and far too coarse to isolate a
 *      neighbourhood. We deliberately throw precision away.
 *   2. The result is a boolean in the eligibility layer. No distance, no ZIP
 *      and no derived score is ever returned to the ranking code.
 *
 * FSD v1.1 §36.1 (postalCode: "Storage only"), §38.2 and §38.3.
 * ─────────────────────────────────────────────────────────────────────────
 */

import type { LatLng } from "./cities";
import { UNKNOWN_COUNTRY, type CountryCode } from "./countries";

/**
 * US ZIP prefix → state.
 *
 * ZIP prefixes are allocated to states in contiguous blocks, so a range table
 * validates a ZIP against a stated state without shipping 41,000 rows. It
 * catches the two errors that actually occur in job feeds: a typo, and a ZIP
 * pasted from a different posting than the city beside it.
 *
 * Ranges are inclusive, on the three-digit prefix.
 */
const US_ZIP3_RANGES: [number, number, string][] = [
  [5, 5, "NY"], [6, 9, "PR"],
  [10, 27, "MA"], [28, 29, "RI"], [30, 38, "NH"], [39, 49, "ME"],
  [50, 59, "VT"], [60, 69, "CT"], [70, 89, "NJ"],
  [100, 149, "NY"], [150, 196, "PA"], [197, 199, "DE"],
  [200, 205, "DC"], [206, 219, "MD"], [220, 246, "VA"], [247, 268, "WV"],
  [270, 289, "NC"], [290, 299, "SC"],
  [300, 319, "GA"], [320, 349, "FL"], [350, 369, "AL"],
  [370, 385, "TN"], [386, 397, "MS"], [398, 399, "GA"],
  [400, 427, "KY"], [430, 459, "OH"], [460, 479, "IN"], [480, 499, "MI"],
  [500, 528, "IA"], [530, 549, "WI"], [550, 567, "MN"],
  [570, 577, "SD"], [580, 588, "ND"], [590, 599, "MT"],
  [600, 629, "IL"], [630, 658, "MO"], [660, 679, "KS"], [680, 693, "NE"],
  [700, 714, "LA"], [716, 729, "AR"], [730, 749, "OK"],
  [750, 799, "TX"], [800, 816, "CO"], [820, 831, "WY"], [832, 838, "ID"],
  [840, 847, "UT"], [850, 865, "AZ"], [870, 884, "NM"], [885, 885, "TX"],
  [889, 898, "NV"], [900, 961, "CA"], [967, 968, "HI"],
  [970, 979, "OR"], [980, 994, "WA"], [995, 999, "AK"],
];

/**
 * ZIP3 → centroid, for the metros in cities.ts.
 *
 * Curated rather than exhaustive, and coarse on purpose — see the header. A
 * prefix that is not here falls back to the city centroid, and a job with
 * neither falls back to name equality, which fails closed.
 */
const ZIP3_CENTROIDS: Record<string, LatLng> = {
  // Texas
  "750": { lat: 32.78, lng: -96.8 }, "751": { lat: 32.78, lng: -96.8 },
  "752": { lat: 32.78, lng: -96.8 }, "753": { lat: 32.78, lng: -96.8 },
  "760": { lat: 32.76, lng: -97.33 }, "761": { lat: 32.76, lng: -97.33 },
  "770": { lat: 29.76, lng: -95.37 }, "772": { lat: 29.76, lng: -95.37 },
  "773": { lat: 29.76, lng: -95.37 }, "774": { lat: 29.76, lng: -95.37 },
  "775": { lat: 29.76, lng: -95.37 },
  "782": { lat: 29.42, lng: -98.49 },
  "786": { lat: 30.27, lng: -97.74 }, "787": { lat: 30.27, lng: -97.74 },
  // Northeast
  "100": { lat: 40.71, lng: -74.01 }, "101": { lat: 40.71, lng: -74.01 },
  "102": { lat: 40.71, lng: -74.01 }, "104": { lat: 40.85, lng: -73.87 },
  "112": { lat: 40.68, lng: -73.94 },
  "071": { lat: 40.74, lng: -74.17 }, "073": { lat: 40.73, lng: -74.06 },
  "021": { lat: 42.36, lng: -71.06 }, "022": { lat: 42.36, lng: -71.06 },
  "191": { lat: 39.95, lng: -75.17 }, "152": { lat: 40.44, lng: -79.996 },
  // Mid-Atlantic / South
  "200": { lat: 38.91, lng: -77.04 }, "202": { lat: 38.91, lng: -77.04 },
  "203": { lat: 38.91, lng: -77.04 }, "204": { lat: 38.91, lng: -77.04 },
  "205": { lat: 38.91, lng: -77.04 },
  "222": { lat: 38.88, lng: -77.1 }, "212": { lat: 39.29, lng: -76.61 },
  "232": { lat: 37.54, lng: -77.44 },
  "282": { lat: 35.23, lng: -80.84 }, "276": { lat: 35.78, lng: -78.64 },
  "277": { lat: 35.99, lng: -78.9 },
  "303": { lat: 33.75, lng: -84.39 }, "308": { lat: 33.75, lng: -84.39 },
  "331": { lat: 25.76, lng: -80.19 }, "328": { lat: 28.54, lng: -81.38 },
  "336": { lat: 27.95, lng: -82.46 }, "322": { lat: 30.33, lng: -81.66 },
  "372": { lat: 36.16, lng: -86.78 }, "381": { lat: 35.15, lng: -90.05 },
  "701": { lat: 29.95, lng: -90.07 },
  // Midwest
  "606": { lat: 41.88, lng: -87.63 }, "482": { lat: 42.33, lng: -83.05 },
  "432": { lat: 39.96, lng: -83.0 }, "441": { lat: 41.5, lng: -81.69 },
  "452": { lat: 39.1, lng: -84.51 }, "462": { lat: 39.77, lng: -86.16 },
  "532": { lat: 43.04, lng: -87.91 }, "554": { lat: 44.98, lng: -93.27 },
  "641": { lat: 39.1, lng: -94.58 }, "631": { lat: 38.63, lng: -90.2 },
  "731": { lat: 35.47, lng: -97.52 },
  // Mountain / Southwest
  "802": { lat: 39.74, lng: -104.99 }, "803": { lat: 40.01, lng: -105.27 },
  "841": { lat: 40.76, lng: -111.89 }, "850": { lat: 33.45, lng: -112.07 },
  "857": { lat: 32.22, lng: -110.97 }, "891": { lat: 36.17, lng: -115.14 },
  "871": { lat: 35.08, lng: -106.65 },
  // West coast
  "941": { lat: 37.77, lng: -122.42 }, "946": { lat: 37.8, lng: -122.27 },
  "951": { lat: 37.34, lng: -121.89 }, "943": { lat: 37.44, lng: -122.14 },
  "940": { lat: 37.39, lng: -122.08 },
  "900": { lat: 34.05, lng: -118.24 }, "904": { lat: 34.02, lng: -118.49 },
  "926": { lat: 33.68, lng: -117.83 }, "921": { lat: 32.72, lng: -117.16 },
  "958": { lat: 38.58, lng: -121.49 },
  "972": { lat: 45.52, lng: -122.68 }, "981": { lat: 47.61, lng: -122.33 },
  "980": { lat: 47.61, lng: -122.2 },
  "968": { lat: 21.31, lng: -157.86 }, "995": { lat: 61.22, lng: -149.9 },
};

/**
 * Normalise a postal code for the given country.
 *
 * Returns null rather than guessing. A malformed code is worse than no code:
 * it produces a confident identity for the wrong place.
 */
export function normalisePostalCode(
  raw: string | null | undefined,
  country: CountryCode
): string | null {
  const v = (raw ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!v) return null;
  const cc = (country ?? "").toUpperCase();

  switch (cc) {
    case "US": {
      // ZIP or ZIP+4. We keep only the five-digit ZIP: the +4 identifies a
      // block face or a single building, which is more precision than any
      // hiring decision has a right to.
      const m = v.match(/^(\d{5})(?:-?\d{4})?$/);
      return m ? m[1] : null;
    }
    case "CA": {
      const m = v.replace(/[^A-Z0-9]/g, "").match(/^([A-Z]\d[A-Z])(\d[A-Z]\d)?$/);
      return m ? (m[2] ? `${m[1]} ${m[2]}` : m[1]) : null;
    }
    case "GB": {
      const compact = v.replace(/\s+/g, "");
      const m = compact.match(/^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})?$/);
      return m ? (m[2] ? `${m[1]} ${m[2]}` : m[1]) : null;
    }
    case "IN":
      return /^\d{6}$/.test(v.replace(/\s/g, "")) ? v.replace(/\s/g, "") : null;
    case "DE":
    case "ES":
    case "FR":
    case "IT":
      return /^\d{5}$/.test(v) ? v : null;
    case "AU":
    case "NZ":
    case "CH":
    case "AT":
    case "BE":
    case "DK":
    case "NO":
      return /^\d{4}$/.test(v) ? v : null;
    case "NL": {
      const m = v.replace(/\s/g, "").match(/^(\d{4})([A-Z]{2})$/);
      return m ? `${m[1]} ${m[2]}` : null;
    }
    case "SG":
      return /^\d{6}$/.test(v) ? v : null;
    default:
      // Unknown scheme: accept a conservative alphanumeric token so the code
      // still serves as an identifier, but never invent structure.
      return /^[A-Z0-9][A-Z0-9 -]{1,9}$/.test(v) ? v : null;
  }
}

/** The three-digit US prefix — the only granularity used for distance. */
export function zip3(postal: string | null | undefined): string | null {
  const v = (postal ?? "").trim();
  return /^\d{5}$/.test(v) ? v.slice(0, 3) : null;
}

/** The state a US ZIP belongs to, or null if it is outside every allocated block. */
export function stateForUsZip(postal: string | null | undefined): string | null {
  const p = zip3(postal);
  if (!p) return null;
  const n = Number(p);
  for (const [lo, hi, state] of US_ZIP3_RANGES) {
    if (n >= lo && n <= hi) return state;
  }
  return null;
}

/**
 * Does a US ZIP agree with the state beside it?
 *
 * Returns "MATCH", "MISMATCH" or "UNVERIFIABLE". Callers should treat
 * UNVERIFIABLE as fine — an unallocated prefix or a non-US country is not an
 * error — and MISMATCH as a data-quality problem worth surfacing to whoever
 * typed it, rather than silently correcting.
 */
export function checkZipState(
  postal: string | null | undefined,
  stateProvince: string | null | undefined,
  country: CountryCode
): "MATCH" | "MISMATCH" | "UNVERIFIABLE" {
  if ((country ?? "").toUpperCase() !== "US") return "UNVERIFIABLE";
  const expected = stateForUsZip(postal);
  const given = (stateProvince ?? "").trim().toUpperCase();
  if (!expected || !given) return "UNVERIFIABLE";
  return expected === given ? "MATCH" : "MISMATCH";
}

/** Centroid from a postal code, at ZIP3 granularity. US only for now. */
export function postalCentroid(
  postal: string | null | undefined,
  country: CountryCode
): LatLng | null {
  if ((country ?? "").toUpperCase() !== "US") return null;
  const p = zip3(postal);
  return p ? (ZIP3_CENTROIDS[p] ?? null) : null;
}

/**
 * THE UNIQUE LOCATION IDENTITY: country | state | postal code.
 *
 * This is what makes two postings the same place. It is deliberately built
 * from the three fields in that order, most stable first:
 *
 *   • country is authoritative and never ambiguous once resolved
 *   • state disambiguates the many duplicated city names within a country
 *   • postal code pins the actual place, and unlike a city string it does not
 *     vary by spelling, abbreviation, accent or which suburb the board chose
 *
 * When there is no postal code the key degrades to country|state|city, which
 * is what we had before and is still better than nothing. It NEVER degrades to
 * country alone: merging every posting in a country would be worse than not
 * merging at all.
 *
 * Returns null when there is not enough to identify a place, which callers
 * must treat as "do not merge" rather than "merge with everything".
 */
export function placeKey(input: {
  country: CountryCode;
  stateProvince?: string | null;
  postalCode?: string | null;
  city?: string | null;
}): string | null {
  const country = (input.country ?? "").toUpperCase();
  if (!country || country === UNKNOWN_COUNTRY) return null;

  const postal = normalisePostalCode(input.postalCode, country);
  const state = (input.stateProvince ?? "").trim().toUpperCase();

  if (postal) return `${country}|${state}|${postal}`;

  const city = (input.city ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!city && !state) return null;
  return `${country}|${state}|c:${city}`;
}

/** True when the key was built from a postal code rather than a city name. */
export function isPostalKey(key: string | null): boolean {
  return Boolean(key) && !key!.includes("|c:");
}

/**
 * Extract a postal code from a free-text location.
 *
 * Job feeds write "Austin, TX 78701" and "London EC2A 4NE" constantly. Pulling
 * the code out turns a soft city match into a hard identity, which is the whole
 * point of this change.
 */
export function extractPostalCode(text: string | null | undefined, country: CountryCode): string | null {
  const v = (text ?? "").trim();
  if (!v) return null;
  const cc = (country ?? "").toUpperCase();

  if (cc === "US") {
    const m = v.match(/\b(\d{5})(?:-\d{4})?\b/);
    return m ? m[1] : null;
  }
  if (cc === "CA") {
    const m = v.toUpperCase().match(/\b([A-Z]\d[A-Z])\s?(\d[A-Z]\d)\b/);
    return m ? `${m[1]} ${m[2]}` : null;
  }
  if (cc === "GB") {
    const m = v.toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s?(\d[A-Z]{2})\b/);
    return m ? `${m[1]} ${m[2]}` : null;
  }
  if (cc === "IN" || cc === "SG") {
    const m = v.match(/\b(\d{6})\b/);
    return m ? m[1] : null;
  }
  if (["DE", "ES", "FR", "IT"].includes(cc)) {
    const m = v.match(/\b(\d{5})\b/);
    return m ? m[1] : null;
  }
  return null;
}
