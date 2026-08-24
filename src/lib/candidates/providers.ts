import type { CandidateSourceKind } from "@/db";

/**
 * PULLING PEOPLE, AS OPPOSED TO PULLING JOBS.
 *
 * ── The distinction that governs this whole file ──
 *
 * A job posting is published. An employer puts it on the open web so that
 * strangers will read it, and reading it is the point. A CANDIDATE record is
 * the opposite: a person handed their name, phone number and work history to
 * one employer, for one purpose, under that employer's privacy notice.
 *
 * So every adapter here needs a credential that belongs to a specific employer,
 * and every adapter here is reading that employer's OWN applicants. There is no
 * adapter that searches the open web for people, and there is not going to be
 * one. The public-profile sites — LinkedIn above all — are absent by decision,
 * not by omission: `src/lib/providers/linkedin.ts` already records what
 * happened to Proxycurl for building exactly that, and candidate PII is the
 * harder case, not the easier one.
 *
 * ── Why the resume databases are inert ──
 *
 * Dice, Monster, ZipRecruiter, Indeed Resume and Naukri Resdex all sell
 * candidate search as a contracted product with a per-seat licence. They are
 * listed here with their real auth shapes so that the day a contract is signed
 * the work is a credential and a config row rather than a rewrite. Until then
 * they refuse, and say what they need. An adapter that quietly returned
 * plausible-looking people would be worse than no adapter at all.
 */

export type SourcedPerson = {
  /** Their id in the originating system. Stable, so re-imports update. */
  externalId: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  headline?: string;
  location?: string;
  skills?: string[];
  resumeText?: string;
  resumeUrl?: string;
  /**
   * A profile link the PERSON published on their own application.
   *
   * The whole "connect on LinkedIn" idea rests on this and only this. If a
   * candidate wrote their LinkedIn URL on the form they submitted, pointing a
   * recruiter at it is following a signpost they put up. Anything else is
   * building a channel they never opened.
   */
  preferredChannel?: string;
  preferredHandle?: string;
};

export type CandidateFetchOpts = {
  /** Absolute stop time, from the caller that knows the run's budget. */
  deadline?: number;
  /** Where the last run stopped. */
  startOffset?: number;
};

export type CandidatePage = {
  people: SourcedPerson[];
  nextOffset: number;
  complete: boolean;
};

/** Thrown when an adapter exists but cannot run without something it lacks. */
export class NotContracted extends Error {
  constructor(readonly kind: CandidateSourceKind, readonly needs: string) {
    super(`${kind} needs ${needs}`);
    this.name = "NotContracted";
  }
}

const authHeader = (secret: string) =>
  `Basic ${Buffer.from(`${secret}:`).toString("base64")}`;

async function getJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const res = await fetch(url, { headers, cache: "no-store" });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Credential rejected by ${new URL(url).hostname} (HTTP ${res.status}).`);
  }
  if (!res.ok) throw new Error(`${new URL(url).hostname} → HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

const trim = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : undefined;
};

/**
 * A profile URL the candidate supplied, reduced to a channel we can name.
 *
 * Deliberately narrow. If we cannot tell what a link is, we do not guess and we
 * do not store it — a recruiter sent to the wrong place is worse than a
 * recruiter sent nowhere.
 */
export function readChannel(url: string): { channel: string; handle: string } | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const known: [RegExp, string][] = [
    [/(^|\.)linkedin\.com$/, "LinkedIn"],
    [/(^|\.)github\.com$/, "GitHub"],
    [/(^|\.)dice\.com$/, "Dice"],
    [/(^|\.)naukri\.com$/, "Naukri"],
    [/(^|\.)stackoverflow\.com$/, "Stack Overflow"],
    [/(^|\.)dribbble\.com$/, "Dribbble"],
    [/(^|\.)behance\.net$/, "Behance"],
  ];
  for (const [re, channel] of known) {
    if (re.test(host)) return { channel, handle: u.toString() };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// GREENHOUSE HARVEST
//
// The employer generates a Harvest API key in their own Greenhouse settings and
// chooses its permissions. It reads candidates that applied to them.
// ─────────────────────────────────────────────────────────────
async function greenhouse(secret: string, _token: string, opts: CandidateFetchOpts): Promise<CandidatePage> {
  type A = { id?: number; name?: string; url?: string };
  type C = {
    id: number; first_name?: string; last_name?: string; title?: string;
    email_addresses?: { value?: string }[];
    phone_numbers?: { value?: string }[];
    website_addresses?: { value?: string }[];
    social_media_addresses?: { value?: string }[];
    addresses?: { value?: string }[];
    tags?: string[];
    attachments?: (A & { type?: string; filename?: string })[];
  };

  const PER_PAGE = 100;
  const page = Math.floor((opts.startOffset ?? 0) / PER_PAGE) + 1;
  const rows = await getJson<C[]>(
    `https://harvest.greenhouse.io/v1/candidates?per_page=${PER_PAGE}&page=${page}`,
    { Authorization: authHeader(secret), "Content-Type": "application/json" }
  );

  const people = rows.map((c): SourcedPerson => {
    const links = [...(c.website_addresses ?? []), ...(c.social_media_addresses ?? [])]
      .map((w) => trim(w.value))
      .filter((v): v is string => Boolean(v));
    const channel = links.map(readChannel).find(Boolean) ?? null;
    const resume = (c.attachments ?? []).find((a) => /resume|cv/i.test(a.type ?? a.filename ?? ""));
    return {
      externalId: String(c.id),
      firstName: trim(c.first_name),
      lastName: trim(c.last_name),
      email: trim(c.email_addresses?.[0]?.value),
      phone: trim(c.phone_numbers?.[0]?.value),
      headline: trim(c.title),
      location: trim(c.addresses?.[0]?.value),
      skills: c.tags ?? [],
      resumeUrl: trim(resume?.url),
      preferredChannel: channel?.channel,
      preferredHandle: channel?.handle,
    };
  });

  const complete = rows.length < PER_PAGE;
  return { people, nextOffset: complete ? 0 : page * PER_PAGE, complete };
}

// ─────────────────────────────────────────────────────────────
// LEVER
// ─────────────────────────────────────────────────────────────
async function lever(secret: string, _token: string, opts: CandidateFetchOpts): Promise<CandidatePage> {
  type O = {
    id: string; name?: string; headline?: string; location?: string;
    emails?: string[]; phones?: { value?: string }[]; links?: string[]; tags?: string[];
  };
  const LIMIT = 100;
  const offset = opts.startOffset ?? 0;
  const d = await getJson<{ data?: O[]; hasNext?: boolean }>(
    `https://api.lever.co/v1/opportunities?limit=${LIMIT}&offset=${offset}`,
    { Authorization: authHeader(secret) }
  );
  const rows = d.data ?? [];

  const people = rows.map((o): SourcedPerson => {
    const [first, ...rest] = (o.name ?? "").trim().split(/\s+/);
    const channel = (o.links ?? []).map(readChannel).find(Boolean) ?? null;
    return {
      externalId: o.id,
      firstName: trim(first),
      lastName: trim(rest.join(" ")),
      email: trim(o.emails?.[0]),
      phone: trim(o.phones?.[0]?.value),
      // Lever's "headline" is the candidate's own summary of where they have worked.
      headline: trim(o.headline),
      location: trim(o.location),
      skills: o.tags ?? [],
      preferredChannel: channel?.channel,
      preferredHandle: channel?.handle,
    };
  });

  const complete = !d.hasNext || rows.length < LIMIT;
  return { people, nextOffset: complete ? 0 : offset + LIMIT, complete };
}

// ─────────────────────────────────────────────────────────────
// ASHBY
// ─────────────────────────────────────────────────────────────
async function ashby(secret: string, _token: string, opts: CandidateFetchOpts): Promise<CandidatePage> {
  type C = {
    id: string; name?: string; primaryEmailAddress?: { value?: string };
    primaryPhoneNumber?: { value?: string }; position?: string; location?: { locationSummary?: string };
    socialLinks?: { url?: string }[]; tags?: { title?: string }[]; resumeFileHandle?: { id?: string };
  };
  const LIMIT = 100;
  const offset = opts.startOffset ?? 0;
  const res = await fetch("https://api.ashbyhq.com/candidate.list", {
    method: "POST",
    headers: { Authorization: authHeader(secret), "Content-Type": "application/json" },
    body: JSON.stringify({ limit: LIMIT, offset }),
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) throw new Error(`Credential rejected by Ashby (HTTP ${res.status}).`);
  if (!res.ok) throw new Error(`Ashby → HTTP ${res.status}`);
  const d = (await res.json()) as { results?: C[]; moreDataAvailable?: boolean };
  const rows = d.results ?? [];

  const people = rows.map((c): SourcedPerson => {
    const [first, ...rest] = (c.name ?? "").trim().split(/\s+/);
    const channel = (c.socialLinks ?? []).map((l) => readChannel(l.url ?? "")).find(Boolean) ?? null;
    return {
      externalId: c.id,
      firstName: trim(first),
      lastName: trim(rest.join(" ")),
      email: trim(c.primaryEmailAddress?.value),
      phone: trim(c.primaryPhoneNumber?.value),
      headline: trim(c.position),
      location: trim(c.location?.locationSummary),
      skills: (c.tags ?? []).map((t) => t.title ?? "").filter(Boolean),
      preferredChannel: channel?.channel,
      preferredHandle: channel?.handle,
    };
  });

  const complete = !d.moreDataAvailable || rows.length < LIMIT;
  return { people, nextOffset: complete ? 0 : offset + LIMIT, complete };
}

// ─────────────────────────────────────────────────────────────
// WORKABLE
// ─────────────────────────────────────────────────────────────
async function workable(secret: string, token: string, opts: CandidateFetchOpts): Promise<CandidatePage> {
  if (!token) throw new NotContracted("WORKABLE", "the account subdomain (the part before .workable.com)");
  type C = {
    id: string; name?: string; firstname?: string; lastname?: string; headline?: string;
    email?: string; phone?: string; address?: string; resume_url?: string;
    social_profiles?: { url?: string }[]; tags?: string[];
  };
  const LIMIT = 100;
  const offset = opts.startOffset ?? 0;
  const d = await getJson<{ candidates?: C[] }>(
    `https://${encodeURIComponent(token)}.workable.com/spi/v3/candidates?limit=${LIMIT}&offset=${offset}`,
    { Authorization: `Bearer ${secret}` }
  );
  const rows = d.candidates ?? [];

  const people = rows.map((c): SourcedPerson => {
    const channel = (c.social_profiles ?? []).map((s) => readChannel(s.url ?? "")).find(Boolean) ?? null;
    return {
      externalId: c.id,
      firstName: trim(c.firstname) ?? trim((c.name ?? "").split(/\s+/)[0]),
      lastName: trim(c.lastname) ?? trim((c.name ?? "").split(/\s+/).slice(1).join(" ")),
      email: trim(c.email),
      phone: trim(c.phone),
      headline: trim(c.headline),
      location: trim(c.address),
      skills: c.tags ?? [],
      resumeUrl: trim(c.resume_url),
      preferredChannel: channel?.channel,
      preferredHandle: channel?.handle,
    };
  });

  const complete = rows.length < LIMIT;
  return { people, nextOffset: complete ? 0 : offset + LIMIT, complete };
}

// ─────────────────────────────────────────────────────────────
// LICENSED RESUME DATABASES — present, documented, and refusing.
//
// Each of these is a real product with a real API behind a real contract. The
// shape of what is needed is recorded so the wiring is already done; what is
// missing is a commercial agreement, and no amount of code substitutes for one.
// ─────────────────────────────────────────────────────────────
const LICENCE_REQUIREMENTS: Record<string, string> = {
  DICE:
    "a Dice Talent Search API key. Dice issues these to employers with an active " +
    "recruitment package; ask your Dice account manager for API access rather than a UI seat.",
  MONSTER:
    "Monster Search & Match credentials. Sold as part of an employer subscription; " +
    "the account team provisions a client id and secret against your contract.",
  ZIPRECRUITER:
    "a ZipRecruiter Resume Database API key, available on plans that include resume access.",
  INDEED_RESUME:
    "Indeed's Resume API. Access is partner-gated and granted per employer; " +
    "an ordinary Indeed Employer account does not include it.",
  NAUKRI:
    "Naukri Resdex API credentials. Resdex is a separately licensed product, and " +
    "note that candidate data from it falls under India's DPDP Act — consent-based, " +
    "with its own notice obligations.",
};

const licensed = (kind: CandidateSourceKind) => async (): Promise<CandidatePage> => {
  throw new NotContracted(kind, LICENCE_REQUIREMENTS[kind] ?? "a licence agreement");
};

type Adapter = (secret: string, token: string, opts: CandidateFetchOpts) => Promise<CandidatePage>;

const ADAPTERS: Partial<Record<CandidateSourceKind, Adapter>> = {
  GREENHOUSE: greenhouse,
  LEVER: lever,
  ASHBY: ashby,
  WORKABLE: workable,
  DICE: licensed("DICE"),
  MONSTER: licensed("MONSTER"),
  ZIPRECRUITER: licensed("ZIPRECRUITER"),
  INDEED_RESUME: licensed("INDEED_RESUME"),
  NAUKRI: licensed("NAUKRI"),
};

/** Which kinds can actually run today, for the admin screen to be honest about. */
export const LIVE_CANDIDATE_KINDS: CandidateSourceKind[] = ["GREENHOUSE", "LEVER", "ASHBY", "WORKABLE"];

export const CANDIDATE_KIND_LABEL: Record<CandidateSourceKind, string> = {
  GREENHOUSE: "Greenhouse (Harvest API)",
  LEVER: "Lever",
  ASHBY: "Ashby",
  WORKABLE: "Workable",
  DICE: "Dice Talent Search",
  MONSTER: "Monster Search & Match",
  ZIPRECRUITER: "ZipRecruiter Resume Database",
  INDEED_RESUME: "Indeed Resume",
  NAUKRI: "Naukri Resdex",
  MANUAL: "Added by hand",
};

/** What an operator must supply for a kind, in words they can act on. */
export const requirementFor = (kind: CandidateSourceKind): string | null =>
  LICENCE_REQUIREMENTS[kind] ?? null;

export async function fetchCandidates(
  kind: CandidateSourceKind,
  secret: string,
  token: string,
  opts: CandidateFetchOpts = {}
): Promise<CandidatePage> {
  const fn = ADAPTERS[kind];
  if (!fn) throw new Error(`No adapter for ${kind}`);
  if (!secret) throw new NotContracted(kind, "an API credential");
  return fn(secret, token, opts);
}
