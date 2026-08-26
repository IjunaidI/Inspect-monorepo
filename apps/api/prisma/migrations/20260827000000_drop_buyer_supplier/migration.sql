-- ============================================================================
-- INS-055 · Migration B — the clean break. Drops the Buyer/Supplier model.
--
-- IRREVERSIBLE. Sanctioned by the ⚠️ TEMPORARY pre-production policy in the
-- repo-root CLAUDE.md: this project has no deployment and the dev database
-- holds nothing of value. If that block has been removed by the time you read
-- this, DO NOT apply this migration as written.
--
-- Applied by `prisma migrate reset` + reseed, not by `migrate deploy`: the
-- SET NOT NULL statements below only hold on empty tables, and on a fresh
-- database every migration replays in order against no rows.
--
-- INVARIANT CHECK (spec §5.2): contains NO `UPDATE "reports"`. The Ed25519 seal
-- is never rewritten. Dropping the unsigned legacy `buyerId` COLUMN is fine —
-- columns live outside the signed envelope; canonicalSnapshot, contentHash and
-- signature are untouched.
--
-- Inspection.factoryCompanyId deliberately stays NULLABLE (SetNull), exactly as
-- supplierId was: an inspection may record no factory.
-- ============================================================================

-- DropForeignKey
ALTER TABLE "buyer_guests" DROP CONSTRAINT "buyer_guests_buyerId_orgId_fkey";

-- DropForeignKey
ALTER TABLE "buyer_guests" DROP CONSTRAINT "buyer_guests_orgId_fkey";

-- DropForeignKey
ALTER TABLE "buyers" DROP CONSTRAINT "buyers_defaultLoopPresetId_fkey";

-- DropForeignKey
ALTER TABLE "buyers" DROP CONSTRAINT "buyers_orgId_fkey";

-- DropForeignKey
ALTER TABLE "inspections" DROP CONSTRAINT "inspections_buyerId_fkey";

-- DropForeignKey
ALTER TABLE "inspections" DROP CONSTRAINT "inspections_supplierId_fkey";

-- DropForeignKey
ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_buyerId_fkey";

-- DropForeignKey
ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_supplierId_fkey";

-- DropForeignKey
ALTER TABLE "report_accesses" DROP CONSTRAINT "report_accesses_buyerGuestId_fkey";

-- DropForeignKey
ALTER TABLE "reports" DROP CONSTRAINT "reports_buyerId_fkey";

-- DropForeignKey
ALTER TABLE "suppliers" DROP CONSTRAINT "suppliers_orgId_fkey";

-- DropIndex
DROP INDEX "inspections_buyerId_idx";

-- DropIndex
DROP INDEX "purchase_orders_buyerId_idx";

-- DropIndex
DROP INDEX "purchase_orders_supplierId_idx";

-- DropIndex
DROP INDEX "report_accesses_buyerGuestId_idx";

-- DropIndex
DROP INDEX "reports_buyerId_idx";

-- AlterTable
ALTER TABLE "inspections" DROP COLUMN "buyerId",
DROP COLUMN "supplierId",
ALTER COLUMN "clientCompanyId" SET NOT NULL;

-- AlterTable
ALTER TABLE "purchase_orders" DROP COLUMN "buyerId",
DROP COLUMN "supplierId",
ALTER COLUMN "clientCompanyId" SET NOT NULL,
ALTER COLUMN "factoryCompanyId" SET NOT NULL;

-- AlterTable
ALTER TABLE "report_accesses" DROP COLUMN "buyerGuestId";

-- AlterTable
ALTER TABLE "reports" DROP COLUMN "buyerId",
ALTER COLUMN "clientCompanyId" SET NOT NULL;

-- DropTable
DROP TABLE "buyer_guests";

-- DropTable
DROP TABLE "buyers";

-- DropTable
DROP TABLE "suppliers";


-- ─────────────────────────────────────────────────────────────────────────────
-- INS-055 spec §6.6 / P5 · the business key, added BY HAND because Prisma's DSL
-- cannot express a functional or partial index.
--
-- Company names are unique per org, case- AND whitespace-insensitively, among
-- ACTIVE rows only — so archiving a company frees its name for reuse. That is a
-- small, intentional change from the old `@@unique([orgId, name])`, which was
-- case-sensitive and covered archived rows (so "Acme" and "ACME" both existed
-- legally). Follows the schema's existing partial-index practice: the init
-- migration already ships two, and organizations use the same lower(btrim())
-- shape.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "companies_org_name_ci_active_key"
  ON "companies" ("orgId", lower(btrim("name")))
  WHERE "archivedAt" IS NULL;
