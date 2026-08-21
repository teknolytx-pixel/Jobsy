ALTER TABLE "jobs" ADD COLUMN "postal_code" varchar(12);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "current_postal_code" varchar(12);--> statement-breakpoint
CREATE INDEX "jobs_place_idx" ON "jobs" USING btree ("country_code","state_province","postal_code");