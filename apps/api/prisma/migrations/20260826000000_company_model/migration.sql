-- ============================================================================
-- INS-055 · Migration A — ADDITIVE. Company + CompanyGuest + the two-party
-- role edges. Nothing is renamed, nothing is dropped, NOTHING IS BACKFILLED.
--
-- Why no backfill: the repo-root CLAUDE.md declares this a pre-production
-- project whose database holds nothing of value, so the 1:1 Buyer/Supplier ->
-- Company backfill, the lineage columns and the human-adjudicated dedupe that
-- the original 10-phase plan carried have all been deleted. Rows are not worth
-- preserving; the correct end-state design is.
--
-- The legacy buyerId / supplierId columns are relaxed to NULLABLE rather than
-- dropped, so each consumer can stop writing them one task at a time and every
-- task still ships green. They are dropped, and the new FKs tightened to NOT
-- NULL, by 20260827000000_drop_buyer_supplier.
--
-- AuditActorType.BUYER_GUEST -> COMPANY_GUEST is a pure vocabulary fix: the
-- value was declared in three places and emitted by none (actorTypeFor returns
-- only USER, PLATFORM_ADMIN or SYSTEM), so no row can hold it and the enum
-- recreation below cannot fail on existing data.
--
-- INVARIANT CHECK (spec §5.2): this migration contains NO `UPDATE "reports"`.
-- reports.canonicalSnapshot / contentHash / signature are the Ed25519 seal and
-- are never rewritten — not to normalize, not to backfill the version marker.
-- `canonicalVersion` is added as a NEW, UNSIGNED column; the authority remains
-- the marker inside the signed payload.
-- ============================================================================

-- CreateEnum
CREATE TYPE "CompanyKind" AS ENUM ('INTERNAL', 'THIRD_PARTY');

-- AlterEnum
BEGIN;
CREATE TYPE "AuditActorType_new" AS ENUM ('USER', 'PLATFORM_ADMIN', 'COMPANY_GUEST', 'SYSTEM');
ALTER TABLE "audit_logs" ALTER COLUMN "actorType" TYPE "AuditActorType_new" USING ("actorType"::text::"AuditActorType_new");
ALTER TYPE "AuditActorType" RENAME TO "AuditActorType_old";
ALTER TYPE "AuditActorType_new" RENAME TO "AuditActorType";
DROP TYPE "public"."AuditActorType_old";
COMMIT;

-- AlterTable
ALTER TABLE "inspections" ADD COLUMN     "clientCompanyId" TEXT,
ADD COLUMN     "factoryCompanyId" TEXT,
ALTER COLUMN "buyerId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "clientCompanyId" TEXT,
ADD COLUMN     "factoryCompanyId" TEXT,
ALTER COLUMN "buyerId" DROP NOT NULL,
ALTER COLUMN "supplierId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "report_accesses" ADD COLUMN     "companyGuestId" TEXT;

-- AlterTable
ALTER TABLE "reports" ADD COLUMN     "canonicalVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "clientCompanyId" TEXT,
ALTER COLUMN "buyerId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CompanyKind" NOT NULL DEFAULT 'THIRD_PARTY',
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "branding" JSONB,
    "defaultLoopPresetId" TEXT,
    "address" TEXT,
    "gps" JSONB,
    "createdByUserId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_guests" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "token" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "lastAccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_guests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "companies_orgId_idx" ON "companies"("orgId");

-- CreateIndex
CREATE INDEX "companies_orgId_name_idx" ON "companies"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "companies_id_orgId_key" ON "companies"("id", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "company_guests_token_key" ON "company_guests"("token");

-- CreateIndex
CREATE INDEX "company_guests_orgId_idx" ON "company_guests"("orgId");

-- CreateIndex
CREATE INDEX "company_guests_token_idx" ON "company_guests"("token");

-- CreateIndex
CREATE UNIQUE INDEX "company_guests_companyId_email_key" ON "company_guests"("companyId", "email");

-- CreateIndex
CREATE INDEX "inspections_clientCompanyId_idx" ON "inspections"("clientCompanyId");

-- CreateIndex
CREATE INDEX "purchase_orders_clientCompanyId_idx" ON "purchase_orders"("clientCompanyId");

-- CreateIndex
CREATE INDEX "purchase_orders_factoryCompanyId_idx" ON "purchase_orders"("factoryCompanyId");

-- CreateIndex
CREATE INDEX "report_accesses_companyGuestId_idx" ON "report_accesses"("companyGuestId");

-- CreateIndex
CREATE INDEX "reports_clientCompanyId_idx" ON "reports"("clientCompanyId");

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_defaultLoopPresetId_fkey" FOREIGN KEY ("defaultLoopPresetId") REFERENCES "loop_presets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_guests" ADD CONSTRAINT "company_guests_companyId_orgId_fkey" FOREIGN KEY ("companyId", "orgId") REFERENCES "companies"("id", "orgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_guests" ADD CONSTRAINT "company_guests_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_clientCompanyId_fkey" FOREIGN KEY ("clientCompanyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_factoryCompanyId_fkey" FOREIGN KEY ("factoryCompanyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_clientCompanyId_fkey" FOREIGN KEY ("clientCompanyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_factoryCompanyId_fkey" FOREIGN KEY ("factoryCompanyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_clientCompanyId_fkey" FOREIGN KEY ("clientCompanyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_accesses" ADD CONSTRAINT "report_accesses_companyGuestId_fkey" FOREIGN KEY ("companyGuestId") REFERENCES "company_guests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

