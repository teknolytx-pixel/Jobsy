CREATE TYPE "public"."candidate_source_kind" AS ENUM('GREENHOUSE', 'LEVER', 'ASHBY', 'WORKABLE', 'DICE', 'MONSTER', 'ZIPRECRUITER', 'INDEED_RESUME', 'NAUKRI', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."candidate_state" AS ENUM('IMPORTED', 'NOTIFIED', 'CLAIMED', 'SUPPRESSED');--> statement-breakpoint
CREATE TYPE "public"."lawful_basis" AS ENUM('APPLICATION', 'LICENSED', 'LEGITIMATE_INTEREST', 'CONSENT');--> statement-breakpoint
CREATE TABLE "candidate_sources" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"kind" "candidate_source_kind" NOT NULL,
	"company_id" varchar(36) NOT NULL,
	"token" varchar(191) NOT NULL,
	"label" varchar(120) NOT NULL,
	"secret" text,
	"lawful_basis" "lawful_basis" DEFAULT 'APPLICATION' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" "source_status" DEFAULT 'PENDING' NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"last_count" integer DEFAULT 0 NOT NULL,
	"total_imported" integer DEFAULT 0 NOT NULL,
	"sync_cursor" integer DEFAULT 0 NOT NULL,
	"added_by_id" varchar(36),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sourced_candidates" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"source_id" varchar(36) NOT NULL,
	"company_id" varchar(36) NOT NULL,
	"external_id" varchar(191) NOT NULL,
	"state" "candidate_state" DEFAULT 'IMPORTED' NOT NULL,
	"lawful_basis" "lawful_basis" NOT NULL,
	"first_name" varchar(120),
	"last_name" varchar(120),
	"email" varchar(255),
	"phone" varchar(60),
	"headline" varchar(200),
	"location" varchar(160),
	"skills" text[] DEFAULT '{}' NOT NULL,
	"resume_text" text,
	"resume_url" text,
	"preferred_channel" varchar(40),
	"preferred_handle" text,
	"notice_sent_at" timestamp with time zone,
	"notice_channel" varchar(40),
	"claim_token" varchar(80),
	"claimed_user_id" varchar(36),
	"claimed_at" timestamp with time zone,
	"suppressed_at" timestamp with time zone,
	"suppressed_reason" varchar(120),
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidate_sources" ADD CONSTRAINT "candidate_sources_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_sources" ADD CONSTRAINT "candidate_sources_added_by_id_users_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourced_candidates" ADD CONSTRAINT "sourced_candidates_source_id_candidate_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."candidate_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourced_candidates" ADD CONSTRAINT "sourced_candidates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourced_candidates" ADD CONSTRAINT "sourced_candidates_claimed_user_id_users_id_fk" FOREIGN KEY ("claimed_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_sources_company_kind_token_idx" ON "candidate_sources" USING btree ("company_id","kind","token");--> statement-breakpoint
CREATE INDEX "candidate_sources_company_idx" ON "candidate_sources" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sourced_candidates_source_external_idx" ON "sourced_candidates" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "sourced_candidates_company_state_idx" ON "sourced_candidates" USING btree ("company_id","state");--> statement-breakpoint
CREATE INDEX "sourced_candidates_email_idx" ON "sourced_candidates" USING btree ("email");