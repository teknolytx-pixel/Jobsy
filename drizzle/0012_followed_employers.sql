CREATE TABLE "followed_employers" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"name" varchar(160) NOT NULL,
	"careers_url" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"last_count" integer DEFAULT 0 NOT NULL,
	"total_imported" integer DEFAULT 0 NOT NULL,
	"added_by_id" varchar(36),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "followed_employers" ADD CONSTRAINT "followed_employers_added_by_id_users_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "followed_employers_name_idx" ON "followed_employers" USING btree (lower("name"));