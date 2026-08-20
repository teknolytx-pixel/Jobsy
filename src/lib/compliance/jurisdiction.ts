/**
 * Jurisdiction detection.
 *
 * Maps a free-text location string to a US state code and, where relevant, a
 * covered locality. This is used ONLY to decide which legal notices and posting
 * rules apply. It is never an input to the matching engine — see PRD MATCH-030,
 * and note that Illinois HB 3773 expressly bans ZIP code as a proxy for a
 * protected class.
 */

export type StateCode =
  | "AL" | "AK" | "AZ" | "AR" | "CA" | "CO" | "CT" | "DE" | "DC" | "FL" | "GA"
  | "HI" | "ID" | "IL" | "IN" | "IA" | "KS" | "KY" | "LA" | "ME" | "MD" | "MA"
  | "MI" | "MN" | "MS" | "MO" | "MT" | "NE" | "NV" | "NH" | "NJ" | "NM" | "NY"
  | "NC" | "ND" | "OH" | "OK" | "OR" | "PA" | "PR" | "RI" | "SC" | "SD" | "TN"
  | "TX" | "UT" | "VT" | "VA" | "WA" | "WV" | "WI" | "WY";

/** Localities with their own rules on top of their state's. */
export type Locality =
  | "NYC"
  | "WESTCHESTER_NY"
  | "ITHACA_NY"
  | "ALBANY_COUNTY_NY"
  | "JERSEY_CITY_NJ"
  | "CLEVELAND_OH"
  | "COLUMBUS_OH"
  | "CINCINNATI_OH"
  | "TOLEDO_OH";

export type Jurisdiction = {
  state: StateCode | null;
  locality: Locality | null;
  /** True when the location could not be resolved. Never treated as a mismatch. */
  unknown: boolean;
  /** True when the role is remote and therefore potentially open to every state. */
  remoteNationwide: boolean;
};

const NAME_TO_CODE: Record<string, StateCode> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  "washington dc": "DC", "washington, d.c.": "DC", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "puerto rico": "PR", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX",
  utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};

const CODES = new Set(Object.values(NAME_TO_CODE));

/**
 * Metro and city names that imply a state. Ordered longest-first at match time
 * so "Kansas City" resolves before "Kansas", and "New York City" before
 * "New York".
 */
const CITY_TO_STATE = [
  ["new york city", "NY"], ["nyc", "NY"], ["manhattan", "NY"], ["brooklyn", "NY"],
  ["queens, ny", "NY"], ["bronx", "NY"], ["staten island", "NY"],
  ["westchester", "NY"], ["ithaca", "NY"], ["albany", "NY"], ["buffalo", "NY"],
  ["rochester, ny", "NY"], ["syracuse", "NY"],
  ["san francisco", "CA"], ["bay area", "CA"], ["silicon valley", "CA"],
  ["los angeles", "CA"], ["san diego", "CA"], ["san jose", "CA"],
  ["oakland", "CA"], ["sacramento", "CA"], ["palo alto", "CA"],
  ["mountain view", "CA"], ["sunnyvale", "CA"], ["santa monica", "CA"], ["irvine", "CA"],
  ["seattle", "WA"], ["bellevue", "WA"], ["redmond", "WA"], ["tacoma", "WA"], ["spokane", "WA"],
  ["chicago", "IL"], ["evanston", "IL"], ["naperville", "IL"],
  ["boston", "MA"], ["cambridge, ma", "MA"], ["somerville", "MA"], ["worcester", "MA"],
  ["denver", "CO"], ["boulder", "CO"], ["colorado springs", "CO"], ["fort collins", "CO"],
  ["austin", "TX"], ["dallas", "TX"], ["houston", "TX"], ["san antonio", "TX"],
  ["fort worth", "TX"], ["plano", "TX"],
  ["jersey city", "NJ"], ["newark", "NJ"], ["hoboken", "NJ"], ["princeton", "NJ"],
  ["cleveland", "OH"], ["columbus", "OH"], ["cincinnati", "OH"], ["toledo", "OH"],
  ["philadelphia", "PA"], ["pittsburgh", "PA"],
  ["atlanta", "GA"], ["miami", "FL"], ["orlando", "FL"], ["tampa", "FL"], ["jacksonville", "FL"],
  ["portland, or", "OR"], ["portland or", "OR"], ["eugene", "OR"],
  ["minneapolis", "MN"], ["st. paul", "MN"], ["saint paul", "MN"],
  ["baltimore", "MD"], ["bethesda", "MD"], ["rockville", "MD"], ["annapolis", "MD"],
  ["hartford", "CT"], ["stamford", "CT"], ["new haven", "CT"],
  ["providence", "RI"], ["burlington, vt", "VT"], ["montpelier", "VT"],
  ["portland, me", "ME"], ["portland me", "ME"],
  ["honolulu", "HI"], ["las vegas", "NV"], ["reno", "NV"],
  ["salt lake city", "UT"], ["phoenix", "AZ"], ["tucson", "AZ"], ["scottsdale", "AZ"],
  ["nashville", "TN"], ["memphis", "TN"], ["charlotte", "NC"], ["raleigh", "NC"],
  ["durham", "NC"], ["richmond", "VA"], ["arlington, va", "VA"], ["alexandria, va", "VA"],
  ["detroit", "MI"], ["ann arbor", "MI"], ["grand rapids", "MI"],
  ["milwaukee", "WI"], ["madison, wi", "WI"],
  ["kansas city, mo", "MO"], ["kansas city, ks", "KS"], ["st. louis", "MO"],
  ["saint louis", "MO"], ["omaha", "NE"], ["des moines", "IA"],
  ["indianapolis", "IN"], ["louisville", "KY"], ["new orleans", "LA"],
  ["oklahoma city", "OK"], ["tulsa", "OK"], ["little rock", "AR"],
  ["boise", "ID"], ["anchorage", "AK"], ["albuquerque", "NM"],
  ["charleston, sc", "SC"], ["columbia, sc", "SC"], ["birmingham", "AL"],
  ["jackson, ms", "MS"], ["billings", "MT"], ["fargo", "ND"], ["sioux falls", "SD"],
  ["cheyenne", "WY"], ["charleston, wv", "WV"], ["wilmington, de", "DE"],
  ["manchester, nh", "NH"], ["san juan", "PR"],
  ["washington, dc", "DC"], ["washington d.c.", "DC"],
] as [string, StateCode][];
CITY_TO_STATE.sort((a, b) => b[0].length - a[0].length);

const LOCALITY_RULES: [RegExp, Locality][] = [
  [/\b(new york,?\s*ny|new york city|nyc|manhattan|brooklyn|the bronx)\b/i, "NYC"],
  [/\bwestchester\b/i, "WESTCHESTER_NY"],
  [/\bithaca\b/i, "ITHACA_NY"],
  [/\balbany county\b/i, "ALBANY_COUNTY_NY"],
  [/\bjersey city\b/i, "JERSEY_CITY_NJ"],
  [/\bcleveland\b/i, "CLEVELAND_OH"],
  [/\bcolumbus\b/i, "COLUMBUS_OH"],
  [/\bcincinnati\b/i, "CINCINNATI_OH"],
  [/\btoledo\b/i, "TOLEDO_OH"],
];

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Resolve a location string.
 *
 * `remote` is passed separately because a fully remote US role is potentially
 * open to a resident of any state, which changes which posting rules bite. That
 * is the reading practitioners take of "a position that may be performed in"
 * a covered state, and it is the conservative one.
 */
export function detectJurisdiction(
  location: string | null | undefined,
  remote?: string | null
): Jurisdiction {
  const remoteNationwide = (remote ?? "").toUpperCase() === "REMOTE";
  if (!location || !location.trim()) {
    return { state: null, locality: null, unknown: true, remoteNationwide };
  }

  const raw = location.trim();
  const lower = normalize(raw);

  let locality: Locality | null = null;
  for (const [re, loc] of LOCALITY_RULES) {
    if (re.test(raw)) {
      locality = loc;
      break;
    }
  }

  // 1. Two-letter code, as a standalone token — "Austin, TX" or "TX".
  //    Word-bounded so "IN" inside "Indianapolis" or the word "in" cannot match.
  const codeMatch = raw.match(/(?:^|[,\s])([A-Z]{2})(?:[,\s]|$)/);
  if (codeMatch && CODES.has(codeMatch[1] as StateCode)) {
    return { state: codeMatch[1] as StateCode, locality, unknown: false, remoteNationwide };
  }

  // 2. Full state name.
  for (const [name, code] of Object.entries(NAME_TO_CODE)) {
    if (lower.includes(name)) {
      return { state: code, locality, unknown: false, remoteNationwide };
    }
  }

  // 3. Known city or metro. Longest first — "kansas city, mo" before "kansas".
  for (const [city, code] of CITY_TO_STATE) {
    if (lower.includes(city)) {
      return { state: code, locality, unknown: false, remoteNationwide };
    }
  }

  return { state: null, locality, unknown: true, remoteNationwide };
}

/** Convenience — the code alone, for storing on a user row. */
export function stateOf(location: string | null | undefined): StateCode | null {
  return detectJurisdiction(location).state;
}
