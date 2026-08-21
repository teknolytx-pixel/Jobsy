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
  COUNTRIES,
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

/**
 * Airport-style and colloquial city abbreviations.
 *
 * Real feeds are full of "SF, NYC, SEA, CHI". Consulted only AFTER the country
 * and state checks have failed, so a token like "SD" is still read as South
 * Dakota (which resolves to the US anyway) rather than San Diego.
 */
const CITY_ABBREV: Record<string, { city: string; country: CountryCode }> = {
  sf: { city: "San Francisco", country: "US" },
  sfo: { city: "San Francisco", country: "US" },
  nyc: { city: "New York", country: "US" },
  ny: { city: "New York", country: "US" },
  lax: { city: "Los Angeles", country: "US" },
  chi: { city: "Chicago", country: "US" },
  chicago: { city: "Chicago", country: "US" },
  sea: { city: "Seattle", country: "US" },
  atl: { city: "Atlanta", country: "US" },
  bos: { city: "Boston", country: "US" },
  phl: { city: "Philadelphia", country: "US" },
  phx: { city: "Phoenix", country: "US" },
  dfw: { city: "Dallas", country: "US" },
  pdx: { city: "Portland", country: "US" },
  den: { city: "Denver", country: "US" },
  aus: { city: "Austin", country: "US" },
  hou: { city: "Houston", country: "US" },
  msp: { city: "Minneapolis", country: "US" },
  ldn: { city: "London", country: "GB" },
  lon: { city: "London", country: "GB" },
  blr: { city: "Bengaluru", country: "IN" },
  hyd: { city: "Hyderabad", country: "IN" },
  bom: { city: "Mumbai", country: "IN" },
  yyz: { city: "Toronto", country: "CA" },
  yvr: { city: "Vancouver", country: "CA" },
  ber: { city: "Berlin", country: "DE" },
  ams: { city: "Amsterdam", country: "NL" },
  syd: { city: "Sydney", country: "AU" },
};

/**
 * ATS country-prefix notation: "US-New York", "CA-Toronto", "GB-London".
 *
 * Greenhouse and Lever emit this constantly, and it is the single largest
 * cause of unresolved locations in a real corpus. The prefix IS the country,
 * so this converts a total failure into a high-confidence answer.
 */
function stripCountryPrefix(part: string): { country: CountryCode | null; rest: string } {
  const m = part.match(/^\s*([A-Za-z]{2})\s*[-–—]\s*(.+)$/);
  if (!m) return { country: null, rest: part };

  const token = m[1];
  const rest = m[2].trim();
  const code = toCountryCode(token);
  if (code === UNKNOWN_COUNTRY) return { country: null, rest: part };

  // "CA-" is both California and Canada. Let the city decide, exactly as it
  // does for "San Francisco, CA" vs "Berlin, DE": CA-Toronto is Canada,
  // CA-San Francisco is California. With no recognisable city, follow the ATS
  // convention, where the prefix is an ISO country code.
  if (token.length === 2 && isUsState(token) && code !== "US") {
    const byCity = INFERABLE_CITIES[norm(rest)] ?? CITY_ABBREV[norm(rest)]?.country;
    if (byCity) return { country: byCity, rest };
  }
  return { country: code, rest };
}

/**
 * Locations listed as alternatives rather than as one place.
 *
 * Real postings use every separator anyone has ever thought of: "London OR
 * Dublin", "Chicago and NYC", "New York/ San Francisco", "Berlin & Munich".
 */
function splitAlternatives(text: string): string[] {
  return text
    .split(/\s+\b(?:or|and)\b\s+|\s*[;|/&+]\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Last resort: a country named inside a sentence rather than as a field.
 *
 * "Remote in the US", "Work from anywhere in Canada". Only full country names
 * and a few unmistakable abbreviations are matched, on word boundaries, so
 * "Indiana" never becomes India and "Chilean" never becomes Chile.
 */
function countryFromPhrase(text: string): CountryCode {
  if (/\b(?:the\s+)?u\.?s\.?a?\.?\b/i.test(text) && /\b(?:the\s+us(?:a)?|u\.s\.a?\.?|usa)\b/i.test(text)) {
    return "US";
  }
  if (/\bthe\s+u\.?k\.?\b/i.test(text)) return "GB";

  const lower = text.toLowerCase();
  const hits = new Set<CountryCode>();
  for (const [code, name] of Object.entries(COUNTRIES)) {
    const escaped = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`).test(lower)) hits.add(code);
  }
  return hits.size === 1 ? [...hits][0] : UNKNOWN_COUNTRY;
}

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

  let parts = text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let country: CountryCode = UNKNOWN_COUNTRY;
  let confidence: ResolvedLocation["confidence"] = "UNKNOWN";
  let stateProvince: string | null = null;
  let city: string | null = null;

  // A postal code glued to a state ("TX 78701") would stop the state matching
  // below from recognising "TX". The code itself is recovered from the original
  // string in step 5, so nothing is lost by removing it here.
  for (let i = 0; i < parts.length; i++) {
    parts[i] = parts[i]
      .replace(/\s*\b\d{5}(?:-\d{4})?\b\s*/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  parts = parts.filter(Boolean);

  // ── 0. ATS country prefixes: "US-New York, US-Chicago" ──
  //
  // Applied per part, because a multi-city posting repeats the prefix on every
  // one. If the parts disagree about the country the posting spans borders, and
  // we say UNKNOWN rather than picking a winner.
  const prefixCountries = new Set<CountryCode>();
  for (let i = 0; i < parts.length; i++) {
    const { country: pc, rest } = stripCountryPrefix(parts[i]);
    if (!pc) continue;
    prefixCountries.add(pc);
    parts[i] = rest;
  }
  if (prefixCountries.size === 1) {
    country = [...prefixCountries][0];
    confidence = "EXPLICIT";
  } else if (prefixCountries.size > 1) {
    return {
      country: UNKNOWN_COUNTRY,
      stateProvince: null,
      city: null,
      postalCode: null,
      confidence: "UNKNOWN",
      mentionsRemote,
    };
  }

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
  //
  // Skipped for a multi-city posting. "US-San Francisco, US-Chicago, US-New
  // York" is three cities in one country, and reading "New York" as THE state
  // of the posting would be worse than leaving it blank.
  const multiPlace = prefixCountries.size === 1 && parts.length > 1;
  for (let i = parts.length - 1; !multiPlace && i >= 0; i--) {
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

  // ── 3. Whatever remains is the city. For a multi-city posting we keep the
  // first as a label; the country is what the eligibility layer acts on. ──
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
    } else {
      const abbrev = CITY_ABBREV[norm(city)];
      if (abbrev) {
        country = abbrev.country;
        city = abbrev.city;
        confidence = "INFERRED";
      }
    }
  }

  // ── 4b. A list of alternatives that all sit in one country. ──
  //
  // "SF, NYC, SEA, CHI" is four cities and one country. Parsing it as
  // city/state/country produces nothing, so fall back to reading each part as
  // a place in its own right. Only agreement counts: if the parts span
  // countries the posting genuinely spans borders, and UNKNOWN is the honest
  // answer.
  if (country === UNKNOWN_COUNTRY) {
    const candidates = [
      ...splitAlternatives(text),
      ...text.split(",").map((s) => s.trim()),
    ].filter(Boolean);

    const found = new Set<CountryCode>();
    let firstCity: string | null = null;
    for (const cand of candidates) {
      if (norm(cand) === norm(text)) continue; // avoid infinite regress
      const sub = resolveLocation(cand);
      if (sub.country === UNKNOWN_COUNTRY) continue;
      found.add(sub.country);
      if (!firstCity) firstCity = sub.city;
    }
    if (found.size === 1) {
      country = [...found][0];
      city = firstCity;
      stateProvince = null;
      confidence = "INFERRED";
    }
  }

  // ── 4c. A country named inside a sentence: "Remote in the US". ──
  if (country === UNKNOWN_COUNTRY) {
    const phrase = countryFromPhrase(original);
    if (phrase !== UNKNOWN_COUNTRY) {
      country = phrase;
      city = null;
      stateProvince = null;
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
