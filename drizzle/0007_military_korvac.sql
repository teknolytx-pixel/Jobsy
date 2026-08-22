ALTER TABLE "jobs" ADD COLUMN "required_skills" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "preferred_skills" text[] DEFAULT '{}' NOT NULL;