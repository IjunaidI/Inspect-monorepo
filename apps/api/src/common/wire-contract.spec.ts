import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The wire contract must describe what the API actually SENDS (INS-086).
 *
 * Three defects of exactly one shape shipped before this test existed, and none
 * of them was visible to `tsc`, to `next build`, or to any suite:
 *
 *   - `ReportListItemDto.buyer` where the API selects `clientCompany` — the
 *     reports list rendered an em-dash in its client column for every row.
 *   - `DefectCatalogItemDto.severity` where the API sends `defaultSeverity` —
 *     every severity group on the populate screen filtered to empty, so no
 *     catalog defect could be tagged at all.
 *   - `ReportDto.generatedBy`, a relation the `Report` model has no column for
 *     — the branded report's "signed by" was always blank.
 *
 * They are invisible because `apiGet<T>(path)` ASSERTS a shape rather than
 * checking one: TypeScript happily types a response it never sees. The DTO and
 * the Prisma model are the two ends of that assertion, so this test compares
 * them directly.
 *
 * It lives in `apps/api` on purpose: the API is the producer, `schema.prisma`
 * is its source of truth, and a mismatch is the API's contract being wrong
 * about itself — not the console's problem to discover at runtime.
 *
 * A field that is legitimately not a column (a decoration, an aggregate, a
 * computed rollup) goes in DECORATIONS with a reason. Adding one is a
 * deliberate act; the point is that it cannot happen by accident.
 */

const SCHEMA = resolve(__dirname, '../../prisma/schema.prisma');
const DTOS = resolve(
  __dirname,
  '../../../../packages/shared-types/src/api-dtos.ts',
);

/** DTO interface -> the Prisma model whose rows it describes. */
const DTO_TO_MODEL: Record<string, string> = {
  LoopPresetDto: 'LoopPreset',
  LoopPresetDetailDto: 'LoopPreset',
  PresetItemDto: 'PresetLoopItem',
  MeasurementFieldDto: 'PresetMeasurementField',
  AllowedDefectDto: 'PresetAllowedDefect',
  DefectCatalogDto: 'DefectCatalog',
  UserDto: 'User',
  AqlResultDto: 'AqlResult',
  InspectionDto: 'Inspection',
  PurchaseOrderDto: 'PurchaseOrder',
  PhotoDto: 'Photo',
  DefectInstanceDto: 'DefectInstance',
  MeasurementDto: 'InspectionMeasurement',
  InspectionLoopItemDto: 'InspectionLoopItem',
  ReportDto: 'Report',
  ReportListItemDto: 'Report',
  GuestReportDto: 'Report',
  InvitationDto: 'Invitation',
  OrganizationDto: 'Organization',
};

/**
 * Fields the API adds that are not columns. Each needs a reason, because an
 * unexplained entry here is how a real mismatch gets waved through.
 */
const DECORATIONS: Record<string, string[]> = {
  // Relation counts on list rows (INS-005).
  '*': ['_count'],
  // Short-lived presigned GET decorated onto reads (INS-049/052/072).
  PhotoDto: ['viewUrl'],
  PresetItemDto: ['referenceImage'],
  GuestReportDto: ['photos'],
  // Server-computed completeness, not stored (INS-081).
  InspectionDto: ['cycleState', 'items', 'measurements'],
  InspectionLoopItemDto: ['photos', 'defects'],
  LoopPresetDetailDto: ['items', 'measurementFields', 'allowedDefects'],
  // MailService result, reported once at creation and never stored.
  InvitationDto: ['emailSent'],
};

function prismaModels(): Map<string, Set<string>> {
  const schema = readFileSync(SCHEMA, 'utf8');
  const models = new Map<string, Set<string>>();
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(schema)) !== null) {
    const fields = new Set<string>();
    for (const raw of m[2].split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('//') || line.startsWith('@@')) continue;
      const f = /^(\w+)\s+\S/.exec(line);
      if (f) fields.add(f[1]);
    }
    models.set(m[1], fields);
  }
  return models;
}

/** Top-level field names of each exported interface, ignoring nested objects. */
function dtoInterfaces(): Map<string, string[]> {
  const src = readFileSync(DTOS, 'utf8');
  const out = new Map<string, string[]>();
  const re = /export interface (\w+)(?:\s+extends\s+\w+)?\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (depth > 0 && i < src.length) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') depth -= 1;
      i += 1;
    }
    const body = src.slice(m.index + m[0].length, i - 1);
    const fields: string[] = [];
    let nest = 0;
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      if (nest === 0) {
        const f = /^(\w+)\??\s*:/.exec(line);
        if (f) fields.push(f[1]);
      }
      nest +=
        (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    }
    out.set(m[1], fields);
  }
  return out;
}

describe('wire contract: DTO fields exist on the model they describe', () => {
  const models = prismaModels();
  const interfaces = dtoInterfaces();

  it('parses both sides (guards against the regexes silently matching nothing)', () => {
    // Without this, a broken regex turns every assertion below into a vacuous
    // pass — the failure mode that makes a contract test worse than none.
    expect(models.size).toBeGreaterThan(20);
    expect(interfaces.size).toBeGreaterThan(20);
    expect(models.get('Report')).toContain('clientCompanyId');
  });

  it.each(Object.entries(DTO_TO_MODEL))(
    '%s matches %s',
    (dtoName, modelName) => {
      const fields = interfaces.get(dtoName);
      const columns = models.get(modelName);
      expect(fields).toBeDefined();
      expect(columns).toBeDefined();

      const allowed = new Set([
        ...(DECORATIONS['*'] ?? []),
        ...(DECORATIONS[dtoName] ?? []),
      ]);
      const phantom = (fields as string[]).filter(
        (f) => !(columns as Set<string>).has(f) && !allowed.has(f),
      );

      // On failure the diff names the offending fields. Either the name is wrong
      // (the ReportListItemDto.buyer class of bug) or it is a genuine decoration,
      // in which case add it to DECORATIONS above with a reason.
      expect({ dto: dtoName, model: modelName, phantom }).toEqual({
        dto: dtoName,
        model: modelName,
        phantom: [],
      });
    },
  );
});
