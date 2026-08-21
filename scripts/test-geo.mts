#!/usr/bin/env tsx
/**
 * FSD v1.1 §37 — the geographic QA matrix, plus the resolver and de-duplication
 * behaviour the rules depend on.
 *
 * TC-GEO-01 … TC-GEO-16 are the scenarios written into the FSD verbatim. They
 * are all P0: the failure they exist to prevent is showing a candidate roles
 * they cannot lawfully or practically hold, and showing a recruiter candidates
 * they specifically excluded.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Dynamic import, matching the convention in test-matching.mts. A .mts entry is
// true ESM while the app's .ts modules transpile to CJS, so a static named
// import fails to link — destructuring a dynamic import interops correctly.
const { checkGeoEligibility, effectiveRemoteScope } = await import(
  "../src/lib/geo/eligibility"
);
const { resolveLocation } = await import("../src/lib/geo/resolve");
const { toCountryCode, isCountryInRegion, UNKNOWN_COUNTRY } = await import(
  "../src/lib/geo/countries"
);
const { distanceMiles, centroid } = await import("../src/lib/geo/cities");
const { dedupeKey, normaliseTitle, normaliseCompany, preferCanonical, isPostalDedupeKey } =
  await import("../src/lib/dedupe");
const {
  normalisePostalCode,
  zip3,
  stateForUsZip,
  checkZipState,
  postalCentroid,
  placeKey,
  isPostalKey,
  extractPostalCode,
} = await import("../src/lib/geo/postal");

type JobGeo = Parameters<typeof checkGeoEligibility>[0];
type CandidateGeo = Parameters<typeof checkGeoEligibility>[1];

let pass = 0;
let fail = 0;
const failures: string[] = [];

function t(id: string, name: string, fn: () => void) {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    failures.push(`${id}  ${name}\n      ${(e as Error).message.split("\n")[0]}`);
  }
}

// ── builders, so each case shows only what it is actually testing ──
function job(over: Partial<JobGeo> = {}): JobGeo {
  return {
    country: "US",
    stateProvince: "TX",
    city: "Austin",
    postalCode: null,
    workModel: "ONSITE",
    remoteScope: null,
    remoteScopeCountries: [],
    remoteScopeStates: [],
    remoteScopeRegion: null,
    localOnly: false,
    localRadiusMiles: null,
    allowedCountries: [],
    excludedCountries: [],
    relocationAccepted: false,
    ...over,
  };
}

function cand(over: Partial<CandidateGeo> = {}): CandidateGeo {
  return {
    currentCountry: "US",
    currentStateProvince: "TX",
    currentCity: "Austin",
    currentPostalCode: null,
    searchCountry: null,
    preferredCountries: [],
    preferredRegions: [],
    preferredCities: [],
    internationalSearchEnabled: false,
    remoteEligibleCountries: [],
    relocationWillingness: "NONE",
    ...over,
  };
}

const eligible = (j: JobGeo, c: CandidateGeo) => checkGeoEligibility(j, c).eligible;

// ═══════════════════════════════════════════════════════════════
// FSD §37 — the matrix
// ═══════════════════════════════════════════════════════════════

t("TC-GEO-01", "USA candidate, USA job → match", () => {
  assert.equal(eligible(job(), cand()), true);
});

t("TC-GEO-02", "USA candidate, India on-site job → not surfaced", () => {
  const j = job({ country: "IN", stateProvince: null, city: "Hyderabad" });
  assert.equal(eligible(j, cand()), false, "BR-014 must exclude a foreign on-site role");
});

t("TC-GEO-03", "USA candidate, Canada remote job → not surfaced by default", () => {
  const j = job({
    country: "CA",
    stateProvince: "ON",
    city: "Toronto",
    workModel: "REMOTE",
    remoteScope: "SAME_COUNTRY",
  });
  assert.equal(eligible(j, cand()), false, "Remote in Canada is not remote in the USA");
});

t("TC-GEO-04", "USA candidate, worldwide remote job → eligible with NO configuration", () => {
  // FSD §32.1 says this is eligible for a plain candidate. An unstated remote
  // reach must therefore not behave as a restriction — see CLP-005.
  const j = job({ country: "IN", workModel: "REMOTE", remoteScope: "WORLDWIDE" });
  assert.equal(eligible(j, cand()), true, "silence must not be read as a restriction");
  assert.equal(eligible(j, cand({ remoteEligibleCountries: ["*"] })), true);
});

t("TC-GEO-05", "USA candidate adds Canada to preferences, Canada job → eligible", () => {
  const j = job({ country: "CA", stateProvince: "ON", city: "Toronto" });
  assert.equal(eligible(j, cand({ preferredCountries: ["CA"] })), true);
});

t("TC-GEO-06", "USA candidate enables international search, UK job → eligible", () => {
  const j = job({ country: "GB", stateProvince: null, city: "London" });
  assert.equal(eligible(j, cand({ internationalSearchEnabled: true })), true);
});

t("TC-GEO-07", "India candidate, USA job → not surfaced by default", () => {
  const c = cand({ currentCountry: "IN", currentStateProvince: null, currentCity: "Hyderabad" });
  assert.equal(eligible(job(), c), false);
});

t("TC-GEO-08", "India candidate, worldwide remote USA job → eligible", () => {
  const j = job({ workModel: "REMOTE", remoteScope: "WORLDWIDE" });
  const c = cand({ currentCountry: "IN", currentStateProvince: null, currentCity: "Hyderabad" });
  assert.equal(eligible(j, c), true);
});

t("TC-GEO-09", "Dallas local-only job, Dallas candidate → match", () => {
  const j = job({ city: "Dallas", localOnly: true, localRadiusMiles: 50 });
  const c = cand({ currentCity: "Dallas" });
  assert.equal(eligible(j, c), true);
});

t("TC-GEO-10", "Dallas local-only job, Houston candidate → not surfaced", () => {
  const j = job({ city: "Dallas", localOnly: true, localRadiusMiles: 50 });
  const c = cand({ currentCity: "Houston" });
  const v = checkGeoEligibility(j, c);
  assert.equal(v.eligible, false, "BR-016: skill coverage must not override the boundary");
  assert.equal(v.rule, "LOC-003");
});

t("TC-GEO-11", "Remote USA-only job, India candidate → not surfaced", () => {
  const j = job({ workModel: "REMOTE", remoteScope: "SAME_COUNTRY" });
  const c = cand({ currentCountry: "IN", currentStateProvince: null, currentCity: "Pune" });
  assert.equal(eligible(j, c), false);
});

t("TC-GEO-12", "Worldwide remote job, India candidate → eligible", () => {
  const j = job({ workModel: "REMOTE", remoteScope: "WORLDWIDE" });
  const c = cand({
    currentCountry: "IN",
    currentStateProvince: null,
    currentCity: "Pune",
    remoteEligibleCountries: ["*"],
  });
  assert.equal(eligible(j, c), true);
});

t("TC-GEO-13", "Remote job with no stated scope is NOT worldwide (BR-017)", () => {
  const j = job({ workModel: "REMOTE", remoteScope: null });
  assert.equal(effectiveRemoteScope(j), "SAME_COUNTRY", "RMT-005 default");
  const foreign = cand({ currentCountry: "IN", currentStateProvince: null, currentCity: "Pune" });
  assert.equal(eligible(j, foreign), false, "an unscoped remote role must not reach abroad");
  assert.equal(eligible(j, cand()), true, "but it still reaches its own country");
});

t("TC-GEO-14", "Candidate changes country → eligibility changes with it", () => {
  const j = job();
  assert.equal(eligible(j, cand()), true);
  const moved = cand({ currentCountry: "GB", currentStateProvince: null, currentCity: "London" });
  assert.equal(eligible(j, moved), false, "the gate must read current state, not cached state");
});

t("TC-GEO-15", "Recruiter widens the radius → the pool widens", () => {
  const c = cand({ currentCity: "Houston" });
  assert.equal(eligible(job({ city: "Dallas", localOnly: true, localRadiusMiles: 50 }), c), false);
  assert.equal(eligible(job({ city: "Dallas", localOnly: true, localRadiusMiles: 300 }), c), true);
});

t("TC-GEO-16", "Exclusion reasons never mention nationality or origin (GEO-007)", () => {
  const banned = /\b(nationality|citizen|citizenship|origin|immigrant|visa status|passport|race|ethnic)\b/i;
  const cases: [JobGeo, CandidateGeo][] = [
    [job({ country: "IN" }), cand()],
    [job({ city: "Dallas", localOnly: true, localRadiusMiles: 50 }), cand({ currentCity: "Houston" })],
    [job({ workModel: "REMOTE", remoteScope: "SAME_COUNTRY" }), cand({ currentCountry: "IN" })],
    [job({ excludedCountries: ["US"] }), cand()],
    [job({ country: UNKNOWN_COUNTRY }), cand()],
    [job({ allowedCountries: ["CA"] }), cand()],
  ];
  for (const [j, c] of cases) {
    const v = checkGeoEligibility(j, c);
    assert.equal(
      banned.test(v.reason),
      false,
      `reason names a protected characteristic: "${v.reason}"`
    );
  }
});

// ═══════════════════════════════════════════════════════════════
// Additional rules the matrix depends on
// ═══════════════════════════════════════════════════════════════

t("TC-GEO-17", "unknown job country fails closed (GEO-006)", () => {
  const v = checkGeoEligibility(job({ country: UNKNOWN_COUNTRY }), cand());
  assert.equal(v.eligible, false);
  assert.equal(v.rule, "GEO-006");
});

t("TC-GEO-18", "unknown candidate country fails closed and says what to fix", () => {
  const v = checkGeoEligibility(job(), cand({ currentCountry: UNKNOWN_COUNTRY }));
  assert.equal(v.eligible, false);
  assert.match(v.reason, /country/i);
});

t("TC-GEO-19", "employer exclusion list beats every opt-in the candidate has", () => {
  const j = job({ workModel: "REMOTE", remoteScope: "WORLDWIDE", excludedCountries: ["IN"] });
  const c = cand({
    currentCountry: "IN",
    internationalSearchEnabled: true,
    remoteEligibleCountries: ["*"],
    preferredCountries: ["US"],
  });
  assert.equal(eligible(j, c), false, "an employer's own exclusion is not overridable");
});

t("TC-GEO-20", "allow list restricts even same-country candidates", () => {
  assert.equal(eligible(job({ allowedCountries: ["CA"] }), cand()), false);
});

t("TC-GEO-21", "state-scoped remote role checks the candidate's state", () => {
  const j = job({ workModel: "REMOTE", remoteScope: "STATES", remoteScopeStates: ["CA", "WA"] });
  assert.equal(eligible(j, cand({ currentStateProvince: "TX" })), false);
  assert.equal(eligible(j, cand({ currentStateProvince: "CA" })), true);
});

t("TC-GEO-22", "region-scoped remote role uses the region membership table", () => {
  const j = job({
    country: "US",
    workModel: "REMOTE",
    remoteScope: "REGION",
    remoteScopeRegion: "NORTH_AMERICA",
  });
  const canadian = cand({
    currentCountry: "CA",
    currentStateProvince: "ON",
    currentCity: "Toronto",
    remoteEligibleCountries: ["US"],
  });
  assert.equal(eligible(j, canadian), true);
  const british = cand({
    currentCountry: "GB",
    currentStateProvince: null,
    currentCity: "London",
    remoteEligibleCountries: ["US"],
  });
  assert.equal(eligible(j, british), false);
});

t("TC-GEO-23", "an EXPLICIT same-country reach limits cross-border remote (CLP-005)", () => {
  const j = job({ country: "GB", city: "London", workModel: "REMOTE", remoteScope: "WORLDWIDE" });

  // Unstated: the worldwide role is eligible (TC-GEO-04).
  assert.equal(eligible(j, cand()), true);

  // Explicitly same-country-only: the same role is not.
  const v = checkGeoEligibility(j, cand({ remoteEligibleCountries: ["SAME"] }));
  assert.equal(v.eligible, false, "an explicit restriction must be honoured");
  assert.equal(v.rule, "CLP-005");

  // A named list that includes the job's country works too.
  assert.equal(eligible(j, cand({ remoteEligibleCountries: ["GB"] })), true);
  // …and one that does not, does not.
  assert.equal(eligible(j, cand({ remoteEligibleCountries: ["CA"] })), false);
});

t("TC-GEO-24", "international relocation needs the employer to accept it too", () => {
  const j = job({ country: "GB", city: "London" });
  const willing = cand({ relocationWillingness: "INTERNATIONAL" });
  assert.equal(eligible(j, willing), false, "candidate willingness alone is not enough");
  assert.equal(eligible(job({ country: "GB", city: "London", relocationAccepted: true }), willing), true);
});

t("TC-GEO-25", "local-only falls back to name matching when a centroid is missing", () => {
  const j = job({ city: "Nowheresville", localOnly: true, localRadiusMiles: 50 });
  assert.equal(eligible(j, cand({ currentCity: "Austin" })), false, "must fail closed");
  assert.equal(eligible(j, cand({ currentCity: "Nowheresville" })), true);
});

t("TC-GEO-26", "preferred region opens a country without enabling global search", () => {
  const j = job({ country: "DE", stateProvince: null, city: "Berlin" });
  assert.equal(eligible(j, cand({ preferredRegions: ["EU"] })), true);
  assert.equal(eligible(j, cand({ preferredRegions: ["APAC"] })), false);
});

// ═══════════════════════════════════════════════════════════════
// Resolver — GEO-001 / GEO-002 / D-1
// ═══════════════════════════════════════════════════════════════

t("TC-GEO-30", "resolves city, state and country from common shapes", () => {
  const a = resolveLocation("Austin, TX");
  assert.equal(a.country, "US");
  assert.equal(a.stateProvince, "TX");
  assert.equal(a.city, "Austin");

  const b = resolveLocation("Bengaluru, India");
  assert.equal(b.country, "IN");
  assert.equal(b.city, "Bengaluru");

  const c = resolveLocation("Toronto, ON, Canada");
  assert.equal(c.country, "CA");
  assert.equal(c.stateProvince, "ON");
});

t("TC-GEO-31", "strips remote decoration without losing the place", () => {
  const r = resolveLocation("Remote — Austin, TX");
  assert.equal(r.country, "US");
  assert.equal(r.mentionsRemote, true);
  assert.equal(r.city, "Austin");
});

t("TC-GEO-32", "ambiguous city names resolve to UNKNOWN, not a coin flip", () => {
  assert.equal(resolveLocation("Cambridge").country, UNKNOWN_COUNTRY);
  assert.equal(resolveLocation("San Jose").country, UNKNOWN_COUNTRY);
  // …but an unambiguous one is safe to infer.
  assert.equal(resolveLocation("Bengaluru").country, "IN");
  assert.equal(resolveLocation("Bengaluru").confidence, "INFERRED");
});

t("TC-GEO-32b", "two-letter tokens that are BOTH a US state and a country code", () => {
  // This is the bug that relocated California to Canada. Every one of these
  // pairs is a live trap in real posting data.
  const cal = resolveLocation("San Francisco, CA");
  assert.equal(cal.country, "US", "CA after a US city is California");
  assert.equal(cal.stateProvince, "CA");

  const berlin = resolveLocation("Berlin, DE");
  assert.equal(berlin.country, "DE", "DE after a German city is Germany, not Delaware");
  assert.equal(berlin.stateProvince, null);

  assert.equal(resolveLocation("Indianapolis, IN").country, "US", "IN is Indiana here");
  assert.equal(resolveLocation("Mumbai, IN").country, "IN", "IN is India here");
  assert.equal(resolveLocation("New Orleans, LA").country, "US", "LA is Louisiana here");
  assert.equal(resolveLocation("Philadelphia, PA").country, "US", "PA is Pennsylvania here");
  assert.equal(resolveLocation("Baltimore, MD").country, "US", "MD is Maryland here");
  assert.equal(resolveLocation("Richmond, VA").country, "US", "VA is Virginia here");
  assert.equal(resolveLocation("Atlanta, GA").country, "US", "GA is Georgia the state here");

  // An explicit, unambiguous country still wins over a state-shaped token.
  const vancouver = resolveLocation("Vancouver, BC, Canada");
  assert.equal(vancouver.country, "CA");
  assert.equal(vancouver.stateProvince, "BC");
});

t("TC-GEO-33", "empty and meaningless locations are UNKNOWN", () => {
  for (const s of ["", "   ", "Remote", "Multiple locations"]) {
    assert.equal(resolveLocation(s).country, UNKNOWN_COUNTRY, `"${s}" must not resolve`);
  }
});

t("TC-GEO-34", "country aliases and codes normalise", () => {
  for (const s of ["USA", "United States", "us", "U.S.A."]) {
    assert.equal(toCountryCode(s), "US", s);
  }
  assert.equal(toCountryCode("England"), "GB");
  assert.equal(toCountryCode("Wakanda"), UNKNOWN_COUNTRY);
});

t("TC-GEO-35", "region membership is explicit", () => {
  assert.equal(isCountryInRegion("US", "NORTH_AMERICA"), true);
  assert.equal(isCountryInRegion("GB", "EU"), false, "the UK is not in the EU");
  assert.equal(isCountryInRegion("GB", "EUROPE"), true);
});

// ═══════════════════════════════════════════════════════════════
// Distance — LOC-002
// ═══════════════════════════════════════════════════════════════

t("TC-GEO-40", "Dallas to Houston is around 225 miles", () => {
  const d = distanceMiles(centroid("Dallas", "TX", "US"), centroid("Houston", "TX", "US"));
  assert.ok(d !== null && d > 200 && d < 250, `got ${d}`);
});

t("TC-GEO-41", "distance is null when either centroid is unknown", () => {
  assert.equal(distanceMiles(centroid("Nowheresville", null, "US"), centroid("Dallas", "TX", "US")), null);
});

// ═══════════════════════════════════════════════════════════════
// De-duplication — SRC-007
// ═══════════════════════════════════════════════════════════════

t("TC-SRC-07-01", "the same role from two sources shares a key", () => {
  const a = dedupeKey({
    title: "Senior Frontend Engineer (Remote)",
    companyName: "Acme, Inc.",
    location: "Austin, TX",
  });
  const b = dedupeKey({
    title: "Sr. Frontend Engineer",
    companyName: "Acme Inc",
    location: "Austin, TX, USA",
  });
  assert.equal(a, b, `keys differ:\n  ${a}\n  ${b}`);
});

t("TC-SRC-07-02", "different roles at the same company do NOT collapse", () => {
  const a = dedupeKey({ title: "Engineer II, Payments", companyName: "Acme", location: "Austin, TX" });
  const b = dedupeKey({ title: "Engineer II, Risk", companyName: "Acme", location: "Austin, TX" });
  assert.notEqual(a, b);
});

t("TC-SRC-07-03", "same role in two cities does NOT collapse", () => {
  const a = dedupeKey({ title: "Support Engineer", companyName: "Acme", location: "Austin, TX" });
  const b = dedupeKey({ title: "Support Engineer", companyName: "Acme", location: "Seattle, WA" });
  assert.notEqual(a, b);
});

t("TC-SRC-07-04", "an unresolvable place yields no key rather than a bad merge", () => {
  assert.equal(dedupeKey({ title: "Engineer", companyName: "Acme", location: "" }), null);
  assert.equal(dedupeKey({ title: "Engineer", companyName: "Acme", location: "Remote" }), null);
});

t("TC-SRC-07-05", "normalisers strip the noise boards add", () => {
  assert.equal(normaliseTitle("Sr. Data Engineer (Remote) req #4821"), "senior data engineer");
  assert.equal(normaliseCompany("Acme Technologies, Inc."), "acme technologies");
});

t("TC-SRC-07-06", "employer-submitted beats crawled as the canonical posting", () => {
  const crawled = { id: "b", origin: "EXTERNALLY_DISCOVERED", consentSource: "CRAWLED", postedAt: new Date("2026-01-01") };
  const direct = { id: "a", origin: "JOBSY_CREATED", consentSource: "EMPLOYER_SUBMITTED", postedAt: new Date("2026-06-01") };
  assert.equal(preferCanonical(crawled, direct).id, "a", "the employer's own posting wins");
});

t("TC-SRC-07-07", "canonical choice is stable across runs", () => {
  const a = { id: "a", origin: "EXTERNALLY_DISCOVERED", consentSource: "CRAWLED", postedAt: new Date("2026-03-01") };
  const b = { id: "b", origin: "EXTERNALLY_DISCOVERED", consentSource: "CRAWLED", postedAt: new Date("2026-03-01") };
  assert.equal(preferCanonical(a, b).id, preferCanonical(b, a).id, "order must not change the winner");
});



// ═══════════════════════════════════════════════════════════════
// Postal code as location IDENTITY — country | state | postal
// ═══════════════════════════════════════════════════════════════

t("TC-ZIP-01", "US ZIP normalises, and ZIP+4 is deliberately truncated", () => {
  assert.equal(normalisePostalCode("78701", "US"), "78701");
  assert.equal(normalisePostalCode(" 78701 ", "US"), "78701");
  // +4 identifies a block face or a single building. We do not keep it.
  assert.equal(normalisePostalCode("78701-1234", "US"), "78701");
  assert.equal(normalisePostalCode("787011234", "US"), "78701");
  assert.equal(normalisePostalCode("7870", "US"), null, "too short is null, not padded");
  assert.equal(normalisePostalCode("ABCDE", "US"), null);
});

t("TC-ZIP-02", "non-US schemes normalise to their own shape", () => {
  assert.equal(normalisePostalCode("m5v 3l9", "CA"), "M5V 3L9");
  assert.equal(normalisePostalCode("M5V", "CA"), "M5V");
  assert.equal(normalisePostalCode("ec2a4ne", "GB"), "EC2A 4NE");
  assert.equal(normalisePostalCode("560001", "IN"), "560001");
  assert.equal(normalisePostalCode("10115", "DE"), "10115");
  assert.equal(normalisePostalCode("1011 AB", "NL"), "1011 AB");
  assert.equal(normalisePostalCode("99999999", "IN"), null);
});

t("TC-ZIP-03", "a US ZIP names its own state", () => {
  assert.equal(stateForUsZip("78701"), "TX", "Austin");
  assert.equal(stateForUsZip("94105"), "CA", "San Francisco");
  assert.equal(stateForUsZip("10001"), "NY", "Manhattan");
  assert.equal(stateForUsZip("02139"), "MA", "Cambridge");
  assert.equal(stateForUsZip("60601"), "IL", "Chicago");
  assert.equal(stateForUsZip("98101"), "WA", "Seattle");
  assert.equal(stateForUsZip("33101"), "FL", "Miami");
  assert.equal(zip3("78701"), "787");
});

t("TC-ZIP-04", "a ZIP that contradicts its state is caught, not silently fixed", () => {
  assert.equal(checkZipState("78701", "TX", "US"), "MATCH");
  assert.equal(checkZipState("78701", "CA", "US"), "MISMATCH", "Austin ZIP with California");
  assert.equal(checkZipState("94105", "TX", "US"), "MISMATCH");
  // Not our business to verify: non-US, or nothing to compare against.
  assert.equal(checkZipState("M5V 3L9", "ON", "CA"), "UNVERIFIABLE");
  assert.equal(checkZipState(null, "TX", "US"), "UNVERIFIABLE");
  assert.equal(checkZipState("78701", null, "US"), "UNVERIFIABLE");
});

t("TC-ZIP-05", "placeKey is country | state | postal, and degrades to city", () => {
  assert.equal(
    placeKey({ country: "US", stateProvince: "TX", postalCode: "78701" }),
    "US|TX|78701"
  );
  // ZIP+4 collapses, so the two forms are the SAME place.
  assert.equal(
    placeKey({ country: "US", stateProvince: "TX", postalCode: "78701-9999" }),
    placeKey({ country: "US", stateProvince: "TX", postalCode: "78701" })
  );
  // No postal: falls back to city, and says so.
  const byCity = placeKey({ country: "US", stateProvince: "TX", city: "Austin" });
  assert.equal(byCity, "US|TX|c:austin");
  assert.equal(isPostalKey("US|TX|78701"), true);
  assert.equal(isPostalKey(byCity), false);
  // Never degrades to country alone.
  assert.equal(placeKey({ country: "US" }), null);
  assert.equal(placeKey({ country: UNKNOWN_COUNTRY, postalCode: "78701" }), null);
});

t("TC-ZIP-06", "the same ZIP in different countries is a different place", () => {
  assert.notEqual(
    placeKey({ country: "US", stateProvince: "TX", postalCode: "78701" }),
    placeKey({ country: "DE", stateProvince: "", postalCode: "78701" })
  );
});

t("TC-ZIP-07", "a postal code is pulled out of free text", () => {
  assert.equal(extractPostalCode("Austin, TX 78701", "US"), "78701");
  assert.equal(extractPostalCode("Austin, TX 78701-1234", "US"), "78701");
  assert.equal(extractPostalCode("London EC2A 4NE", "GB"), "EC2A 4NE");
  assert.equal(extractPostalCode("Toronto, ON M5V 3L9", "CA"), "M5V 3L9");
  assert.equal(extractPostalCode("Bengaluru 560001", "IN"), "560001");
  assert.equal(extractPostalCode("Austin, TX", "US"), null);
});

t("TC-ZIP-08", "the resolver returns the postal code and fills the state from it", () => {
  const r = resolveLocation("Austin, TX 78701");
  assert.equal(r.postalCode, "78701");
  assert.equal(r.stateProvince, "TX");
  assert.equal(r.city, "Austin", "the ZIP must not be left glued to the city");

  // A bare ZIP still names its state.
  const bare = resolveLocation("78701, USA");
  assert.equal(bare.postalCode, "78701");
  assert.equal(bare.stateProvince, "TX", "the ZIP supplies the state the text omitted");
});

t("TC-ZIP-09", "de-duplication now merges on ZIP, across differently written cities", () => {
  // The real failure: three boards, three spellings of one city, one job.
  const a = dedupeKey({
    title: "Staff Engineer", companyName: "Acme Inc",
    countryCode: "US", stateProvince: "NY", postalCode: "10001", city: "New York",
  });
  const b = dedupeKey({
    title: "Staff Engineer", companyName: "Acme",
    countryCode: "US", stateProvince: "NY", postalCode: "10001-4444", city: "NYC",
  });
  const c = dedupeKey({
    title: "Staff Engineer", companyName: "ACME, Inc.",
    countryCode: "US", stateProvince: "NY", postalCode: "10001", city: "Manhattan",
  });
  assert.equal(a, b, "ZIP+4 and a different city spelling must not split the key");
  assert.equal(a, c, "punctuation and a third spelling must not split the key");
  assert.equal(isPostalDedupeKey(a), true, "this was a high-confidence postal merge");
});

t("TC-ZIP-10", "different ZIPs in one city stay different postings", () => {
  const downtown = dedupeKey({
    title: "Barista", companyName: "Acme", countryCode: "US", stateProvince: "TX",
    postalCode: "78701", city: "Austin",
  });
  const north = dedupeKey({
    title: "Barista", companyName: "Acme", countryCode: "US", stateProvince: "TX",
    postalCode: "78758", city: "Austin",
  });
  assert.notEqual(downtown, north, "two shops in one city are two jobs");
});

t("TC-ZIP-11", "radius uses the ZIP3 centroid when it is available", () => {
  const dallas = postalCentroid("75201", "US");
  const houston = postalCentroid("77002", "US");
  assert.ok(dallas && houston, "both metros must resolve");
  const d = distanceMiles(dallas, houston);
  assert.ok(d !== null && d > 200 && d < 250, `Dallas→Houston should be ~225mi, got ${d}`);

  // Non-US and unknown prefixes decline rather than guess.
  assert.equal(postalCentroid("M5V 3L9", "CA"), null);
  assert.equal(postalCentroid("59001", "US"), null, "an uncurated prefix returns null");
});

t("TC-ZIP-12", "ZIP granularity for distance is the 3-digit prefix, never the full code", () => {
  // Every ZIP inside one sectional centre resolves to the SAME point. This is
  // the privacy property, not an approximation bug: full-ZIP precision is what
  // makes a distance filter into a neighbourhood filter.
  const a = postalCentroid("78701", "US");
  const b = postalCentroid("78799", "US");
  assert.deepEqual(a, b, "78701 and 78799 must be indistinguishable for distance");
});

t("TC-ZIP-13", "a local-only radius honours ZIP when both sides have one", () => {
  const j = job({ city: "Dallas", postalCode: "75201", localOnly: true, localRadiusMiles: 50 });
  const near = cand({ currentCity: "Plano", currentPostalCode: "75024" });
  const far = cand({ currentCity: "Houston", currentPostalCode: "77002" });
  assert.equal(eligible(j, near), true, "Plano is inside 50 miles of Dallas");
  assert.equal(eligible(j, far), false, "Houston is not");
});

t("TC-ZIP-14", "a candidate with no ZIP is not penalised — it falls back to the city", () => {
  const j = job({ city: "Dallas", postalCode: "75201", localOnly: true, localRadiusMiles: 50 });
  assert.equal(eligible(j, cand({ currentCity: "Dallas", currentPostalCode: null })), true);
  assert.equal(eligible(j, cand({ currentCity: "Houston", currentPostalCode: null })), false);
});

t("TC-ZIP-15", "ZIP never reaches the scoring engine — the boundary, asserted", () => {
  // The guard enforces this at build time by scanning src/lib/matching for the
  // token. This test asserts the other half: the type the engine accepts has no
  // postal field at all, so there is nothing to read even if someone tried.
  //
  // Illinois HB 3773 names ZIP code explicitly as a prohibited proxy, and the
  // history it is reacting to is residential segregation. Identity use is fine;
  // screening use is redlining.
  const engineSrc = readFileSync("src/lib/matching/engine.ts", "utf8");
  const candType = engineSrc.match(/type\s+CandidateInput\s*=\s*\{[\s\S]*?\n\};/)?.[0] ?? "";
  const jobType = engineSrc.match(/type\s+JobInput\s*=\s*\{[\s\S]*?\n\};/)?.[0] ?? "";
  assert.ok(candType && jobType, "engine input types must exist");
  for (const [name, src] of [["CandidateInput", candType], ["JobInput", jobType]] as const) {
    assert.equal(/postal|zip/i.test(src), false, `${name} must not expose a postal field`);
  }
});

// ═══════════════════════════════════════════════════════════════

console.log(`\nGEO / SRC suite: ${pass} passed, ${fail} failed`);
if (fail) {
  console.error("\nFailures:\n");
  for (const f of failures) console.error("  " + f + "\n");
  process.exit(1);
}
