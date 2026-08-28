CREATE TABLE "candidate_profiles" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"label" varchar(80) NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"headline" text,
	"skills" text[] DEFAULT '{}' NOT NULL,
	"years_exp" integer DEFAULT 0 NOT NULL,
	"salary_target" integer,
	"availability" text,
	"bio" text,
	"resume_id" varchar(36),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "candidate_profiles_user_idx" ON "candidate_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_profiles_one_primary_idx" ON "candidate_profiles" USING btree ("user_id") WHERE "candidate_profiles"."is_primary";--> statement-breakpoint
-- BACKFILL — every existing candidate keeps matching exactly as before.
--
-- The engine reads its inputs from `users`, and this release makes the primary
-- profile the source of truth for those fields. A candidate with no profile row
-- would therefore have nothing to promote and nothing to sync back, and the
-- next profile save would blank their skills.
--
-- So each existing candidate gets one profile built from what they already
-- have, marked primary. The `users` columns are left untouched: they are now
-- the mirror, and they already hold exactly what the mirror should contain.
INSERT INTO "candidate_profiles"
  ("id", "user_id", "label", "is_primary", "headline", "skills", "years_exp",
   "salary_target", "availability", "bio", "created_at", "updated_at")
SELECT
  gen_random_uuid()::text,
  u."id",
  'General',
  true,
  u."headline",
  u."skills",
  COALESCE(u."years_exp", 0),
  u."salary_target",
  u."availability",
  u."bio",
  now(),
  now()
FROM "users" u
WHERE u."role" = 'CANDIDATE'
  AND NOT EXISTS (SELECT 1 FROM "candidate_profiles" p WHERE p."user_id" = u."id");
