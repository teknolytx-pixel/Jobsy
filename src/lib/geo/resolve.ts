/**
 * GEO-001 / GEO-002 — turn a free-text location into a structured one.
 *
 * Every job and every candidate in the existing database holds location as a
 * single string: "Austin, TX", "Remote — US", "Bengaluru, India", "London".
 * FSD v1.1 §39.2 D-1 records the three options for that legacy data and
 * recommends the conservative one: resolve what we confidently can, and treat
 * everything else as country-unknown so it fails closed rather than matching
 * across borders on a guess.
 *
 * This module therefore never returns a country it is not sure about.
 * `confidence` is part of the return value precisely so callers can tell the
 * difference between "United States" and "probably the United States".
 */

import { extractPostalCode, normalisePostalCode, stateForUsZip } from "./postal";
import {
  UNKNOWN_COUNTRY,
  toCountryCode,
  toUsStateAbbr,
  isUsState,
  CA_PROVINCES,
  type CountryCode,
} from "./countries";

export type ResolvedLocation = {
  country: CountryCode;
  stateProvince: string | null;
  city: string | null;
  /** GEO-001 — the identity component. See postal.ts for what may use it. */
  postalCode: string | null;
  /**
   * EXPLICIT — the text named the country, or named a state/province that
   *            belongs to exactly one country.
   * INFERRED — the city name maps to exactly one country in our centroid table.
   * UNKNOWN  — we could not tell. Fails closed under GEO-006.
   */
  confidence: "EXPLICIT" | "INFERRED" | "UNKNOWN";
  /** True when the text itself said "remote" — the caller still decides scope. */
  mentionsRemote: boolean;
};

const REMOTE_WORDS =
  /\b(remote|work from home|wfh|distributed|anywhere|telecommute|virtual)\b/i;

/** Strip decoration ingested feeds add: "Remote — ", "(Hybrid)", "Multiple locations". */
function clean(input: string): string {
  return input
    .replace(/\((remote|hybrid|on-?site|contract|full-?time|part-?time)\)/gi, " ")
    .replace(/\b(remote|hybrid|on-?site)\s*[-–—:|]\s*/gi, " ")
    .replace(/\s*[-–—|]\s*(remote|hybrid|on-?site)\b/gi, " ")
    .replace(/\b(multiple locations|various locations|several locations)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * City names we are willing to infer a country from, because the name maps to
 * exactly one country in practice.
 *
 * Kept separate from the centroid table on purpose: a centroid exists for
 * radius arithmetic, which is a different question from "is it safe to guess a
 * country from this word alone". Ambiguous names are omitted so they resolve to
 * UNKNOWN rather than to a coin flip.
 */
const INFERABLE_CITIES: Record<string, CountryCode> = {
  "new york": "US", brooklyn: "US", "jersey city": "US", newark: "US",
  boston: "US", philadelphia: "US", pittsburgh: "US", baltimore: "US",
  richmond: "US", charlotte: "US", raleigh: "US", durham: "US", atlanta: "US",
  miami: "US", orlando: "US", tampa: "US", jacksonville: "US", nashville: "US",
  memphis: "US", "new orleans": "US", houston: "US", dallas: "US",
  "fort worth": "US", plano: "US", irving: "US", austin: "US",
  "san antonio": "US", "oklahoma city": "US", "kansas city": "US",
  "st louis": "US", chicago: "US", detroit: "US", cleveland: "US",
  cincinnati: "US", indianapolis: "US", milwaukee: "US", minneapolis: "US",
  denver: "US", boulder: "US", "salt lake city": "US", phoenix: "US",
  tucson: "US", "las vegas": "US", albuquerque: "US", "san francisco": "US",
  oakland: "US", "palo alto": "US", "mountain view": "US", sunnyvale: "US",
  "los angeles": "US", "santa monica": "US", irvine: "US", "san diego": "US",
  sacramento: "US", seattle: "US", bellevue: "US", honolulu: "US",
  anchorage: "US",
  toronto: "CA", ottawa: "CA", montreal: "CA", vancouver: "CA", calgary: "CA",
  edmonton: "CA",
  london: "GB", manchester: "GB", edinburgh: "GB", glasgow: "GB", bristol: "GB",
  leeds: "GB",
  dublin: "IE",
  berlin: "DE", munich: "DE", hamburg: "DE", frankfurt: "DE",
  paris: "FR", amsterdam: "NL", brussels: "BE", zurich: "CH", vienna: "AT",
  madrid: "ES", barcelona: "ES", lisbon: "PT", milan: "IT", rome: "IT",
  stockholm: "SE", oslo: "NO", copenhagen: "DK", helsinki: "FI",
  warsaw: "PL", krakow: "PL", prague: "CZ", bucharest: "RO", athens: "GR",
  bengaluru: "IN", bangalore: "IN", hyderabad: "IN", chennai: "IN",
  mumbai: "IN", pune: "IN", "new delhi": "IN", gurugram: "IN", noida: "IN",
  kolkata: "IN", ahmedabad: "IN",
  singapore: "SG", "hong kong": "HK", tokyo: "JP", osaka: "JP", seoul: "KR",
  shanghai: "CN", beijing: "CN", shenzhen: "CN", manila: "PH", jakarta: "ID",
  "kuala lumpur": "MY", "ho chi minh city": "VN", hanoi: "VN", bangkok: "TH",
  sydney: "AU", melbourne: "AU", brisbane: "AU", perth: "AU",
  auckland: "NZ", wellington: "NZ",
  dubai: "AE", "abu dhabi": "AE", riyadh: "SA", "tel aviv": "IL",
  istanbul: "TR", cairo: "EG", johannesburg: "ZA", "cape town": "ZA",
  lagos: "NG", nairobi: "KE",
  "mexico city": "MX", guadalajara: "MX", "sao paulo": "BR",
  "rio de janeiro": "BR", "buenos aires": "AR", santiago: "CL", bogota: "CO",
  lima: "PE", "panama city": "PA",
  // Deliberately absent because the name is ambiguous across countries:
  //   Cambridge (MA / GB), San Jose (CA / CR), Birmingham (AL / GB),
  //   Portland (OR / ME), Washington (DC / state), Arlington (VA / TX).
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");

/**
 * Resolve free text to a structured location.
 *
 * Accepts the shapes real data actually contains:
 *   "Austin, TX"            "Austin, TX, USA"       "Remote — US"
 *   "Bengaluru, India"      "London"                "Toronto, ON, Canada"
 *   "Remote"                ""                      "Multiple locations"
 */
export function resolveLocation(input: string | null | undefined): ResolvedLocation {
  const original = (input ?? "").trim();
  const mentionsRemote = REMOTE_WORDS.test(original);

  const text = clean(original);
  if (!text) {
    return {
      country: UNKNOWN_COUNTRY,
      stateProvince: null,
      city: null,
      postalCode: null,
      confidence: "UNKNOWN",
      mentionsRemote,
    };
  }

  const parts = text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let country: CountryCode = UNKNOWN_COUNTRY;
  let confidence: ResolvedLocation["confidence"] = "UNKNOWN";
  let stateProvince: string | null = null;
  let city: string | null = null;

  // ── 1. An UNAMBIGUOUS country, usually last. ──
  //
  // "CA" is California far more often than Canada in this corpus, and the same
  // trap is set by DE (Delaware/Germany), IN (Indiana/India), LA
  // (Louisiana/Laos), PA, MD, ME, MT, AL, AR, VA, GA and more. Reading a bare
  // two-letter US state as a country silently relocates the largest US tech
  // market to another continent, so ambiguous tokens are left for step 2 and
  // resolved by context in step 3.
  for (let i = parts.length - 1; i >= 0; i--) {
    const token = parts[i];
    const code = toCountryCode(token);
    if (code === UNKNOWN_COUNTRY) continue;
    if (token.trim().length === 2 && isUsState(token)) continue; // ambiguous — later
    country = code;
    confidence = "EXPLICIT";
    parts.splice(i, 1);
    break;
  }

  // ── 2. A state or province, which implies its own country. ──
  for (let i = parts.length - 1; i >= 0; i--) {
    const token = parts[i];
    const us = toUsStateAbbr(token);
    if (us && (country === "US" || country === UNKNOWN_COUNTRY)) {
      stateProvince = us;
      if (country === UNKNOWN_COUNTRY) {
        country = "US";
        confidence = "EXPLICIT";
      }
      parts.splice(i, 1);
      break;
    }
    const upper = token.toUpperCase();
    const caMatch =
      CA_PROVINCES[upper] ??
      Object.entries(CA_PROVINCES).find(([, n]) => n.toLowerCase() === norm(token))?.[0];
    if (caMatch && (country === "CA" || country === UNKNOWN_COUNTRY)) {
      stateProvince = CA_PROVINCES[upper] ? upper : caMatch;
      if (country === UNKNOWN_COUNTRY) {
        country = "CA";
        confidence = "EXPLICIT";
      }
      parts.splice(i, 1);
      break;
    }
  }

  // ── 3. Whatever remains is the city. ──
  if (parts.length) city = parts[0];

  // ── 3b. Let the city arbitrate an ambiguous two-letter token. ──
  //
  // "Berlin, DE" is Germany, not Delaware; "San Francisco, CA" is California,
  // not Canada. Where the city names a country unambiguously, it wins over the
  // state reading, because a city is far more specific than a two-letter code.
  if (city && stateProvince && country === "US") {
    const byCity = INFERABLE_CITIES[norm(city)];
    if (byCity && byCity !== "US") {
      country = byCity;
      stateProvince = null;
      confidence = "EXPLICIT";
    }
  }

  // ── 4. Infer the country from an unambiguous city name, as a fallback. ──
  if (country === UNKNOWN_COUNTRY && city) {
    const guess = INFERABLE_CITIES[norm(city)];
    if (guess) {
      country = guess;
      confidence = "INFERRED";
    }
  }

  // ── 5. The postal code, and what it can tell us that the text did not. ──
  //
  // A US ZIP names its own state, so "Austin 78701" yields TX even though the
  // text never said so. This is identity resolution, not screening: see the
  // header of postal.ts for why that distinction is the whole ballgame.
  const postalCode =
    country === UNKNOWN_COUNTRY ? null : normalisePostalCode(extractPostalCode(original, country), country);

  if (postalCode && country === "US" && !stateProvince) {
    stateProvince = stateForUsZip(postalCode);
  }

  // Strip a trailing ZIP from the city we captured: "Austin 78701" is Austin.
  if (city && postalCode) {
    const stripped = city.replace(new RegExp(`\\s*${postalCode}(?:-\\d{4})?\\s*$`), "").trim();
    city = stripped || null;
  }

  return { country, stateProvince, city: city || null, postalCode, confidence, mentionsRemote };
}

/** Convenience for backfills: the country alone, or null when unresolved. */
export function resolveCountry(input: string | null | undefined): CountryCode | null {
  const r = resolveLocation(input);
  return r.country === UNKNOWN_COUNTRY ? null : r.country;
}
