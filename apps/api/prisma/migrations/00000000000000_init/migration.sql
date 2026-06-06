-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrgType" AS ENUM ('INSPECTION_COMPANY', 'MANUFACTURER');

-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('INSPECTOR', 'QA_MANAGER', 'ORG_OWNER', 'PLATFORM_ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "InspectionType" AS ENUM ('PRE_SHIPMENT');

-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('DRAFT', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REPORT_ISSUED', 'REJECTED', 'HOLD');

-- CreateEnum
CREATE TYPE "AqlLevel" AS ENUM ('I', 'II', 'III', 'S1', 'S2', 'S3', 'S4');

-- CreateEnum
CREATE TYPE "DefectSeverity" AS ENUM ('CRITICAL', 'MAJOR', 'MINOR');

-- CreateEnum
CREATE TYPE "DefectScope" AS ENUM ('GLOBAL', 'ORG');

-- CreateEnum
CREATE TYPE "AqlClassOutcome" AS ENUM ('PASS', 'FAIL');

-- CreateEnum
CREATE TYPE "QaDecision" AS ENUM ('PASS', 'FAIL', 'HOLD');

-- CreateEnum
CREATE TYPE "PhotoSource" AS ENUM ('MOBILE_VERIFIED', 'MANUAL_UPLOAD');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('GENERATED', 'DELIVERED');

-- CreateEnum
CREATE TYPE "DeliveryChannel" AS ENUM ('EMAIL', 'PORTAL');

-- CreateEnum
CREATE TYPE "ReportAccessAction" AS ENUM ('VIEW', 'DOWNLOAD');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'PLATFORM_ADMIN', 'BUYER_GUEST', 'SYSTEM');

-- CreateEnum
CREATE TYPE "BillableEventKind" AS ENUM ('INSPECTION', 'RE_INSPECTION');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OrgType" NOT NULL,
    "status" "OrgStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "invitedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyers" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "branding" JSONB,
    "defaultLoopPresetId" TEXT,
    "createdByUserId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_guests" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "token" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "lastAccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buyer_guests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "gps" JSONB,
    "createdByUserId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "styleNumber" TEXT NOT NULL,
    "description" TEXT,
    "createdByUserId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "totalQuantity" INTEGER,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loop_presets" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT,
    "aqlLevel" "AqlLevel",
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loop_presets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preset_loop_steps" (
    "id" TEXT NOT NULL,
    "loopPresetId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "zoneName" TEXT NOT NULL,
    "description" TEXT,
    "referenceImageUrls" TEXT[],
    "requiredShotCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "preset_loop_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preset_measurement_fields" (
    "id" TEXT NOT NULL,
    "presetLoopStepId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "unit" TEXT,

    CONSTRAINT "preset_measurement_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preset_step_allowed_defects" (
    "presetLoopStepId" TEXT NOT NULL,
    "defectCatalogId" TEXT NOT NULL,

    CONSTRAINT "preset_step_allowed_defects_pkey" PRIMARY KEY ("presetLoopStepId","defectCatalogId")
);

-- CreateTable
CREATE TABLE "defect_catalog" (
    "id" TEXT NOT NULL,
    "scope" "DefectScope" NOT NULL,
    "orgId" TEXT,
    "name" TEXT NOT NULL,
    "defaultSeverity" "DefectSeverity" NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "defect_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspections" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "supplierId" TEXT,
    "poId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lotSize" INTEGER,
    "inspectionType" "InspectionType" NOT NULL DEFAULT 'PRE_SHIPMENT',
    "status" "InspectionStatus" NOT NULL DEFAULT 'DRAFT',
    "loopPresetId" TEXT,
    "loopPresetSnapshot" JSONB,
    "aqlLevel" "AqlLevel" NOT NULL DEFAULT 'II',
    "aqlPlan" JSONB,
    "computedSampling" JSONB,
    "cartonsTotal" INTEGER,
    "cartonsInspected" INTEGER,
    "quantityPresented" INTEGER,
    "quantityShortfall" INTEGER,
    "workmanshipNotes" TEXT,
    "packagingNotes" TEXT,
    "assignedInspectorId" TEXT,
    "tamperProof" JSONB,
    "submittedAt" TIMESTAMP(3),
    "supersedesInspectionId" TEXT,
    "clientRequestId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_loops" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "zoneName" TEXT NOT NULL,
    "description" TEXT,
    "requiredShotCount" INTEGER NOT NULL DEFAULT 1,
    "allowedDefectsSnapshot" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_loops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_measurements" (
    "id" TEXT NOT NULL,
    "inspectionLoopId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "recordedValue" TEXT,
    "unit" TEXT,
    "notes" TEXT,

    CONSTRAINT "inspection_measurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photos" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "inspectionLoopId" TEXT,
    "storageKey" TEXT NOT NULL,
    "thumbnailKey" TEXT,
    "source" "PhotoSource" NOT NULL,
    "uploaderUserId" TEXT,
    "capturedAt" TIMESTAMP(3),
    "gps" JSONB,
    "deviceId" TEXT,
    "exif" JSONB,
    "contentHash" TEXT NOT NULL,
    "annotations" JSONB,
    "position" INTEGER,
    "clientRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "defect_instances" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "inspectionLoopId" TEXT,
    "defectCatalogId" TEXT,
    "customText" TEXT,
    "severity" "DefectSeverity" NOT NULL,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "defect_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "defect_instance_photos" (
    "defectInstanceId" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,

    CONSTRAINT "defect_instance_photos_pkey" PRIMARY KEY ("defectInstanceId","photoId")
);

-- CreateTable
CREATE TABLE "aql_results" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "perClass" JSONB NOT NULL,
    "systemRecommendation" "AqlClassOutcome" NOT NULL,
    "qaDecision" "QaDecision",
    "qaRemarks" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aql_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "pdfStorageKey" TEXT,
    "brandingSnapshot" JSONB NOT NULL,
    "canonicalSnapshot" JSONB,
    "contentHash" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "verificationToken" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'GENERATED',
    "deliveredAt" TIMESTAMP(3),
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_deliveries" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "channel" "DeliveryChannel" NOT NULL,
    "recipientEmail" TEXT,
    "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_accesses" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "buyerGuestId" TEXT,
    "action" "ReportAccessAction" NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "accessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_accesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billable_events" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "kind" "BillableEventKind" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billable_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "actorUserId" TEXT,
    "actorType" "AuditActorType" NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "payloadHash" TEXT NOT NULL,
    "prevEntryHash" TEXT,
    "sequence" INTEGER NOT NULL,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_orgId_idx" ON "users"("orgId");

-- CreateIndex
CREATE INDEX "users_orgId_role_idx" ON "users"("orgId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_key" ON "invitations"("token");

-- CreateIndex
CREATE INDEX "invitations_orgId_idx" ON "invitations"("orgId");

-- CreateIndex
CREATE INDEX "invitations_token_idx" ON "invitations"("token");

-- CreateIndex
CREATE INDEX "buyers_orgId_idx" ON "buyers"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "buyers_orgId_name_key" ON "buyers"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_guests_token_key" ON "buyer_guests"("token");

-- CreateIndex
CREATE INDEX "buyer_guests_orgId_idx" ON "buyer_guests"("orgId");

-- CreateIndex
CREATE INDEX "buyer_guests_token_idx" ON "buyer_guests"("token");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_guests_buyerId_email_key" ON "buyer_guests"("buyerId", "email");

-- CreateIndex
CREATE INDEX "suppliers_orgId_idx" ON "suppliers"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_orgId_name_key" ON "suppliers"("orgId", "name");

-- CreateIndex
CREATE INDEX "products_orgId_idx" ON "products"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "products_orgId_styleNumber_key" ON "products"("orgId", "styleNumber");

-- CreateIndex
CREATE INDEX "purchase_orders_orgId_idx" ON "purchase_orders"("orgId");

-- CreateIndex
CREATE INDEX "purchase_orders_buyerId_idx" ON "purchase_orders"("buyerId");

-- CreateIndex
CREATE INDEX "purchase_orders_supplierId_idx" ON "purchase_orders"("supplierId");

-- CreateIndex
CREATE INDEX "purchase_orders_productId_idx" ON "purchase_orders"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_orgId_poNumber_key" ON "purchase_orders"("orgId", "poNumber");

-- CreateIndex
CREATE INDEX "loop_presets_orgId_idx" ON "loop_presets"("orgId");

-- CreateIndex
CREATE INDEX "loop_presets_orgId_isArchived_idx" ON "loop_presets"("orgId", "isArchived");

-- CreateIndex
CREATE UNIQUE INDEX "loop_presets_orgId_name_version_key" ON "loop_presets"("orgId", "name", "version");

-- CreateIndex
CREATE INDEX "preset_loop_steps_loopPresetId_idx" ON "preset_loop_steps"("loopPresetId");

-- CreateIndex
CREATE UNIQUE INDEX "preset_loop_steps_loopPresetId_position_key" ON "preset_loop_steps"("loopPresetId", "position");

-- CreateIndex
CREATE INDEX "preset_measurement_fields_presetLoopStepId_idx" ON "preset_measurement_fields"("presetLoopStepId");

-- CreateIndex
CREATE UNIQUE INDEX "preset_measurement_fields_presetLoopStepId_position_key" ON "preset_measurement_fields"("presetLoopStepId", "position");

-- CreateIndex
CREATE INDEX "preset_step_allowed_defects_defectCatalogId_idx" ON "preset_step_allowed_defects"("defectCatalogId");

-- CreateIndex
CREATE INDEX "defect_catalog_scope_idx" ON "defect_catalog"("scope");

-- CreateIndex
CREATE INDEX "defect_catalog_orgId_idx" ON "defect_catalog"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "defect_catalog_orgId_name_key" ON "defect_catalog"("orgId", "name");

-- CreateIndex
CREATE INDEX "inspections_orgId_idx" ON "inspections"("orgId");

-- CreateIndex
CREATE INDEX "inspections_orgId_status_idx" ON "inspections"("orgId", "status");

-- CreateIndex
CREATE INDEX "inspections_orgId_createdAt_idx" ON "inspections"("orgId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "inspections_poId_idx" ON "inspections"("poId");

-- CreateIndex
CREATE INDEX "inspections_buyerId_idx" ON "inspections"("buyerId");

-- CreateIndex
CREATE INDEX "inspections_supersedesInspectionId_idx" ON "inspections"("supersedesInspectionId");

-- CreateIndex
CREATE UNIQUE INDEX "inspections_orgId_clientRequestId_key" ON "inspections"("orgId", "clientRequestId");

-- CreateIndex
CREATE INDEX "inspection_loops_inspectionId_idx" ON "inspection_loops"("inspectionId");

-- CreateIndex
CREATE INDEX "inspection_loops_orgId_idx" ON "inspection_loops"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_loops_inspectionId_position_key" ON "inspection_loops"("inspectionId", "position");

-- CreateIndex
CREATE INDEX "inspection_measurements_inspectionLoopId_idx" ON "inspection_measurements"("inspectionLoopId");

-- CreateIndex
CREATE INDEX "photos_orgId_idx" ON "photos"("orgId");

-- CreateIndex
CREATE INDEX "photos_inspectionId_idx" ON "photos"("inspectionId");

-- CreateIndex
CREATE INDEX "photos_inspectionLoopId_idx" ON "photos"("inspectionLoopId");

-- CreateIndex
CREATE INDEX "photos_contentHash_idx" ON "photos"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "photos_orgId_clientRequestId_key" ON "photos"("orgId", "clientRequestId");

-- CreateIndex
CREATE INDEX "defect_instances_orgId_idx" ON "defect_instances"("orgId");

-- CreateIndex
CREATE INDEX "defect_instances_inspectionId_idx" ON "defect_instances"("inspectionId");

-- CreateIndex
CREATE INDEX "defect_instances_inspectionId_severity_idx" ON "defect_instances"("inspectionId", "severity");

-- CreateIndex
CREATE INDEX "defect_instance_photos_photoId_idx" ON "defect_instance_photos"("photoId");

-- CreateIndex
CREATE UNIQUE INDEX "aql_results_inspectionId_key" ON "aql_results"("inspectionId");

-- CreateIndex
CREATE INDEX "aql_results_orgId_idx" ON "aql_results"("orgId");

-- CreateIndex
CREATE INDEX "aql_results_orgId_qaDecision_idx" ON "aql_results"("orgId", "qaDecision");

-- CreateIndex
CREATE UNIQUE INDEX "reports_inspectionId_key" ON "reports"("inspectionId");

-- CreateIndex
CREATE UNIQUE INDEX "reports_verificationToken_key" ON "reports"("verificationToken");

-- CreateIndex
CREATE INDEX "reports_orgId_idx" ON "reports"("orgId");

-- CreateIndex
CREATE INDEX "reports_buyerId_idx" ON "reports"("buyerId");

-- CreateIndex
CREATE INDEX "reports_verificationToken_idx" ON "reports"("verificationToken");

-- CreateIndex
CREATE INDEX "report_deliveries_reportId_idx" ON "report_deliveries"("reportId");

-- CreateIndex
CREATE INDEX "report_accesses_reportId_idx" ON "report_accesses"("reportId");

-- CreateIndex
CREATE INDEX "report_accesses_buyerGuestId_idx" ON "report_accesses"("buyerGuestId");

-- CreateIndex
CREATE UNIQUE INDEX "billable_events_inspectionId_key" ON "billable_events"("inspectionId");

-- CreateIndex
CREATE INDEX "billable_events_orgId_idx" ON "billable_events"("orgId");

-- CreateIndex
CREATE INDEX "audit_logs_orgId_createdAt_idx" ON "audit_logs"("orgId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_idx" ON "audit_logs"("actorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_orgId_sequence_key" ON "audit_logs"("orgId", "sequence");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyers" ADD CONSTRAINT "buyers_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyers" ADD CONSTRAINT "buyers_defaultLoopPresetId_fkey" FOREIGN KEY ("defaultLoopPresetId") REFERENCES "loop_presets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_guests" ADD CONSTRAINT "buyer_guests_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "buyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_guests" ADD CONSTRAINT "buyer_guests_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loop_presets" ADD CONSTRAINT "loop_presets_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loop_presets" ADD CONSTRAINT "loop_presets_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preset_loop_steps" ADD CONSTRAINT "preset_loop_steps_loopPresetId_fkey" FOREIGN KEY ("loopPresetId") REFERENCES "loop_presets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preset_measurement_fields" ADD CONSTRAINT "preset_measurement_fields_presetLoopStepId_fkey" FOREIGN KEY ("presetLoopStepId") REFERENCES "preset_loop_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preset_step_allowed_defects" ADD CONSTRAINT "preset_step_allowed_defects_presetLoopStepId_fkey" FOREIGN KEY ("presetLoopStepId") REFERENCES "preset_loop_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preset_step_allowed_defects" ADD CONSTRAINT "preset_step_allowed_defects_defectCatalogId_fkey" FOREIGN KEY ("defectCatalogId") REFERENCES "defect_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defect_catalog" ADD CONSTRAINT "defect_catalog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_poId_fkey" FOREIGN KEY ("poId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_loopPresetId_fkey" FOREIGN KEY ("loopPresetId") REFERENCES "loop_presets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_assignedInspectorId_fkey" FOREIGN KEY ("assignedInspectorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_supersedesInspectionId_fkey" FOREIGN KEY ("supersedesInspectionId") REFERENCES "inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_loops" ADD CONSTRAINT "inspection_loops_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_loops" ADD CONSTRAINT "inspection_loops_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_measurements" ADD CONSTRAINT "inspection_measurements_inspectionLoopId_fkey" FOREIGN KEY ("inspectionLoopId") REFERENCES "inspection_loops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_inspectionLoopId_fkey" FOREIGN KEY ("inspectionLoopId") REFERENCES "inspection_loops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_uploaderUserId_fkey" FOREIGN KEY ("uploaderUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defect_instances" ADD CONSTRAINT "defect_instances_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defect_instances" ADD CONSTRAINT "defect_instances_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defect_instances" ADD CONSTRAINT "defect_instances_inspectionLoopId_fkey" FOREIGN KEY ("inspectionLoopId") REFERENCES "inspection_loops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defect_instances" ADD CONSTRAINT "defect_instances_defectCatalogId_fkey" FOREIGN KEY ("defectCatalogId") REFERENCES "defect_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defect_instance_photos" ADD CONSTRAINT "defect_instance_photos_defectInstanceId_fkey" FOREIGN KEY ("defectInstanceId") REFERENCES "defect_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defect_instance_photos" ADD CONSTRAINT "defect_instance_photos_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "photos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aql_results" ADD CONSTRAINT "aql_results_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aql_results" ADD CONSTRAINT "aql_results_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aql_results" ADD CONSTRAINT "aql_results_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_deliveries" ADD CONSTRAINT "report_deliveries_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_accesses" ADD CONSTRAINT "report_accesses_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_accesses" ADD CONSTRAINT "report_accesses_buyerGuestId_fkey" FOREIGN KEY ("buyerGuestId") REFERENCES "buyer_guests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billable_events" ADD CONSTRAINT "billable_events_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billable_events" ADD CONSTRAINT "billable_events_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─────────────────────────────────────────────
-- Partial unique indexes (cannot be expressed in schema.prisma).
-- Postgres treats NULLs as distinct, so @@unique([orgId, ...]) does not dedupe
-- rows where orgId IS NULL. These enforce uniqueness for those rows.
-- ─────────────────────────────────────────────

-- Unique GLOBAL defect names (orgId IS NULL) — the seeded common-defect library.
CREATE UNIQUE INDEX "defect_catalog_global_name_key" ON "defect_catalog" ("name") WHERE "orgId" IS NULL;

-- Single deterministic sequence space for platform-level audit entries (orgId IS NULL),
-- preserving the hash-chain order for cross-tenant/platform events.
CREATE UNIQUE INDEX "audit_logs_platform_sequence_key" ON "audit_logs" ("sequence") WHERE "orgId" IS NULL;
