CREATE TYPE "public"."job_status" AS ENUM('DRAFT', 'PUBLISHED', 'PAUSED', 'CLOSED', 'ARCHIVED');--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "status" "job_status" DEFAULT 'PUBLISHED' NOT NULL;--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
-- Align existing rows. The column defaults to PUBLISHED, which would be a lie
-- for every posting already switched off — and `active` is about to be derived
-- from `status`, so a mismatch here silently resurrects dead jobs.
--
-- The two ways a job goes inactive are not the same thing:
--   • a JOBSY posting was closed by its recruiter        -> CLOSED (link stays alive)
--   • an ingested posting vanished from its source feed  -> ARCHIVED (it is gone)
UPDATE "jobs" SET "status" = 'CLOSED'   WHERE "active" = false AND "source" = 'JOBSY';--> statement-breakpoint
UPDATE "jobs" SET "status" = 'ARCHIVED' WHERE "active" = false AND "source" <> 'JOBSY';
