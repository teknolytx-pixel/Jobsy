CREATE TYPE "public"."application_status" AS ENUM('SUBMITTED', 'REDIRECTED', 'VIEWED', 'INTERVIEWING', 'REJECTED', 'HIRED');--> statement-breakpoint
CREATE TYPE "public"."apply_method" AS ENUM('EASY', 'EXTERNAL');--> statement-breakpoint
CREATE TYPE "public"."direction" AS ENUM('LIKE', 'PASS');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('QUEUED', 'SENT', 'FAILED', 'LOGGED_ONLY');--> statement-breakpoint
CREATE TYPE "public"."email_template" AS ENUM('RECRUITER_INTEREST', 'APPLICATION_RECEIVED', 'MATCH_CANDIDATE', 'MATCH_RECRUITER');--> statement-breakpoint
CREATE TYPE "public"."job_source" AS ENUM('JOBSY', 'GREENHOUSE', 'LEVER', 'ASHBY', 'ADZUNA', 'JSEARCH', 'JOOBLE', 'CAREERJET', 'REMOTIVE', 'ARBEITNOW', 'WORKABLE', 'SMARTRECRUITERS', 'RECRUITEE', 'PERSONIO', 'BAMBOOHR', 'WORKDAY', 'CAREER_SITE', 'XML_FEED', 'LINKEDIN');--> statement-breakpoint
CREATE TYPE "public"."remote_pref" AS ENUM('ONSITE', 'HYBRID', 'REMOTE', 'ANY');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('CANDIDATE', 'RECRUITER', 'BOTH');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('GREENHOUSE', 'LEVER', 'ASHBY', 'WORKABLE', 'SMARTRECRUITERS', 'RECRUITEE', 'PERSONIO', 'BAMBOOHR', 'WORKDAY', 'JSONLD', 'XML_FEED');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('PENDING', 'OK', 'FAILING', 'DISABLED');--> statement-breakpoint
CREATE TABLE "applications" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"candidate_id" varchar(36) NOT NULL,
	"job_id" varchar(36) NOT NULL,
	"method" "apply_method" NOT NULL,
	"status" "application_status" DEFAULT 'SUBMITTED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_swipes" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"candidate_id" varchar(36) NOT NULL,
	"job_id" varchar(36) NOT NULL,
	"direction" "direction" NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" varchar(80) NOT NULL,
	"website" text,
	"logo_url" text,
	"source" "job_source" DEFAULT 'JOBSY' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "email_logs" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"to_address" varchar(255) NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"template" "email_template" NOT NULL,
	"status" "email_status" DEFAULT 'QUEUED' NOT NULL,
	"provider_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_runs" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"source" "job_source" NOT NULL,
	"board" text,
	"source_id" varchar(36),
	"fetched" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "job_sources" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"kind" "source_kind" NOT NULL,
	"token" text NOT NULL,
	"company_name" text NOT NULL,
	"careers_url" text,
	"auto_detected" boolean DEFAULT false NOT NULL,
	"detected_via" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" "source_status" DEFAULT 'PENDING' NOT NULL,
	"last_error" text,
	"last_run_at" timestamp with time zone,
	"last_job_count" integer DEFAULT 0 NOT NULL,
	"total_imported" integer DEFAULT 0 NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"added_by_id" varchar(36),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"source" "job_source" NOT NULL,
	"external_id" varchar(191),
	"source_url" text,
	"publisher" text,
	"title" text NOT NULL,
	"company_id" varchar(36) NOT NULL,
	"location" text NOT NULL,
	"remote" "remote_pref" DEFAULT 'ONSITE' NOT NULL,
	"employment_type" text DEFAULT 'Full-time' NOT NULL,
	"seniority" text DEFAULT 'Mid' NOT NULL,
	"salary_min" integer,
	"salary_max" integer,
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"description" text NOT NULL,
	"skills" text[] DEFAULT '{}' NOT NULL,
	"perks" text[] DEFAULT '{}' NOT NULL,
	"apply_method" "apply_method" DEFAULT 'EXTERNAL' NOT NULL,
	"apply_url" text,
	"posted_by_id" varchar(36),
	"active" boolean DEFAULT true NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"job_id" varchar(36) NOT NULL,
	"candidate_id" varchar(36) NOT NULL,
	"recruiter_id" varchar(36) NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"match_id" varchar(36) NOT NULL,
	"sender_id" varchar(36) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruiter_swipes" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"recruiter_id" varchar(36) NOT NULL,
	"job_id" varchar(36) NOT NULL,
	"candidate_id" varchar(36) NOT NULL,
	"direction" "direction" NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"image" text,
	"role" "role" DEFAULT 'CANDIDATE' NOT NULL,
	"linkedin_sub" varchar(128),
	"linkedin_linked_at" timestamp with time zone,
	"email_verified" boolean DEFAULT false NOT NULL,
	"headline" text,
	"bio" text,
	"location" text,
	"remote_pref" "remote_pref" DEFAULT 'ANY' NOT NULL,
	"years_exp" integer DEFAULT 0 NOT NULL,
	"salary_target" integer,
	"availability" text,
	"skills" text[] DEFAULT '{}' NOT NULL,
	"open_to_offers" boolean DEFAULT true NOT NULL,
	"profile_ready" boolean DEFAULT false NOT NULL,
	"company_id" varchar(36),
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_candidate_id_users_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_swipes" ADD CONSTRAINT "candidate_swipes_candidate_id_users_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_swipes" ADD CONSTRAINT "candidate_swipes_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_runs" ADD CONSTRAINT "ingest_runs_source_id_job_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."job_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_sources" ADD CONSTRAINT "job_sources_added_by_id_users_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_posted_by_id_users_id_fk" FOREIGN KEY ("posted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_candidate_id_users_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_recruiter_id_users_id_fk" FOREIGN KEY ("recruiter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruiter_swipes" ADD CONSTRAINT "recruiter_swipes_recruiter_id_users_id_fk" FOREIGN KEY ("recruiter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruiter_swipes" ADD CONSTRAINT "recruiter_swipes_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruiter_swipes" ADD CONSTRAINT "recruiter_swipes_candidate_id_users_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "application_unique" ON "applications" USING btree ("candidate_id","job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cand_swipe_unique" ON "candidate_swipes" USING btree ("candidate_id","job_id");--> statement-breakpoint
CREATE INDEX "cand_swipe_job_idx" ON "candidate_swipes" USING btree ("job_id","direction");--> statement-breakpoint
CREATE INDEX "email_to_idx" ON "email_logs" USING btree ("to_address","created_at");--> statement-breakpoint
CREATE INDEX "ingest_source_idx" ON "ingest_runs" USING btree ("source","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_source_unique" ON "job_sources" USING btree ("kind","token");--> statement-breakpoint
CREATE INDEX "job_source_enabled_idx" ON "job_sources" USING btree ("enabled","last_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_source_external_idx" ON "jobs" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "jobs_active_posted_idx" ON "jobs" USING btree ("active","posted_at");--> statement-breakpoint
CREATE INDEX "jobs_posted_by_idx" ON "jobs" USING btree ("posted_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "match_unique" ON "matches" USING btree ("job_id","candidate_id");--> statement-breakpoint
CREATE INDEX "match_cand_idx" ON "matches" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "match_rec_idx" ON "matches" USING btree ("recruiter_id");--> statement-breakpoint
CREATE INDEX "message_thread_idx" ON "messages" USING btree ("match_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rec_swipe_unique" ON "recruiter_swipes" USING btree ("job_id","candidate_id");--> statement-breakpoint
CREATE INDEX "rec_swipe_cand_idx" ON "recruiter_swipes" USING btree ("candidate_id","direction");--> statement-breakpoint
CREATE UNIQUE INDEX "users_linkedin_sub_idx" ON "users" USING btree ("linkedin_sub");--> statement-breakpoint
CREATE INDEX "users_role_ready_idx" ON "users" USING btree ("role","profile_ready");