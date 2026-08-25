import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────────────────────
export const roleEnum = pgEnum("role", ["CANDIDATE", "RECRUITER", "BOTH"]);
/**
 * FSD §8.1 — the job lifecycle. `active` is retained and derived from this;
 * see src/lib/jobStatus.ts for why both exist.
 *
 * BOTH remains in roleEnum above only because removing a Postgres enum value
 * means recreating the type and rewriting every dependent column. Nothing
 * writes it any more — see scripts/migrate-roles.mts.
 */
export const jobStatusEnum = pgEnum("job_status", [
  "DRAFT",
  "PUBLISHED",
  "PAUSED",
  "CLOSED",
  "ARCHIVED",
]);
export const directionEnum = pgEnum("direction", ["LIKE", "PASS"]);

/**
 * CAND-006 / REC-011 / BR-011 / AC-014 — why a recruiter passed.
 *
 * The rule "rejection must use job-related criteria" was unenforceable because
 * nothing was recorded: `recruiter_swipes` had a direction and no reason, so
 * there was no evidence a decision was job-related, and no way to notice a
 * recruiter whose passes correlated with something they must not.
 *
 * Every value here is about the ROLE or the WORK. There is deliberately no
 * "other" free-text option: a free-text box on a rejection is where unlawful
 * reasoning gets written down, and it cannot be audited or aggregated.
 */
export const rejectionReasonEnum = pgEnum("rejection_reason", [
  "SKILLS_GAP",
  "EXPERIENCE_LEVEL",
  "COMPENSATION_MISMATCH",
  "WORK_MODEL_MISMATCH",
  "LOCATION_MISMATCH",
  "ROLE_FILLED",
  "NOT_A_FIT_FOR_THIS_ROLE",
]);
export const applyMethodEnum = pgEnum("apply_method", ["EASY", "EXTERNAL"]);
export const jobSourceEnum = pgEnum("job_source", [
  "JOBSY",
  "GREENHOUSE",
  "LEVER",
  "ASHBY",
  "ADZUNA",
  "JSEARCH", // Google for Jobs index: Indeed, LinkedIn, Glassdoor, ZipRecruiter, Monster
  "JOOBLE", // Indeed + Monster + CareerBuilder aggregate
  "CAREERJET",
  "REMOTIVE",
  "ARBEITNOW",
  // ── company-targeted ATS connectors ──
  "WORKABLE",
  "SMARTRECRUITERS",
  "RECRUITEE",
  "PERSONIO",
  "BAMBOOHR",
  "WORKDAY",
  // ── universal fallbacks for bespoke career sites ──
  "CAREER_SITE", // schema.org JobPosting scraped from the company's own page
  "XML_FEED", // the same XML feed the employer already gives Indeed
  "LINKEDIN", // reserved — requires a LinkedIn Talent partnership
]);

/** How a connected company's jobs are pulled. */
export const sourceKindEnum = pgEnum("source_kind", [
  "GREENHOUSE", "LEVER", "ASHBY", "WORKABLE", "SMARTRECRUITERS",
  "RECRUITEE", "PERSONIO", "BAMBOOHR", "WORKDAY",
  // JSONLD  — the listing page itself publishes schema.org JobPosting records.
  // JSONLD_CRAWL — the listing publishes none, but the job pages it links to
  //   (or the ones its sitemap names) do. This is the common shape: Google for
  //   Jobs wants the data on the job page, not the index.
  "JSONLD", "JSONLD_CRAWL", "XML_FEED",
]);

export const sourceStatusEnum = pgEnum("source_status", ["PENDING", "OK", "FAILING", "DISABLED"]);

/**
 * Where a sourced candidate came from.
 *
 * Every value here is a system the EMPLOYER has a relationship with — their own
 * ATS, or a resume database they hold a licence for. There is deliberately no
 * value for a public profile site, because taking someone's CV off one is a
 * terms-of-service breach and, without a lawful basis, an unlawful act. The
 * absence is the policy.
 */
export const candidateSourceKindEnum = pgEnum("candidate_source_kind", [
  // The employer's own applicants. The strongest position we can be in: these
  // people applied to this company and agreed to its privacy notice.
  "GREENHOUSE",
  "LEVER",
  "ASHBY",
  "WORKABLE",
  // Licensed resume databases. Inert until a real contract key is supplied.
  "DICE",
  "MONSTER",
  "ZIPRECRUITER",
  "INDEED_RESUME",
  "NAUKRI",
  // A recruiter typing someone in, or uploading a CV they were sent.
  "MANUAL",
]);

/**
 * Why we are allowed to hold this person's data.
 *
 * Recorded per candidate rather than assumed per source, because the same ATS
 * can hold applicants (who consented to that employer) and referrals (who did
 * not). A row that cannot name its basis is a row we should not have.
 */
export const lawfulBasisEnum = pgEnum("lawful_basis", [
  /** They applied to this employer and accepted its privacy notice. */
  "APPLICATION",
  /** Held under a resume-database licence the employer pays for. */
  "LICENSED",
  /** Recruitment sourcing as a legitimate interest — requires notice under Art 14. */
  "LEGITIMATE_INTEREST",
  /** They told us directly. */
  "CONSENT",
]);

/**
 * How far along a sourced candidate is.
 *
 * The order matters and the first value is the important one: IMPORTED means
 * held but invisible — not matched, not scored, not shown to anyone but the
 * recruiter whose ATS they came from. A person cannot be put through an
 * automated hiring tool before they have been told it exists (NYC LL144), and
 * cannot be silently added to a database (GDPR Art 14). This column is what
 * makes those two facts enforceable rather than aspirational.
 */
export const candidateStateEnum = pgEnum("candidate_state", [
  "IMPORTED",
  "NOTIFIED",
  "CLAIMED",
  /** They objected, or asked to be erased. Never re-import. */
  "SUPPRESSED",
]);
export const remotePrefEnum = pgEnum("remote_pref", ["ONSITE", "HYBRID", "REMOTE", "ANY"]);
export const applicationStatusEnum = pgEnum("application_status", [
  "SUBMITTED",
  "REDIRECTED",
  "VIEWED",
  "INTERVIEWING",
  "REJECTED",
  "HIRED",
]);
/**
 * SUPPRESSED — the recipient has this category switched off (MATCH-006).
 *
 * A distinct status, not a silent skip: "we chose not to send this" and "we
 * tried and failed" are different facts, and collapsing them makes a delivery
 * problem indistinguishable from a working preference.
 */
export const emailStatusEnum = pgEnum("email_status", [
  "QUEUED",
  "SENT",
  "FAILED",
  "LOGGED_ONLY",
  "SUPPRESSED",
]);
export const emailTemplateEnum = pgEnum("email_template", [
  "RECRUITER_INTEREST",
  "APPLICATION_RECEIVED",
  "MATCH_CANDIDATE",
  "MATCH_RECRUITER",
  // ── PRD v1.0 additions ──
  "VERIFY_EMAIL",
  "PASSWORD_RESET",
  "PASSWORD_CHANGED",
  "COMPANY_INVITE",
  "NEW_MESSAGE",
  "JOB_EXPIRY_WARNING",
  "SOURCE_DISABLED",
  "REPORT_ACKNOWLEDGED",
  "HUMAN_REVIEW_OUTCOME",
  "DATA_EXPORT_READY",
  "ACCOUNT_DELETED",
]);

export const tokenPurposeEnum = pgEnum("token_purpose", [
  "VERIFY_EMAIL",
  "RESET_PASSWORD",
  "COMPANY_INVITE",
  "DOMAIN_VERIFY",
  "UNSUBSCRIBE",
]);

export const seatRoleEnum = pgEnum("seat_role", ["COMPANY_ADMIN", "RECRUITER"]);
export const memberStatusEnum = pgEnum("member_status", ["ACTIVE", "SUSPENDED"]);
export const inviteStatusEnum = pgEnum("invite_status", [
  "PENDING",
  "ACCEPTED",
  "REVOKED",
  "EXPIRED",
]);

export const parseStatusEnum = pgEnum("parse_status", ["PENDING", "OK", "FAILED", "MANUAL"]);

export const reportKindEnum = pgEnum("report_kind", ["JOB", "USER", "MESSAGE", "COMPANY"]);
export const reportReasonEnum = pgEnum("report_reason", [
  "SCAM_OR_FEE",
  "DISCRIMINATORY",
  "HARASSMENT",
  "SPAM",
  "GHOST_JOB",
  "IMPERSONATION",
  "OTHER",
]);
export const reportStatusEnum = pgEnum("report_status", [
  "OPEN",
  "REVIEWING",
  "ACTIONED",
  "DISMISSED",
]);
export const moderationActionEnum = pgEnum("moderation_action", [
  "NONE",
  "WARNED",
  "CONTENT_REMOVED",
  "SUSPENDED",
  "BANNED",
]);

export const privacyRequestKindEnum = pgEnum("privacy_request_kind", [
  "ACCESS",
  "EXPORT",
  "DELETE",
  "CORRECT",
  "OPT_OUT_PROFILING",
  "LIMIT_SENSITIVE",
  "HUMAN_REVIEW",
]);
export const privacyRequestStatusEnum = pgEnum("privacy_request_status", [
  "RECEIVED",
  "IN_PROGRESS",
  "COMPLETED",
  "DENIED",
  "ON_LEGAL_HOLD",
]);

export const consentSourceEnum = pgEnum("consent_source", ["EMPLOYER_SUBMITTED", "CRAWLED"]);

/** RMT-002 — the geographic scope of a remote role. Never assume WORLDWIDE. */
export const remoteScopeEnum = pgEnum("remote_scope", [
  "SAME_COUNTRY",
  "COUNTRIES",
  "STATES",
  "REGION",
  "WORLDWIDE",
]);

/** SRC-012 — three job origins, not two. */
export const jobOriginEnum = pgEnum("job_origin", [
  "JOBSY_CREATED",
  "RECRUITER_IMPORTED",
  "EXTERNALLY_DISCOVERED",
]);

/** CLP-006 — how far the candidate will move for work. */
export const relocationEnum = pgEnum("relocation_willingness", [
  "NONE",
  "DOMESTIC",
  "INTERNATIONAL",
]);

const id = () =>
  varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

// ─────────────────────────────────────────────────────────────
// COMPANIES
// ─────────────────────────────────────────────────────────────
export const companies = pgTable("companies", {
  id: id(),
  name: text("name").notNull(),
  slug: varchar("slug", { length: 80 }).notNull().unique(),
  website: text("website"),
  logoUrl: text("logo_url"),
  description: text("description"),
  source: jobSourceEnum("source").notNull().default("JOBSY"),

  // ── COMP-003 domain verification ──
  emailDomain: varchar("email_domain", { length: 191 }),
  verified: boolean("verified").notNull().default(false),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  /** "EMAIL" or "DNS" — recorded so a verification can be audited later. */
  verifiedMethod: varchar("verified_method", { length: 20 }),

  /** SEAT-001. Read from the row, never hardcoded: 1 admin + 3 recruiters. */
  seatLimit: integer("seat_limit").notNull().default(4),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────
// USERS — one row serves both sides of the marketplace
// ─────────────────────────────────────────────────────────────
export const users = pgTable(
  "users",
  {
    id: id(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    name: text("name").notNull(),
    passwordHash: text("password_hash"),
    image: text("image"),
    role: roleEnum("role").notNull().default("CANDIDATE"),

    // LinkedIn OIDC (scopes: openid, profile, email) — the self-serve tier
    linkedinSub: varchar("linkedin_sub", { length: 128 }),
    linkedinLinkedAt: timestamp("linkedin_linked_at", { withTimezone: true }),
    emailVerified: boolean("email_verified").notNull().default(false),

    // candidate side
    /**
     * Given and family name, kept separately from `name`.
     *
     * `name` remains the display string and stays authoritative for everything
     * that renders a person, so nothing downstream has to learn a new field.
     * These exist because registration asks for them separately and an
     * application form, an offer letter or a CV parse needs the parts — joining
     * them is easy, splitting them reliably is not ("Maria del Carmen Ortiz
     * Gómez" has no safe midpoint).
     */
    firstName: varchar("first_name", { length: 120 }),
    lastName: varchar("last_name", { length: 120 }),
    /** Contact number. Optional for candidates, useful for recruiters. */
    phone: varchar("phone", { length: 60 }),
    headline: text("headline"),
    bio: text("bio"),
    location: text("location"),
    remotePref: remotePrefEnum("remote_pref").notNull().default("ANY"),
    yearsExp: integer("years_exp").notNull().default(0),
    salaryTarget: integer("salary_target"), // thousands, USD
    availability: text("availability"),
    skills: text("skills").array().notNull().default([]),
    openToOffers: boolean("open_to_offers").notNull().default(true),
    profileReady: boolean("profile_ready").notNull().default(false),

    // recruiter side
    companyId: varchar("company_id", { length: 36 }).references(() => companies.id),
    title: text("title"),

    // ── work authorization (WORK-001) ──
    // Exactly two booleans. Never a visa category, country of citizenship,
    // status detail or document number — see PRD WORK-001 and IRCA 8 USC 1324b.
    authorizedToWork: boolean("authorized_to_work"),
    requiresSponsorship: boolean("requires_sponsorship"),
    /** Opt-in consent timestamp, required where this is "sensitive data". */
    workAuthConsentAt: timestamp("work_auth_consent_at", { withTimezone: true }),

    // ── security & lifecycle ──
    /**
     * AUTH-008. Embedded as a JWT claim; a token whose claim is below this
     * value is rejected. Incrementing it revokes every outstanding session on
     * the next request, with no deploy and no cache flush.
     */
    sessionVersion: integer("session_version").notNull().default(0),
    isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    /** XPLAIN-003 — opted out of automated ranking. */
    profilingOptOut: boolean("profiling_opt_out").notNull().default(false),
    /** AUTH-012 — set at request; the purge job erases the row's PII. */
    deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    legalHold: boolean("legal_hold").notNull().default(false),
    /** Two-letter US state, derived from the user's stated location. Used ONLY
     *  to select which legal notices apply — never as a matching input. */
    jurisdiction: varchar("jurisdiction", { length: 8 }),

    // ── FSD v1.1 §36.2 — CandidateLocation ──
    // Where the candidate LIVES and where they want to WORK, kept apart.
    // Deliberately contains no nationality, citizenship or immigration-status
    // field: country of residence plus the employer-stated right to work in a
    // jurisdiction answers every rule in §30–§35, and the protected version of
    // the question cannot then be asked by accident. See FSD §38.1.
    currentCountry: varchar("current_country", { length: 2 }),
    currentStateProvince: varchar("current_state_province", { length: 64 }),
    currentCity: text("current_city"),
    /**
     * OPTIONAL, and it stays optional. It improves radius accuracy for
     * local-only roles and nothing else. Never a matching input, never a
     * recruiter-settable filter — see src/lib/geo/postal.ts.
     */
    currentPostalCode: varchar("current_postal_code", { length: 12 }),
    /** CLP-002 — defaults to currentCountry when null. */
    searchCountry: varchar("search_country", { length: 2 }),
    preferredCountries: text("preferred_countries").array().notNull().default([]),
    preferredRegions: text("preferred_regions").array().notNull().default([]),
    preferredCities: text("preferred_cities").array().notNull().default([]),
    /** CLP-004 — cross-border matching is opt-in, off by default (BR-014). */
    internationalSearchEnabled: boolean("international_search_enabled").notNull().default(false),
    /** CLP-005 — empty means same country only; ["*"] means anywhere. */
    remoteEligibleCountries: text("remote_eligible_countries").array().notNull().default([]),
    relocationWillingness: relocationEnum("relocation_willingness").notNull().default("NONE"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_linkedin_sub_idx").on(t.linkedinSub),
    index("users_role_ready_idx").on(t.role, t.profileReady),
    index("users_current_country_idx").on(t.currentCountry),
  ]
);

// ─────────────────────────────────────────────────────────────
// JOBS
// ─────────────────────────────────────────────────────────────
export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    source: jobSourceEnum("source").notNull(),
    externalId: varchar("external_id", { length: 191 }),
    sourceUrl: text("source_url"),
    /** Original board the aggregator sourced it from: "Indeed", "Monster", … */
    publisher: text("publisher"),

    title: text("title").notNull(),
    companyId: varchar("company_id", { length: 36 })
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    location: text("location").notNull(),
    remote: remotePrefEnum("remote").notNull().default("ONSITE"),
    employmentType: text("employment_type").notNull().default("Full-time"),
    seniority: text("seniority").notNull().default("Mid"),

    salaryMin: integer("salary_min"), // thousands, USD
    salaryMax: integer("salary_max"),
    currency: varchar("currency", { length: 8 }).notNull().default("USD"),

    description: text("description").notNull(),
    /**
     * The union of required + preferred, kept as the general-purpose skill list.
     *
     * Every existing query, the RSS feed, the card UI and every ingested job
     * reads this. It stays authoritative for "what is this job about"; the two
     * columns below say how strongly each one is wanted.
     */
    skills: text("skills").array().notNull().default([]),
    /**
     * MATCH-002 — required vs preferred, as the recruiter STATED them.
     *
     * The match engine has always weighted these differently — 40 points against
     * 12 — but nobody could ever say which was which. `parseRequirements()`
     * inferred the split by looking for headings like "Requirements" and
     * "Nice to have" in the description prose, and reported `structured: false`
     * when it found none, which is most of the time: aggregator feeds truncate
     * the body, and plenty of recruiters write a paragraph rather than a list.
     *
     * When that inference fails, EVERY tagged skill becomes required. A posting
     * that mentions Kubernetes as a nice-to-have then scores candidates as
     * though it were mandatory, and people who could do the job rank below
     * people who cannot.
     *
     * Empty means "not stated" — inference still runs, exactly as before. These
     * are additive, so every job already in the table keeps working.
     */
    requiredSkills: text("required_skills").array().notNull().default([]),
    preferredSkills: text("preferred_skills").array().notNull().default([]),
    perks: text("perks").array().notNull().default([]),

    applyMethod: applyMethodEnum("apply_method").notNull().default("EXTERNAL"),
    applyUrl: text("apply_url"),

    postedById: varchar("posted_by_id", { length: 36 }).references(() => users.id, {
      onDelete: "set null",
    }),

    // ── WORK-002 ──
    /** Three states: true, false, and null meaning unstated. Never inferred. */
    sponsorshipAvailable: boolean("sponsorship_available"),

    // ── LEGAL-002 pay transparency ──
    /** Required in covered jurisdictions alongside a salary range. */
    benefitsDescription: text("benefits_description"),
    /** True when the employer themselves supplied compensation data. */
    employerSuppliedPay: boolean("employer_supplied_pay").notNull().default(false),
    /**
     * The affirmative defence. Washington, Colorado, Delaware, Columbus and
     * New Jersey all key third-party liability on employer CONSENT, so the two
     * populations must be distinguishable in the data, not just in intent.
     */
    consentSource: consentSourceEnum("consent_source").notNull().default("CRAWLED"),

    // ── TRUST-001 / JOB-003 ghost jobs ──
    /** Set when a recruiter attests the vacancy is real, current and theirs. */
    attestedAt: timestamp("attested_at", { withTimezone: true }),
    attestedById: varchar("attested_by_id", { length: 36 }),
    /** Advanced by the "is this still open?" prompt; drives 60-day auto-expiry. */
    lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }),
    expiryWarnedAt: timestamp("expiry_warned_at", { withTimezone: true }),
    /** Consecutive successful syncs in which an ingested job was absent. */
    missedSyncs: integer("missed_syncs").notNull().default(0),

    // ── FSD v1.1 §36.1 — JobLocation ──
    // `location` above stays as the human string we display. These are what the
    // eligibility layer actually reads, because inferring geography from free
    // text is the root cause §30–§33 exists to prevent.
    countryCode: varchar("country_code", { length: 2 }),
    stateProvince: varchar("state_province", { length: 64 }),
    city: text("city"),
    /**
     * Identity, not screening. country + state + postal is the unique place
     * key used for cross-source de-duplication, and the ZIP3 prefix is used for
     * radius arithmetic in the eligibility layer. It is unreachable from the
     * scoring engine, which the MATCH-030 guard enforces: Illinois HB 3773
     * names ZIP explicitly as a banned proxy. See src/lib/geo/postal.ts.
     */
    postalCode: varchar("postal_code", { length: 12 }),
    /** RMT-001. Null means the employer stated no scope — RMT-005 applies. */
    remoteScope: remoteScopeEnum("remote_scope"),
    remoteScopeCountries: text("remote_scope_countries").array().notNull().default([]),
    remoteScopeStates: text("remote_scope_states").array().notNull().default([]),
    remoteScopeRegion: varchar("remote_scope_region", { length: 32 }),
    /** Whether the scope was stated by the employer or defaulted under RMT-005. */
    remoteScopeSource: varchar("remote_scope_source", { length: 16 }),
    /** LOC-001 – LOC-003. */
    localOnly: boolean("local_only").notNull().default(false),
    localRadiusMiles: integer("local_radius_miles"),
    /** LOC-006 — why the role needs local presence. Cheap now, costly later. */
    localJustification: text("local_justification"),
    relocationAccepted: boolean("relocation_accepted").notNull().default(false),
    allowedCountries: text("allowed_countries").array().notNull().default([]),
    excludedCountries: text("excluded_countries").array().notNull().default([]),

    // ── SRC-007 / SRC-012 ──
    /** Three origins. `consentSource` above answers a different question: who
     *  supplied the pay data, which is a pay-transparency liability question. */
    origin: jobOriginEnum("origin").notNull().default("EXTERNALLY_DISCOVERED"),
    /** Cross-source identity: normalised title + company + location. */
    dedupeKey: varchar("dedupe_key", { length: 191 }),
    /** Set on a duplicate, pointing at the posting we surface instead. */
    canonicalJobId: varchar("canonical_job_id", { length: 36 }),

    /** Derived from `status`. Kept so existing visibility queries are unchanged. */
    active: boolean("active").notNull().default(true),
    status: jobStatusEnum("status").notNull().default("PUBLISHED"),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
    raw: jsonb("raw"),
  },
  (t) => [
    uniqueIndex("jobs_source_external_idx").on(t.source, t.externalId),
    index("jobs_active_posted_idx").on(t.active, t.postedAt),
    index("jobs_status_idx").on(t.status),
    index("jobs_posted_by_idx").on(t.postedById),
    index("jobs_country_active_idx").on(t.countryCode, t.active),
    index("jobs_dedupe_key_idx").on(t.dedupeKey),
    index("jobs_place_idx").on(t.countryCode, t.stateProvince, t.postalCode),
    index("jobs_canonical_idx").on(t.canonicalJobId),
  ]
);

// ─────────────────────────────────────────────────────────────
// SWIPES — split by intent so uniqueness is actually enforceable
// ─────────────────────────────────────────────────────────────
export const candidateSwipes = pgTable(
  "candidate_swipes",
  {
    id: id(),
    candidateId: varchar("candidate_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobId: varchar("job_id", { length: 36 })
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    direction: directionEnum("direction").notNull(),
    score: integer("score").notNull().default(0),
    /** NFR-005 — which scoring model produced `score`. Null for pre-v2.1 rows. */
    modelVersion: varchar("model_version", { length: 32 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cand_swipe_unique").on(t.candidateId, t.jobId),
    index("cand_swipe_job_idx").on(t.jobId, t.direction),
  ]
);

export const recruiterSwipes = pgTable(
  "recruiter_swipes",
  {
    id: id(),
    recruiterId: varchar("recruiter_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobId: varchar("job_id", { length: 36 })
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    candidateId: varchar("candidate_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    direction: directionEnum("direction").notNull(),
    score: integer("score").notNull().default(0),
    /** BR-011 — required on a PASS, meaningless on a LIKE. */
    rejectionReason: rejectionReasonEnum("rejection_reason"),
    /** NFR-005 — the model that ranked this pair when the decision was made. */
    modelVersion: varchar("model_version", { length: 32 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("rec_swipe_unique").on(t.jobId, t.candidateId),
    index("rec_swipe_cand_idx").on(t.candidateId, t.direction),
  ]
);

// ─────────────────────────────────────────────────────────────
// OUTCOMES
// ─────────────────────────────────────────────────────────────
export const applications = pgTable(
  "applications",
  {
    id: id(),
    candidateId: varchar("candidate_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobId: varchar("job_id", { length: 36 })
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    method: applyMethodEnum("method").notNull(),
    status: applicationStatusEnum("status").notNull().default("SUBMITTED"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("application_unique").on(t.candidateId, t.jobId)]
);

export const matches = pgTable(
  "matches",
  {
    id: id(),
    jobId: varchar("job_id", { length: 36 })
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    candidateId: varchar("candidate_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recruiterId: varchar("recruiter_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    score: integer("score").notNull().default(0),
    /**
     * NFR-005 — which scoring model produced `score`.
     *
     * On the swipe too, not only here: a swipe is the moment a ranked decision
     * was acted on, and that is what a bias audit samples. Null on rows that
     * predate versioning, which is itself the honest answer — we do not know.
     */
    modelVersion: varchar("model_version", { length: 32 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("match_unique").on(t.jobId, t.candidateId),
    index("match_cand_idx").on(t.candidateId),
    index("match_rec_idx").on(t.recruiterId),
  ]
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    matchId: varchar("match_id", { length: 36 })
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    senderId: varchar("sender_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("message_thread_idx").on(t.matchId, t.createdAt)]
);

// ─────────────────────────────────────────────────────────────
// OPS
// ─────────────────────────────────────────────────────────────
export const emailLogs = pgTable(
  "email_logs",
  {
    id: id(),
    to: varchar("to_address", { length: 255 }).notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    template: emailTemplateEnum("template").notNull(),
    status: emailStatusEnum("status").notNull().default("QUEUED"),
    providerId: text("provider_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("email_to_idx").on(t.to, t.createdAt)]
);

/**
 * A connected company. One row = "keep pulling every job this employer posts".
 *
 * This is what makes ingestion continuous rather than a one-off import: add a
 * company once, and the scheduled sync picks up everything they post from then
 * on, with no further action from anyone.
 */
export const jobSources = pgTable(
  "job_sources",
  {
    id: id(),
    kind: sourceKindEnum("kind").notNull(),
    /** Board slug for an ATS ("stripe", "nvidia|wd5|Careers"), or a URL for JSONLD / XML_FEED. */
    token: text("token").notNull(),
    companyName: text("company_name").notNull(),
    careersUrl: text("careers_url"),
    autoDetected: boolean("auto_detected").notNull().default(false),
    detectedVia: text("detected_via"),

    enabled: boolean("enabled").notNull().default(true),
    status: sourceStatusEnum("status").notNull().default("PENDING"),
    lastError: text("last_error"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastJobCount: integer("last_job_count").notNull().default(0),
    totalImported: integer("total_imported").notNull().default(0),
    /**
     * How far through a large careers site the last run got.
     *
     * A serverless run has sixty seconds. An employer can have three thousand
     * openings. Those two facts cannot both be satisfied in one invocation, and
     * the first version pretended otherwise by rotating on the clock — which
     * re-read arbitrary parts of the site and never guaranteed it had seen all
     * of it.
     *
     * A stored cursor makes the guarantee: each run continues where the last
     * one stopped, so coverage is complete after enough runs rather than
     * approximately complete for ever.
     */
    crawlCursor: integer("crawl_cursor").notNull().default(0),
    /** Job pages the last run knew existed, so progress can be shown honestly. */
    lastDiscovered: integer("last_discovered").notNull().default(0),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),

    /** Who connected it — null for sources seeded from env or by an admin script. */
    addedById: varchar("added_by_id", { length: 36 }).references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("job_source_unique").on(t.kind, t.token),
    index("job_source_enabled_idx").on(t.enabled, t.lastRunAt),
  ]
);

export const ingestRuns = pgTable(
  "ingest_runs",
  {
    id: id(),
    source: jobSourceEnum("source").notNull(),
    board: text("board"),
    sourceId: varchar("source_id", { length: 36 }).references(() => jobSources.id, {
      onDelete: "cascade",
    }),
    fetched: integer("fetched").notNull().default(0),
    created: integer("created").notNull().default(0),
    updated: integer("updated").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("ingest_source_idx").on(t.source, t.startedAt)]
);

// ─────────────────────────────────────────────────────────────
// RELATIONS
// ─────────────────────────────────────────────────────────────
/**
 * A connected candidate source — one employer's ATS account, or one resume
 * database licence.
 *
 * Separate from `job_sources` on purpose. A job board is a public thing anyone
 * may read; a candidate source holds other people's personal data under a
 * credential that belongs to one company, and conflating the two would make it
 * far too easy to leak the second through a screen built for the first.
 */
export const candidateSources = pgTable(
  "candidate_sources",
  {
    id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    kind: candidateSourceKindEnum("kind").notNull(),
    /** The company whose credential this is. Scopes every candidate it imports. */
    companyId: varchar("company_id", { length: 36 })
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** Board slug, account id, or licence identifier. Never the secret itself. */
    token: varchar("token", { length: 191 }).notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    /**
     * The API credential.
     *
     * Held because the sync runs without a human present. Stored separately
     * from `token` so it never rides along in a list response by accident — the
     * API layer must select columns explicitly to include it, and no read path
     * outside the sync does.
     */
    secret: text("secret"),
    lawfulBasis: lawfulBasisEnum("lawful_basis").notNull().default("APPLICATION"),
    enabled: boolean("enabled").notNull().default(true),
    status: sourceStatusEnum("status").notNull().default("PENDING"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastError: text("last_error"),
    lastCount: integer("last_count").notNull().default(0),
    totalImported: integer("total_imported").notNull().default(0),
    syncCursor: integer("sync_cursor").notNull().default(0),
    addedById: varchar("added_by_id", { length: 36 }).references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("candidate_sources_company_kind_token_idx").on(t.companyId, t.kind, t.token),
    index("candidate_sources_company_idx").on(t.companyId),
  ]
);

/**
 * A person we hold, who has not necessarily agreed to be held.
 *
 * ── Why this is not a row in `users` ──
 *
 * Because they are not users. They have no password, no session, no acceptance
 * of any terms, and in most cases no idea Jobsy exists. Putting them in `users`
 * would put them one careless query away from the matching deck, the recruiter
 * search, and every count that says "candidates on Jobsy" — and the separation
 * is what makes "invisible until notified" true by construction rather than by
 * everyone remembering a WHERE clause.
 *
 * When somebody claims their profile a real `users` row is created and linked
 * through `claimedUserId`. That is the moment they become a user.
 */
export const sourcedCandidates = pgTable(
  "sourced_candidates",
  {
    id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    sourceId: varchar("source_id", { length: 36 })
      .notNull()
      .references(() => candidateSources.id, { onDelete: "cascade" }),
    companyId: varchar("company_id", { length: 36 })
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** Their id in the originating system, so re-imports update rather than duplicate. */
    externalId: varchar("external_id", { length: 191 }).notNull(),

    state: candidateStateEnum("state").notNull().default("IMPORTED"),
    lawfulBasis: lawfulBasisEnum("lawful_basis").notNull(),

    firstName: varchar("first_name", { length: 120 }),
    lastName: varchar("last_name", { length: 120 }),
    email: varchar("email", { length: 255 }),
    phone: varchar("phone", { length: 60 }),
    headline: varchar("headline", { length: 200 }),
    location: varchar("location", { length: 160 }),
    skills: text("skills").array().notNull().default([]),
    /** Extracted CV text, for skill reading. The file stays in the source system. */
    resumeText: text("resume_text"),
    /** Where the CV lives in the ATS, for a recruiter who wants the original. */
    resumeUrl: text("resume_url"),

    /**
     * How this person said they prefer to be approached, if they said so.
     *
     * Only ever populated from something they published themselves — the
     * profile URL they put on their own application. It is a pointer to a
     * conversation on their turf, not a channel we opened.
     */
    preferredChannel: varchar("preferred_channel", { length: 40 }),
    preferredHandle: text("preferred_handle"),

    /** Article 14: when we told them, and how. Null means we have not. */
    noticeSentAt: timestamp("notice_sent_at", { withTimezone: true }),
    noticeChannel: varchar("notice_channel", { length: 40 }),
    /** Single-use token for the claim link. */
    claimToken: varchar("claim_token", { length: 80 }),
    claimedUserId: varchar("claimed_user_id", { length: 36 }).references(() => users.id),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    /** An objection or erasure request. Suppresses, and blocks re-import. */
    suppressedAt: timestamp("suppressed_at", { withTimezone: true }),
    suppressedReason: varchar("suppressed_reason", { length: 120 }),

    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sourced_candidates_source_external_idx").on(t.sourceId, t.externalId),
    index("sourced_candidates_company_state_idx").on(t.companyId, t.state),
    index("sourced_candidates_email_idx").on(t.email),
  ]
);

export const companiesRelations = relations(companies, ({ many }) => ({
  jobs: many(jobs),
  users: many(users),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  company: one(companies, { fields: [users.companyId], references: [companies.id] }),
  postedJobs: many(jobs),
  applications: many(applications),
  messages: many(messages),
}));

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  company: one(companies, { fields: [jobs.companyId], references: [companies.id] }),
  postedBy: one(users, { fields: [jobs.postedById], references: [users.id] }),
  applications: many(applications),
  matches: many(matches),
}));

export const applicationsRelations = relations(applications, ({ one }) => ({
  candidate: one(users, { fields: [applications.candidateId], references: [users.id] }),
  job: one(jobs, { fields: [applications.jobId], references: [jobs.id] }),
}));

export const matchesRelations = relations(matches, ({ one, many }) => ({
  job: one(jobs, { fields: [matches.jobId], references: [jobs.id] }),
  candidate: one(users, { fields: [matches.candidateId], references: [users.id], relationName: "matchCandidate" }),
  recruiter: one(users, { fields: [matches.recruiterId], references: [users.id], relationName: "matchRecruiter" }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  match: one(matches, { fields: [messages.matchId], references: [matches.id] }),
  sender: one(users, { fields: [messages.senderId], references: [users.id] }),
}));

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Company = typeof companies.$inferSelect;
export type Match = typeof matches.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Application = typeof applications.$inferSelect;
export type Direction = (typeof directionEnum.enumValues)[number];
export type RemotePref = (typeof remotePrefEnum.enumValues)[number];
export type ApplyMethod = (typeof applyMethodEnum.enumValues)[number];
export type JobSource = (typeof jobSourceEnum.enumValues)[number];
export type EmailTemplate = (typeof emailTemplateEnum.enumValues)[number];
export type JobSourceRow = typeof jobSources.$inferSelect;
export type CandidateSourceRow = typeof candidateSources.$inferSelect;
export type SourcedCandidateRow = typeof sourcedCandidates.$inferSelect;
export type CandidateSourceKind = (typeof candidateSourceKindEnum.enumValues)[number];
export type CandidateState = (typeof candidateStateEnum.enumValues)[number];
export type LawfulBasis = (typeof lawfulBasisEnum.enumValues)[number];
export type NewJobSource = typeof jobSources.$inferInsert;
export type SourceKind = (typeof sourceKindEnum.enumValues)[number];
export type SourceStatus = (typeof sourceStatusEnum.enumValues)[number];

// ═════════════════════════════════════════════════════════════
// PRD v1.0 — additions
//
// Everything below implements the P0 gap list in PRD §26. Grouped by the
// feature IDs that required it so the mapping stays traceable.
// ═════════════════════════════════════════════════════════════

/**
 * AUTH-006 / AUTH-007 / SEAT-002 / COMP-003 / NOTIF-001.
 *
 * Only a SHA-256 hash of the token is ever stored. A database dump therefore
 * cannot be used to verify an email, reset a password, or join a company.
 */
export const emailTokens = pgTable(
  "email_tokens",
  {
    id: id(),
    userId: varchar("user_id", { length: 36 }).references(() => users.id, { onDelete: "cascade" }),
    /** Set for invitations, where no user row exists yet. */
    email: varchar("email", { length: 255 }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    purpose: tokenPurposeEnum("purpose").notNull(),
    /** Free-form payload — the company id for an invite, the domain for a domain check. */
    context: jsonb("context"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("email_token_hash_idx").on(t.tokenHash),
    index("email_token_user_idx").on(t.userId, t.purpose, t.expiresAt),
  ]
);

/**
 * AUTH-009 — rate limiting.
 *
 * Serverless functions are stateless and horizontally scaled, so an in-memory
 * counter silently does nothing. This is a fixed-window counter in Postgres:
 * correct across every instance, and fast enough at MVP volume. Swap for Redis
 * when write volume justifies it — the interface in src/lib/ratelimit.ts stays
 * the same.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    /** "login:ip:1.2.3.4:29184713" — bucket is baked into the key. */
    key: varchar("key", { length: 191 }).primaryKey(),
    count: integer("count").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("rate_limit_expiry_idx").on(t.expiresAt)]
);

/** SEAT-001 — 1 COMPANY_ADMIN + N RECRUITER seats per company. */
export const companyMembers = pgTable(
  "company_members",
  {
    id: id(),
    companyId: varchar("company_id", { length: 36 })
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seatRole: seatRoleEnum("seat_role").notNull().default("RECRUITER"),
    status: memberStatusEnum("status").notNull().default("ACTIVE"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("company_member_unique").on(t.companyId, t.userId),
    index("company_member_status_idx").on(t.companyId, t.status),
    // A user belongs to exactly one company at a time (SEAT-002 AC-4).
    uniqueIndex("company_member_user_unique").on(t.userId),
  ]
);

/** SEAT-002 — teammate invitations. */
export const companyInvitations = pgTable(
  "company_invitations",
  {
    id: id(),
    companyId: varchar("company_id", { length: 36 })
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }).notNull(),
    seatRole: seatRoleEnum("seat_role").notNull().default("RECRUITER"),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    invitedById: varchar("invited_by_id", { length: 36 }).references(() => users.id, {
      onDelete: "set null",
    }),
    status: inviteStatusEnum("status").notNull().default("PENDING"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("company_invite_token_idx").on(t.tokenHash),
    index("company_invite_lookup_idx").on(t.companyId, t.email, t.status),
  ]
);

/** RESUME-001 — uploaded files. */
export const resumes = pgTable(
  "resumes",
  {
    id: id(),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    filename: text("filename").notNull(),
    mime: varchar("mime", { length: 100 }).notNull(),
    bytes: integer("bytes").notNull(),
    version: integer("version").notNull().default(1),
    isPrimary: boolean("is_primary").notNull().default(true),
    parseStatus: parseStatusEnum("parse_status").notNull().default("PENDING"),
    parsedAt: timestamp("parsed_at", { withTimezone: true }),
    parseError: text("parse_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("resume_user_idx").on(t.userId, t.isPrimary)]
);

/**
 * RESUME-003 — structured parse output.
 *
 * Held separately from the profile because parsed data is a SUGGESTION. It is
 * never written to users.* until the candidate approves it (AC-4).
 */
export const resumeParses = pgTable(
  "resume_parses",
  {
    id: id(),
    resumeId: varchar("resume_id", { length: 36 })
      .notNull()
      .references(() => resumes.id, { onDelete: "cascade" }),
    rawText: text("raw_text"),
    structured: jsonb("structured"),
    confidence: jsonb("confidence"),
    engine: varchar("engine", { length: 40 }).notNull().default("jobsy-local"),
    engineVersion: varchar("engine_version", { length: 20 }).notNull().default("1.0"),
    appliedToProfile: boolean("applied_to_profile").notNull().default(false),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("resume_parse_resume_idx").on(t.resumeId)]
);

/**
 * TRUST-002 / MSG-004 — reports.
 *
 * `snapshot` freezes the reported content at report time so a later edit or
 * delete cannot destroy the evidence.
 */
export const reports = pgTable(
  "reports",
  {
    id: id(),
    reporterId: varchar("reporter_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: reportKindEnum("kind").notNull(),
    /** Id of the reported job / user / message / company. */
    targetId: varchar("target_id", { length: 36 }).notNull(),
    reason: reportReasonEnum("reason").notNull(),
    detail: text("detail"),
    snapshot: jsonb("snapshot").notNull(),
    status: reportStatusEnum("status").notNull().default("OPEN"),
    action: moderationActionEnum("action").notNull().default("NONE"),
    resolvedById: varchar("resolved_by_id", { length: 36 }).references(() => users.id, {
      onDelete: "set null",
    }),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("report_status_idx").on(t.status, t.createdAt),
    index("report_target_idx").on(t.kind, t.targetId),
  ]
);

/** MSG-004 — blocks. Directional rows; enforcement checks both directions. */
export const blocks = pgTable(
  "blocks",
  {
    id: id(),
    blockerId: varchar("blocker_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedId: varchar("blocked_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("block_unique").on(t.blockerId, t.blockedId),
    index("block_blocked_idx").on(t.blockedId),
  ]
);

/**
 * LEGAL-009 — proof of what the user agreed to, and when.
 *
 * Enforceability turns on being able to show the user affirmatively assented to
 * a specific document version. Without this row there is no evidence.
 */
export const termsAcceptances = pgTable(
  "terms_acceptances",
  {
    id: id(),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    document: varchar("document", { length: 40 }).notNull(),
    version: varchar("version", { length: 20 }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
    ip: varchar("ip", { length: 64 }),
    userAgent: text("user_agent"),
  },
  (t) => [index("terms_user_idx").on(t.userId, t.document)]
);

/** LEGAL-001 / AUTH-012 / XPLAIN-003 / XPLAIN-004 — the privacy request ledger. */
export const privacyRequests = pgTable(
  "privacy_requests",
  {
    id: id(),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: privacyRequestKindEnum("kind").notNull(),
    status: privacyRequestStatusEnum("status").notNull().default("RECEIVED"),
    /** Two-letter state / territory used to pick the applicable SLA. */
    jurisdiction: varchar("jurisdiction", { length: 8 }),
    detail: text("detail"),
    outcome: text("outcome"),
    denialReason: text("denial_reason"),
    /** Due date computed at intake — 15 days for opt-outs, 45 otherwise. */
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("privacy_req_status_idx").on(t.status, t.dueAt),
    index("privacy_req_user_idx").on(t.userId, t.kind),
  ]
);

/** XPLAIN-002 — proof an AEDT notice was delivered, per user per jurisdiction. */
export const aedtNotices = pgTable(
  "aedt_notices",
  {
    id: id(),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jurisdiction: varchar("jurisdiction", { length: 8 }).notNull(),
    noticeVersion: varchar("notice_version", { length: 20 }).notNull(),
    /** Set when the notice must precede use by a fixed period (NYC: 10 business days). */
    usableFrom: timestamp("usable_from", { withTimezone: true }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("aedt_notice_unique").on(t.userId, t.jurisdiction, t.noticeVersion)]
);

/** NOTIF-001 — per-category preferences. Transactional mail is not listed and is never suppressed. */
export const notificationPrefs = pgTable("notification_prefs", {
  userId: varchar("user_id", { length: 36 })
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  newMatch: boolean("new_match").notNull().default(true),
  newMessage: boolean("new_message").notNull().default(true),
  recruiterInterest: boolean("recruiter_interest").notNull().default(true),
  applicationStatus: boolean("application_status").notNull().default(true),
  jobAlerts: boolean("job_alerts").notNull().default(false),
  productUpdates: boolean("product_updates").notNull().default(false),
  /** Lets an unsubscribe link work without a login (NOTIF-001 AC-4). */
  unsubscribeTokenHash: varchar("unsubscribe_token_hash", { length: 64 }).notNull(),
  suppressedAt: timestamp("suppressed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** LEGAL-012 / TRUST-008 — append-only audit trail. Never updated, never deleted. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    actorId: varchar("actor_id", { length: 36 }),
    action: varchar("action", { length: 80 }).notNull(),
    subjectType: varchar("subject_type", { length: 40 }),
    subjectId: varchar("subject_id", { length: 36 }),
    detail: jsonb("detail"),
    ip: varchar("ip", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_action_idx").on(t.action, t.createdAt),
    index("audit_subject_idx").on(t.subjectType, t.subjectId),
    index("audit_actor_idx").on(t.actorId, t.createdAt),
  ]
);

/** APPLY-003 — application status transitions. */
export const applicationEvents = pgTable(
  "application_events",
  {
    id: id(),
    applicationId: varchar("application_id", { length: 36 })
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    fromStatus: applicationStatusEnum("from_status"),
    toStatus: applicationStatusEnum("to_status").notNull(),
    actorId: varchar("actor_id", { length: 36 }).references(() => users.id, {
      onDelete: "set null",
    }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("app_event_idx").on(t.applicationId, t.createdAt)]
);

/**
 * MATCH-031 — voluntary EEO self-identification, for bias auditing only.
 *
 * ⚠️ NOTHING IN src/lib/matching MAY IMPORT THIS TABLE. The isolation is
 * enforced by scripts/check-prohibited-inputs.mts, which fails the build if any
 * matching module references it. See PRD MATCH-030 / MATCH-031.
 */
export const eeoSelfId = pgTable("eeo_self_id", {
  userId: varchar("user_id", { length: 36 })
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  sexCategory: varchar("sex_category", { length: 40 }),
  raceEthnicityCategory: varchar("race_ethnicity_category", { length: 60 }),
  consentVersion: varchar("consent_version", { length: 20 }).notNull(),
  collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── PRD v1.0 types ──
export type TokenPurpose = (typeof tokenPurposeEnum.enumValues)[number];
export type SeatRole = (typeof seatRoleEnum.enumValues)[number];
export type MemberStatus = (typeof memberStatusEnum.enumValues)[number];
export type InviteStatus = (typeof inviteStatusEnum.enumValues)[number];
export type ParseStatus = (typeof parseStatusEnum.enumValues)[number];
export type ReportKind = (typeof reportKindEnum.enumValues)[number];
export type ReportReason = (typeof reportReasonEnum.enumValues)[number];
export type ReportStatus = (typeof reportStatusEnum.enumValues)[number];
export type ModerationAction = (typeof moderationActionEnum.enumValues)[number];
export type PrivacyRequestKind = (typeof privacyRequestKindEnum.enumValues)[number];
export type PrivacyRequestStatus = (typeof privacyRequestStatusEnum.enumValues)[number];
export type ConsentSource = (typeof consentSourceEnum.enumValues)[number];
export type ApplicationStatus = (typeof applicationStatusEnum.enumValues)[number];
export type CompanyMember = typeof companyMembers.$inferSelect;
export type CompanyInvitation = typeof companyInvitations.$inferSelect;
export type Resume = typeof resumes.$inferSelect;
export type ResumeParse = typeof resumeParses.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type PrivacyRequest = typeof privacyRequests.$inferSelect;
export type NotificationPrefs = typeof notificationPrefs.$inferSelect;
export type AuditRow = typeof auditLog.$inferSelect;
