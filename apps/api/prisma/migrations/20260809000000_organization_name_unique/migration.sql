-- ============================================================================
-- Organization.name uniqueness (case-insensitive, trimmed).
--
-- Organization had NO uniqueness of any kind on `name`, so the admin console
-- could mint the same company twice — and did (two "Polo" orgs in the dev
-- database, created 40 seconds apart). OrgsService.create now pre-checks, but a
-- pre-check is advisory: two concurrent requests can both pass it. This index is
-- what actually makes a duplicate impossible.
--
-- Case-insensitive + trimmed so "polo", "Polo " and "POLO" all collide, which is
-- what an operator means by "that company already exists". Expressed as a raw
-- functional index because Prisma's schema DSL cannot describe one — same reason
-- and same pattern as `defect_catalog_global_name_key` in the init migration.
--
-- ⚠️ PRE-FLIGHT REQUIRED — this migration FAILS if duplicates exist. Check with:
--
--   SELECT lower(btrim("name")) AS norm, count(*), array_agg("id")
--     FROM "organizations" GROUP BY 1 HAVING count(*) > 1;
--
-- and rename or remove the losing rows first. As of 2026-08-09 the dev database
-- still has one such pair ("Polo" MANUFACTURER + "Polo" INSPECTION_COMPANY),
-- deliberately left in place, so this migration is authored but NOT yet applied.
-- ============================================================================

CREATE UNIQUE INDEX "organizations_name_lower_key"
  ON "organizations" (lower(btrim("name")));
