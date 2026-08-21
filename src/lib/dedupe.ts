/**
 * SRC-007 — cross-source de-duplication.
 *
 * The unique index on (source, externalId) stops the same provider giving us a
 * job twice. It does nothing about the same role arriving from Adzuna AND
 * Greenhouse AND JSearch, which is the common case for any company with a
 * public ATS: the candidate sees the same job three times and the deck feels
 * broken.
 *
 * The approach is a normalised identity key rather than fuzzy similarity.
 * Fuzzy matching across a whole job table is expensive and, worse, it collapses
 * genuinely distinct roles — "Engineer II, Payments" and "Engineer II, Risk" at
 * the same company in the same city are different jobs. An exact key on
 * normalised title + company + place is conservative: it merges what is
 * certainly the same and leaves the rest alone.
 */

import { resolveLocation } from "./geo/resolve";
import { isPostalKey, placeKey } from "./geo/postal";
import { UNKNOWN_COUNTRY } from "./geo/countries";

/** Seniority and req-number noise that differs between boards for one role. */
const TITLE_NOISE = [
  /\(\s*(remote|hybrid|on-?site|contract|full-?time|part-?time)\s*\)/gi,
  /\b(req|requisition|job)\s*#?\s*\d+\b/gi,
  /\bid\s*[:#]\s*\w+\b/gi,
  /[–—-]\s*(remote|hybrid|on-?site)\s*$/gi,
  /\s*\([^)]*\)\s*$/g,
];

export function normaliseTitle(title: string): string {
  let t = (title ?? "").toLowerCase();
  for (const re of TITLE_NOISE) t = t.replace(re, " ");
  return t
    .replace(/[^a-z0-9+#/ ]/g, " ")
    .replace(/\b(sr|snr)\b/g, "senior")
    .replace(/\b(jr)\b/g, "junior")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function normaliseCompany(name: string): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|gmbh|plc|co|sa|bv|ag|pvt|private)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * The identity key: normalised title + normalised company + PLACE.
 *
 * Place is `country | state | postal code`, which is the change that makes this
 * reliable. A city string is written six ways by six job boards — "NYC", "New
 * York", "New York City", "Manhattan", "New York, New York" — so keying on it
 * either misses real duplicates or, if you loosen the comparison, merges
 * genuinely different roles. A postal code is a single canonical token, and
 * country plus state disambiguates the codes that repeat across borders.
 *
 * Where no postal code is available the key degrades to country|state|city,
 * which is where we were before. It never degrades to country alone.
 *
 * Returns null when the place cannot be identified: a job with no resolvable
 * location is left un-deduplicated rather than merged on a guess.
 */
export function dedupeKey(input: {
  title: string;
  companyName: string;
  location?: string | null;
  countryCode?: string | null;
  stateProvince?: string | null;
  postalCode?: string | null;
  city?: string | null;
}): string | null {
  const title = normaliseTitle(input.title);
  const company = normaliseCompany(input.companyName);
  if (!title || !company) return null;

  // Structured fields win; the free-text string is the fallback for legacy rows.
  const needsFallback = !input.countryCode || (!input.postalCode && !input.city);
  const parsed = needsFallback ? resolveLocation(input.location) : null;

  const country = (input.countryCode || parsed?.country || "").toUpperCase();
  if (!country || country === UNKNOWN_COUNTRY) return null;

  const place = placeKey({
    country,
    stateProvince: input.stateProvince ?? parsed?.stateProvince ?? null,
    postalCode: input.postalCode ?? parsed?.postalCode ?? null,
    city: input.city ?? parsed?.city ?? null,
  });
  if (!place) return null;

  return `${title}|${company}|${place}`.slice(0, 191);
}

/** True when a key was built from a postal code — i.e. a high-confidence merge. */
export function isPostalDedupeKey(key: string | null): boolean {
  if (!key) return false;
  const parts = key.split("|");
  return isPostalKey(parts.slice(2).join("|"));
}

/**
 * Which of two postings for the same role should be the one candidates see.
 *
 * Employer-submitted beats crawled, because that posting carries the consent
 * that pay-transparency third-party liability keys on, and because the employer
 * is the authority on their own vacancy. After that, earlier wins, so the
 * canonical posting is stable and does not flip on every ingestion run.
 */
export function preferCanonical<
  T extends { id: string; origin?: string | null; consentSource?: string | null; postedAt?: Date | null }
>(a: T, b: T): T {
  const rank = (j: T) => {
    if (j.origin === "JOBSY_CREATED") return 0;
    if (j.origin === "RECRUITER_IMPORTED") return 1;
    if (j.consentSource === "EMPLOYER_SUBMITTED") return 2;
    return 3;
  };
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra < rb ? a : b;

  const ta = a.postedAt ? a.postedAt.getTime() : Number.MAX_SAFE_INTEGER;
  const tb = b.postedAt ? b.postedAt.getTime() : Number.MAX_SAFE_INTEGER;
  if (ta !== tb) return ta <= tb ? a : b;

  // Deterministic last resort, so two runs never disagree.
  return a.id <= b.id ? a : b;
}
