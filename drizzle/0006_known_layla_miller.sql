CREATE TYPE "public"."rejection_reason" AS ENUM('SKILLS_GAP', 'EXPERIENCE_LEVEL', 'COMPENSATION_MISMATCH', 'WORK_MODEL_MISMATCH', 'LOCATION_MISMATCH', 'ROLE_FILLED', 'NOT_A_FIT_FOR_THIS_ROLE');--> statement-breakpoint
ALTER TABLE "candidate_swipes" ADD COLUMN "model_version" varchar(32);--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "model_version" varchar(32);--> statement-breakpoint
ALTER TABLE "recruiter_swipes" ADD COLUMN "rejection_reason" "rejection_reason";--> statement-breakpoint
ALTER TABLE "recruiter_swipes" ADD COLUMN "model_version" varchar(32);