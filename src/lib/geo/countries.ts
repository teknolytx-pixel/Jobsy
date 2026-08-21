/**
 * GEO-001 / GEO-002 — the country vocabulary.
 *
 * Everything in this file is about WHERE WORK HAPPENS. Nothing here describes
 * a person's nationality, citizenship or origin, and nothing here may be used
 * to do so. FSD v1.1 §38.1: country of residence and the right to work in a
 * named jurisdiction are location and authorisation facts; nationality is a
 * protected characteristic and 8 U.S.C. § 1324b makes citizenship-status
 * discrimination unlawful for most employers.
 *
 * The practical consequence is that this module is imported by the ELIGIBILITY
 * layer only. It must never be imported from src/lib/matching/** — the
 * MATCH-030 guard enforces that, and FSD §38.2 explains why.
 */

/** ISO 3166-1 alpha-2. */
export type CountryCode = string;

/**
 * The countries Jobsy actually sees traffic from or posts jobs in. Not the full
 * ISO list: an unknown country is better handled as UNKNOWN (which fails
 * closed) than silently matched against a code nobody verified.
 */
export const COUNTRIES: Record<CountryCode, string> = {
  US: "United States",
  CA: "Canada",
  MX: "Mexico",
  GB: "United Kingdom",
  IE: "Ireland",
  DE: "Germany",
  FR: "France",
  ES: "Spain",
  PT: "Portugal",
  IT: "Italy",
  NL: "Netherlands",
  BE: "Belgium",
  CH: "Switzerland",
  AT: "Austria",
  SE: "Sweden",
  NO: "Norway",
  DK: "Denmark",
  FI: "Finland",
  PL: "Poland",
  CZ: "Czechia",
  RO: "Romania",
  UA: "Ukraine",
  GR: "Greece",
  IN: "India",
  SG: "Singapore",
  AU: "Australia",
  NZ: "New Zealand",
  JP: "Japan",
  KR: "South Korea",
  CN: "China",
  HK: "Hong Kong",
  PH: "Philippines",
  ID: "Indonesia",
  MY: "Malaysia",
  VN: "Vietnam",
  TH: "Thailand",
  AE: "United Arab Emirates",
  SA: "Saudi Arabia",
  IL: "Israel",
  TR: "Turkey",
  EG: "Egypt",
  ZA: "South Africa",
  NG: "Nigeria",
  KE: "Kenya",
  BR: "Brazil",
  AR: "Argentina",
  CL: "Chile",
  CO: "Colombia",
  PE: "Peru",
  CR: "Costa Rica",
  PA: "Panama",
};

/**
 * Free-text spellings we accept. Lower-cased on both sides before lookup.
 * Deliberately conservative: "georgia" is a US state far more often than the
 * country in this corpus, so it is NOT aliased to GE.
 */
const ALIASES: Record<string, CountryCode> = {
  usa: "US",
  "u.s.": "US",
  "u.s.a.": "US",
  us: "US",
  "united states": "US",
  "united states of america": "US",
  america: "US",
  uk: "GB",
  "u.k.": "GB",
  "united kingdom": "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "northern ireland": "GB",
  "great britain": "GB",
  britain: "GB",
  eire: "IE",
  deutschland: "DE",
  holland: "NL",
  "the netherlands": "NL",
  uae: "AE",
  "u.a.e.": "AE",
  "korea": "KR",
  "republic of korea": "KR",
  "south korea": "KR",
  "prc": "CN",
  "mainland china": "CN",
  "hong kong sar": "HK",
  bharat: "IN",
  "republic of india": "IN",
  "czech republic": "CZ",
  "cote d'ivoire": "CI",
  "new zealand": "NZ",
  "south africa": "ZA",
  "saudi arabia": "SA",
  "costa rica": "CR",
};

/** Sentinel for "we could not determine the country". Fails closed everywhere. */
export const UNKNOWN_COUNTRY = "ZZ";

/** US states and territories, by postal abbreviation. */
export const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  PR: "Puerto Rico", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming",
};

const US_STATE_BY_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATES).map(([abbr, name]) => [name.toLowerCase(), abbr])
);

/** Canadian provinces — the second-largest source of cross-border confusion. */
export const CA_PROVINCES: Record<string, string> = {
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick",
  NL: "Newfoundland and Labrador", NS: "Nova Scotia", NT: "Northwest Territories",
  NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island", QC: "Quebec",
  SK: "Saskatchewan", YT: "Yukon",
};

/**
 * RMT-002 — named regions a remote role may be scoped to.
 *
 * A region is a convenience over a country list, nothing more. Membership is
 * deliberately explicit rather than computed, so that widening a region is a
 * reviewed change rather than a side effect of adding a country above.
 */
export const REGIONS: Record<string, CountryCode[]> = {
  NORTH_AMERICA: ["US", "CA", "MX"],
  US_CANADA: ["US", "CA"],
  LATAM: ["MX", "BR", "AR", "CL", "CO", "PE", "CR", "PA"],
  EU: [
    "DE", "FR", "ES", "PT", "IT", "NL", "BE", "AT", "SE", "DK", "FI", "PL",
    "CZ", "RO", "GR", "IE",
  ],
  EUROPE: [
    "GB", "IE", "DE", "FR", "ES", "PT", "IT", "NL", "BE", "CH", "AT", "SE",
    "NO", "DK", "FI", "PL", "CZ", "RO", "UA", "GR",
  ],
  NORDICS: ["SE", "NO", "DK", "FI"],
  DACH: ["DE", "AT", "CH"],
  UK_IRELAND: ["GB", "IE"],
  APAC: [
    "IN", "SG", "AU", "NZ", "JP", "KR", "CN", "HK", "PH", "ID", "MY", "VN", "TH",
  ],
  ANZ: ["AU", "NZ"],
  MENA: ["AE", "SA", "IL", "TR", "EG"],
  AFRICA: ["ZA", "NG", "KE", "EG"],
};

export type RegionName = keyof typeof REGIONS;

/** Countries in a named region, or [] if the region is not recognised. */
export function countriesInRegion(region: string): CountryCode[] {
  return REGIONS[region.toUpperCase()] ?? [];
}

export function isCountryInRegion(code: CountryCode, region: string): boolean {
  return countriesInRegion(region).includes(code.toUpperCase());
}

/**
 * Resolve a country name, alias or code to an ISO alpha-2 code.
 * Returns UNKNOWN_COUNTRY rather than guessing — see GEO-006.
 */
export function toCountryCode(input: string | null | undefined): CountryCode {
  if (!input) return UNKNOWN_COUNTRY;
  const raw = input.trim();
  if (!raw) return UNKNOWN_COUNTRY;

  const upper = raw.toUpperCase();
  if (COUNTRIES[upper]) return upper;

  const lower = raw.toLowerCase();
  if (ALIASES[lower]) return ALIASES[lower];

  for (const [code, name] of Object.entries(COUNTRIES)) {
    if (name.toLowerCase() === lower) return code;
  }
  return UNKNOWN_COUNTRY;
}

export function countryName(code: CountryCode): string {
  if (code === UNKNOWN_COUNTRY) return "an unspecified country";
  return COUNTRIES[code.toUpperCase()] ?? code;
}

/** Resolve a US state name or abbreviation to its postal abbreviation. */
export function toUsStateAbbr(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim();
  const upper = raw.toUpperCase();
  if (US_STATES[upper]) return upper;
  return US_STATE_BY_NAME[raw.toLowerCase()] ?? null;
}

export function isUsState(token: string): boolean {
  return toUsStateAbbr(token) !== null;
}

export function isCaProvince(token: string): boolean {
  const upper = token.trim().toUpperCase();
  if (CA_PROVINCES[upper]) return true;
  return Object.values(CA_PROVINCES).some((n) => n.toLowerCase() === token.trim().toLowerCase());
}
