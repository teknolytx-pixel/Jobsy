-- IF NOT EXISTS, deliberately.
--
-- This value can legitimately arrive two ways: through this migration, or by
-- hand in a database console when someone needs the feature working before
-- they can run a migration. Without the guard the second path poisons the
-- first — the migration then fails with "already exists" and every LATER
-- migration is blocked behind it, which is a far worse outcome than a
-- statement that quietly does nothing.
ALTER TYPE "public"."source_kind" ADD VALUE IF NOT EXISTS 'JSONLD_CRAWL' BEFORE 'XML_FEED';
