-- INS-097 — the capture-point library.
--
-- 1. One catalog-scope enum shared by DefectCatalog and CapturePoint. A RENAME (not
--    Prisma's drop-and-recreate) so defect_catalog rows keep their values untouched.
ALTER TYPE "DefectScope" RENAME TO "CatalogScope";

-- 2. Where on (or around) the garment a library capture point is shot.
CREATE TYPE "CapturePointCategory" AS ENUM ('OVERALL', 'TOP', 'BOTTOM', 'LABELS_TRIMS', 'PACKAGING', 'TEST', 'OTHER');

-- 3. The library: GLOBAL seeded rows (orgId NULL) + per-org custom rows.
CREATE TABLE "capture_points" (
    "id" TEXT NOT NULL,
    "scope" "CatalogScope" NOT NULL,
    "orgId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "CapturePointCategory" NOT NULL,
    "iconKey" TEXT,
    "referenceImageUrl" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capture_points_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "capture_points_orgId_name_key" ON "capture_points"("orgId", "name");
CREATE INDEX "capture_points_scope_idx" ON "capture_points"("scope");
CREATE INDEX "capture_points_orgId_idx" ON "capture_points"("orgId");
CREATE INDEX "capture_points_category_idx" ON "capture_points"("category");

ALTER TABLE "capture_points" ADD CONSTRAINT "capture_points_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Unique GLOBAL names (Postgres treats NULLs as distinct, so @@unique([orgId, name])
-- alone cannot dedupe the seeded library) — same shape as defect_catalog_global_name_key.
CREATE UNIQUE INDEX "capture_points_global_name_key" ON "capture_points" ("name") WHERE "orgId" IS NULL;

-- scope and orgId must agree: GLOBAL <=> orgId IS NULL. DefectCatalog never got this.
ALTER TABLE "capture_points" ADD CONSTRAINT "capture_points_scope_matches_org"
    CHECK (("scope" = 'GLOBAL') = ("orgId" IS NULL));

-- 4. Non-authoritative lineage from a preset item to the library row it was picked from.
--    SET NULL on delete: the item's own itemName/description remain the truth.
ALTER TABLE "preset_loop_items" ADD COLUMN "capturePointId" TEXT;
CREATE INDEX "preset_loop_items_capturePointId_idx" ON "preset_loop_items"("capturePointId");
ALTER TABLE "preset_loop_items" ADD CONSTRAINT "preset_loop_items_capturePointId_fkey" FOREIGN KEY ("capturePointId") REFERENCES "capture_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;
