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
export const directionEnum = pgEnum("direction", ["LIKE", "PASS"]);
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
  "JSONLD", "XML_FEED",
]);

export const sourceStatusEnum = pgEnum("source_status", ["PENDING", "OK", "FAILING", "DISABLED"]);
export const remotePrefEnum = pgEnum("remote_pref", ["ONSITE", "HYBRID", "REMOTE", "ANY"]);
export const applicationStatusEnum = pgEnum("application_status", [
  "SUBMITTED",
  "REDIRECTED",
  "VIEWED",
  "INTERVIEWING",
  "REJECTED",
  "HIRED",
]);
export const emailStatusEnum = pgEnum("email_status", ["QUEUED", "SENT", "FAILED", "LOGGED_ONLY"]);
export const emailTemplateEnum = pgEnum("email_template", [
  "RECRUITER_INTEREST",
  "APPLICATION_RECEIVED",
  "MATCH_CANDIDATE",
  "MATCH_RECRUITER",
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
  source: jobSourceEnum("source").notNull().default("JOBSY"),
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

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_linkedin_sub_idx").on(t.linkedinSub),
    index("users_role_ready_idx").on(t.role, t.profileReady),
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
    skills: text("skills").array().notNull().default([]),
    perks: text("perks").array().notNull().default([]),

    applyMethod: applyMethodEnum("apply_method").notNull().default("EXTERNAL"),
    applyUrl: text("apply_url"),

    postedById: varchar("posted_by_id", { length: 36 }).references(() => users.id, {
      onDelete: "set null",
    }),

    active: boolean("active").notNull().default(true),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
    raw: jsonb("raw"),
  },
  (t) => [
    uniqueIndex("jobs_source_external_idx").on(t.source, t.externalId),
    index("jobs_active_posted_idx").on(t.active, t.postedAt),
    index("jobs_posted_by_idx").on(t.postedById),
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
export type NewJobSource = typeof jobSources.$inferInsert;
export type SourceKind = (typeof sourceKindEnum.enumValues)[number];
export type SourceStatus = (typeof sourceStatusEnum.enumValues)[number];
