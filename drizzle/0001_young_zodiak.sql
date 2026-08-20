CREATE TYPE "public"."consent_source" AS ENUM('EMPLOYER_SUBMITTED', 'CRAWLED');--> statement-breakpoint
CREATE TYPE "public"."invite_status" AS ENUM('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."moderation_action" AS ENUM('NONE', 'WARNED', 'CONTENT_REMOVED', 'SUSPENDED', 'BANNED');--> statement-breakpoint
CREATE TYPE "public"."parse_status" AS ENUM('PENDING', 'OK', 'FAILED', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."privacy_request_kind" AS ENUM('ACCESS', 'EXPORT', 'DELETE', 'CORRECT', 'OPT_OUT_PROFILING', 'LIMIT_SENSITIVE', 'HUMAN_REVIEW');--> statement-breakpoint
CREATE TYPE "public"."privacy_request_status" AS ENUM('RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'DENIED', 'ON_LEGAL_HOLD');--> statement-breakpoint
CREATE TYPE "public"."report_kind" AS ENUM('JOB', 'USER', 'MESSAGE', 'COMPANY');--> statement-breakpoint
CREATE TYPE "public"."report_reason" AS ENUM('SCAM_OR_FEE', 'DISCRIMINATORY', 'HARASSMENT', 'SPAM', 'GHOST_JOB', 'IMPERSONATION', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('OPEN', 'REVIEWING', 'ACTIONED', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."seat_role" AS ENUM('COMPANY_ADMIN', 'RECRUITER');--> statement-breakpoint
CREATE TYPE "public"."token_purpose" AS ENUM('VERIFY_EMAIL', 'RESET_PASSWORD', 'COMPANY_INVITE', 'DOMAIN_VERIFY', 'UNSUBSCRIBE');--> statement-breakpoint
ALTER TYPE "public"."email_template" ADD VALUE 'VERIFY_EMAIL';--> statement-breakpoint
ALTER TYPE "public"."email_template" ADD VALUE 'PASSWORD_RESET';--> statement-breakpoint
ALTER TYPE "public"."email_template" ADD VALUE 'PASSWORD_CHANGED';--> statement-breakpoint
ALTER TYPE "public"."email_template" ADD VALUE 'COMPANY_INVITE';--> statement-breakpoint
ALTER TYPE "public"."email_template" ADD VALUE 'NEW_MESSAGE';--> statement-breakpoint
ALTER TYPE "public"."email_template" ADD VALUE 'JOB_EXPIRY_WARNING';--> statement-breakpoint
ALTER TYPE "public"."email_template" ADD VALUE 'SOURCE_DISABLED';--> statement-breakpoint
ALTER TYPE "public"."email_template" ADD VALUE 'REPORT_ACKNOWLEDGED';--> statement-breakpoint
ALTER TYPE "public"."email_template" ADD VALUE 'HUMAN_REVIEW_OUTCOME';--> statement-breakpoint
ALTER TYPE "public"."email_template" ADD VALUE 'DATA_EXPORT_READY';--> statement-breakpoint
ALTER TYPE "public"."email_template" ADD VALUE 'ACCOUNT_DELETED';--> statement-breakpoint
CREATE TABLE "aedt_notices" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"jurisdiction" varchar(8) NOT NULL,
	"notice_version" varchar(20) NOT NULL,
	"usable_from" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"delivered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_events" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"application_id" varchar(36) NOT NULL,
	"from_status" "application_status",
	"to_status" "application_status" NOT NULL,
	"actor_id" varchar(36),
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"actor_id" varchar(36),
	"action" varchar(80) NOT NULL,
	"subject_type" varchar(40),
	"subject_id" varchar(36),
	"detail" jsonb,
	"ip" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"blocker_id" varchar(36) NOT NULL,
	"blocked_id" varchar(36) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_invitations" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"company_id" varchar(36) NOT NULL,
	"email" varchar(255) NOT NULL,
	"seat_role" "seat_role" DEFAULT 'RECRUITER' NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"invited_by_id" varchar(36),
	"status" "invite_status" DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_members" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"company_id" varchar(36) NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"seat_role" "seat_role" DEFAULT 'RECRUITER' NOT NULL,
	"status" "member_status" DEFAULT 'ACTIVE' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eeo_self_id" (
	"user_id" varchar(36) PRIMARY KEY NOT NULL,
	"sex_category" varchar(40),
	"race_ethnicity_category" varchar(60),
	"consent_version" varchar(20) NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_tokens" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(36),
	"email" varchar(255),
	"token_hash" varchar(64) NOT NULL,
	"purpose" "token_purpose" NOT NULL,
	"context" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_prefs" (
	"user_id" varchar(36) PRIMARY KEY NOT NULL,
	"new_match" boolean DEFAULT true NOT NULL,
	"new_message" boolean DEFAULT true NOT NULL,
	"recruiter_interest" boolean DEFAULT true NOT NULL,
	"application_status" boolean DEFAULT true NOT NULL,
	"job_alerts" boolean DEFAULT false NOT NULL,
	"product_updates" boolean DEFAULT false NOT NULL,
	"unsubscribe_token_hash" varchar(64) NOT NULL,
	"suppressed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "privacy_requests" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"kind" "privacy_request_kind" NOT NULL,
	"status" "privacy_request_status" DEFAULT 'RECEIVED' NOT NULL,
	"jurisdiction" varchar(8),
	"detail" text,
	"outcome" text,
	"denial_reason" text,
	"due_at" timestamp with time zone NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" varchar(191) PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"reporter_id" varchar(36) NOT NULL,
	"kind" "report_kind" NOT NULL,
	"target_id" varchar(36) NOT NULL,
	"reason" "report_reason" NOT NULL,
	"detail" text,
	"snapshot" jsonb NOT NULL,
	"status" "report_status" DEFAULT 'OPEN' NOT NULL,
	"action" "moderation_action" DEFAULT 'NONE' NOT NULL,
	"resolved_by_id" varchar(36),
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "resume_parses" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"resume_id" varchar(36) NOT NULL,
	"raw_text" text,
	"structured" jsonb,
	"confidence" jsonb,
	"engine" varchar(40) DEFAULT 'jobsy-local' NOT NULL,
	"engine_version" varchar(20) DEFAULT '1.0' NOT NULL,
	"applied_to_profile" boolean DEFAULT false NOT NULL,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resumes" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime" varchar(100) NOT NULL,
	"bytes" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_primary" boolean DEFAULT true NOT NULL,
	"parse_status" "parse_status" DEFAULT 'PENDING' NOT NULL,
	"parsed_at" timestamp with time zone,
	"parse_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "terms_acceptances" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"document" varchar(40) NOT NULL,
	"version" varchar(20) NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" varchar(64),
	"user_agent" text
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "email_domain" varchar(191);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "verified_method" varchar(20);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "seat_limit" integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "sponsorship_available" boolean;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "benefits_description" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "employer_supplied_pay" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "consent_source" "consent_source" DEFAULT 'CRAWLED' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "attested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "attested_by_id" varchar(36);--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "last_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "expiry_warned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "missed_syncs" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "authorized_to_work" boolean;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "requires_sponsorship" boolean;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "work_auth_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "session_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_platform_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "profiling_opt_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deletion_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "legal_hold" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "jurisdiction" varchar(8);--> statement-breakpoint
ALTER TABLE "aedt_notices" ADD CONSTRAINT "aedt_notices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_invitations" ADD CONSTRAINT "company_invitations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_invitations" ADD CONSTRAINT "company_invitations_invited_by_id_users_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eeo_self_id" ADD CONSTRAINT "eeo_self_id_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_parses" ADD CONSTRAINT "resume_parses_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms_acceptances" ADD CONSTRAINT "terms_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "aedt_notice_unique" ON "aedt_notices" USING btree ("user_id","jurisdiction","notice_version");--> statement-breakpoint
CREATE INDEX "app_event_idx" ON "application_events" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "audit_log" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "audit_subject_idx" ON "audit_log" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_log" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "block_unique" ON "blocks" USING btree ("blocker_id","blocked_id");--> statement-breakpoint
CREATE INDEX "block_blocked_idx" ON "blocks" USING btree ("blocked_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_invite_token_idx" ON "company_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "company_invite_lookup_idx" ON "company_invitations" USING btree ("company_id","email","status");--> statement-breakpoint
CREATE UNIQUE INDEX "company_member_unique" ON "company_members" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX "company_member_status_idx" ON "company_members" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "company_member_user_unique" ON "company_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_token_hash_idx" ON "email_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "email_token_user_idx" ON "email_tokens" USING btree ("user_id","purpose","expires_at");--> statement-breakpoint
CREATE INDEX "privacy_req_status_idx" ON "privacy_requests" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "privacy_req_user_idx" ON "privacy_requests" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "rate_limit_expiry_idx" ON "rate_limits" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "report_status_idx" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "report_target_idx" ON "reports" USING btree ("kind","target_id");--> statement-breakpoint
CREATE INDEX "resume_parse_resume_idx" ON "resume_parses" USING btree ("resume_id");--> statement-breakpoint
CREATE INDEX "resume_user_idx" ON "resumes" USING btree ("user_id","is_primary");--> statement-breakpoint
CREATE INDEX "terms_user_idx" ON "terms_acceptances" USING btree ("user_id","document");