/**
 * Pure mapping helpers for the inspection aggregate (no Prisma, no Nest) so the
 * snapshot/counting/decision logic is unit-testable without a database.
 */
import { DefectClass, DefectCounts } from '../aql/aql.types';

export interface SeverityRow {
  severity: 'CRITICAL' | 'MAJOR' | 'MINOR';
  count: number;
}

/** Fold grouped defect counts into the {critical,major,minor} shape the AQL engine wants. */
export function toDefectCounts(rows: SeverityRow[]): DefectCounts {
  const counts: Record<DefectClass, number> = { critical: 0, major: 0, minor: 0 };
  for (const row of rows) {
    if (row.severity === 'CRITICAL') counts.critical = row.count;
    else if (row.severity === 'MAJOR') counts.major = row.count;
    else if (row.severity === 'MINOR') counts.minor = row.count;
  }
  return counts;
}

export interface PresetStepLike {
  position: number;
  zoneName: string;
  description?: string | null;
  referenceImageUrls: string[];
  requiredShotCount: number;
  measurementFields: Array<{ label: string; unit?: string | null }>;
  allowedDefects: Array<{
    defectCatalogId: string;
    defectCatalog: { name: string; defaultSeverity: 'CRITICAL' | 'MAJOR' | 'MINOR' };
  }>;
}
export interface PresetLike {
  id: string;
  version: number;
  steps: PresetStepLike[];
}

/**
 * Resolve a preset into the immutable snapshot frozen onto an Inspection — defect
 * NAMES + severities are resolved (not just FKs) so later catalog edits cannot
 * mutate a historical inspection or its signed report (spec §6/§9).
 */
export function buildPresetSnapshot(preset: PresetLike) {
  return {
    presetId: preset.id,
    version: preset.version,
    steps: preset.steps.map((s) => ({
      position: s.position,
      zoneName: s.zoneName,
      requiredShotCount: s.requiredShotCount,
      referenceImageUrls: s.referenceImageUrls,
      measurementFields: s.measurementFields.map((m) => ({
        label: m.label,
        unit: m.unit ?? undefined,
      })),
      allowedDefects: s.allowedDefects.map((a) => ({
        defectCatalogId: a.defectCatalogId,
        name: a.defectCatalog.name,
        severity: a.defectCatalog.defaultSeverity,
      })),
    })),
  };
}

export type QaDecisionValue = 'PASS' | 'FAIL' | 'HOLD';
export type InspectionDecisionStatus = 'APPROVED' | 'REJECTED' | 'HOLD';

/** Map the QA Manager's binding decision to the resulting inspection status (spec §8). */
export function qaDecisionToStatus(decision: QaDecisionValue): InspectionDecisionStatus {
  if (decision === 'PASS') return 'APPROVED';
  if (decision === 'FAIL') return 'REJECTED';
  return 'HOLD';
}
