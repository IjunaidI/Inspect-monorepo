-- INS-081 clean break (spec §9): pre-launch data is DISCARDED rather than
-- converted. Required here, not merely intended — the ALTER TABLEs below add
-- NOT NULL columns (photos.cycleIndex, photos.inspectionLoopItemId,
-- inspection_measurements.inspectionId/orgId, preset_measurement_fields.loopPresetId)
-- which Postgres refuses on a non-empty table.
--
-- CASCADE transitively reaches every table with an FK into these three. Measured
-- reach when this ran (2026-08-12) — WIDER than first assumed, because
-- Buyer.defaultLoopPresetId references loop_presets, which drags buyers and then
-- everything hanging off a buyer into the truncation:
--   EMPTIED: photos, defect_instances, defect_instance_photos,
--            inspection_measurements, inspection_loops, inspections, aql_results,
--            billable_events, reports, report_deliveries, report_accesses,
--            loop_presets, preset_loop_steps, preset_step_allowed_defects,
--            preset_measurement_fields, buyers, buyer_guests, purchase_orders
--   SURVIVED: organizations, users, suppliers, products, defect_catalog,
--             audit_logs, invitations
-- Buyers and POs must be recreated after this migration. The integration suite
-- creates its own per run, so only manual/console data needs rebuilding.
TRUNCATE TABLE
  "reports",
  "inspections",
  "loop_presets"
RESTART IDENTITY CASCADE;

-- DropForeignKey
ALTER TABLE "defect_instances" DROP CONSTRAINT "defect_instances_inspectionLoopId_fkey";

-- DropForeignKey
ALTER TABLE "inspection_loops" DROP CONSTRAINT "inspection_loops_inspectionId_orgId_fkey";

-- DropForeignKey
ALTER TABLE "inspection_loops" DROP CONSTRAINT "inspection_loops_orgId_fkey";

-- DropForeignKey
ALTER TABLE "inspection_measurements" DROP CONSTRAINT "inspection_measurements_inspectionLoopId_fkey";

-- DropForeignKey
ALTER TABLE "photos" DROP CONSTRAINT "photos_inspectionLoopId_fkey";

-- DropForeignKey
ALTER TABLE "preset_loop_steps" DROP CONSTRAINT "preset_loop_steps_loopPresetId_fkey";

-- DropForeignKey
ALTER TABLE "preset_measurement_fields" DROP CONSTRAINT "preset_measurement_fields_presetLoopStepId_fkey";

-- DropForeignKey
ALTER TABLE "preset_step_allowed_defects" DROP CONSTRAINT "preset_step_allowed_defects_defectCatalogId_fkey";

-- DropForeignKey
ALTER TABLE "preset_step_allowed_defects" DROP CONSTRAINT "preset_step_allowed_defects_presetLoopStepId_fkey";

-- DropIndex
DROP INDEX "inspection_measurements_inspectionLoopId_idx";

-- DropIndex
DROP INDEX "photos_inspectionLoopId_idx";

-- DropIndex
DROP INDEX "preset_measurement_fields_presetLoopStepId_idx";

-- DropIndex
DROP INDEX "preset_measurement_fields_presetLoopStepId_position_key";

-- AlterTable
ALTER TABLE "defect_instances" DROP COLUMN "inspectionLoopId",
ADD COLUMN     "cycleIndex" INTEGER,
ADD COLUMN     "inspectionLoopItemId" TEXT;

-- AlterTable
ALTER TABLE "inspection_measurements" DROP COLUMN "inspectionLoopId",
ADD COLUMN     "cycleIndex" INTEGER NOT NULL,
ADD COLUMN     "inspectionId" TEXT NOT NULL,
ADD COLUMN     "orgId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "photos" DROP COLUMN "inspectionLoopId",
DROP COLUMN "position",
ADD COLUMN     "cycleIndex" INTEGER NOT NULL,
ADD COLUMN     "inspectionLoopItemId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "preset_measurement_fields" DROP COLUMN "presetLoopStepId",
ADD COLUMN     "loopPresetId" TEXT NOT NULL;

-- DropTable
DROP TABLE "inspection_loops";

-- DropTable
DROP TABLE "preset_loop_steps";

-- DropTable
DROP TABLE "preset_step_allowed_defects";

-- CreateTable
CREATE TABLE "preset_loop_items" (
    "id" TEXT NOT NULL,
    "loopPresetId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "itemName" TEXT NOT NULL,
    "description" TEXT,
    "referenceImageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "preset_loop_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preset_allowed_defects" (
    "loopPresetId" TEXT NOT NULL,
    "defectCatalogId" TEXT NOT NULL,

    CONSTRAINT "preset_allowed_defects_pkey" PRIMARY KEY ("loopPresetId","defectCatalogId")
);

-- CreateTable
CREATE TABLE "inspection_loop_items" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "itemName" TEXT NOT NULL,
    "description" TEXT,
    "referenceImageUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_loop_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "preset_loop_items_loopPresetId_idx" ON "preset_loop_items"("loopPresetId");

-- CreateIndex
CREATE UNIQUE INDEX "preset_loop_items_loopPresetId_position_key" ON "preset_loop_items"("loopPresetId", "position");

-- CreateIndex
CREATE INDEX "preset_allowed_defects_defectCatalogId_idx" ON "preset_allowed_defects"("defectCatalogId");

-- CreateIndex
CREATE INDEX "inspection_loop_items_inspectionId_idx" ON "inspection_loop_items"("inspectionId");

-- CreateIndex
CREATE INDEX "inspection_loop_items_orgId_idx" ON "inspection_loop_items"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_loop_items_inspectionId_position_key" ON "inspection_loop_items"("inspectionId", "position");

-- CreateIndex
CREATE INDEX "defect_instances_inspectionId_cycleIndex_idx" ON "defect_instances"("inspectionId", "cycleIndex");

-- CreateIndex
CREATE INDEX "inspection_measurements_inspectionId_idx" ON "inspection_measurements"("inspectionId");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_measurements_inspectionId_cycleIndex_label_key" ON "inspection_measurements"("inspectionId", "cycleIndex", "label");

-- CreateIndex
CREATE INDEX "photos_inspectionLoopItemId_idx" ON "photos"("inspectionLoopItemId");

-- CreateIndex
CREATE UNIQUE INDEX "photos_inspectionLoopItemId_cycleIndex_key" ON "photos"("inspectionLoopItemId", "cycleIndex");

-- CreateIndex
CREATE INDEX "preset_measurement_fields_loopPresetId_idx" ON "preset_measurement_fields"("loopPresetId");

-- CreateIndex
CREATE UNIQUE INDEX "preset_measurement_fields_loopPresetId_position_key" ON "preset_measurement_fields"("loopPresetId", "position");

-- AddForeignKey
ALTER TABLE "preset_loop_items" ADD CONSTRAINT "preset_loop_items_loopPresetId_fkey" FOREIGN KEY ("loopPresetId") REFERENCES "loop_presets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preset_measurement_fields" ADD CONSTRAINT "preset_measurement_fields_loopPresetId_fkey" FOREIGN KEY ("loopPresetId") REFERENCES "loop_presets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preset_allowed_defects" ADD CONSTRAINT "preset_allowed_defects_loopPresetId_fkey" FOREIGN KEY ("loopPresetId") REFERENCES "loop_presets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preset_allowed_defects" ADD CONSTRAINT "preset_allowed_defects_defectCatalogId_fkey" FOREIGN KEY ("defectCatalogId") REFERENCES "defect_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_loop_items" ADD CONSTRAINT "inspection_loop_items_inspectionId_orgId_fkey" FOREIGN KEY ("inspectionId", "orgId") REFERENCES "inspections"("id", "orgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_loop_items" ADD CONSTRAINT "inspection_loop_items_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_measurements" ADD CONSTRAINT "inspection_measurements_inspectionId_orgId_fkey" FOREIGN KEY ("inspectionId", "orgId") REFERENCES "inspections"("id", "orgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_inspectionLoopItemId_fkey" FOREIGN KEY ("inspectionLoopItemId") REFERENCES "inspection_loop_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defect_instances" ADD CONSTRAINT "defect_instances_inspectionLoopItemId_fkey" FOREIGN KEY ("inspectionLoopItemId") REFERENCES "inspection_loop_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

