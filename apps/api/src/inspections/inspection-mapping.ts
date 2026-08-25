/**
 * Pure mapping helpers for the inspection aggregate (no Prisma, no Nest) so the
 * snapshot/counting/decision logic is unit-testable without a database.
 */
import type {
  BillableEventKind,
  DefectSeverity,
  QaDecision,
} from '@inspect/shared-types';
import { DefectClass, DefectCounts } from '../aql/aql.types';

export interface SeverityRow {
  severity: DefectSeverity;
  count: number;
}

/** Fold grouped defect counts into the {critical,major,minor} shape the AQL engine wants. */
export function toDefectCounts(rows: SeverityRow[]): DefectCounts {
  const counts: Record<DefectClass, number> = {
    critical: 0,
    major: 0,
    minor: 0,
  };
  for (const row of rows) {
    if (row.severity === 'CRITICAL') counts.critical = row.count;
    else if (row.severity === 'MAJOR') counts.major = row.count;
    else if (row.severity === 'MINOR') counts.minor = row.count;
  }
  return counts;
}

export interface PresetItemLike {
  position: number;
  itemName: string;
  description?: string | null;
  referenceImageUrl?: string | null;
}
export interface PresetLike {
  id: string;
  version: number;
  items: PresetItemLike[];
  measurementFields: Array<{ label: string; unit?: string | null }>;
  allowedDefects: Array<{
    defectCatalogId: string;
    defectCatalog: { name: string; defaultSeverity: DefectSeverity };
  }>;
}

/**
 * Resolve a preset into the immutable snapshot frozen onto an Inspection — defect
 * NAMES + severities are resolved (not just FKs) so later catalog edits cannot
 * mutate a historical inspection or its signed report (spec §6/§9).
 *
 * INS-081: defects and measurement fields are LOOP-GLOBAL, so they sit beside
 * items[] rather than being duplicated into every item.
 */
export function buildPresetSnapshot(preset: PresetLike) {
  return {
    presetId: preset.id,
    version: preset.version,
    items: preset.items.map((i) => ({
      position: i.position,
      itemName: i.itemName,
      description: i.description ?? undefined,
      referenceImageUrl: i.referenceImageUrl ?? undefined,
    })),
    measurementFields: preset.measurementFields.map((m) => ({
      label: m.label,
      unit: m.unit ?? undefined,
    })),
    allowedDefects: preset.allowedDefects.map((a) => ({
      defectCatalogId: a.defectCatalogId,
      name: a.defectCatalog.name,
      severity: a.defectCatalog.defaultSeverity,
    })),
  };
}

export type BillableKind = BillableEventKind;

/**
 * INS-018 — the billable kind is a FUNCTION of the re-inspection linkage, never
 * an independent input: `BillableEvent.kind = RE_INSPECTION` iff the inspection
 * carries `supersedesInspectionId`. Keeping the derivation here (and calling it
 * from the one service path that mints the event) is what stops the two columns
 * from drifting apart while the DB has no CHECK constraint.
 */
export function billableKindFor(
  supersedesInspectionId?: string | null,
): BillableKind {
  return supersedesInspectionId ? 'RE_INSPECTION' : 'INSPECTION';
}

export type QaDecisionValue = QaDecision;
export type InspectionDecisionStatus = 'APPROVED' | 'REJECTED' | 'HOLD';

/** Map the QA Manager's binding decision to the resulting inspection status (spec §8). */
export function qaDecisionToStatus(
  decision: QaDecisionValue,
): InspectionDecisionStatus {
  if (decision === 'PASS') return 'APPROVED';
  if (decision === 'FAIL') return 'REJECTED';
  return 'HOLD';
}
