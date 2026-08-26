-- ============================================================================
-- INS-055 · INS-014 immutability triggers, repointed at the Company columns.
--
-- A SEPARATE migration rather than an edit to 20260827000000: that one is
-- already applied, and editing an applied migration is exactly the checksum
-- drift that blocks `prisma migrate dev` later.
--
-- WHY THIS IS REQUIRED, not cosmetic: both trigger functions guard
-- `NEW."buyerId"` / `NEW."supplierId"` BY NAME. Dropping those columns does not
-- drop or invalidate the trigger — PostgreSQL resolves the record fields only
-- when the trigger FIRES — so the immutability guard began raising
--   "The column `new` does not exist in the current database"
-- on every UPDATE of a submitted inspection. The DB-backed integration suite
-- caught it as a 500 on POST /inspections/:id/decision; nothing in type-check,
-- lint or the unit suite could have.
--
-- The GUARANTEE is unchanged — only the column names move. A submitted
-- inspection's parties stay frozen and a signed report's tamper-proof columns
-- still cannot be modified. `canonicalVersion` is ADDED to the report guard: it
-- mirrors the signed payload's version marker, so it must be as immutable as the
-- rest of the envelope.
-- ============================================================================
CREATE OR REPLACE FUNCTION inspect_reports_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$

BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'reports are immutable: DELETE is not permitted (id=%)', OLD."id"
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."inspectionId"      IS DISTINCT FROM OLD."inspectionId"
     OR NEW."orgId"             IS DISTINCT FROM OLD."orgId"
     OR NEW."clientCompanyId"   IS DISTINCT FROM OLD."clientCompanyId"
     OR NEW."canonicalSnapshot" IS DISTINCT FROM OLD."canonicalSnapshot"
     OR NEW."contentHash"       IS DISTINCT FROM OLD."contentHash"
     OR NEW."signature"         IS DISTINCT FROM OLD."signature"
     OR NEW."canonicalVersion"  IS DISTINCT FROM OLD."canonicalVersion"
     OR NEW."brandingSnapshot"  IS DISTINCT FROM OLD."brandingSnapshot"
     OR NEW."verificationToken" IS DISTINCT FROM OLD."verificationToken"
     OR NEW."generatedAt"       IS DISTINCT FROM OLD."generatedAt"
  THEN
    RAISE EXCEPTION
      'report % is signed: its tamper-proof columns cannot be modified', OLD."id"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION inspect_inspections_frozen_after_submit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'DRAFT' THEN
      RETURN OLD;  -- an untouched draft may still be discarded
    END IF;
    RAISE EXCEPTION
      'inspection % is % : hard delete is not permitted (archive/supersede instead)',
      OLD."id", OLD."status" USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD."status" IN ('DRAFT', 'ASSIGNED', 'IN_PROGRESS') THEN
    RETURN NEW;  -- pre-submission edits are the normal QA workflow
  END IF;

  IF NEW."orgId"              IS DISTINCT FROM OLD."orgId"
     OR NEW."clientCompanyId"    IS DISTINCT FROM OLD."clientCompanyId"
     OR NEW."factoryCompanyId"   IS DISTINCT FROM OLD."factoryCompanyId"
     OR NEW."poId"               IS DISTINCT FROM OLD."poId"
     OR NEW."productId"          IS DISTINCT FROM OLD."productId"
     OR NEW."lotSize"            IS DISTINCT FROM OLD."lotSize"
     OR NEW."inspectionType"     IS DISTINCT FROM OLD."inspectionType"
     OR NEW."loopPresetSnapshot" IS DISTINCT FROM OLD."loopPresetSnapshot"
     OR NEW."aqlLevel"           IS DISTINCT FROM OLD."aqlLevel"
     OR NEW."aqlPlan"            IS DISTINCT FROM OLD."aqlPlan"
     OR NEW."computedSampling"   IS DISTINCT FROM OLD."computedSampling"
     OR NEW."cartonsTotal"       IS DISTINCT FROM OLD."cartonsTotal"
     OR NEW."cartonsInspected"   IS DISTINCT FROM OLD."cartonsInspected"
     OR NEW."quantityPresented"  IS DISTINCT FROM OLD."quantityPresented"
     OR NEW."quantityShortfall"  IS DISTINCT FROM OLD."quantityShortfall"
     OR NEW."workmanshipNotes"   IS DISTINCT FROM OLD."workmanshipNotes"
     OR NEW."packagingNotes"     IS DISTINCT FROM OLD."packagingNotes"
     OR NEW."tamperProof"        IS DISTINCT FROM OLD."tamperProof"
     OR NEW."submittedAt"        IS DISTINCT FROM OLD."submittedAt"
     OR NEW."supersedesInspectionId" IS DISTINCT FROM OLD."supersedesInspectionId"
  THEN
    RAISE EXCEPTION
      'inspection % is % : its evidence is frozen — correct it with a linked re-inspection',
      OLD."id", OLD."status" USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
