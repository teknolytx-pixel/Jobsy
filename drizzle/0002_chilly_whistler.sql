CREATE TYPE "public"."job_origin" AS ENUM('JOBSY_CREATED', 'RECRUITER_IMPORTED', 'EXTERNALLY_DISCOVERED');--> statement-breakpoint
CREATE TYPE "public"."relocation_willingness" AS ENUM('NONE', 'DOMESTIC', 'INTERNATIONAL');--> statement-breakpoint
CREATE TYPE "public"."remote_scope" AS ENUM('SAME_COUNTRY', 'COUNTRIES', 'STATES', 'REGION', 'WORLDWIDE');--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "country_code" varchar(2);--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "state_province" varchar(64);--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "remote_scope" "remote_scope";--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "remote_scope_countries" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "remote_scope_states" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "remote_scope_region" varchar(32);--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "remote_scope_source" varchar(16);--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "local_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "local_radius_miles" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "local_justification" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "relocation_accepted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "allowed_countries" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "excluded_countries" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "origin" "job_origin" DEFAULT 'EXTERNALLY_DISCOVERED' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "dedupe_key" varchar(191);--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "canonical_job_id" varchar(36);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "current_country" varchar(2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "current_state_province" varchar(64);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "current_city" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "search_country" varchar(2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferred_countries" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferred_regions" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferred_cities" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "international_search_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "remote_eligible_countries" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "relocation_willingness" "relocation_willingness" DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
CREATE INDEX "jobs_country_active_idx" ON "jobs" USING btree ("country_code","active");--> statement-breakpoint
CREATE INDEX "jobs_dedupe_key_idx" ON "jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "jobs_canonical_idx" ON "jobs" USING btree ("canonical_job_id");--> statement-breakpoint
CREATE INDEX "users_current_country_idx" ON "users" USING btree ("current_country");