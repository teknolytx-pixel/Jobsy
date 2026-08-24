ALTER TABLE "job_sources" ADD COLUMN "crawl_cursor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "job_sources" ADD COLUMN "last_discovered" integer DEFAULT 0 NOT NULL;