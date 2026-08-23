/**
 * ATS VENDORS WE RECOGNISE BUT CANNOT PULL FROM.
 *
 * ── Why this exists ──
 *
 * A recruiter pasted https://jobs.citi.com/search-jobs and got back "isn't on an
 * ATS we recognise, publishes no JobPosting structured data, and exposes no job
 * feed". Every clause was true and the whole thing was useless: it described
 * what we failed to find rather than what they could do about it.
 *
 * The nine systems with adapters — Greenhouse, Lever, Ashby, Workable,
 * SmartRecruiters, Recruitee, Personio, BambooHR, Workday — are the mid-market
 * and startup end of the market. Large employers overwhelmingly run something
 * else: Radancy, Phenom, iCIMS, Taleo, SuccessFactors, Eightfold, Avature. Those
 * are not obscure. Between them they carry a large share of the enterprise jobs
 * anyone would actually want on a job site.
 *
 * We cannot pull from them automatically. Most expose no public API, several
 * render entirely in JavaScript, and at least one (Citi's, as it happens)
 * disallows its own search path in robots.txt. What we CAN do is recognise them
 * by name and say the one useful sentence: here is what this is, and here is
 * precisely what to ask the employer for.
 *
 * ── The honest framing ──
 *
 * "Every career site should work" is not reachable and pretending otherwise
 * produces a worse product. Some sites publish nothing machine-readable, and a
 * few forbid crawling outright. Naming the vendor turns a dead end into a
 * request a recruiter can actually make — every one of these systems can emit
 * an XML feed, and the employer's talent team can usually turn it on, because
 * it is the same feed they already send to Indeed.
 */

export type VendorId =
  | "RADANCY"
  | "PHENOM"
  | "ICIMS"
  | "TALEO"
  | "SUCCESSFACTORS"
  | "EIGHTFOLD"
  | "AVATURE"
  | "JOBVITE"
  | "ORACLE_FUSION"
  | "DAYFORCE"
  | "ADP"
  | "UKG"
  | "PAYLOCITY"
  | "TEAMTAILOR"
  | "JAZZHR"
  | "BREEZY"
  | "PINPOINT";

export type Vendor = {
  id: VendorId;
  name: string;
  /** Matched against the URL and then against the page HTML. */
  signals: RegExp[];
  /** What to ask the employer for, in words a recruiter can forward. */
  ask: string;
};

/**
 * Order matters only for reporting; the first match wins and any of these is a
 * useful answer.
 *
 * Several are detectable only in the page HTML rather than the URL, because
 * they are white-labelled onto the employer's own domain — Radancy serves
 * jobs.citi.com, Phenom serves dozens of Fortune 500 careers sites. The asset
 * and analytics hostnames are the giveaway and are stable enough to match on.
 */
export const VENDORS: Vendor[] = [
  {
    id: "RADANCY",
    name: "Radancy (TalentBrew)",
    signals: [/radancy\.net/i, /talentbrew\.com/i, /tbcdn\.talentbrew/i],
    ask: "Radancy sites can publish an XML job feed. Ask their talent acquisition team for the TalentBrew job feed URL — it is the same feed they supply to Indeed.",
  },
  {
    id: "PHENOM",
    name: "Phenom People",
    signals: [/phenompeople\.com/i, /phenom\.com\/widgets/i, /\.phenom\.cloud/i],
    ask: "Phenom sites expose a jobs API per tenant. Ask the employer for their Phenom job feed or API endpoint.",
  },
  {
    id: "ICIMS",
    name: "iCIMS",
    signals: [/\.icims\.com/i, /careers-[a-z0-9-]+\.icims\.com/i],
    ask: "iCIMS can publish a public XML feed. Ask for their iCIMS job feed URL, or the portal ID for their careers site.",
  },
  {
    id: "TALEO",
    name: "Oracle Taleo",
    signals: [/\.taleo\.net/i, /taleo\.net\/careersection/i],
    ask: "Taleo can emit an XML feed per career section. Ask for the feed URL, or the career-section name and company code.",
  },
  {
    id: "SUCCESSFACTORS",
    name: "SAP SuccessFactors",
    signals: [/successfactors\.(com|eu)/i, /career\d*\.successfactors/i, /jobs\.sap\.com/i],
    ask: "SuccessFactors publishes an RSS/XML feed per career site. Ask for the job feed URL or their company ID.",
  },
  {
    id: "EIGHTFOLD",
    name: "Eightfold",
    signals: [/eightfold\.ai/i, /\.eightfold\.cloud/i],
    ask: "Eightfold exposes a positions API per tenant. Ask the employer for their Eightfold careers API URL.",
  },
  { id: "AVATURE", name: "Avature", signals: [/\.avature\.net/i], ask: "Avature can publish an XML feed. Ask for their Avature job feed URL." },
  { id: "JOBVITE", name: "Jobvite", signals: [/jobvite\.com/i], ask: "Jobvite publishes a public XML feed per company. Ask for their Jobvite feed URL or company ID." },
  {
    id: "ORACLE_FUSION",
    name: "Oracle Cloud Recruiting",
    signals: [/oraclecloud\.com\/hcmUI/i, /\.fa\.[a-z0-9-]+\.oraclecloud\.com/i],
    ask: "Oracle Cloud Recruiting exposes a candidate-experience API. Ask for the site name and tenant URL.",
  },
  { id: "DAYFORCE", name: "Dayforce (Ceridian)", signals: [/dayforcehcm\.com/i], ask: "Dayforce can publish an XML feed. Ask for their job feed URL." },
  { id: "ADP", name: "ADP Workforce Now", signals: [/workforcenow\.adp\.com/i, /myjobs\.adp\.com/i], ask: "ADP can publish a job feed. Ask for their ADP careers feed URL." },
  { id: "UKG", name: "UKG (UltiPro)", signals: [/recruiting\.ultipro\.com/i, /\.ukg\.(com|net)/i], ask: "UKG publishes an RSS feed per company. Ask for their UKG job feed URL." },
  { id: "PAYLOCITY", name: "Paylocity", signals: [/recruiting\.paylocity\.com/i], ask: "Paylocity can publish a job feed. Ask for their Paylocity careers feed URL." },
  { id: "TEAMTAILOR", name: "Teamtailor", signals: [/\.teamtailor\.com/i], ask: "Teamtailor publishes a public JSON and RSS feed. Ask for their Teamtailor careers URL." },
  { id: "JAZZHR", name: "JazzHR", signals: [/\.applytojob\.com/i, /jazz\.co/i], ask: "JazzHR publishes an XML feed per account. Ask for their JazzHR feed URL." },
  { id: "BREEZY", name: "Breezy HR", signals: [/\.breezy\.hr/i], ask: "Breezy publishes a public JSON feed. Ask for their Breezy careers URL." },
  { id: "PINPOINT", name: "Pinpoint", signals: [/\.pinpointhq\.com/i], ask: "Pinpoint publishes an XML feed. Ask for their Pinpoint careers feed URL." },
];

/** First vendor whose signature appears in the URL or the page source. */
export function recogniseVendor(haystack: string): Vendor | null {
  for (const v of VENDORS) {
    if (v.signals.some((re) => re.test(haystack))) return v;
  }
  return null;
}
