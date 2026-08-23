import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { blockedIdsFor } from "./trust";
import {
  candidateSwipes,
  companies,
  db,
  jobs,
  recruiterSwipes,
  users,
  type User,
} from "@/db";
import { scoreJobForCandidate } from "./match";
import { checkGeoEligibility, toCandidateGeo, toJobGeo } from "./geo";
import { isSponsorshipEligible } from "./authorization";

export type JobCard = {
  id: string; title: string; company: string; location: string; remote: string;
  employmentType: string; seniority: string; salaryMin: number | null; salaryMax: number | null;
  description: string; skills: string[]; perks: string[];
  applyMethod: "EASY" | "EXTERNAL"; applyUrl: string | null;
  source: string; sourceUrl: string | null; postedAt: string; recruiterName: string | null;
  score: number; sharedSkills: string[]; missingSkills: string[]; reasons: string[];
  /** Why it might not work — shown so a low score never looks arbitrary. */
  concerns: string[];
  /** Skills credited via adjacency, with what earned the credit. */
  transferable: { skill: string; via: string | null }[];
  /** 0..1 — can they do the job at all. Gates the logistics features. */
  qualification: number;
};

export type CandidateCard = {
  id: string; name: string; headline: string; location: string; remotePref: string;
  yearsExp: number; salaryTarget: number | null; availability: string; bio: string;
  skills: string[]; image: string | null; linkedinVerified: boolean;
  score: number; sharedSkills: string[]; missingSkills: string[]; reasons: string[];
  /** Why it might not work — shown so a low score never looks arbitrary. */
  concerns: string[];
  /** Skills credited via adjacency, with what earned the credit. */
  transferable: { skill: string; via: string | null }[];
  /** 0..1 — can they do the job at all. Gates the logistics features. */
  qualification: number;
};

const DECK_SIZE = 25;
/** Over-fetch, then re-rank in app — SQL can't express the scoring function. */
const POOL = 400;

export async function candidateDeck(candidate: User): Promise<JobCard[]> {
  const [seen, blocked] = await Promise.all([
    db
      .select({ jobId: candidateSwipes.jobId })
      .from(candidateSwipes)
      .where(eq(candidateSwipes.candidateId, candidate.id)),
    // MSG-004 AC-2 — a blocked person's postings never appear again.
    blockedIdsFor(candidate.id),
  ]);
  const seenIds = seen.map((s) => s.jobId);

  const clauses = [
    eq(jobs.active, true),
    // SRC-007 — a posting that lost the canonical contest is never surfaced.
    sql`${jobs.canonicalJobId} IS NULL`,
  ];
  if (seenIds.length) clauses.push(notInArray(jobs.id, seenIds));
  if (blocked.length) {
    clauses.push(
      sql`(${jobs.postedById} IS NULL OR ${jobs.postedById} NOT IN ${blocked})`
    );
  }
  const candGeo = toCandidateGeo(candidate);

  /**
   * ── Choosing the pool ──
   *
   * This query used to be `ORDER BY posted_at DESC LIMIT 400`, and everything
   * clever in this codebase — geography, sponsorship, skill scoring — ran on
   * whatever it happened to return. With a thousand jobs and nightly
   * ingestion that is not a ranking problem, it is a visibility one: if 400
   * jobs anywhere on earth were posted more recently than the roles a
   * candidate could actually take, those roles were never considered. Not
   * ranked low. Absent.
   *
   * A test reproducing the reported symptom returned an EMPTY deck: 450 recent
   * foreign postings filled the pool, the geography filter correctly removed
   * every one of them, and three ideal local matches were never fetched.
   *
   * So the pool is now chosen for eligibility and relevance, and the scoring
   * engine ranks within it — which is the order those two steps should always
   * have been in.
   */

  /**
   * Countries this candidate could plausibly be eligible for.
   *
   * NARROWING ONLY. Every row this returns still goes through
   * `checkGeoEligibility`, which is the authority; this exists so the pool is
   * not spent on rows that authority will certainly reject. Cross-border
   * matching is opt-in (CLP-004), so when it is off, same-country is the only
   * way to be eligible and the filter is exact. When it is ON, the rules are
   * richer than a country list can express, so we do not narrow at all rather
   * than risk hiding something eligible.
   */
  const countryScope: string[] | null = (() => {
    if (candGeo.internationalSearchEnabled) return null;
    const set = new Set<string>();
    const add = (c: string | null | undefined) => {
      const v = (c ?? "").trim().toUpperCase();
      if (v && v !== "XX" && v.length === 2) set.add(v);
    };
    add(candGeo.currentCountry);
    add(candGeo.searchCountry);
    candGeo.preferredCountries.forEach(add);
    return set.size ? [...set] : null;
  })();

  if (countryScope) {
    // A job with no resolved country is ineligible anyway
    // (UNKNOWN_JOB_COUNTRY_IS_ELIGIBLE = false). Excluding it here stops it
    // consuming a pool slot only to be discarded a moment later.
    clauses.push(sql`${jobs.countryCode} IS NOT NULL`);
    clauses.push(inArray(jobs.countryCode, countryScope));
  }

  const where = and(...clauses);

  /**
   * How many of the candidate's skills this posting names.
   *
   * Compared lower-cased because job skills arrive from a dozen sources with a
   * dozen capitalisation habits. This is a coarse pre-filter, not the match: the
   * engine still does alias and adjacency work afterwards, so a posting wanting
   * "JS" still scores for a candidate who wrote "JavaScript". Its job is only to
   * make sure such a posting is IN the pool to be scored.
   */
  const candSkills = (candidate.skills ?? []).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const overlap = candSkills.length
    // Passed as ONE delimited string and split in SQL. Binding a JS array
    // straight into `= any(...)` leaves the driver to guess the element type,
    // and Postgres rejects it; a single text parameter has no such ambiguity
    // and is still fully parameterised.
    ? sql<number>`(select count(*) from unnest(${jobs.skills}) s
                   where lower(s) = any(string_to_array(${candSkills.join("\u0001")}, chr(1))))`
    : sql<number>`0`;

  /** Nearby beats far away, and anywhere beats a city they cannot reach. */
  const city = (candGeo.currentCity ?? "").trim().toLowerCase();
  const proximity = city
    ? sql<number>`(case when lower(coalesce(${jobs.city}, '')) = ${city} then 2 when ${jobs.remote} = 'REMOTE' then 1 else 0 end)`
    : sql<number>`(case when ${jobs.remote} = 'REMOTE' then 1 else 0 end)`;

  const rows = await db
    .select({ job: jobs, company: companies, posterName: users.name })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .leftJoin(users, eq(jobs.postedById, users.id))
    .where(where)
    /**
     * XPLAIN-003 — a candidate who opted out of profiling gets the same
     * ELIGIBILITY narrowing (that is the law about where they may work, not a
     * judgement about them) but no relevance ordering. Their pool, like their
     * deck, is newest-first.
     */
    .orderBy(
      ...(candidate.profilingOptOut
        ? [desc(jobs.postedAt)]
        : [desc(overlap), desc(proximity), desc(jobs.postedAt)])
    )
    .limit(POOL);

  return rows
    .map(({ job, company, posterName }) => {
      const fit = scoreJobForCandidate(job, candidate);
      const geo = checkGeoEligibility(toJobGeo(job), candGeo);
      return {
        _excluded: fit.full.excluded,
        _geoEligible: geo.eligible,
        // BR-006 — Stage 1, beside geography and for the same reason: this
        // decides WHICH pairs are considered. It never reaches the scorer.
        _sponsorshipEligible: isSponsorshipEligible({
          jobSponsorshipAvailable: job.sponsorshipAvailable,
          candidateRequiresSponsorship: candidate.requiresSponsorship,
        }),
        id: job.id,
        title: job.title,
        company: company.name,
        location: job.location,
        remote: job.remote,
        employmentType: job.employmentType,
        seniority: job.seniority,
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
        description: job.description.slice(0, 1400),
        skills: job.skills,
        perks: job.perks,
        applyMethod: job.applyMethod,
        applyUrl: job.applyUrl,
        source: job.source,
        sourceUrl: job.sourceUrl,
        postedAt: job.postedAt.toISOString(),
        recruiterName: posterName ?? null,
        score: fit.score,
        sharedSkills: fit.sharedSkills,
        missingSkills: fit.missingSkills.slice(0, 6),
        reasons: fit.reasons,
        concerns: fit.full.concerns,
        transferable: fit.full.transferableSkills.map((t) => ({ skill: t.skill, via: t.via })),
        qualification: fit.full.qualification,
      };
    })
    // A hard filter means "don't show this", not "show it last" — an onsite job
    // in another city is noise in a remote-only candidate's deck, however good
    // the skill overlap looks.
    .filter((c) => !c._excluded)
    // BR-018 — geographic incompatibility removes the pair from the pool. This
    // runs on the row, not on the score, because Stage 1 of FSD §34 is the
    // eligibility layer and the scoring engine never sees geography.
    .filter((c) => c._geoEligible)
    .filter((c) => c._sponsorshipEligible)
    .map(({ _excluded, _geoEligible, _sponsorshipEligible, ...card }) => card satisfies JobCard)
    // XPLAIN-003 AC-3/5 — an opted-out candidate still sees the same jobs. What
    // changes is the ORDER: newest first instead of score-ranked. Withholding
    // the product because someone exercised a statutory right is retaliation,
    // which several of these statutes name explicitly.
    .sort((a, b) =>
      candidate.profilingOptOut
        ? Date.parse(b.postedAt) - Date.parse(a.postedAt)
        : b.score - a.score
    )
    .slice(0, DECK_SIZE);
}

/**
 * CAND-002 / CAND-007 — the filters a recruiter may apply, as a closed list.
 *
 * This is an allowlist and not a convenience. The spec permits filtering on
 * skills, experience and the like; it PROHIBITS filtering on a protected
 * characteristic. The difference between those two sentences is one careless
 * `Object.assign(where, req.query)` away, so no filter reaches the query unless
 * it is named here.
 *
 * Absent on purpose, and to be kept absent: name, age, graduation year, school,
 * photo, gender, citizenship, sponsorship need, postcode. Sponsorship is
 * handled as a Stage-1 eligibility rule (BR-006) precisely so it can never
 * become a thing a recruiter dials up or down.
 */
export type RecruiterFilters = {
  /** Candidate must have ALL of these. Matched against the normalised set. */
  skills?: string[];
  minYearsExp?: number;
  maxYearsExp?: number;
  /** Their stated preference: ONSITE | HYBRID | REMOTE | ANY. */
  remotePref?: string;
  /** Their target, in $k. A recruiter filtering by budget, not by person. */
  maxSalaryTarget?: number;
  minScore?: number;
};

export async function recruiterDeck(
  recruiter: User,
  jobId: string,
  filters: RecruiterFilters = {}
): Promise<CandidateCard[]> {
  const found = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  const job = found[0];
  if (!job || job.postedById !== recruiter.id) throw new Error("Not your job post");

  const [seen, blocked] = await Promise.all([
    db
      .select({ candidateId: recruiterSwipes.candidateId })
      .from(recruiterSwipes)
      .where(eq(recruiterSwipes.jobId, jobId)),
    blockedIdsFor(recruiter.id),
  ]);
  const exclude = [...new Set([...seen.map((s) => s.candidateId), recruiter.id, ...blocked])];
  const jobGeo = toJobGeo(job);

  /**
   * What this role actually asks for, lower-cased for comparison across the
   * capitalisation habits of a dozen sources. Authored required/preferred
   * skills (MATCH-002) win when present; otherwise the general list.
   */
  const jobSkills = [
    ...(job.requiredSkills ?? []),
    ...(job.preferredSkills ?? []),
    ...(job.skills ?? []),
  ]
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  const uniqueJobSkills = [...new Set(jobSkills)];

  const skillCoverage = uniqueJobSkills.length
    ? sql<number>`(select count(*) from unnest(${users.skills}) s
                   where lower(s) = any(string_to_array(${uniqueJobSkills.join("\u0001")}, chr(1))))`
    : sql<number>`0`;

  const jobCountry = (job.countryCode ?? "").trim().toUpperCase() || null;

  const rows = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.profileReady, true),
        eq(users.openToOffers, true),
        eq(users.role, "CANDIDATE"),
        notInArray(users.id, exclude),
        // AUTH-006 AC-6 — an unverified address never appears in a recruiter's
        // deck. Anyone can type an address they do not control.
        eq(users.emailVerified, true),
        // AUTH-012 — a closed account disappears immediately, before the purge.
        sql`${users.deletionRequestedAt} IS NULL`,
        sql`cardinality(${users.skills}) > 0`,
        /**
         * The same narrowing the candidate deck does, from the other side.
         *
         * Cross-border is opt-in for candidates (CLP-004), so a candidate whose
         * country differs and who has not enabled international search cannot
         * be eligible for this role — `checkGeoEligibility` below will reject
         * them. Excluding them here stops them consuming pool slots that a
         * reachable candidate needed.
         */
        ...(jobCountry
          ? [
              sql`(${users.currentCountry} = ${jobCountry} OR ${users.internationalSearchEnabled} = true)`,
            ]
          : [])
      )
    )
    /**
     * Ranked by how much of THIS ROLE'S requirement each candidate covers,
     * not by who edited their profile most recently.
     *
     * `updatedAt DESC LIMIT 400` had the same failure as the candidate deck: a
     * recruiter sourcing for a Databricks role got the 400 most recently active
     * candidates and then scored them, so a perfect match who had not touched
     * their profile in a month was never in the running. On a growing user base
     * that gets steadily worse.
     */
    .orderBy(...(jobSkills.length ? [desc(skillCoverage), desc(users.updatedAt)] : [desc(users.updatedAt)]))
    .limit(POOL);

  return rows
    .map((c) => {
      const fit = scoreJobForCandidate(job, c);
      const geo = checkGeoEligibility(jobGeo, toCandidateGeo(c));
      return {
        _excluded: fit.full.excluded,
        _geoEligible: geo.eligible,
        // Symmetrical with the candidate deck. If a role does not sponsor and a
        // person has said they will need it, neither side benefits from the
        // introduction — and showing the recruiter a candidate they cannot hire
        // is how a lawful policy turns into a conversation about status.
        _sponsorshipEligible: isSponsorshipEligible({
          jobSponsorshipAvailable: job.sponsorshipAvailable,
          candidateRequiresSponsorship: c.requiresSponsorship,
        }),
        id: c.id,
        name: c.name,
        headline: c.headline ?? "Candidate",
        location: c.location ?? "Not specified",
        remotePref: c.remotePref,
        yearsExp: c.yearsExp,
        salaryTarget: c.salaryTarget,
        availability: c.availability ?? "Not specified",
        bio: c.bio ?? "",
        skills: c.skills,
        image: c.image,
        linkedinVerified: Boolean(c.linkedinSub),
        score: fit.score,
        sharedSkills: fit.sharedSkills,
        missingSkills: fit.missingSkills.slice(0, 6),
        reasons: fit.reasons,
        concerns: fit.full.concerns,
        transferable: fit.full.transferableSkills.map((t) => ({ skill: t.skill, via: t.via })),
        qualification: fit.full.qualification,
      };
    })
    .filter((c) => !c._excluded)
    // BR-016 / BR-018 — a candidate outside the boundary is not a weaker
    // candidate, they are not in the pool. Skill coverage does not override it.
    .filter((c) => c._geoEligible)
    .filter((c) => c._sponsorshipEligible)
    // CAND-002 — applied AFTER eligibility and scoring, never as SQL. Keeping
    // them out of the query means a filter can only ever narrow what the
    // recruiter was already permitted to see.
    .filter((c) => {
      if (filters.minScore !== undefined && c.score < filters.minScore) return false;
      if (filters.minYearsExp !== undefined && (c.yearsExp ?? 0) < filters.minYearsExp) return false;
      if (filters.maxYearsExp !== undefined && (c.yearsExp ?? 0) > filters.maxYearsExp) return false;
      if (filters.remotePref && c.remotePref !== filters.remotePref) return false;
      if (
        filters.maxSalaryTarget !== undefined &&
        c.salaryTarget !== null &&
        c.salaryTarget !== undefined &&
        c.salaryTarget > filters.maxSalaryTarget
      ) {
        return false;
      }
      if (filters.skills?.length) {
        const have = new Set(c.skills.map((s) => s.toLowerCase()));
        if (!filters.skills.every((want) => have.has(want.toLowerCase()))) return false;
      }
      return true;
    })
    .map(({ _excluded, _geoEligible, _sponsorshipEligible, ...card }) => card satisfies CandidateCard)
    .sort((a, b) => b.score - a.score)
    .slice(0, DECK_SIZE);
}


/**
 * GEO-007 — why the deck is empty.
 *
 * An empty deck with no explanation reads as a broken product, and a candidate
 * who has not turned international search on has no way to guess that is why.
 * This returns the counts and the most common exclusion reason so the empty
 * state can say something true and actionable.
 *
 * Every reason string comes from checkGeoEligibility, which phrases exclusions
 * in terms of work location and never in terms of who the candidate is.
 */
export async function candidateGeoDiagnostics(candidate: User): Promise<{
  considered: number;
  excludedByGeography: number;
  topReason: string | null;
}> {
  const rows = await db
    .select({ job: jobs })
    .from(jobs)
    .where(and(eq(jobs.active, true), sql`${jobs.canonicalJobId} IS NULL`))
    .orderBy(desc(jobs.postedAt))
    .limit(POOL);

  const candGeo = toCandidateGeo(candidate);
  const reasons = new Map<string, number>();
  let excluded = 0;

  for (const { job } of rows) {
    const verdict = checkGeoEligibility(toJobGeo(job), candGeo);
    if (verdict.eligible) continue;
    excluded++;
    reasons.set(verdict.reason, (reasons.get(verdict.reason) ?? 0) + 1);
  }

  const topReason =
    [...reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return { considered: rows.length, excludedByGeography: excluded, topReason };
}
