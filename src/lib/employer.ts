/**
 * WHOSE JOBS ARE THESE?
 *
 * ── The failure ──
 *
 * Citi's careers site connected correctly and appeared in the sources list as
 * "Early Career". The administrator scanned the list for "Citi", didn't find
 * it, and reasonably concluded the connection had failed. The fifteen imported
 * jobs carried the same label, so candidates would have seen "Early Career"
 * where the employer's name belongs.
 *
 * Nothing was broken in the crawl. The job page's schema.org record simply had
 * `hiringOrganization.name = "Early Career"` — the name of the PROGRAMME, not
 * the company — and the code took the first value it found without asking
 * whether it looked like an employer.
 *
 * ── The rule ──
 *
 * Prefer what the site says about itself, but refuse names that are obviously a
 * section of a careers site rather than a company, and fall back to the domain,
 * which is the one thing a company controls and rarely lies about. jobs.citi.com
 * is Citi whatever the page says.
 *
 * This is a heuristic and will occasionally be wrong. It is wrong in a much
 * better direction: an employer named after their own domain is recognisable,
 * and "Early Career" is not.
 */

/**
 * Names that describe a part of a careers site rather than an employer.
 *
 * Anchored whole-string, because these words legitimately appear INSIDE real
 * company names — "Careers Australia" is a company, "Careers" is a menu item.
 */
const SECTION_NAMES = [
  /^(early|graduate|student|campus|experienced|professional|executive)?\s*(careers?|jobs?|hiring|recruit(ing|ment)?|talent|opportunit(y|ies)|openings?|vacanc(y|ies)|roles?|positions?)$/i,
  /^(careers?|jobs?)\s*(site|portal|centre|center|home|page|search|board)$/i,
  /^(search|results|home|apply|apply now|job search|job alerts?|our people|life at|work (with|for) us)$/i,
  /^(company|employer|organi[sz]ation|undefined|null|n\/?a|untitled)$/i,
];

/** Host prefixes that are about the careers site, not the company. */
const HOST_PREFIXES = /^(www|jobs?|careers?|apply|talent|hiring|recruiting|search|my|emea|us|uk)\./i;

/**
 * Suffixes that are part of the public suffix rather than the company label.
 * Not the full PSL — just the compound endings common enough to matter.
 */
const COMPOUND_TLD = /\.(co|com|org|net|gov|ac|edu)\.[a-z]{2}$/i;

export function looksLikeSection(name: string): boolean {
  const n = name.trim();
  if (!n || n.length > 60) return true;
  return SECTION_NAMES.some((re) => re.test(n));
}

/**
 * The company label inside a hostname.
 *
 *   jobs.citi.com          → Citi
 *   careers.td.com         → TD
 *   www.bespokeco.co.uk    → Bespokeco
 *
 * Short labels are upper-cased, because a two or three letter label is an
 * initialism far more often than a word — TD, IBM, SAP, BP.
 */
export function employerFromHost(hostname: string): string {
  let host = hostname.toLowerCase().replace(/^www\./, "");
  // Strip careers-site prefixes, but never the last two labels — a site called
  // jobs.com would otherwise strip itself out of existence.
  while (HOST_PREFIXES.test(host) && host.split(".").length > 2) {
    host = host.slice(host.indexOf(".") + 1);
  }
  const withoutTld = COMPOUND_TLD.test(host)
    ? host.replace(COMPOUND_TLD, "")
    : host.replace(/\.[a-z]{2,}$/i, "");
  const label = withoutTld.split(".").pop() ?? host;
  const clean = label.replace(/[-_]+/g, " ").trim();
  if (!clean) return hostname;
  if (clean.length <= 3) return clean.toUpperCase();
  return clean.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export type NameEvidence = {
  /** hiringOrganization.name values, one per job page read. */
  jsonLdNames?: string[];
  /** og:site_name, if the page has one. */
  siteName?: string | null;
  /** A name already stored for this source. */
  stored?: string | null;
  /** Any URL on the site. */
  url: string;
};

/**
 * Pick the employer's name from whatever the site offered.
 *
 * The JSON-LD name is checked by FREQUENCY rather than taking the first: a
 * large careers site mixes programme names into some records and the company
 * name into most, so the mode is a better answer than whichever page happened
 * to be read first.
 */
export function employerNameFrom(e: NameEvidence): string {
  const host = (() => {
    try {
      return new URL(e.url).hostname;
    } catch {
      return e.url;
    }
  })();

  const counts = new Map<string, number>();
  for (const raw of e.jsonLdNames ?? []) {
    const n = raw?.trim();
    if (!n || looksLikeSection(n)) continue;
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const modal = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  if (modal) return modal.slice(0, 80);

  for (const candidate of [e.siteName, e.stored]) {
    const n = candidate?.trim();
    if (n && !looksLikeSection(n)) return n.slice(0, 80);
  }

  return employerFromHost(host).slice(0, 80);
}

/**
 * The per-job version.
 *
 * Same rule, one record at a time, with the source's stored name as the middle
 * preference — so jobs inherit the connection's name when their own record is
 * unhelpful, and the domain when neither is any good.
 */
export const employerForJob = (jsonLdName: string, stored: string | undefined, pageUrl: string): string =>
  employerNameFrom({ jsonLdNames: [jsonLdName], stored, url: pageUrl });
