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
import { expandSkills, toSqlArrays } from "./matching/expansion";
import { bestCredit } from "./matching/taxonomy";
import { MIN_MATCH, tierFor, type MatchTier } from "./matching/engine";
import type { ConfidenceBand } from "./matching/confidence";
import { normalizeSkills } from "./skills";

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
  /**
   * MATCH-040 — whether this cleared the quality bar (MIN_MATCH).
   *
   * BELOW_BAR cards are still returned and still swipeable; they rank after
   * every strong match and the UI marks them. Withholding them entirely would
   * mean a candidate in a thin market opens the app to nothing, unable to tell
   * a quiet week from a broken product.
   */
  tier: MatchTier;
  /**
   * How much this score rests on evidence rather than defaults.
   *
   * Carried beside the score, never folded into it — ordering by it would rank
   * people on how complete their profile is, which is not merit.
   */
  confidence: { score: number; band: ConfidenceBand; improve: string[] };
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
  /**
   * CAND-002 — when the recruiter searched for specific skills, how this
   * person covers each one. Empty when no skill search is active.
   *
   * `credit` is 1 for holding the skill outright, between 0 and 1 for holding
   * a related one (`via` names it), and 0 for not having it. Every searched
   * skill appears, including the ones they lack: a sourcing decision made on
   * "has 3 of your 5" needs to show which two are missing, and a card that
   * silently dropped them would be inviting the recruiter to assume five.
   */
  requested: { skill: string; via: string | null; credit: number }[];
  /** 0..1 — weighted share of the searched skills covered. 0 with no search. */
  requestedCoverage: number;
  /** MATCH-040 — see JobCard.tier. Below-bar candidates rank last, never hidden. */
  tier: MatchTier;
  /**
   * How much this score rests on evidence rather than defaults.
   *
   * Carried beside the score, never folded into it — ordering by it would rank
   * people on how complete their profile is, which is not merit.
   */
  confidence: { score: number; band: ConfidenceBand; improve: string[] };
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
   * How related this posting is to what the candidate can actually do.
   *
   * ── Why this is not a count ──
   *
   * This was `count(*)` over exact string equality, which quietly undid the
   * work of the entire matching module. The engine credits Vue at 0.55 toward
   * React and PySpark at 0.75 toward Databricks; this query credited them at
   * zero. A Vue developer's pool was therefore chosen as though they had no
   * relevant skills at all — every React job tied at 0, the pool filled by
   * recency, and the engine was handed rows it would never have picked. It then
   * scored those rows impeccably, which is why the symptom reads as "random
   * jobs" rather than as bad ranking. The scoring was never wrong; it was being
   * asked the wrong question.
   *
   * `expandSkills` produces the same relatedness the engine scores by, so the
   * two steps now agree. Selection can only ADD rows that exact matching would
   * have dropped; nothing here alters a score.
   */
  const expanded = expandSkills(candidate.skills ?? []);
  const { names: expNames, weights: expWeights } = toSqlArrays(expanded);

  /**
   * Summed weight of the expansion terms this posting names.
   *
   * Iterates the expansion (bounded to 300 terms) testing membership in the
   * posting's skills, rather than the reverse, because a posting carries a
   * handful of skills and the expansion is the larger, fixed-size side.
   *
   * Fast enough at the current corpus. If the jobs table reaches the order of
   * 100k rows the fix is a lower-cased skills column with a GIN index — not a
   * cached score, which would go stale the moment somebody edits their profile,
   * and a profile edit is precisely the event that must re-rank.
   */
  const relatedness = expanded.length
    ? sql<number>`(
        select coalesce(sum(w.weight), 0)
          from unnest(
                 string_to_array(${expNames}, chr(1)),
                 string_to_array(${expWeights}, chr(1))::float8[]
               ) as w(name, weight)
         where exists (
                 select 1 from unnest(${jobs.skills}) s where lower(s) = w.name
               )
      )`
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
        : [desc(relatedness), desc(proximity), desc(jobs.postedAt)])
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
        tier: tierFor(fit.score),
        confidence: {
          score: fit.full.confidence.score,
          band: fit.full.confidence.band,
          improve: fit.full.confidence.improve.map((x) => x.note),
        },
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
    /**
     * MATCH-040 — every strong match first, then the near misses.
     *
     * Two keys, not one. Sorting by score alone would already put strong
     * matches first, but it would not give the UI a place to say "everything
     * from here is below your bar" — and a 71 next to a 69 would look like a
     * continuum when the product is asserting a line between them. Tier makes
     * the line explicit; score orders within each side of it.
     */
    .sort((a, b) => {
      if (candidate.profilingOptOut) return Date.parse(b.postedAt) - Date.parse(a.postedAt);
      const at = a.tier === "STRONG" ? 0 : 1;
      const bt = b.tier === "STRONG" ? 0 : 1;
      return at - bt || b.score - a.score;
    })
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
  /**
   * Skills the recruiter is sourcing for. RANKS rather than excludes: coverage
   * of these decides the order, and each one is reported on the card as held,
   * held-via-a-related-skill, or missing. Nobody is dropped for lacking one.
   */
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
   * What this search is actually looking for.
   *
   * Two sources, in priority order. The skills the recruiter typed into the
   * search come FIRST, because they are a live statement of intent and
   * `expandSkills` weights earlier entries higher; the posting's own skills
   * follow as the standing definition of the role. A recruiter who has typed
   * nothing still gets the role's skills, which is the previous behaviour.
   *
   * Authored required/preferred skills (MATCH-002) win over the general list.
   */
  const searchedSkills = (filters.skills ?? []).map((x) => x.trim()).filter(Boolean);
  const roleSkills = [
    ...(job.requiredSkills ?? []),
    ...(job.preferredSkills ?? []),
    ...(job.skills ?? []),
  ]
    .map((x) => x.trim())
    .filter(Boolean);

  const intent = [...new Set([...searchedSkills, ...roleSkills])];
  const expandedRole = expandSkills(intent);
  const { names: roleNames, weights: roleWeights } = toSqlArrays(expandedRole);

  /**
   * Weighted coverage of that intent, the mirror of the candidate deck.
   *
   * This was `count(*)` over exact equality, with the same consequence in
   * reverse: a recruiter sourcing for Databricks never reached a candidate who
   * had written Spark, because the pool was chosen before anything understood
   * that those are related. Now the pool is ranked by the same graph the engine
   * scores with, so that candidate is fetched and then scored on their merits.
   */
  const skillCoverage = expandedRole.length
    ? sql<number>`(
        select coalesce(sum(w.weight), 0)
          from unnest(
                 string_to_array(${roleNames}, chr(1)),
                 string_to_array(${roleWeights}, chr(1))::float8[]
               ) as w(name, weight)
         where exists (
                 select 1 from unnest(${users.skills}) s where lower(s) = w.name
               )
      )`
    : sql<number>`0`;

  const jobCountry = (job.countryCode ?? "").trim().toUpperCase() || null;

  /**
   * ── ELIGIBILITY, APPLIED WHEN THE POOL IS CHOSEN ──
   *
   * Skill coverage decided the whole pool, and geography, sponsorship and work
   * model were applied afterwards to whatever came back. Those three are not
   * preferences that make somebody a weaker candidate; they decide whether the
   * person can take the job at all. Checking them second meant a market full of
   * skilled-but-ineligible people filled all 400 slots, got discarded a moment
   * later, and the one person who could actually be hired was never fetched.
   *
   * Measured on a 450-row fixture before this change: a role that does not
   * sponsor, with exactly one work-authorized candidate available, returned
   * ZERO candidates. Not a thin list — an empty one, from which a recruiter
   * would reasonably conclude there was nobody to hire.
   *
   * The narrowing below mirrors the authorities EXACTLY and never more
   * aggressively, because a pool filter that over-excludes is invisible: the
   * candidate simply never appears and nothing reports why. Anything subtler
   * than these two cases is left to `checkGeoEligibility` and the engine's hard
   * filter on the rows that come back.
   */
  const eligibility = [];

  /**
   * `checkSponsorship` refuses exactly one combination: the candidate states
   * they need sponsorship AND the role states it is unavailable. Every other
   * combination — including either side being unstated — is eligible, so only
   * an explicit `true` is excluded here and NULL is deliberately kept.
   */
  if (job.sponsorshipAvailable === false) {
    eligibility.push(sql`(${users.requiresSponsorship} IS NULL OR ${users.requiresSponsorship} = false)`);
  }

  /**
   * The engine's hard filter already excludes a remote-only candidate from a
   * strictly onsite role — "this role is onsite and you're remote-only" — so
   * fetching them only to drop them wastes a slot a reachable candidate needed.
   *
   * Only the REMOTE case. The filter also excludes onsite roles outside the
   * candidate's metro, but relocation and imprecise city data make that a
   * judgement the engine should keep making on the full row rather than one a
   * query should make on a string comparison.
   */
  if (job.remote === "ONSITE") {
    eligibility.push(sql`${users.remotePref} <> 'REMOTE'`);
  }

  /**
   * How reachable this person is for THIS role, as a ranking signal.
   *
   * The candidate deck has always had this; the recruiter deck had nothing, so
   * an Austin hybrid role ranked 450 Chicago candidates above an equally
   * skilled one in Austin. Commute feasibility only — same city, then same
   * state — never a neighbourhood signal, and flat for a remote role where
   * location genuinely does not matter.
   */
  const jobCity = (job.city ?? "").trim().toLowerCase();
  const jobState = (job.stateProvince ?? "").trim().toUpperCase();
  const proximity =
    job.remote === "REMOTE"
      ? sql<number>`0`
      : sql<number>`(case
            when ${jobCity} <> '' and lower(coalesce(${users.currentCity}, '')) = ${jobCity} then 2
            when ${jobState} <> '' and upper(coalesce(${users.currentStateProvince}, '')) = ${jobState} then 1
            else 0
          end)`;

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
          : []),
        ...eligibility
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
    /**
     * Coverage, then reachability, then recency — the same shape the candidate
     * deck uses, from the other side.
     */
    .orderBy(
      ...(expandedRole.length
        ? [desc(skillCoverage), desc(proximity), desc(users.updatedAt)]
        : [desc(proximity), desc(users.updatedAt)])
    )
    .limit(POOL);

  /**
   * The searched skills in canonical form, so "databricks" typed by a recruiter
   * and "Databricks" stored on a profile are the same thing.
   */
  const searchNorm = normalizeSkills(searchedSkills);

  return rows
    .map((c) => {
      const fit = scoreJobForCandidate(job, c);
      const geo = checkGeoEligibility(jobGeo, toCandidateGeo(c));

      /**
       * Coverage of what the recruiter typed, scored through the same adjacency
       * graph the engine uses — so searching "Databricks" credits a candidate
       * who wrote "Spark" at 0.8 rather than treating them as a non-match.
       */
      const candNorm = normalizeSkills(c.skills ?? []);
      const requested = searchNorm.map((skill) => {
        const { credit, via } = bestCredit(skill, candNorm);
        return { skill, via: credit > 0 ? via : null, credit: Number(credit.toFixed(2)) };
      });
      const requestedCoverage = searchNorm.length
        ? Number((requested.reduce((a, r) => a + r.credit, 0) / searchNorm.length).toFixed(3))
        : 0;

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
        requested,
        requestedCoverage,
        tier: tierFor(fit.score),
        confidence: {
          score: fit.full.confidence.score,
          band: fit.full.confidence.band,
          improve: fit.full.confidence.improve.map((x) => x.note),
        },
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
      /**
       * Skills are RANKED, not filtered.
       *
       * This used to require every searched skill, matched as an exact string:
       * `filters.skills.every((want) => have.has(want.toLowerCase()))`. Two
       * things were wrong with it. It could not see that Spark covers most of
       * Databricks, so a search for one hid every holder of the other. And an
       * all-or-nothing rule makes the fifth skill a recruiter idly adds as
       * destructive as the first — four-of-five is usually the person you want
       * to talk to, and they vanished silently.
       *
       * Coverage now drives the ORDER (below) and every searched skill is
       * reported on the card, held or missing. A recruiter who genuinely wants
       * a hard cut still has `minScore`, which is explicit about being one.
       */
      return true;
    })
    .map(({ _excluded, _geoEligible, _sponsorshipEligible, ...card }) => card satisfies CandidateCard)
    /**
     * Coverage first when a skill search is active, then overall fit.
     *
     * Bucketed to one decimal on purpose. Comparing raw coverage would let a
     * 0.02 difference — the gap between crediting a related skill at 0.8 and at
     * 0.78 — outrank a candidate who is a far better fit on everything else.
     * Rounding says "these cover about the same amount of what you asked for,
     * so show the stronger candidate first", which is what a recruiter reading
     * the list actually wants.
     */
    /**
     * Strong matches first, then coverage of what was searched, then fit.
     *
     * Tier leads even when a skill search is active. A recruiter who typed
     * "Databricks" wants Databricks people, but a 40%-overall candidate who
     * happens to hold the token is not a better first call than an 80% one who
     * holds it too — coverage decides the order WITHIN a tier, not across it.
     */
    .sort((a, b) => {
      const at = a.tier === "STRONG" ? 0 : 1;
      const bt = b.tier === "STRONG" ? 0 : 1;
      if (at !== bt) return at - bt;
      if (searchNorm.length) {
        const cov =
          Math.round(b.requestedCoverage * 10) - Math.round(a.requestedCoverage * 10);
        if (cov) return cov;
      }
      return b.score - a.score;
    })
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
