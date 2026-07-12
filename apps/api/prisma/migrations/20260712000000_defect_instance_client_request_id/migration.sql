-- INS-044: DefectInstance idempotency — a retried add-defect must not duplicate
-- the row (a phantom duplicate can flip the per-class AQL verdict on submit).
-- Mirrors the existing (orgId, clientRequestId) uniques on inspections + photos.

-- AlterTable
ALTER TABLE "defect_instances" ADD COLUMN     "clientRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "defect_instances_orgId_clientRequestId_key" ON "defect_instances"("orgId", "clientRequestId");
