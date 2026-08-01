-- ============================================================================
-- DB-level enforcement of the invariants that were previously app-layer-only.
-- Closes INS-010, INS-011, INS-014, INS-015, INS-018 and INS-046.
--
-- Context: CLAUDE.md lists seven cross-cutting domain invariants and notes that
-- several were "enforced only at the app layer today (the DB does not back them
-- yet)". This migration moves the structural ones into the database, so a bug in
-- a new write path — or a direct row mutation, which is exactly the threat the
-- tamper-proof design defends against — is rejected by Postgres rather than
-- silently corrupting a tenant boundary or a signed artifact.
--
-- Pre-flight (run against the live dev database before authoring this):
--   0 photos / inspection_loops / defect_instances / aql_results misaligned
--     with their parent's orgId
--   0 buyer_guests misaligned with their buyer's orgId
--   0 reports with a NULL canonicalSnapshot
--   0 defect_instances violating catalog-XOR-custom
--   0 billable_events whose kind disagrees with the supersedes chain
-- ...so every constraint below applies to existing data without repair.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- INS-046 · Report.canonicalSnapshot NOT NULL
-- verifyByToken() recomputes contentHash FROM this column, so a signed report
-- with a null snapshot would publicly verify as invalid forever.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "reports" ALTER COLUMN "canonicalSnapshot" SET NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- INS-010 · Composite-FK tenant guard (orgId alignment)
-- Children carried a denormalized orgId the database never checked against their
-- parent aggregate, so a bad write could attach a child to the WRONG TENANT with
-- no DB rejection. Parents now expose a composite key and children reference it.
--
-- Note: photos.inspectionLoopId and defect_instances.inspectionLoopId stay
-- single-column ON PURPOSE — they are ON DELETE SET NULL, and a composite FK
-- would have to null the NOT NULL orgId alongside the loop id.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "aql_results" DROP CONSTRAINT "aql_results_inspectionId_fkey";
ALTER TABLE "buyer_guests" DROP CONSTRAINT "buyer_guests_buyerId_fkey";
ALTER TABLE "defect_instances" DROP CONSTRAINT "defect_instances_inspectionId_fkey";
ALTER TABLE "inspection_loops" DROP CONSTRAINT "inspection_loops_inspectionId_fkey";
ALTER TABLE "photos" DROP CONSTRAINT "photos_inspectionId_fkey";

CREATE UNIQUE INDEX "aql_results_inspectionId_orgId_key" ON "aql_results"("inspectionId", "orgId");
CREATE UNIQUE INDEX "buyers_id_orgId_key" ON "buyers"("id", "orgId");
CREATE UNIQUE INDEX "inspections_id_orgId_key" ON "inspections"("id", "orgId");

ALTER TABLE "buyer_guests" ADD CONSTRAINT "buyer_guests_buyerId_orgId_fkey"
  FOREIGN KEY ("buyerId", "orgId") REFERENCES "buyers"("id", "orgId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inspection_loops" ADD CONSTRAINT "inspection_loops_inspectionId_orgId_fkey"
  FOREIGN KEY ("inspectionId", "orgId") REFERENCES "inspections"("id", "orgId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "photos" ADD CONSTRAINT "photos_inspectionId_orgId_fkey"
  FOREIGN KEY ("inspectionId", "orgId") REFERENCES "inspections"("id", "orgId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "defect_instances" ADD CONSTRAINT "defect_instances_inspectionId_orgId_fkey"
  FOREIGN KEY ("inspectionId", "orgId") REFERENCES "inspections"("id", "orgId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "aql_results" ADD CONSTRAINT "aql_results_inspectionId_orgId_fkey"
  FOREIGN KEY ("inspectionId", "orgId") REFERENCES "inspections"("id", "orgId")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- INS-015 · DefectInstance = catalog XOR custom
-- The service enforced it; any other write path could violate it. A phantom row
-- with neither (or both) set feeds the AQL class counts and can flip a binding
-- QC verdict.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "defect_instances"
  ADD CONSTRAINT "defect_instances_catalog_xor_custom"
  CHECK ((("defectCatalogId" IS NULL) <> ("customText" IS NULL)));

-- ─────────────────────────────────────────────────────────────────────────────
-- INS-011 · audit_logs is append-only
-- The hash chain detects tampering, but nothing PREVENTED it: the table accepted
-- UPDATE and DELETE, so the append-only guarantee rested entirely on caller
-- discipline. INSERT stays open; everything else is refused.
--
-- Residual risk (documented, not solvable here): a role that OWNS the table can
-- ALTER TABLE ... DISABLE TRIGGER. Full protection needs a least-privilege
-- application role that is not the table owner — see docs/reference/inspect-schema.md.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION inspect_audit_logs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'audit_logs is append-only: % is not permitted (id=%)', TG_OP, OLD."id"
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION inspect_audit_logs_append_only();

CREATE TRIGGER audit_logs_no_delete
  BEFORE DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION inspect_audit_logs_append_only();

-- ─────────────────────────────────────────────────────────────────────────────
-- INS-014 · Immutability of submitted inspections and signed reports
--
-- Deliberately COLUMN-LEVEL, not a blanket UPDATE block: the lifecycle must keep
-- moving after submission (SUBMITTED -> UNDER_REVIEW -> APPROVED -> REPORT_ISSUED)
-- and a report legitimately gains its pdfStorageKey / status / deliveredAt AFTER
-- the signing transaction commits. What must never change is the EVIDENCE.
-- ─────────────────────────────────────────────────────────────────────────────

-- Reports: the tamper-proof seal and everything it covers are frozen for life.
-- Mutable by design: pdfStorageKey (rendition attached post-commit, INS-003),
-- status and deliveredAt (delivery lifecycle, INS-020).
CREATE OR REPLACE FUNCTION inspect_reports_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'reports are immutable: DELETE is not permitted (id=%)', OLD."id"
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."inspectionId"      IS DISTINCT FROM OLD."inspectionId"
     OR NEW."orgId"             IS DISTINCT FROM OLD."orgId"
     OR NEW."buyerId"           IS DISTINCT FROM OLD."buyerId"
     OR NEW."canonicalSnapshot" IS DISTINCT FROM OLD."canonicalSnapshot"
     OR NEW."brandingSnapshot"  IS DISTINCT FROM OLD."brandingSnapshot"
     OR NEW."contentHash"       IS DISTINCT FROM OLD."contentHash"
     OR NEW."signature"         IS DISTINCT FROM OLD."signature"
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

CREATE TRIGGER reports_immutable_columns
  BEFORE UPDATE ON "reports"
  FOR EACH ROW EXECUTE FUNCTION inspect_reports_immutable();

CREATE TRIGGER reports_no_delete
  BEFORE DELETE ON "reports"
  FOR EACH ROW EXECUTE FUNCTION inspect_reports_immutable();

-- Inspections: once SUBMITTED or beyond, the inspected FACTS are frozen. The
-- status/decision machinery and the audit-ish timestamps keep moving.
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
     OR NEW."buyerId"            IS DISTINCT FROM OLD."buyerId"
     OR NEW."supplierId"         IS DISTINCT FROM OLD."supplierId"
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

CREATE TRIGGER inspections_frozen_after_submit
  BEFORE UPDATE ON "inspections"
  FOR EACH ROW EXECUTE FUNCTION inspect_inspections_frozen_after_submit();

CREATE TRIGGER inspections_no_hard_delete
  BEFORE DELETE ON "inspections"
  FOR EACH ROW EXECUTE FUNCTION inspect_inspections_frozen_after_submit();

-- The populate evidence itself: photos, defects, loops and measurements cannot be
-- added, altered or removed once their inspection is submitted. This is the
-- populate service's LOCKED status set, backed by the database.
-- The cascade from a DRAFT inspection delete still works: the parent row is gone
-- only when the parent trigger allowed it, and DRAFT is the only case it allows.
CREATE OR REPLACE FUNCTION inspect_evidence_frozen_after_submit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_inspection TEXT;
  parent_status TEXT;
BEGIN
  target_inspection := CASE
    WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ->> 'inspectionId'
    ELSE to_jsonb(NEW) ->> 'inspectionId'
  END;
  IF target_inspection IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  SELECT i."status" INTO parent_status FROM "inspections" i WHERE i."id" = target_inspection;
  -- Parent already gone (cascade from a permitted DRAFT delete): nothing to guard.
  IF parent_status IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF parent_status IN ('DRAFT', 'ASSIGNED', 'IN_PROGRESS') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  RAISE EXCEPTION
    '% on % is not permitted: inspection % is % and its evidence is frozen',
    TG_OP, TG_TABLE_NAME, target_inspection, parent_status
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER photos_frozen_after_submit
  BEFORE INSERT OR UPDATE OR DELETE ON "photos"
  FOR EACH ROW EXECUTE FUNCTION inspect_evidence_frozen_after_submit();

CREATE TRIGGER defect_instances_frozen_after_submit
  BEFORE INSERT OR UPDATE OR DELETE ON "defect_instances"
  FOR EACH ROW EXECUTE FUNCTION inspect_evidence_frozen_after_submit();

CREATE TRIGGER inspection_loops_frozen_after_submit
  BEFORE INSERT OR UPDATE OR DELETE ON "inspection_loops"
  FOR EACH ROW EXECUTE FUNCTION inspect_evidence_frozen_after_submit();

-- ─────────────────────────────────────────────────────────────────────────────
-- INS-018 · BillableEvent.kind must agree with the re-inspection chain
-- kind and Inspection.supersedesInspectionId were unrelated columns, so billing
-- and lineage could diverge with nothing to catch it: any first inspection could
-- be billed as a RE_INSPECTION.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION inspect_billable_event_matches_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  supersedes TEXT;
BEGIN
  SELECT i."supersedesInspectionId" INTO supersedes
  FROM "inspections" i WHERE i."id" = NEW."inspectionId";

  IF NEW."kind" = 'RE_INSPECTION' AND supersedes IS NULL THEN
    RAISE EXCEPTION
      'billable event for inspection % cannot be RE_INSPECTION: it supersedes nothing',
      NEW."inspectionId" USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."kind" <> 'RE_INSPECTION' AND supersedes IS NOT NULL THEN
    RAISE EXCEPTION
      'inspection % supersedes % so its billable event must be RE_INSPECTION (got %)',
      NEW."inspectionId", supersedes, NEW."kind" USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER billable_events_match_chain
  BEFORE INSERT OR UPDATE ON "billable_events"
  FOR EACH ROW EXECUTE FUNCTION inspect_billable_event_matches_chain();
