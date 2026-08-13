# Loop Items + Populate Cycles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the loop model so a preset *is* one loop of ordered single-image items, and populate walks those items repeatedly — one cycle per inspected unit — with an end gate that only opens on a cycle boundary.

**Architecture:** A cycle is not a table. `PresetLoopStep`/`InspectionLoop` become `PresetLoopItem`/`InspectionLoopItem` (one row per capture point), and `Photo`/`DefectInstance`/`InspectionMeasurement` carry a `cycleIndex`. `@@unique([inspectionLoopItemId, cycleIndex])` makes "one image per slot" a database guarantee. A pure `cycleState()` helper computes completeness and is shared by the submit guard and the populate UI, so the API's rule and the screen's rule cannot drift.

**Tech Stack:** NestJS 11, Prisma 6 (Postgres 16), Jest, Next.js 15 App Router, React 19.

**Spec:** [docs/in-progress/specs/2026-08-12-loop-items-and-populate-cycles-design.md](../specs/2026-08-12-loop-items-and-populate-cycles-design.md) (INS-081)

## Global Constraints

- **Vocabulary, verbatim:** a **loop** is the preset; a **loop item** is one capture point taking exactly one image; a **cycle**/**unit** is one pass over every item. UI says "Add Loop Item", "Items · N", "Unit 7 of 32". Never "step", "zone", or "shot".
- `cycleIndex` is **0-based in storage**, rendered **1-based** ("Unit 7" = `cycleIndex` 6).
- `cycleIndex` values may have **gaps** after a discard. They are stable identifiers, not ordinals. A new cycle takes `max(existing) + 1`.
- **Tenant isolation:** every tenant-scoped query stays filtered by `orgId`; the composite tenant-aligned FKs added in INS-010 are preserved verbatim on every renamed model.
- **Audit:** every new write path appends one `AuditLog` row **inside the same transaction**. New actions: `populate.photoRetaken`, `populate.cycleDiscarded`.
- **Populate is `@Roles('PLATFORM_ADMIN')`** — the whole controller already is; new routes inherit it. Preset routes stay `@Roles('QA_MANAGER')`.
- Only AQL **General Level II** is supported; the existing 400 guard stays.
- **Red-window warning:** Tasks 2–6 rewrite the schema and every consumer. `pnpm type-check` is **expected to fail** from the end of Task 2 until Task 7 Step 1. Each of those tasks is gated by its own Jest specs, not by a repo-wide build. Task 7 restores a green tree and is the real integration gate. Do not "fix" intermediate red by stubbing.
- Run commands from the repo root. If `pnpm` is not on PATH, use `npx -y pnpm@9.12.0 <cmd>`.

---

### Task 1: `cycleState` — the pure completeness rule

No database, no Nest. This is the rule both the submit guard (Task 4) and the populate screen (Task 9) obey.

**Files:**
- Create: `apps/api/src/inspections/cycle-state.ts`
- Test: `apps/api/src/inspections/cycle-state.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `cycleState(items, photos) → CycleState`, plus the exported types `CycleItem`, `CyclePhotoRef`, `PartialCycle`, `NextSlot`, `CycleState`. Tasks 4, 5, 6 and 9 all import from this module.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/inspections/cycle-state.spec.ts`:

```ts
import { cycleState, type CycleItem, type CyclePhotoRef } from './cycle-state';

const ITEMS: CycleItem[] = [
  { id: 'a', position: 1 },
  { id: 'b', position: 2 },
  { id: 'c', position: 3 },
];
const shot = (id: string, cycleIndex: number): CyclePhotoRef => ({
  inspectionLoopItemId: id,
  cycleIndex,
});

describe('cycleState', () => {
  it('returns an empty state and no next slot when the loop has no items', () => {
    expect(cycleState([], [])).toEqual({
      completedCycles: 0,
      partialCycles: [],
      nextSlot: null,
      totalPhotos: 0,
    });
  });

  it('points at the first item of cycle 0 when nothing has been shot', () => {
    expect(cycleState(ITEMS, [])).toEqual({
      completedCycles: 0,
      partialCycles: [],
      nextSlot: { cycleIndex: 0, itemId: 'a' },
      totalPhotos: 0,
    });
  });

  it('counts a full pass as one completed cycle and rolls to the next unit', () => {
    const photos = [shot('a', 0), shot('b', 0), shot('c', 0)];
    expect(cycleState(ITEMS, photos)).toEqual({
      completedCycles: 1,
      partialCycles: [],
      nextSlot: { cycleIndex: 1, itemId: 'a' },
      totalPhotos: 3,
    });
  });

  it('reports a partial cycle and steers the next slot at its first missing item', () => {
    const photos = [shot('a', 0), shot('c', 0)];
    expect(cycleState(ITEMS, photos)).toEqual({
      completedCycles: 0,
      partialCycles: [{ cycleIndex: 0, missingItemIds: ['b'] }],
      nextSlot: { cycleIndex: 0, itemId: 'b' },
      totalPhotos: 2,
    });
  });

  it('orders missing items by position regardless of upload order', () => {
    const photos = [shot('b', 0)];
    const state = cycleState(ITEMS, photos);
    expect(state.partialCycles[0].missingItemIds).toEqual(['a', 'c']);
    expect(state.nextSlot).toEqual({ cycleIndex: 0, itemId: 'a' });
  });

  it('finishes an earlier partial cycle before starting a new unit', () => {
    const photos = [shot('a', 0), shot('b', 0), shot('a', 1), shot('b', 1), shot('c', 1)];
    const state = cycleState(ITEMS, photos);
    expect(state.completedCycles).toBe(1);
    expect(state.partialCycles).toEqual([{ cycleIndex: 0, missingItemIds: ['c'] }]);
    expect(state.nextSlot).toEqual({ cycleIndex: 0, itemId: 'c' });
  });

  it('allocates the next cycle above the highest existing index, so a discarded middle unit leaves no collision', () => {
    const photos = [
      shot('a', 0), shot('b', 0), shot('c', 0),
      shot('a', 2), shot('b', 2), shot('c', 2),
    ];
    const state = cycleState(ITEMS, photos);
    expect(state.completedCycles).toBe(2);
    expect(state.nextSlot).toEqual({ cycleIndex: 3, itemId: 'a' });
  });

  it('ignores photos whose item is not on this loop', () => {
    const photos = [shot('a', 0), shot('b', 0), shot('c', 0), shot('ghost', 0)];
    const state = cycleState(ITEMS, photos);
    expect(state.completedCycles).toBe(1);
    expect(state.totalPhotos).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @inspect/api exec jest src/inspections/cycle-state.spec.ts`
Expected: FAIL — `Cannot find module './cycle-state'`.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/inspections/cycle-state.ts`:

```ts
/**
 * INS-081 — the cycle-completeness rule, as a pure function.
 *
 * A "cycle" (a unit) is one pass over every loop item. It has no row of its
 * own: it exists because evidence carries its index. This helper is the single
 * definition of "is that pass complete", shared by the submit guard and the
 * populate console — a divergence between the two is precisely how a
 * half-photographed unit would reach a signed report.
 *
 * cycleIndex values may be non-contiguous: discarding a middle unit leaves a
 * gap, and a new cycle is allocated ABOVE the highest existing index rather
 * than filling the hole, so it can never collide with the surviving rows'
 * @@unique([inspectionLoopItemId, cycleIndex]).
 */

export interface CycleItem {
  id: string;
  position: number;
}

export interface CyclePhotoRef {
  inspectionLoopItemId: string;
  cycleIndex: number;
}

export interface PartialCycle {
  cycleIndex: number;
  /** Ordered by item position — the order the operator will be walked through. */
  missingItemIds: string[];
}

export interface NextSlot {
  cycleIndex: number;
  itemId: string;
}

export interface CycleState {
  completedCycles: number;
  /** Every cycle missing at least one item, ascending. Empty means submittable. */
  partialCycles: PartialCycle[];
  /** Where the guided flow should send the operator next; null only when the loop has no items. */
  nextSlot: NextSlot | null;
  totalPhotos: number;
}

export function cycleState(items: CycleItem[], photos: CyclePhotoRef[]): CycleState {
  const ordered = [...items].sort((a, b) => a.position - b.position);
  const itemIds = new Set(ordered.map((i) => i.id));

  // Photos for items that are not on this loop cannot complete a cycle and must
  // not inflate the counts.
  const relevant = photos.filter((p) => itemIds.has(p.inspectionLoopItemId));

  const shotByCycle = new Map<number, Set<string>>();
  for (const photo of relevant) {
    const set = shotByCycle.get(photo.cycleIndex) ?? new Set<string>();
    set.add(photo.inspectionLoopItemId);
    shotByCycle.set(photo.cycleIndex, set);
  }

  const cycleIndexes = [...shotByCycle.keys()].sort((a, b) => a - b);
  const partialCycles: PartialCycle[] = [];
  let completedCycles = 0;

  for (const cycleIndex of cycleIndexes) {
    const shot = shotByCycle.get(cycleIndex)!;
    const missingItemIds = ordered.filter((i) => !shot.has(i.id)).map((i) => i.id);
    if (missingItemIds.length === 0) completedCycles += 1;
    else partialCycles.push({ cycleIndex, missingItemIds });
  }

  let nextSlot: NextSlot | null = null;
  if (ordered.length > 0) {
    if (partialCycles.length > 0) {
      const first = partialCycles[0];
      nextSlot = { cycleIndex: first.cycleIndex, itemId: first.missingItemIds[0] };
    } else {
      const nextIndex = cycleIndexes.length === 0 ? 0 : Math.max(...cycleIndexes) + 1;
      nextSlot = { cycleIndex: nextIndex, itemId: ordered[0].id };
    }
  }

  return { completedCycles, partialCycles, nextSlot, totalPhotos: relevant.length };
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm --filter @inspect/api exec jest src/inspections/cycle-state.spec.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/inspections/cycle-state.ts apps/api/src/inspections/cycle-state.spec.ts
git commit -m "feat(api): cycleState — pure loop-cycle completeness rule (INS-081)"
```

---

### Task 2: Schema + destructive migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (models at lines 373-445, 566-604, 613-683)
- Create: `apps/api/prisma/migrations/<timestamp>_loop_items_and_cycles/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma models `PresetLoopItem`, `PresetAllowedDefect`, `PresetMeasurementField` (repointed), `InspectionLoopItem`; fields `Photo.inspectionLoopItemId` (NOT NULL), `Photo.cycleIndex`, `DefectInstance.inspectionLoopItemId`, `DefectInstance.cycleIndex`, `InspectionMeasurement.{inspectionId, orgId, cycleIndex}`. Relation accessors `LoopPreset.items`, `LoopPreset.measurementFields`, `LoopPreset.allowedDefects`, `Inspection.items`, `Inspection.measurements`. Every later API task depends on these exact names.

> **This migration destroys data.** Per spec §9 it truncates presets, inspections, evidence and reports. Before running it against anything but a scratch database, confirm no buyer holds a signed report — a dropped report cannot be re-verified. Rehearse on a scratch DB first.

- [ ] **Step 1: Replace the preset models**

In `apps/api/prisma/schema.prisma`, replace `PresetLoopStep` (line 399), `PresetMeasurementField` (line 420) and `PresetStepAllowedDefect` (line 435) with:

```prisma
/// One ordered capture point in a loop (INS-081). Takes exactly ONE image —
/// there is no shot count, because an item IS a shot.
model PresetLoopItem {
  id                String   @id @default(cuid())
  loopPresetId      String
  position          Int
  itemName          String
  description       String?
  referenceImageUrl String?
  createdAt         DateTime @default(now())

  loopPreset LoopPreset @relation(fields: [loopPresetId], references: [id], onDelete: Cascade)

  @@unique([loopPresetId, position])
  @@index([loopPresetId])
  @@map("preset_loop_items")
}

/// Measurement sheet defined ONCE per loop (INS-081) and filled once per cycle.
model PresetMeasurementField {
  id           String  @id @default(cuid())
  loopPresetId String
  position     Int
  label        String
  unit         String?

  loopPreset LoopPreset @relation(fields: [loopPresetId], references: [id], onDelete: Cascade)

  @@unique([loopPresetId, position])
  @@index([loopPresetId])
  @@map("preset_measurement_fields")
}

/// Junction: which catalog defects are taggable anywhere in this loop (INS-081 —
/// loop-global, no longer per item).
model PresetAllowedDefect {
  loopPresetId    String
  defectCatalogId String

  loopPreset    LoopPreset    @relation(fields: [loopPresetId], references: [id], onDelete: Cascade)
  defectCatalog DefectCatalog @relation(fields: [defectCatalogId], references: [id], onDelete: Restrict)

  @@id([loopPresetId, defectCatalogId])
  @@index([defectCatalogId])
  @@map("preset_allowed_defects")
}
```

- [ ] **Step 2: Repoint the `LoopPreset` and `DefectCatalog` relation lists**

In `model LoopPreset` (line 373) replace the `steps` line with three lines:

```prisma
  items             PresetLoopItem[]
  measurementFields PresetMeasurementField[]
  allowedDefects    PresetAllowedDefect[]
```

In `model DefectCatalog`, rename the back-relation `PresetStepAllowedDefect[]` to `PresetAllowedDefect[]` (keep its field name).

- [ ] **Step 3: Replace `InspectionLoop` and `InspectionMeasurement`**

Replace `model InspectionLoop` (line 566) and `model InspectionMeasurement` (line 592) with:

```prisma
/// The inspection's frozen copy of one loop item (INS-081). No shot count and no
/// per-item defect snapshot: the allowed-defect list is loop-global and already
/// resolved inside Inspection.loopPresetSnapshot.
model InspectionLoopItem {
  id                String   @id @default(cuid())
  inspectionId      String
  orgId             String
  position          Int
  itemName          String
  description       String?
  referenceImageUrl String?
  notes             String?
  createdAt         DateTime @default(now())

  /// INS-010: tenant-aligned composite FK (see Inspection.@@unique([id, orgId])).
  inspection   Inspection       @relation(fields: [inspectionId, orgId], references: [id, orgId], onDelete: Cascade)
  organization Organization     @relation(fields: [orgId], references: [id], onDelete: Restrict)
  photos       Photo[]
  defects      DefectInstance[]

  @@unique([inspectionId, position])
  @@index([inspectionId])
  @@index([orgId])
  @@map("inspection_loop_items")
}

/// Free-form measured value recorded once per CYCLE (INS-081) — the sheet is
/// loop-global, so a measurement belongs to a unit, not to an item.
model InspectionMeasurement {
  id            String  @id @default(cuid())
  inspectionId  String
  orgId         String
  cycleIndex    Int
  label         String
  recordedValue String?
  unit          String?
  notes         String?

  inspection Inspection @relation(fields: [inspectionId, orgId], references: [id, orgId], onDelete: Cascade)

  @@unique([inspectionId, cycleIndex, label])
  @@index([inspectionId])
  @@map("inspection_measurements")
}
```

- [ ] **Step 4: Add `cycleIndex` to the evidence models**

In `model Inspection`, rename the `loops` relation line to:

```prisma
  items        InspectionLoopItem[]
  measurements InspectionMeasurement[]
```

In `model Photo` (line 613) change the loop link to a required slot:

```prisma
  inspectionLoopItemId String
  cycleIndex           Int
```

and its relation to:

```prisma
  inspectionLoopItem InspectionLoopItem @relation(fields: [inspectionLoopItemId], references: [id], onDelete: Cascade)
```

Delete `position Int?` from `Photo` — ordering now derives from `(cycleIndex, item.position)`. Replace the `@@index([inspectionLoopId])` line and add the slot constraint:

```prisma
  @@unique([orgId, clientRequestId])
  @@unique([inspectionLoopItemId, cycleIndex])
  @@index([inspectionLoopItemId])
```

In `model DefectInstance` (line 655) replace `inspectionLoopId` with:

```prisma
  inspectionLoopItemId String?
  cycleIndex           Int?
```

and its relation with:

```prisma
  inspectionLoopItem InspectionLoopItem? @relation(fields: [inspectionLoopItemId], references: [id], onDelete: SetNull)
```

Also update `Organization`'s back-relations: `InspectionLoop[]` → `InspectionLoopItem[]`.

- [ ] **Step 5: Generate the migration without applying it**

Run: `pnpm --filter @inspect/api exec prisma migrate dev --name loop_items_and_cycles --create-only`
Expected: a new folder under `apps/api/prisma/migrations/` containing `migration.sql` with data-loss warnings.

- [ ] **Step 6: Prepend the truncation so NOT NULL columns can land**

`ALTER TABLE … ADD COLUMN … NOT NULL` fails on non-empty tables. Open the generated `migration.sql` and add this as the **first** statement:

```sql
-- INS-081 clean break (spec §9): pre-launch data is discarded rather than
-- converted. CASCADE reaches aql_results, billable_events, defect_instance_photos,
-- report_deliveries and report_accesses without naming them.
TRUNCATE TABLE
  "reports",
  "inspections",
  "loop_presets"
RESTART IDENTITY CASCADE;
```

Leave the rest of the generated SQL as Prisma wrote it.

- [ ] **Step 7: Apply the migration and regenerate the client**

Run: `pnpm api prisma:migrate && pnpm api prisma:generate`
Expected: migration applies clean; the Prisma client regenerates. `pnpm type-check` now fails across the API — that is the expected red window (see Global Constraints).

- [ ] **Step 8: Re-seed the global defect library**

Run: `pnpm --filter @inspect/api exec prisma db seed`
Expected: 14 global defects present, idempotent.

- [ ] **Step 9: Verify the slot constraint exists in the database**

Run: `pnpm --filter @inspect/api exec prisma db execute --stdin <<< "SELECT indexname FROM pg_indexes WHERE tablename = 'photos';"`
Expected: the output lists a unique index over `(inspectionLoopItemId, cycleIndex)`.

- [ ] **Step 10: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(api)!: loop items + cycleIndex schema, destructive migration (INS-081)"
```

---

### Task 3: Loop-preset service + controller

**Files:**
- Modify: `apps/api/src/loop-presets/loop-presets.service.ts`
- Modify: `apps/api/src/loop-presets/loop-presets.controller.ts:33-58`
- Test: `apps/api/src/loop-presets/loop-presets.service.spec.ts`

**Interfaces:**
- Consumes: Prisma models from Task 2.
- Produces: `CreateLoopPresetInput { name, description?, aqlLevel?, items: PresetItemInput[], measurementFields?: Array<{label, unit?}>, allowedDefectCatalogIds?: string[] }` and `PresetItemInput { itemName, description?, referenceImageUrl? }`. Task 4 reads `get()`'s include shape; Task 8 mirrors this as the web wire type.

- [ ] **Step 1: Write the failing tests**

Replace the input-validation describe blocks in `apps/api/src/loop-presets/loop-presets.service.spec.ts` with these (keep the file's existing mock-Prisma harness and its other tests):

```ts
describe('create — INS-081 loop-item shape', () => {
  it('rejects a preset with no items', async () => {
    await expect(
      service.create('org_1', actor, { name: 'Tee', items: [] }),
    ).rejects.toThrow('at least one loop item is required');
  });

  it('rejects an item with a blank name', async () => {
    await expect(
      service.create('org_1', actor, { name: 'Tee', items: [{ itemName: '  ' }] }),
    ).rejects.toThrow('item 1: itemName is required');
  });

  it('rejects a reference image key outside this org namespace', async () => {
    await expect(
      service.create('org_1', actor, {
        name: 'Tee',
        items: [{ itemName: 'Right sleeve', referenceImageUrl: 'orgs/org_2/presets/x.jpg' }],
      }),
    ).rejects.toThrow('item 1: referenceImageUrl must be a key under orgs/org_1/presets/');
  });

  it('numbers items from 1 in submitted order and stores defects loop-global', async () => {
    await service.create('org_1', actor, {
      name: 'Tee',
      items: [{ itemName: 'Right sleeve' }, { itemName: 'Neck hole' }],
      allowedDefectCatalogIds: ['dc_1'],
      measurementFields: [{ label: 'Chest', unit: 'cm' }],
    });
    const data = prisma.loopPreset.create.mock.calls[0][0].data;
    expect(data.items.create).toEqual([
      expect.objectContaining({ position: 1, itemName: 'Right sleeve' }),
      expect.objectContaining({ position: 2, itemName: 'Neck hole' }),
    ]);
    expect(data.allowedDefects.create).toEqual([{ defectCatalogId: 'dc_1' }]);
    expect(data.measurementFields.create).toEqual([
      expect.objectContaining({ position: 1, label: 'Chest', unit: 'cm' }),
    ]);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `pnpm --filter @inspect/api exec jest src/loop-presets`
Expected: FAIL — the service still speaks `steps`.

- [ ] **Step 3: Rewrite the service inputs and validation**

In `apps/api/src/loop-presets/loop-presets.service.ts`, replace the `PresetStepInput`/`CreateLoopPresetInput` interfaces with:

```ts
export interface PresetItemInput {
  itemName: string;
  description?: string;
  /** Storage key under orgs/<orgId>/presets/ — one reference illustration per item. */
  referenceImageUrl?: string;
}
export interface CreateLoopPresetInput {
  name: string;
  description?: string;
  aqlLevel?: AqlLevelInput;
  items: PresetItemInput[];
  /** Loop-global (INS-081): the sheet filled once per cycle. */
  measurementFields?: Array<{ label: string; unit?: string }>;
  /** Loop-global (INS-081): the taggable defect list for the whole loop. */
  allowedDefectCatalogIds?: string[];
}
```

Replace the steps validation block (lines 80-113) with:

```ts
if (!Array.isArray(input.items) || input.items.length === 0) {
  throw new BadRequestException('at least one loop item is required');
}
const refPrefix = `orgs/${orgId}/presets/`;
input.items.forEach((it, i) => {
  if (!it?.itemName?.trim()) {
    throw new BadRequestException(`item ${i + 1}: itemName is required`);
  }
  // Tenant isolation (security review, carried over from the step shape): a
  // reference key must live in THIS org's preset namespace, or the detail
  // presign becomes a signing oracle over another tenant's objects.
  if (it.referenceImageUrl != null) {
    if (typeof it.referenceImageUrl !== 'string' || !it.referenceImageUrl.startsWith(refPrefix)) {
      throw new BadRequestException(
        `item ${i + 1}: referenceImageUrl must be a key under ${refPrefix} (use POST /loop-presets/presign)`,
      );
    }
  }
});

const catalogIds = [...new Set(input.allowedDefectCatalogIds ?? [])];
if (catalogIds.length > 0) {
  const found = await this.prisma.defectCatalog.findMany({
    where: { id: { in: catalogIds }, OR: [{ orgId }, { orgId: null }] },
    select: { id: true },
  });
  if (found.length !== catalogIds.length) {
    throw new BadRequestException('one or more allowedDefectCatalogIds are not accessible');
  }
}
```

- [ ] **Step 4: Rewrite the create payload**

Replace the `steps: { create: … }` block inside `tx.loopPreset.create` with:

```ts
          items: {
            create: input.items.map((it, i) => ({
              position: i + 1,
              itemName: it.itemName.trim(),
              description: it.description,
              referenceImageUrl: it.referenceImageUrl,
            })),
          },
          measurementFields: {
            create: (input.measurementFields ?? []).map((m, j) => ({
              position: j + 1,
              label: m.label,
              unit: m.unit,
            })),
          },
          allowedDefects: {
            create: catalogIds.map((cid) => ({ defectCatalogId: cid })),
          },
```

and its `include` with:

```ts
        include: { items: true, measurementFields: true, allowedDefects: true },
```

In the audit metadata, change `steps: preset.steps.length` to `items: preset.items.length`.

- [ ] **Step 5: Update `get()` and `list()`**

Replace `get()`'s include with:

```ts
      include: {
        items: { orderBy: { position: 'asc' } },
        measurementFields: { orderBy: { position: 'asc' } },
        allowedDefects: { include: { defectCatalog: true } },
      },
```

In `list()`, change the `_count` select from `steps: true` to `items: true`.

- [ ] **Step 6: Update the controller's reference-image decoration**

In `apps/api/src/loop-presets/loop-presets.controller.ts`, replace the `steps: preset.steps?.map(...)` block in `get()` with:

```ts
      items: preset.items?.map((item) => {
        const key = item.referenceImageUrl;
        if (typeof key !== 'string' || !key.startsWith(refPrefix)) {
          return { ...item, referenceImage: null as { key: string; viewUrl: string | null } | null };
        }
        try {
          return { ...item, referenceImage: { key, viewUrl: this.storage.presignDownload(key) } };
        } catch {
          return { ...item, referenceImage: { key, viewUrl: null as string | null } };
        }
      }),
```

- [ ] **Step 7: Run the tests and verify they pass**

Run: `pnpm --filter @inspect/api exec jest src/loop-presets`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/loop-presets
git commit -m "feat(api): presets hold loop items with loop-global defects and measurements (INS-081)"
```

---

### Task 4: Inspection snapshot, materialisation and the submit gate

**Files:**
- Modify: `apps/api/src/inspections/inspection-mapping.ts:23-66`
- Modify: `apps/api/src/inspections/inspections.service.ts` (include at :104, create at :190-219, submit guard at :327-341)
- Test: `apps/api/src/inspections/inspection-mapping.spec.ts`, `apps/api/src/inspections/inspections.service.spec.ts`

**Interfaces:**
- Consumes: `cycleState` from Task 1; Prisma models from Task 2; `get()`'s include shape from Task 3.
- Produces: `buildPresetSnapshot(preset)` returning `{ presetId, version, items[], measurementFields[], allowedDefects[] }`. Task 6 reads this snapshot shape; Task 5 relies on `InspectionLoopItem` rows existing after create.

- [ ] **Step 1: Write the failing snapshot test**

In `apps/api/src/inspections/inspection-mapping.spec.ts`, replace the `buildPresetSnapshot` describe with:

```ts
describe('buildPresetSnapshot — INS-081', () => {
  const preset = {
    id: 'lp_1',
    version: 3,
    items: [
      { position: 1, itemName: 'Right sleeve', description: null, referenceImageUrl: 'orgs/o/presets/a.jpg' },
      { position: 2, itemName: 'Neck hole', description: 'inside seam', referenceImageUrl: null },
    ],
    measurementFields: [{ label: 'Chest', unit: 'cm' }],
    allowedDefects: [
      { defectCatalogId: 'dc_1', defectCatalog: { name: 'Broken stitch', defaultSeverity: 'MAJOR' as const } },
    ],
  };

  it('freezes items in order with their reference image', () => {
    const snap = buildPresetSnapshot(preset);
    expect(snap.items).toEqual([
      { position: 1, itemName: 'Right sleeve', description: undefined, referenceImageUrl: 'orgs/o/presets/a.jpg' },
      { position: 2, itemName: 'Neck hole', description: 'inside seam', referenceImageUrl: undefined },
    ]);
  });

  it('resolves defect names and severities loop-global, not per item', () => {
    const snap = buildPresetSnapshot(preset);
    expect(snap.allowedDefects).toEqual([
      { defectCatalogId: 'dc_1', name: 'Broken stitch', severity: 'MAJOR' },
    ]);
    expect(snap.measurementFields).toEqual([{ label: 'Chest', unit: 'cm' }]);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `pnpm --filter @inspect/api exec jest src/inspections/inspection-mapping.spec.ts`
Expected: FAIL — the snapshot still emits `steps`.

- [ ] **Step 3: Rewrite the snapshot builder**

In `apps/api/src/inspections/inspection-mapping.ts`, replace `PresetStepLike`, `PresetLike` and `buildPresetSnapshot` with:

```ts
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
    defectCatalog: { name: string; defaultSeverity: 'CRITICAL' | 'MAJOR' | 'MINOR' };
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
```

- [ ] **Step 4: Materialise items instead of loops**

In `apps/api/src/inspections/inspections.service.ts`, in `create()` replace the `loops: { create: … }` block and the trailing include with:

```ts
        items: {
          create: snapshot.items.map((i) => ({
            orgId,
            position: i.position,
            itemName: i.itemName,
            description: i.description,
            referenceImageUrl: i.referenceImageUrl,
          })),
        },
      },
      include: { items: { orderBy: { position: 'asc' } } },
```

In `get()`'s include (line 104), replace the `loops` block with:

```ts
        items: {
          orderBy: { position: 'asc' },
          include: {
            photos: { orderBy: { cycleIndex: 'asc' } },
            defects: { include: { defectCatalog: true } },
          },
        },
        measurements: { orderBy: [{ cycleIndex: 'asc' }, { label: 'asc' }] },
```

and delete the top-level `photos:` include — unassigned photos no longer exist (spec §3.2).

- [ ] **Step 5: Write the failing submit-guard test**

Append to `apps/api/src/inspections/inspections.service.spec.ts`:

```ts
describe('submit — INS-081 cycle gate', () => {
  const ITEMS = [
    { id: 'a', position: 1, itemName: 'Right sleeve' },
    { id: 'b', position: 2, itemName: 'Neck hole' },
  ];

  it('refuses an inspection with no complete unit', async () => {
    prisma.inspection.findFirst.mockResolvedValue({ id: 'i1', orgId: 'o1', status: 'DRAFT', lotSize: 500, aqlPlan: PLAN });
    prisma.inspectionLoopItem.findMany.mockResolvedValue(ITEMS);
    prisma.photo.findMany.mockResolvedValue([]);
    await expect(service.submit('o1', actor, 'i1')).rejects.toThrow(
      'Cannot submit: no complete unit has been photographed',
    );
  });

  it('refuses a partial unit and names the unit and its missing items', async () => {
    prisma.inspection.findFirst.mockResolvedValue({ id: 'i1', orgId: 'o1', status: 'DRAFT', lotSize: 500, aqlPlan: PLAN });
    prisma.inspectionLoopItem.findMany.mockResolvedValue(ITEMS);
    prisma.photo.findMany.mockResolvedValue([
      { inspectionLoopItemId: 'a', cycleIndex: 0 },
      { inspectionLoopItemId: 'b', cycleIndex: 0 },
      { inspectionLoopItemId: 'a', cycleIndex: 1 },
    ]);
    await expect(service.submit('o1', actor, 'i1')).rejects.toThrow(
      'unit 2 (missing Neck hole)',
    );
  });
});
```

`PLAN` is the existing valid-plan fixture in that file; reuse it rather than inventing another.

- [ ] **Step 6: Run it and verify it fails**

Run: `pnpm --filter @inspect/api exec jest src/inspections/inspections.service.spec.ts -t "cycle gate"`
Expected: FAIL — the old shortfall guard queries `inspectionLoop`.

- [ ] **Step 7: Replace the submit guard**

Add the import at the top of `inspections.service.ts`:

```ts
import { cycleState } from './cycle-state';
```

Replace the INS-056 shortfall block (lines 327-341) with:

```ts
    // INS-056 + INS-081: a verdict must never be computed from missing evidence.
    // The AQL engine folds absent counts to zero, so an empty inspection would
    // otherwise mint a PASS. The rule is now cycle-shaped: at least one complete
    // pass over every loop item, and no half-finished unit left behind.
    const items = await this.prisma.inspectionLoopItem.findMany({
      where: { inspectionId: id },
      select: { id: true, position: true, itemName: true },
      orderBy: { position: 'asc' },
    });
    const slots = await this.prisma.photo.findMany({
      where: { inspectionId: id },
      select: { inspectionLoopItemId: true, cycleIndex: true },
    });
    const state = cycleState(items, slots);
    if (state.completedCycles === 0) {
      throw new BadRequestException(
        'Cannot submit: no complete unit has been photographed. Shoot every loop item at least once.',
      );
    }
    if (state.partialCycles.length > 0) {
      const nameById = new Map(items.map((i) => [i.id, i.itemName]));
      const detail = state.partialCycles
        .map(
          (pc) =>
            `unit ${pc.cycleIndex + 1} (missing ${pc.missingItemIds
              .map((itemId) => nameById.get(itemId) ?? itemId)
              .join(', ')})`,
        )
        .join('; ');
      throw new BadRequestException(
        `Cannot submit: incomplete ${detail}. Finish or discard it before submitting.`,
      );
    }
```

- [ ] **Step 8: Run the inspections tests and verify they pass**

Run: `pnpm --filter @inspect/api exec jest src/inspections`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/inspections
git commit -m "feat(api): loop-item snapshot + cycle-complete submit gate (INS-081)"
```

---

### Task 5: Populate — slot-addressed uploads, retake, discard

**Files:**
- Modify: `apps/api/src/populate/populate.service.ts`
- Modify: `apps/api/src/populate/populate.controller.ts:47-71`
- Test: `apps/api/src/populate/populate.service.spec.ts`

**Interfaces:**
- Consumes: `cycleState` (Task 1), Prisma models (Task 2).
- Produces: `RegisterPhotoInput { storageKey, contentHash, inspectionLoopItemId, cycleIndex, thumbnailKey?, capturedAt?, deviceId?, gps?, exif?, clientRequestId? }`; `RetakePhotoInput` (same minus the slot fields); `AddDefectInput { inspectionLoopItemId, cycleIndex, defectCatalogId?, customText?, severity?, notes?, photoIds?, clientRequestId? }`; `AddMeasurementInput { cycleIndex, label, recordedValue?, unit?, notes? }`; `discardCycle(...)  → { cycleIndex, deleted: {photos, defects, measurements} }`; `loadForPopulate(id)` returning `{ …inspection, items[], measurements[], cycleState }`. Task 9 consumes all of these over the wire.

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/src/populate/populate.service.spec.ts` (reuse the file's existing mock harness):

```ts
describe('registerPhoto — INS-081 slot addressing', () => {
  it('requires a slot', async () => {
    await expect(
      service.registerPhoto('i1', actor, { storageKey: 'k', contentHash: 'h' } as never),
    ).rejects.toThrow('inspectionLoopItemId is required');
  });

  it('rejects a negative cycleIndex', async () => {
    await expect(
      service.registerPhoto('i1', actor, {
        storageKey: 'k', contentHash: 'h', inspectionLoopItemId: 'li_1', cycleIndex: -1,
      }),
    ).rejects.toThrow('cycleIndex must be a non-negative integer');
  });

  it('turns a taken slot into a 409 that points at retake', async () => {
    prisma.$transaction.mockRejectedValue(
      Object.assign(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '6' }), {
        meta: { target: ['inspectionLoopItemId', 'cycleIndex'] },
      }),
    );
    await expect(
      service.registerPhoto('i1', actor, {
        storageKey: 'k', contentHash: 'h', inspectionLoopItemId: 'li_1', cycleIndex: 0,
      }),
    ).rejects.toThrow(/already has a photo.*retake/i);
  });
});

describe('discardCycle', () => {
  it('deletes the unit\'s photos, defects and measurements and audits the counts', async () => {
    const result = await service.discardCycle('i1', actor, 2);
    expect(prisma.photo.deleteMany).toHaveBeenCalledWith({
      where: { inspectionId: 'i1', cycleIndex: 2 },
    });
    expect(prisma.defectInstance.deleteMany).toHaveBeenCalledWith({
      where: { inspectionId: 'i1', cycleIndex: 2 },
    });
    expect(prisma.inspectionMeasurement.deleteMany).toHaveBeenCalledWith({
      where: { inspectionId: 'i1', cycleIndex: 2 },
    });
    expect(result.cycleIndex).toBe(2);
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'populate.cycleDiscarded' }),
      expect.anything(),
    );
  });
});
```

- [ ] **Step 2: Run them and verify they fail**

Run: `pnpm --filter @inspect/api exec jest src/populate`
Expected: FAIL — `discardCycle` is not a function.

- [ ] **Step 3: Rewrite the input types and slot assertion**

In `apps/api/src/populate/populate.service.ts` replace the input interfaces:

```ts
export interface RegisterPhotoInput {
  storageKey: string;
  contentHash: string;
  inspectionLoopItemId: string;
  cycleIndex: number;
  thumbnailKey?: string;
  capturedAt?: string;
  deviceId?: string;
  gps?: unknown;
  exif?: unknown;
  clientRequestId?: string;
}
export interface RetakePhotoInput {
  storageKey: string;
  contentHash: string;
  thumbnailKey?: string;
  capturedAt?: string;
  deviceId?: string;
  gps?: unknown;
  exif?: unknown;
}
export interface AddDefectInput {
  inspectionLoopItemId: string;
  cycleIndex: number;
  defectCatalogId?: string;
  customText?: string;
  severity?: Severity;
  notes?: string;
  photoIds?: string[];
  clientRequestId?: string;
}
export interface AddMeasurementInput {
  cycleIndex: number;
  label: string;
  recordedValue?: string;
  unit?: string;
  notes?: string;
}
```

Replace `assertLoop` with:

```ts
  private assertCycleIndex(cycleIndex: number) {
    if (!Number.isInteger(cycleIndex) || cycleIndex < 0) {
      throw new BadRequestException('cycleIndex must be a non-negative integer');
    }
  }

  private async assertItem(inspectionId: string, inspectionLoopItemId: string) {
    const item = await this.prisma.inspectionLoopItem.findFirst({
      where: { id: inspectionLoopItemId, inspectionId },
      select: { id: true },
    });
    if (!item) {
      throw new BadRequestException('inspectionLoopItemId not found on this inspection');
    }
  }

  /** A slot is (item, cycle). A defect must hang off a slot that holds evidence. */
  private async assertSlotHasPhoto(
    inspectionId: string,
    inspectionLoopItemId: string,
    cycleIndex: number,
  ) {
    const photo = await this.prisma.photo.findFirst({
      where: { inspectionId, inspectionLoopItemId, cycleIndex },
      select: { id: true },
    });
    if (!photo) {
      throw new BadRequestException(
        `no photo has been uploaded for unit ${cycleIndex + 1} of that loop item yet`,
      );
    }
  }
```

- [ ] **Step 4: Make `registerPhoto` slot-addressed**

In `registerPhoto`, after the `contentHash` check, replace the optional-loop block with:

```ts
    if (!input?.inspectionLoopItemId) {
      throw new BadRequestException('inspectionLoopItemId is required');
    }
    this.assertCycleIndex(input.cycleIndex);
    await this.assertItem(inspectionId, input.inspectionLoopItemId);
```

In the create payload swap `inspectionLoopId: input.inspectionLoopId` for:

```ts
            inspectionLoopItemId: input.inspectionLoopItemId,
            cycleIndex: input.cycleIndex,
```

and in the audit metadata swap `inspectionLoopId: photo.inspectionLoopId` for `inspectionLoopItemId: photo.inspectionLoopItemId, cycleIndex: photo.cycleIndex`.

Then replace the P2002 catch so the two unique constraints are told apart:

```ts
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const target = Array.isArray(e.meta?.target) ? (e.meta.target as string[]) : [];
        // The SLOT constraint is a different failure from the idempotency one:
        // this is not a retry, it is a second photo aimed at a filled slot.
        if (target.includes('cycleIndex')) {
          throw new ConflictException(
            `Unit ${input.cycleIndex + 1} already has a photo for that loop item; use retake to replace it`,
          );
        }
        if (input.clientRequestId) {
          const replay = await this.findPhotoReplay(insp.orgId, insp.id, input.clientRequestId);
          if (replay) return replay;
        }
      }
      throw e;
    }
```

- [ ] **Step 5: Delete `assignPhotoToLoop` and add `retakePhoto`**

Delete the whole `assignPhotoToLoop` method (spec §5 — it has no meaning once every upload targets a slot) and add:

```ts
  /**
   * INS-081 — replace the bytes in an existing slot, pre-submit only.
   *
   * The row is updated IN PLACE rather than deleted and re-inserted because the
   * slot is the identity: defect links (DefectInstancePhoto) survive untouched
   * and the @@unique([inspectionLoopItemId, cycleIndex]) is never transiently
   * violated. Provenance is carried by the audit chain — the entry records BOTH
   * content hashes — not by the row's immutability. The superseded object is
   * left in storage; MVP has no object-lifecycle policy.
   */
  async retakePhoto(
    inspectionId: string,
    actor: AuthUser,
    photoId: string,
    input: RetakePhotoInput,
  ) {
    const insp = await this.loadOpenInspection(inspectionId);
    if (!input?.storageKey) throw new BadRequestException('storageKey is required');
    if (!input?.contentHash) throw new BadRequestException('contentHash is required');
    const photo = await this.prisma.photo.findFirst({ where: { id: photoId, inspectionId } });
    if (!photo) throw new NotFoundException('Photo not found on this inspection');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.photo.update({
        where: { id: photoId },
        data: {
          storageKey: input.storageKey,
          thumbnailKey: input.thumbnailKey ?? null,
          contentHash: input.contentHash,
          capturedAt: input.capturedAt ? new Date(input.capturedAt) : null,
          deviceId: input.deviceId ?? null,
          gps: input.gps as Prisma.InputJsonValue,
          exif: input.exif as Prisma.InputJsonValue,
          uploaderUserId: actor.userId,
          source: 'MANUAL_UPLOAD',
        },
      });
      await this.audit.append(
        {
          orgId: insp.orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'populate.photoRetaken',
          entityType: 'Photo',
          entityId: photoId,
          metadata: {
            inspectionId: insp.id,
            inspectionLoopItemId: photo.inspectionLoopItemId,
            cycleIndex: photo.cycleIndex,
            fromContentHash: photo.contentHash,
            toContentHash: updated.contentHash,
          },
        },
        tx,
      );
      return updated;
    });
  }

  /**
   * INS-081 — the "remove" half of the end-of-loop rule: a unit is either
   * finished or discarded whole. Deleting one photo out of a unit is deliberately
   * NOT offered; that is what would create an unfinishable hole in history.
   */
  async discardCycle(inspectionId: string, actor: AuthUser, cycleIndex: number) {
    const insp = await this.loadOpenInspection(inspectionId);
    this.assertCycleIndex(cycleIndex);
    return this.prisma.$transaction(async (tx) => {
      const defects = await tx.defectInstance.deleteMany({ where: { inspectionId, cycleIndex } });
      const photos = await tx.photo.deleteMany({ where: { inspectionId, cycleIndex } });
      const measurements = await tx.inspectionMeasurement.deleteMany({
        where: { inspectionId, cycleIndex },
      });
      await this.audit.append(
        {
          orgId: insp.orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'populate.cycleDiscarded',
          entityType: 'Inspection',
          entityId: insp.id,
          metadata: {
            cycleIndex,
            photos: photos.count,
            defects: defects.count,
            measurements: measurements.count,
          },
        },
        tx,
      );
      return {
        cycleIndex,
        deleted: {
          photos: photos.count,
          defects: defects.count,
          measurements: measurements.count,
        },
      };
    });
  }
```

Defects are deleted **before** photos so the `DefectInstancePhoto` junction rows go with their parent defect rather than blocking the photo delete.

- [ ] **Step 6: Move defects and measurements onto the slot / cycle**

In `addDefect`, replace the optional-loop block with:

```ts
    if (!input?.inspectionLoopItemId) {
      throw new BadRequestException('inspectionLoopItemId is required');
    }
    this.assertCycleIndex(input.cycleIndex);
    await this.assertItem(inspectionId, input.inspectionLoopItemId);
    await this.assertSlotHasPhoto(inspectionId, input.inspectionLoopItemId, input.cycleIndex);
```

and in its create payload swap `inspectionLoopId` for `inspectionLoopItemId: input.inspectionLoopItemId, cycleIndex: input.cycleIndex`; mirror that in the audit metadata.

Replace `addMeasurement`'s body between the guards and the transaction with an upsert so re-entering a value is idempotent:

```ts
  async addMeasurement(inspectionId: string, actor: AuthUser, input: AddMeasurementInput) {
    const insp = await this.loadOpenInspection(inspectionId);
    this.assertCycleIndex(input?.cycleIndex);
    if (!input?.label?.trim()) throw new BadRequestException('label is required');
    const label = input.label.trim();
    return this.prisma.$transaction(async (tx) => {
      const measurement = await tx.inspectionMeasurement.upsert({
        where: { inspectionId_cycleIndex_label: { inspectionId, cycleIndex: input.cycleIndex, label } },
        create: {
          inspectionId,
          orgId: insp.orgId,
          cycleIndex: input.cycleIndex,
          label,
          recordedValue: input.recordedValue,
          unit: input.unit,
          notes: input.notes,
        },
        update: {
          recordedValue: input.recordedValue,
          unit: input.unit,
          notes: input.notes,
        },
      });
      await this.audit.append(
        {
          orgId: insp.orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'populate.measurementAdded',
          entityType: 'InspectionMeasurement',
          entityId: measurement.id,
          metadata: {
            inspectionId,
            cycleIndex: measurement.cycleIndex,
            label: measurement.label,
            recordedValue: measurement.recordedValue,
            unit: measurement.unit,
          },
        },
        tx,
      );
      return measurement;
    });
  }
```

- [ ] **Step 7: Return the cycle state from the populate read**

Replace `loadForPopulate`'s include and return with:

```ts
      include: {
        buyer: true,
        supplier: true,
        product: true,
        purchaseOrder: true,
        items: {
          orderBy: { position: 'asc' },
          include: {
            photos: { orderBy: { cycleIndex: 'asc' } },
            defects: { include: { defectCatalog: true } },
          },
        },
        measurements: { orderBy: [{ cycleIndex: 'asc' }, { label: 'asc' }] },
        assignedInspector: { select: { id: true, name: true, email: true } },
        aqlResult: true,
        report: true,
      },
    });
    if (!inspection) {
      throw new NotFoundException('Inspection not found');
    }
    const slots = inspection.items.flatMap((item) =>
      item.photos.map((p) => ({ inspectionLoopItemId: item.id, cycleIndex: p.cycleIndex })),
    );
    return {
      ...inspection,
      items: inspection.items.map((item) => ({
        ...item,
        photos: item.photos.map((p) => this.withViewUrl(p)),
      })),
      // The console renders the SAME rule the submit guard enforces (INS-081).
      cycleState: cycleState(
        inspection.items.map((i) => ({ id: i.id, position: i.position })),
        slots,
      ),
    };
```

Add `import { cycleState } from '../inspections/cycle-state';` at the top.

- [ ] **Step 8: Wire the controller routes**

In `apps/api/src/populate/populate.controller.ts`, delete the `@Patch('photos/:photoId/loop')` handler and add:

```ts
  @Post('photos/:photoId/retake')
  retake(
    @CurrentUser() user: AuthUser,
    @Param('inspectionId') inspectionId: string,
    @Param('photoId') photoId: string,
    @Body() body: RetakePhotoInput,
  ) {
    return this.populate.retakePhoto(inspectionId, user, photoId, body);
  }

  @Delete('cycles/:cycleIndex')
  discardCycle(
    @CurrentUser() user: AuthUser,
    @Param('inspectionId') inspectionId: string,
    @Param('cycleIndex') cycleIndex: string,
  ) {
    return this.populate.discardCycle(inspectionId, user, Number(cycleIndex));
  }
```

Add `Delete` to the `@nestjs/common` import and `RetakePhotoInput` to the service import; drop the now-unused `Patch`.

- [ ] **Step 9: Run the populate tests and verify they pass**

Run: `pnpm --filter @inspect/api exec jest src/populate`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/populate
git commit -m "feat(api): slot-addressed populate with retake and cycle discard (INS-081)"
```

---

### Task 6: Report snapshot and PDF

**Files:**
- Modify: `apps/api/src/reports/reports.service.ts:98-186`
- Modify: `apps/api/src/reports/report-pdf.ts:82-98, 734-760, 823-868`
- Test: `apps/api/src/reports/reports.service.spec.ts`, `apps/api/src/reports/report-pdf.spec.ts`

**Interfaces:**
- Consumes: `cycleState` (Task 1), the Prisma shape from Task 2, `Inspection.loopPresetSnapshot` from Task 4.
- Produces: the canonical snapshot keys `items[]`, `cycles: { completed, sampleSize }`, `measurements[]`, and per-defect `{ itemPosition, cycleIndex }`. `ReportCanonicalSnapshot` in `report-pdf.ts` is the typed view of it.

- [ ] **Step 1: Write the failing snapshot test**

In `apps/api/src/reports/reports.service.spec.ts`, add:

```ts
it('freezes items, cycle depth and per-unit defect attribution (INS-081)', async () => {
  const report = await service.generate('o1', actor, 'i1');
  const snap = report.canonicalSnapshot as Record<string, unknown>;
  expect(snap.items).toEqual([
    { position: 1, itemName: 'Right sleeve', notes: null },
    { position: 2, itemName: 'Neck hole', notes: null },
  ]);
  expect(snap.cycles).toEqual({ completed: 2, sampleSize: 32 });
  expect(snap.defects).toEqual([
    expect.objectContaining({ itemPosition: 1, cycleIndex: 0, severity: 'MAJOR' }),
  ]);
  expect(snap.measurements).toEqual([
    { cycleIndex: 0, label: 'Chest', recordedValue: '52', unit: 'cm' },
  ]);
});
```

Extend the file's inspection fixture with two `items`, one defect carrying `{ inspectionLoopItemId: 'li_1', cycleIndex: 0 }`, six photos across two cycles, one measurement, and `computedSampling: { sampleSize: 32 }`.

- [ ] **Step 2: Run it and verify it fails**

Run: `pnpm --filter @inspect/api exec jest src/reports/reports.service.spec.ts`
Expected: FAIL — the snapshot still emits `loops`.

- [ ] **Step 3: Rewrite the query and the canonical payload**

In `reports.service.ts`, replace the `loops` and `photos` includes in `generate()` with:

```ts
        items: { orderBy: { position: 'asc' }, include: { photos: true } },
        measurements: { orderBy: [{ cycleIndex: 'asc' }, { label: 'asc' }] },
```

Then replace the `orderedPhotoHashes` line with a deterministic slot ordering:

```ts
    // Deterministic evidence ordering (the signature covers this exact sequence):
    // by unit, then by the item's position within the loop. Sorted in JS so the
    // ordering does not depend on a relation-ordering capability.
    const orderedPhotos = inspection.items
      .flatMap((item) => item.photos.map((p) => ({ ...p, itemPosition: item.position })))
      .sort((a, b) => a.cycleIndex - b.cycleIndex || a.itemPosition - b.itemPosition);
    const orderedPhotoHashes = orderedPhotos.map((p) => p.contentHash);
    const itemPositionById = new Map(inspection.items.map((i) => [i.id, i.position]));
    const state = cycleState(
      inspection.items.map((i) => ({ id: i.id, position: i.position })),
      orderedPhotos.map((p) => ({ inspectionLoopItemId: p.inspectionLoopItemId, cycleIndex: p.cycleIndex })),
    );
    const sampleSize =
      (inspection.computedSampling as { sampleSize?: number } | null)?.sampleSize ?? null;
```

In `rawCanonical`, replace the `defects` mapping's `inspectionLoopId` line with:

```ts
        itemPosition: d.inspectionLoopItemId ? itemPositionById.get(d.inspectionLoopItemId) ?? null : null,
        cycleIndex: d.cycleIndex ?? null,
```

and replace the whole `loops:` key with:

```ts
      items: inspection.items.map((i) => ({
        position: i.position,
        itemName: i.itemName,
        notes: i.notes,
      })),
      // Evidence depth versus the sampling plan, so a short inspection is visible
      // to the buyer rather than silently equivalent to a full one (INS-081).
      cycles: { completed: state.completedCycles, sampleSize },
      measurements: inspection.measurements.map((m) => ({
        cycleIndex: m.cycleIndex,
        label: m.label,
        recordedValue: m.recordedValue,
        unit: m.unit,
      })),
```

Add `import { cycleState } from '../inspections/cycle-state';`.

- [ ] **Step 4: Update the PDF's typed snapshot view**

In `apps/api/src/reports/report-pdf.ts`, in `ReportCanonicalSnapshot` replace the `loops?:` block and the defect entry's `inspectionLoopId` with:

```ts
  items?: Array<{
    position?: number | null;
    itemName?: string | null;
    notes?: string | null;
  }>;
  cycles?: { completed?: number | null; sampleSize?: number | null };
  measurements?: Array<{
    cycleIndex?: number | null;
    label?: string | null;
    recordedValue?: string | null;
    unit?: string | null;
  }>;
```

and in the defects array entry:

```ts
    itemPosition?: number | null;
    cycleIndex?: number | null;
```

- [ ] **Step 5: Rewrite the defect narrative and measurement sheet**

Replace the `zoneByLoopId` block in `drawDefectNarrative` (around line 741) with:

```ts
  const itemNameByPosition = new Map<number, string>();
  (snap.items ?? []).forEach((i, idx) => {
    const position = i.position ?? idx + 1;
    itemNameByPosition.set(position, i.itemName || `Item ${position}`);
  });
  const label = (d: { itemPosition?: number | null; cycleIndex?: number | null }) => {
    const item = d.itemPosition != null ? itemNameByPosition.get(d.itemPosition) : undefined;
    const unit = d.cycleIndex != null ? `Unit ${d.cycleIndex + 1}` : null;
    return [unit, item].filter(Boolean).join(' · ') || '—';
  };
```

and use `label(d)` where the old zone lookup was used.

Replace `drawMeasurementSheet` (line 823) wholesale — the sheet is now grouped by unit, not by loop:

```ts
function drawMeasurementSheet(p: Painter, fonts: Fonts, snap: ReportCanonicalSnapshot): void {
  const rows = snap.measurements ?? [];
  if (rows.length === 0) return;

  // INS-081: measurements are recorded once per UNIT (the sheet is loop-global),
  // so the sheet groups by cycleIndex ascending rather than by loop item.
  const byCycle = new Map<number, typeof rows>();
  for (const m of rows) {
    const cycleIndex = m.cycleIndex ?? 0;
    byCycle.set(cycleIndex, [...(byCycle.get(cycleIndex) ?? []), m]);
  }
  const cycles = [...byCycle.keys()].sort((a, b) => a - b);

  p.section(6, 'Measurement sheet', 'Free-form - as recorded, per unit');
  p.ensure(20);
  p.rect(MARGIN, p.y - 6, CONTENT_W, 20, FILL);
  p.text('POINT', { x: MARGIN + 6, y: p.y, size: 7.5, color: SUB });
  p.text('RECORDED', { x: MARGIN + CONTENT_W - 90, y: p.y, size: 7.5, color: SUB, align: 'right' });
  p.text('UNIT', { x: MARGIN + CONTENT_W, y: p.y, size: 7.5, color: SUB, align: 'right' });
  p.y -= 20;

  for (const cycleIndex of cycles) {
    p.ensure(18);
    p.text(`Unit ${cycleIndex + 1}`, {
      x: MARGIN + 6,
      y: p.y,
      size: 9,
      font: fonts.bold,
      color: SUB,
    });
    p.y -= 15;
    for (const m of byCycle.get(cycleIndex) ?? []) {
      p.ensure(18);
      p.hairline(p.y + 11, LINE_SOFT);
      p.text(m.label || '—', { x: MARGIN + 14, y: p.y, size: 9.5, color: INK });
      p.text(m.recordedValue ?? '—', {
        x: MARGIN + CONTENT_W - 90,
        y: p.y,
        size: 9.5,
        font: fonts.mono,
        color: INK,
        align: 'right',
      });
      p.text(m.unit ?? '—', {
        x: MARGIN + CONTENT_W,
        y: p.y,
        size: 9.5,
        font: fonts.mono,
        color: SUB,
        align: 'right',
      });
      p.y -= 15;
    }
  }
}
```

In `drawSamplingPlan`, add one line under the sample size: `Units photographed: <cycles.completed> of <cycles.sampleSize>`.

- [ ] **Step 6: Update the PDF fixture and run the report tests**

Update the `SNAPSHOT` fixture in `report-pdf.spec.ts` to the new shape (`items`, `cycles`, `measurements`, defects with `itemPosition`/`cycleIndex`).

Run: `pnpm --filter @inspect/api exec jest src/reports`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/reports
git commit -m "feat(api): report snapshot carries items, cycle depth and per-unit defects (INS-081)"
```

---

### Task 7: Green the tree + DB-backed integration specs

This is the real gate. Everything before it was unit-level.

**Files:**
- Modify: `apps/api/test/integration/support.ts:215-230`
- Modify: the existing integration specs under `apps/api/test/integration/` that create presets or upload photos
- Create: `apps/api/test/integration/populate-cycles.int-spec.ts`
- Modify: `apps/api/scripts/smoke-loop.mjs`

**Interfaces:**
- Consumes: every API surface from Tasks 3-6.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Restore a green build**

Run: `pnpm type-check`
Fix every remaining reference to `steps`, `zoneName`, `requiredShotCount`, `inspectionLoopId` or `assignPhotoToLoop` under `apps/api` until it passes. Expected at the end: PASS for `@inspect/api` (the web app is still red — Tasks 8-9 fix it).

- [ ] **Step 2: Update the integration fixture**

In `apps/api/test/integration/support.ts`, replace the preset body (line 218-229) with:

```ts
      body: {
        name: `E2E Loop ${tag}`,
        aqlLevel: 'II',
        items: [{ itemName: 'Front' }, { itemName: 'Back' }],
        measurementFields: [{ label: 'Length', unit: 'cm' }],
        allowedDefectCatalogIds: minor ? [minor.id] : [],
      },
```

- [ ] **Step 3: Write the failing cycle spec**

Create `apps/api/test/integration/populate-cycles.int-spec.ts`:

```ts
import { createClient, seedInspection, expect2xx } from './support';

describe('populate cycles (INS-081)', () => {
  it('blocks submit mid-cycle, then allows it once the unit is discarded', async () => {
    const { client, adminToken, inspectionId, items } = await seedInspection();

    // Unit 1: both items — a complete cycle.
    await uploadTo(client, adminToken, inspectionId, items[0].id, 0);
    await uploadTo(client, adminToken, inspectionId, items[1].id, 0);
    // Unit 2: only the first item — partial.
    await uploadTo(client, adminToken, inspectionId, items[0].id, 1);

    const blocked = await client.post(`/inspections/${inspectionId}/submit`, { token: adminToken });
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toMatch(/unit 2 \(missing Back\)/);

    expect2xx(
      await client.delete(`/inspections/${inspectionId}/populate/cycles/1`, { token: adminToken }),
    );
    expect2xx(await client.post(`/inspections/${inspectionId}/submit`, { token: adminToken }));
  });

  it('rejects a second photo aimed at a filled slot with 409', async () => {
    const { client, adminToken, inspectionId, items } = await seedInspection();
    await uploadTo(client, adminToken, inspectionId, items[0].id, 0);
    const dup = await uploadTo(client, adminToken, inspectionId, items[0].id, 0, { raw: true });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toMatch(/retake/i);
  });

  it('retake replaces the bytes, keeps the slot, and audits both hashes', async () => {
    const { client, adminToken, inspectionId, items } = await seedInspection();
    const photo = await uploadTo(client, adminToken, inspectionId, items[0].id, 0);
    const retaken = expect2xx(
      await client.post(`/inspections/${inspectionId}/populate/photos/${photo.id}/retake`, {
        token: adminToken,
        body: { storageKey: `${photo.storageKey}-v2`, contentHash: 'b'.repeat(64) },
      }),
    );
    expect(retaken.id).toBe(photo.id);
    expect(retaken.cycleIndex).toBe(0);
    expect(retaken.contentHash).toBe('b'.repeat(64));
  });

  it('refuses retake and discard once the inspection is submitted', async () => {
    const { client, adminToken, inspectionId, items } = await seedInspection();
    await uploadTo(client, adminToken, inspectionId, items[0].id, 0);
    await uploadTo(client, adminToken, inspectionId, items[1].id, 0);
    expect2xx(await client.post(`/inspections/${inspectionId}/submit`, { token: adminToken }));

    const discard = await client.delete(`/inspections/${inspectionId}/populate/cycles/0`, {
      token: adminToken,
    });
    expect(discard.status).toBe(400);
    expect(discard.body.message).toMatch(/locked/i);
  });
});
```

Add the `uploadTo` helper and extend `seedInspection` in `support.ts` to return `items` (from the create response's `items[]`). Follow the file's existing presign→PUT→register pattern; `{ raw: true }` returns the un-asserted response.

- [ ] **Step 4: Run the integration suite and verify the new spec fails, then passes**

Run: `pnpm api test:integration`
Expected: the new spec drives out any remaining wiring gaps; iterate until the whole suite is green against a migrated + seeded database.

- [ ] **Step 5: Update the smoke script**

In `apps/api/scripts/smoke-loop.mjs`, replace the preset body's `steps`/`zoneName`/`requiredShotCount` with `items`/`itemName`, and give every photo registration an `inspectionLoopItemId` + `cycleIndex`.

- [ ] **Step 6: Run the full unit suite**

Run: `pnpm api test`
Expected: PASS (204 + the new cycle-state and guard specs).

- [ ] **Step 7: Commit**

```bash
git add apps/api/test apps/api/scripts apps/api/src
git commit -m "test(api): DB-backed specs for loop-item cycles, retake and discard (INS-081)"
```

---

### Task 8: Web wire types + preset builder

**Files:**
- Modify: `apps/web/lib/api.ts:328-371, 465-509`
- Modify: `apps/web/app/(console)/presets/actions.ts:7-33`
- Rewrite: `apps/web/app/(console)/presets/new/builder.tsx`
- Modify: `apps/web/app/(console)/presets/page.tsx:40`, `apps/web/app/(console)/presets/[id]/page.tsx:47-58`
- Modify: `packages/shared-types/src/json-contracts.ts`

**Interfaces:**
- Consumes: the API shapes from Tasks 3-5.
- Produces: `ApiPresetItem`, `ApiLoopPresetDetail { items, measurementFields, allowedDefects }`, `ApiInspectionLoopItem`, `ApiPhoto.cycleIndex`, `CreatePresetInput { name, description?, aqlLevel?, items, measurementFields?, allowedDefectCatalogIds? }`. Task 9 consumes the inspection-side types.

- [ ] **Step 1: Update the wire types**

In `apps/web/lib/api.ts` replace `ApiPresetStep` / `ApiLoopPresetDetail` with:

```ts
export interface ApiPresetItem {
  id: string;
  itemName: string;
  description?: string | null;
  referenceImageUrl?: string | null;
  position: number;
  /** Present on GET /loop-presets/:id — key decorated with a short-lived view URL. */
  referenceImage?: { key: string; viewUrl: string | null } | null;
}

export interface ApiLoopPresetDetail extends ApiLoopPreset {
  items: ApiPresetItem[];
  measurementFields: ApiMeasurementField[];
  allowedDefects: ApiAllowedDefect[];
}
```

Change `ApiLoopPreset._count` from `{ steps: number; … }` to `{ items: number; inspections: number; defaultForBuyers: number }`.

Replace `ApiInspectionLoop` with:

```ts
export interface ApiInspectionLoopItem {
  id: string;
  /** Wire names are the Prisma-native columns (INS-064) — do NOT re-alias. */
  itemName: string;
  position: number;
  description?: string | null;
  referenceImageUrl?: string | null;
  photos?: ApiPhoto[];
  defects?: ApiDefectInstance[];
}

export interface ApiCycleState {
  completedCycles: number;
  partialCycles: { cycleIndex: number; missingItemIds: string[] }[];
  nextSlot: { cycleIndex: number; itemId: string } | null;
  totalPhotos: number;
}
```

On `ApiInspection`, replace `loops?: ApiInspectionLoop[]` with `items?: ApiInspectionLoopItem[]`, and add:

```ts
  measurements?: ApiMeasurement[];
  cycleState?: ApiCycleState;
  /** Frozen at creation — the loop-global measurement sheet the console renders per unit. */
  loopPresetSnapshot?: {
    presetId: string;
    version: number;
    items: { position: number; itemName: string; description?: string; referenceImageUrl?: string }[];
    measurementFields: { label: string; unit?: string }[];
    allowedDefects: { defectCatalogId: string; name: string; severity: 'CRITICAL' | 'MAJOR' | 'MINOR' }[];
  } | null;
``` On `ApiPhoto`, replace `inspectionLoopId` with `inspectionLoopItemId: string` and add `cycleIndex: number`. On `ApiMeasurement`, replace `inspectionLoopId` with `cycleIndex: number`. On `ApiDefectInstance`, add `inspectionLoopItemId?: string | null` and `cycleIndex?: number | null`.

- [ ] **Step 2: Update the server actions**

In `apps/web/app/(console)/presets/actions.ts` replace `PresetStepInput`/`CreatePresetInput` and the validation in `createPreset`:

```ts
export interface PresetItemInput {
  itemName: string;
  description?: string;
  referenceImageUrl?: string;
}

export interface CreatePresetInput {
  name: string;
  description?: string;
  aqlLevel?: string;
  items: PresetItemInput[];
  measurementFields?: { label: string; unit?: string }[];
  allowedDefectCatalogIds?: string[];
}
```

```ts
  if (!input.name.trim()) return { error: 'Preset name is required' };
  if (!input.items.length) return { error: 'Add at least one loop item' };
  for (const it of input.items) {
    if (!it.itemName.trim()) return { error: 'Each loop item must have a name' };
  }
```

- [ ] **Step 3: Rewrite the builder's state model**

In `apps/web/app/(console)/presets/new/builder.tsx` replace `StepDraft` and `BuilderState` with:

```ts
interface ItemDraft {
  id: string;
  itemName: string;
  description: string;
  referenceImage: ReferenceImageDraft | null;
}

/** Which editor the main panel shows — the loop's own config, or one item. */
type Selection = { kind: 'defects' } | { kind: 'measurements' } | { kind: 'item'; index: number };

interface BuilderState {
  presetName: string;
  description: string;
  aqlLevel: string;
  items: ItemDraft[];
  measurementFields: MeasurementFieldDraft[];
  allowedDefectCatalogIds: Set<string>;
  selection: Selection;
  customDefectName: string;
  customDefectSeverity: 'CRITICAL' | 'MAJOR' | 'MINOR';
  saving: boolean;
  saveError: string | null;
}

function blankItem(name = ''): ItemDraft {
  return { id: crypto.randomUUID(), itemName: name, description: '', referenceImage: null };
}
```

Seed the initial state with `items: [blankItem('Item 01')]`, `selection: { kind: 'item', index: 0 }`.

- [ ] **Step 4: Rewrite the sidebar into two groups**

Replace the sidebar's loop list and "Add Loop" button with a Loop group above an Items group. Keep the existing `moveStep`/`removeStep` reorder controls, renamed to `moveItem`/`removeItem` and operating on `state.items`:

```tsx
<div style={{ ...fieldLabel, marginBottom: 8 }}>Loop</div>
<button
  onClick={() => set({ selection: { kind: 'defects' } })}
  style={sidebarRow(state.selection.kind === 'defects')}
>
  Defect tags
  <Mono style={{ marginLeft: 'auto', fontSize: 11, color: ui.faint }}>
    {state.allowedDefectCatalogIds.size}
  </Mono>
</button>
<button
  onClick={() => set({ selection: { kind: 'measurements' } })}
  style={sidebarRow(state.selection.kind === 'measurements')}
>
  Measurements
  <Mono style={{ marginLeft: 'auto', fontSize: 11, color: ui.faint }}>
    {state.measurementFields.length}
  </Mono>
</button>

<div style={{ borderTop: `1px solid ${ui.line}`, margin: '18px 0 12px' }} />
<div style={{ ...fieldLabel, marginBottom: 10 }}>Items · {state.items.length}</div>
```

Each item row shows its position, `itemName || 'Item NN'`, and a reference-image indicator — **not** a shot count and **not** a tag count. The add button reads:

```tsx
<Plus size={14} /> Add Loop Item
```

Define `sidebarRow(active: boolean)` next to the existing `iconBtn` style object, mirroring the current active-row treatment (`ui.accentSoft` background, 2px `ui.accent` left border).

- [ ] **Step 5: Rewrite the main panel**

- `selection.kind === 'item'` → name input, description input, and the single reference-image uploader (reuse `handleReferenceUpload`, storing to `item.referenceImage` instead of pushing to an array). Delete the required-shots card, the per-item defect picker and the per-item measurement table entirely.
- `selection.kind === 'defects'` → the existing severity-grouped picker plus the custom-defect row, now reading and writing `state.allowedDefectCatalogIds`.
- `selection.kind === 'measurements'` → the existing measurement-fields table, now reading and writing `state.measurementFields`.
- Keep the pass/fail info box visible under the defects editor.

Delete `setShots`, `bumpShots`, `totalShots` and the `activeStep` variable together with the `void activeStep;` line in `handleSave`.

- [ ] **Step 6: Rewrite the submit payload**

```ts
    const input: CreatePresetInput = {
      name: state.presetName,
      description: state.description || undefined,
      aqlLevel: state.aqlLevel || undefined,
      items: state.items.map((it) => ({
        itemName: it.itemName,
        description: it.description || undefined,
        referenceImageUrl: it.referenceImage?.key,
      })),
      measurementFields: state.measurementFields.map((f) => ({
        label: f.label,
        unit: f.unit || undefined,
      })),
      allowedDefectCatalogIds: Array.from(state.allowedDefectCatalogIds),
    };
```

Update `initFromSeed` to read `seed.items`, `seed.measurementFields` and `seed.allowedDefects` for the duplicate path.

- [ ] **Step 7: Update the list and detail pages**

`presets/page.tsx:40` — `loopCount: p._count?.items ?? 0`, and relabel the column "Items".
`presets/[id]/page.tsx` — iterate `preset.items`, render `item.itemName`, delete the `requiredShotCount` line, and render the loop-global defect tags and measurement fields once above the item list.

- [ ] **Step 8: Update the unwired contract package**

In `packages/shared-types/src/json-contracts.ts`, rename the preset-snapshot contract's `steps`/`zoneName`/`requiredShotCount` to `items`/`itemName` and hoist `allowedDefects`/`measurementFields` to the loop level, matching Task 4's `buildPresetSnapshot`. The package is still unwired (INS-008) but must not encode the dead shape.

- [ ] **Step 9: Verify the build**

Run: `pnpm --filter @inspect/web type-check && pnpm --filter @inspect/web build`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/web/lib apps/web/app/\(console\)/presets packages/shared-types
git commit -m "feat(web): preset builder designs one loop of single-image items (INS-081)"
```

---

### Task 9: Populate workspace — guided cycle, grid, retake, end gate

**Files:**
- Rewrite: `apps/web/app/(console)/inspections/[id]/populate/populate-workspace.tsx`
- Modify: `apps/web/app/(console)/inspections/[id]/populate/actions.ts`
- Modify: `apps/web/app/(console)/inspections/[id]/report/page.tsx:52,60`

**Interfaces:**
- Consumes: `ApiInspectionLoopItem`, `ApiCycleState`, `ApiPhoto.cycleIndex` (Task 8); the populate routes (Task 5).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Update the server actions**

In `populate/actions.ts` delete `assignPhotoToLoop` and add:

```ts
export async function retakePhoto(
  inspectionId: string,
  photoId: string,
  input: { storageKey: string; contentHash: string },
): Promise<{ data?: ApiPhoto; error?: string }> {
  try {
    const data = await apiPost<ApiPhoto>(
      `/inspections/${inspectionId}/populate/photos/${photoId}/retake`,
      input,
    );
    return { data };
  } catch (e) {
    return { error: msg(e, 'retake failed') };
  }
}

export async function discardCycle(
  inspectionId: string,
  cycleIndex: number,
): Promise<{ error?: string }> {
  try {
    await apiDelete(`/inspections/${inspectionId}/populate/cycles/${cycleIndex}`);
    return {};
  } catch (e) {
    return { error: msg(e, 'discard unit failed') };
  }
}
```

Import `apiDelete` from `@/lib/api` and drop the now-unused `apiPatch`.

- [ ] **Step 2: Rebuild the workspace state**

Replace the `activeLoopId` state with a slot cursor driven by the server-computed cycle state:

```ts
const items = [...(inspection.items ?? [])].sort((a, b) => a.position - b.position);
const state = inspection.cycleState;
const photoBySlot = new Map<string, ApiPhoto>();
for (const item of items) {
  for (const photo of item.photos ?? []) photoBySlot.set(`${item.id}:${photo.cycleIndex}`, photo);
}
const cycleIndexes = [...new Set(items.flatMap((i) => (i.photos ?? []).map((p) => p.cycleIndex)))]
  .sort((a, b) => a - b);

const [cursor, setCursor] = useState<{ cycleIndex: number; itemId: string }>(
  state?.nextSlot ?? { cycleIndex: 0, itemId: items[0]?.id ?? '' },
);
const [view, setView] = useState<'guided' | 'grid'>('guided');
const [endGate, setEndGate] = useState<{ cycleIndex: number; missing: string[] } | null>(null);

const cursorItemIndex = items.findIndex((i) => i.id === cursor.itemId);
const cursorPhoto = photoBySlot.get(`${cursor.itemId}:${cursor.cycleIndex}`);
const targetUnits = inspection.computedSampling?.sampleSize ?? null;
```

- [ ] **Step 3: Upload into the cursor slot and auto-advance**

```ts
async function handlePhotoUpload(file: File) {
  startTransition(async () => {
    setPendingError(undefined);
    const presign = await presignPhoto(inspection.id);
    if (presign.error) { setPendingError(presign.error); return; }
    try {
      await uploadBytesToPresignedUrl(presign.data!.uploadUrl, file);
    } catch (e) {
      setPendingError(`Storage upload failed — the browser could not PUT to object storage: ${String(e)}`);
      return;
    }
    const hash = await sha256Hex(file);
    const reg = await registerPhoto(inspection.id, {
      storageKey: presign.data!.storageKey,
      contentHash: hash,
      inspectionLoopItemId: cursor.itemId,
      cycleIndex: cursor.cycleIndex,
      clientRequestId: `web-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
    if (reg.error) { setPendingError(reg.error); return; }
    advance();
    router.refresh();
  });
}

/** Next item in this unit; past the last item, roll to item 01 of the next unit. */
function advance() {
  const next = cursorItemIndex + 1;
  if (next < items.length) setCursor({ ...cursor, itemId: items[next].id });
  else setCursor({ cycleIndex: cursor.cycleIndex + 1, itemId: items[0].id });
}
```

- [ ] **Step 4: Add the retake control**

Render it only when `cursorPhoto` exists, beside Upload:

```tsx
{cursorPhoto && (
  <Btn
    kind="ghost"
    icon={<RefreshCw size={15} />}
    onClick={isPending ? undefined : () => retakeInputRef.current?.click()}
  >
    Retake
  </Btn>
)}
```

backed by a second hidden file input whose handler presigns, PUTs, hashes, then calls
`retakePhoto(inspection.id, cursorPhoto.id, { storageKey, contentHash })` and `router.refresh()` **without**
advancing the cursor — a retake replaces, it does not progress. Import `RefreshCw` from `lucide-react`.

- [ ] **Step 5: Build the sidebar, unit strip and grid**

- Items list: each row shows `item.itemName` and whether the **current** unit has its shot; clicking sets `cursor.itemId`.
- Unit strip: one row per entry in `cycleIndexes` plus the in-progress unit, labelled `Unit {cycleIndex + 1}`, with a `●/○` dot per item. Clicking sets `cursor.cycleIndex`. A unit in `state.partialCycles` gets the amber marker and a **Discard unit** button calling `discardCycle`.
- Progress caption: `{state.completedCycles} of {targetUnits ?? '—'} units` — a target, never a blocker.
- `view === 'grid'`: a `units × items` table of thumbnails; clicking a cell sets the cursor to that slot and switches back to `'guided'`:

```tsx
<div style={{ overflowX: 'auto' }}>
  <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
    <thead>
      <tr>
        <th style={{ ...fieldLabel, textAlign: 'left', padding: 8 }}>Unit</th>
        {items.map((item) => (
          <th key={item.id} style={{ ...fieldLabel, textAlign: 'left', padding: 8 }}>
            {item.itemName}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {[...cycleIndexes, cursor.cycleIndex]
        .filter((c, i, a) => a.indexOf(c) === i)
        .sort((a, b) => a - b)
        .map((cycleIndex) => {
          const partial = state?.partialCycles?.some((pc) => pc.cycleIndex === cycleIndex);
          return (
            <tr key={cycleIndex} style={{ borderTop: `1px solid ${ui.lineSoft}` }}>
              <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                <Mono style={{ color: partial ? severity.major.fg : ui.sub }}>
                  Unit {cycleIndex + 1}
                </Mono>
                {partial && (
                  <button
                    onClick={() => startTransition(async () => {
                      const r = await discardCycle(inspection.id, cycleIndex);
                      if (r.error) setPendingError(r.error);
                      else router.refresh();
                    })}
                    style={{ marginLeft: 8, background: 'transparent', border: 'none', color: severity.major.fg, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    Discard
                  </button>
                )}
              </td>
              {items.map((item) => {
                const photo = photoBySlot.get(`${item.id}:${cycleIndex}`);
                return (
                  <td key={item.id} style={{ padding: 6 }}>
                    <div
                      onClick={() => { setCursor({ cycleIndex, itemId: item.id }); setView('guided'); }}
                      style={{ width: 72, height: 54, borderRadius: 8, cursor: 'pointer', overflow: 'hidden', border: photo ? `1px solid ${ui.line}` : `1.5px dashed #C8D0DA`, background: photo ? '#fff' : ui.fill }}
                    >
                      {photo?.viewUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={photo.viewUrl} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          );
        })}
    </tbody>
  </table>
</div>
```

- [ ] **Step 6: Wire the end gate**

```tsx
<Btn
  kind="primary"
  icon={<Check size={15} />}
  onClick={isPending ? undefined : () => {
    const partial = state?.partialCycles?.[0];
    if (partial) {
      const names = partial.missingItemIds
        .map((id) => items.find((i) => i.id === id)?.itemName ?? id);
      setEndGate({ cycleIndex: partial.cycleIndex, missing: names });
      return;
    }
    handleSubmit();
  }}
>
  End loop & review
</Btn>
```

The modal offers exactly two actions and no dismiss-to-submit path: **Finish unit N** sets the cursor to
`{ cycleIndex: partial.cycleIndex, itemId: partial.missingItemIds[0] }` and closes; **Discard unit N** calls
`discardCycle(inspection.id, partial.cycleIndex)` then `router.refresh()`.

- [ ] **Step 7: Move defects and measurements into the right rail**

- Defect tags render from the loop-global catalog and call `addDefect(inspection.id, { inspectionLoopItemId: cursor.itemId, cycleIndex: cursor.cycleIndex, … })`. Disable tagging when `cursorPhoto` is undefined — the API requires the slot to hold evidence — with the caption "Upload this item's photo first".
- "On this unit" lists every defect across all items whose `cycleIndex === cursor.cycleIndex`, each labelled with its item name.
- The measurement sheet renders one row per `loopPresetSnapshot.measurementFields` entry, prefilled from `inspection.measurements` filtered to `cursor.cycleIndex`, saving via `addMeasurement(inspection.id, { cycleIndex: cursor.cycleIndex, label, recordedValue, unit })`.

- [ ] **Step 8: Fix the report preview page**

In `report/page.tsx:52,60` replace `l.zoneName` with `l.itemName` and iterate `inspection.items`.

- [ ] **Step 9: Verify the build**

Run: `pnpm type-check && pnpm build`
Expected: PASS for both apps — the red window opened in Task 2 is now fully closed.

- [ ] **Step 10: Manual verification against the running stack**

Run: `pnpm dev`, then in the console: create a 3-item loop preset → create an inspection from it → populate two full units → confirm the guided flow auto-advances and rolls over → retake one shot and confirm the thumbnail changes without a new slot appearing → leave unit 3 half-shot → confirm **End loop & review** opens the gate → **Discard unit 3** → confirm submit succeeds.

- [ ] **Step 11: Commit**

```bash
git add apps/web/app/\(console\)/inspections
git commit -m "feat(web): guided populate cycles with grid, retake and end gate (INS-081)"
```

---

### Task 10: Documentation

**Files:**
- Modify: `docs/future/BACKLOG.md`, `docs/STATUS.md`, `CLAUDE.md`
- Move: `docs/in-progress/specs/2026-08-12-loop-items-and-populate-cycles-design.md` → `docs/done/specs/`
- Move: `docs/in-progress/plans/2026-08-12-loop-items-and-populate-cycles.md` → `docs/done/plans/`

- [ ] **Step 1: Add INS-081 to the backlog**

Add it under the HIGH band, in the file's existing entry format:

```markdown
### INS-081 · Loop model reshaped: one loop of single-image items, populate cycles per unit   [HIGH]
- status: done            # 2026-08-12: a preset IS one loop holding ordered single-image loop items; populate walks them repeatedly (one cycle per inspected unit) and can only be ended on a cycle boundary — finish the unit or discard it. Defect tags and the measurement sheet moved up to loop level; recorded defects pin to (cycle, item) and measurements to a cycle. Retake replaces a slot's bytes in place with both content hashes in the audit chain. Destructive clean-break migration (spec §9).
- area: Loop presets + populate + reports (schema, API, web)
- evidence: presets held many loops each demanding requiredShotCount photos with their own defect list (`schema.prisma:399`, `builder.tsx:169`); populate was a free-click sidebar with no notion of a unit (`populate-workspace.tsx:70`); submit only checked `photos >= requiredShotCount` per loop (`inspections.service.ts:335`), so a half-photographed garment could be submitted.
- fix: PresetLoopStep→PresetLoopItem, InspectionLoop→InspectionLoopItem, zoneName→itemName; drop requiredShotCount; hoist allowedDefects + measurementFields to LoopPreset; add cycleIndex to Photo/DefectInstance/InspectionMeasurement with @@unique([inspectionLoopItemId, cycleIndex]); pure cycleState() shared by the submit guard and the console; guided populate with grid, retake and the end gate.
- verify: `pnpm api test` + `pnpm api test:integration` green; submit mid-cycle 400s naming the unit and its missing items; discarding the partial unit lets it through; a second photo into a filled slot 409s.
- refs: spec `docs/done/specs/2026-08-12-loop-items-and-populate-cycles-design.md` · supersedes INS-075 · reverses INS-073
```

- [ ] **Step 2: Close INS-075 and annotate INS-073**

INS-075 → `status: superseded  # 2026-08-12: INS-081 answered the vocabulary question ("Loop item") and changed the schema and snapshot shapes INS-075 was written to avoid touching.`
INS-073 → append to its done note: `# 2026-08-12: superseded by INS-081 — requiredShotCount no longer exists.`

- [ ] **Step 3: Update STATUS.md**

Bump "Last verified" to the completion date; update the loop-preset and populate pillar rows to describe items + cycles.

- [ ] **Step 4: Update CLAUDE.md**

In "Domain invariants", add the one-image-per-slot and cycle-complete rules. In "Backend architecture", correct the module description so it stops describing per-step defects.

- [ ] **Step 5: Move the spec and plan to done/**

```bash
git mv docs/in-progress/specs/2026-08-12-loop-items-and-populate-cycles-design.md docs/done/specs/
git mv docs/in-progress/plans/2026-08-12-loop-items-and-populate-cycles.md docs/done/plans/
```

- [ ] **Step 6: Verify every link still resolves**

Check the relative paths in the moved spec (`../../../apps/...` becomes correct at the new depth — `docs/done/specs/` is the same depth as `docs/in-progress/specs/`, so they are unchanged) and that STATUS/BACKLOG agree with the code.

- [ ] **Step 7: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs: close INS-081, supersede INS-075, refresh STATUS (INS-081)"
```
