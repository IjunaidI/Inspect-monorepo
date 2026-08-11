# Loop items + populate cycles — design

- **Date:** 2026-08-12
- **Backlog id:** INS-081
- **Status:** design approved, plan pending
- **Supersedes:** INS-075 (the "rename Loop in UI copy" question is answered here), and reverses INS-073
  (the required-shots stepper it polished is deleted by this redesign)

## 1. Problem

The loop model does not match the product. Today a `LoopPreset` holds many *loops*, each of which demands
`requiredShotCount` photos and carries its **own** defect-tag list and measurement fields. Populate renders
those loops as a free-click sidebar: the operator picks any loop and dumps N photos into it in any order.

What the inspection actually is: a short, ordered list of **single-image capture points** — right sleeve,
left sleeve, neck hole — walked **repeatedly**, once per unit drawn from the AQL sample. The repetition is
the loop. Nothing in the current model expresses it, so the operator gets no guidance, no notion of a unit,
and no protection against submitting a half-photographed garment.

## 2. Decisions

Settled with the product owner on 2026-08-12:

| # | Question | Decision |
|---|----------|----------|
| 1 | Is a preset one loop or many? | **One.** `LoopPreset` *is* the loop; the builder page is a single-loop design tool. |
| 2 | What is a loop item? | An ordered capture point taking **exactly one** image. `requiredShotCount` is deleted. |
| 3 | Cycles vs the AQL sample size `n` | **Soft target.** `n` is displayed ("Unit 7 of 32"); more or fewer cycles are both allowed and both recorded. |
| 4 | Where do defects attach? | Tag list is **loop-global**; a recorded instance pins to **(cycle, item)** — "Unit 7, right sleeve". |
| 5 | Where do measurements live? | Sheet defined **loop-global**, recorded **once per cycle** (per unit). |
| 6 | Populate navigation | **Guided by default** (one item at a time, auto-advancing), plus a grid to jump into any slot, including finished cycles. |
| 7 | Storage of a cycle | **Index on the evidence rows**, not a table. See §3. |
| 8 | Existing data | **Clean break** — forward migration, old presets/inspections dropped. |

### 2.1 The end-of-loop rule

A loop can only be ended on a **cycle boundary**. Mid-cycle there are exactly two exits: finish the unit, or
discard it. There is no third option and no override — not in the UI, not in the API.

## 3. Data model

### 3.1 Preset side

```
LoopPreset                             // the loop itself; name + version semantics unchanged
  ├─ items: PresetLoopItem[]           // renamed from PresetLoopStep
  │    position, itemName, description?, referenceImageUrl?
  │    ✗ requiredShotCount             — deleted (an item IS one shot)
  ├─ allowedDefects: PresetAllowedDefect[]      // FK moves presetLoopStepId → loopPresetId
  └─ measurementFields: PresetMeasurementField[] // FK moves presetLoopStepId → loopPresetId
```

Renames: `PresetLoopStep` → `PresetLoopItem`, `PresetStepAllowedDefect` → `PresetAllowedDefect`,
`zoneName` → `itemName`. `referenceImageUrls String[]` collapses to `referenceImageUrl String?` — with one
capture per item, one reference illustration is the honest shape. The org-namespace prefix check on
reference keys ([loop-presets.service.ts:83-98](../../../apps/api/src/loop-presets/loop-presets.service.ts#L83))
carries over unchanged; it is a tenant-isolation control, not a shape detail.

### 3.2 Inspection side

```
Inspection
  ├─ loopPresetSnapshot   { presetId, version, items[], allowedDefects[], measurementFields[] }
  └─ items: InspectionLoopItem[]       // renamed from InspectionLoop
       position, itemName, description?, referenceImageUrl?
       ✗ requiredShotCount, ✗ allowedDefectsSnapshot

Photo                  + cycleIndex Int   @@unique([inspectionLoopItemId, cycleIndex])
                       inspectionLoopItemId String  ← now NOT NULL
DefectInstance         + cycleIndex Int?  // set together with inspectionLoopItemId
InspectionMeasurement  ✗ inspectionLoopItemId → + inspectionId + cycleIndex
                                              @@unique([inspectionId, cycleIndex, label])
```

**Unassigned photos cease to exist.** Today `Photo.inspectionLoopId` is nullable — "null until the Admin
drags it into the correct loop" — and `loadForPopulate` returns a top-level `photos[]` of orphans alongside
the per-loop ones. In a guided flow every upload targets a known slot, so both the column and the orphan
list go away. This matters beyond tidiness: a `@@unique` over a nullable pair would let unlimited NULL rows
through and silently void invariant 1. The `PATCH .../photos/:photoId/loop` endpoint
(`assignPhotoToLoop`) is deleted with it — retake (§7.3) covers the real need it was serving.

`InspectionLoop.allowedDefectsSnapshot` is deleted rather than moved: `buildPresetSnapshot`
([inspection-mapping.ts:46](../../../apps/api/src/inspections/inspection-mapping.ts#L46)) already resolves
defect **names and severities** — not just FKs — into `loopPresetSnapshot`, and that list is now loop-global.
Denormalising it per item would duplicate the same array N times.

`cycleIndex` is 0-based in storage and rendered 1-based ("Unit 7"). Existing composite tenant-aligned FKs
(INS-010) are preserved verbatim; only the loop-item link is renamed.

**To verify during implementation:** `Photo.position` (`Int?`) appears to have no reader — ordering now
derives from `(cycleIndex, item.position)`. Confirm before dropping it; leaving it is acceptable.

### 3.3 Invariants

| Invariant | Enforced by |
|---|---|
| One image per (item, cycle) | `@@unique([inspectionLoopItemId, cycleIndex])` — **database**, not UI convention |
| No partial cycle may be submitted | `InspectionsService.submit()`, replacing the `photos >= requiredShotCount` check ([inspections.service.ts:335](../../../apps/api/src/inspections/inspections.service.ts#L335)) |
| At least one complete cycle | `submit()` — preserves the INS-056 intent that a verdict never derives from missing evidence |
| A defect's `cycleIndex` names a cycle that exists | `PopulateService.addDefect()` |
| Cycle count is advisory | Nothing rejects `completedCycles != sampleSize`; both numbers land in the report |

A cycle has no row of its own — it exists because evidence carries its index. Completeness is one
`GROUP BY cycleIndex`; discarding a partial cycle is three scoped deletes. If per-unit metadata (unit serial,
carton number, per-unit capture time) is ever needed, an explicit `InspectionCycle` table is a strictly
additive follow-up that does not disturb the UI built here.

## 4. Domain core: `cycleState`

A pure, DB-free helper in `apps/api/src/inspections/cycle-state.ts`, unit-tested first (TDD), consumed by
both the submit guard and the populate read:

```ts
cycleState(items: {id: string; position: number}[],
           photos: {inspectionLoopItemId: string; cycleIndex: number}[])
  → { completedCycles: number
      partialCycle: { cycleIndex: number; missingItemIds: string[] } | null
      nextSlot: { cycleIndex: number; itemId: string }
      totalPhotos: number }
```

Keeping this pure matters: it is the rule the API enforces and the UI renders, and a divergence between the
two is exactly how a half-photographed unit would reach a signed report.

## 5. API surface

| Route | Change |
|---|---|
| `POST /loop-presets` | `steps[]` → `items[]` (no `requiredShotCount`); `allowedDefectCatalogIds` + `measurementFields` move to the top level |
| `GET /loop-presets/:id` | mirrors the above |
| `POST /inspections` | materialises `InspectionLoopItem[]` from the snapshot's `items[]` |
| `POST …/populate/photos` | `inspectionLoopItemId` + `cycleIndex` both **required**; a duplicate slot is a **409**, distinct from the existing `clientRequestId` replay/conflict contract (INS-016) |
| `PATCH …/populate/photos/:photoId/loop` | **deleted** — `assignPhotoToLoop` has no meaning once every upload targets a slot |
| `POST …/populate/photos/:photoId/retake` | **new** — see §7.3 |
| `DELETE …/populate/cycles/:cycleIndex` | **new** — discards a cycle's photos, defects and measurements in one transaction |
| `POST …/populate/defects` | accepts `cycleIndex`; `inspectionLoopItemId` + `cycleIndex` are set together or both omitted |
| `POST …/populate/measurements` | keyed by `(inspectionId, cycleIndex, label)` instead of the loop FK |
| `GET …/populate` | returns `items[]`, `cycleState`, and photos keyed by slot; the top-level orphan `photos[]` is gone |
| `POST /inspections/:id/submit` | new partial-cycle guard; error names the unit and the missing items |

`…` abbreviates `/inspections/:inspectionId` — the populate controller is mounted at
`inspections/:inspectionId/populate` and is `@Roles('PLATFORM_ADMIN')` throughout
([populate.controller.ts:23](../../../apps/api/src/populate/populate.controller.ts#L23)); the new routes
inherit that unchanged.

Every new write appends its `AuditLog` entry inside the same transaction, per the standing invariant.
Cycle discard and retake are the two that most need it — both destroy or replace evidence.

## 6. Preset builder

`/presets/new` and `/presets/[id]`. The sidebar splits into two groups, which is what makes "defects are not
per-item" self-evident without a word of explanation:

```
┌ Loop ──────────────────┐   ← loop-global config
│  ▸ Defect tags     14  │
│  ▸ Measurements     3  │
├ Items · 3 ─────────────┤   ← the ordered single-image list
│  01  Right sleeve   ▣  │
│  02  Left sleeve    ▣  │
│  03  Neck hole      ○  │      ▣ = has a reference image
│  + Add Loop Item       │
└────────────────────────┘
```

- **"Add Loop" becomes "Add Loop Item".** Sidebar header "Loops · N" becomes "Items · N"; the "N shots"
  total is deleted (it always equals the item count).
- Selecting an **item** yields a thin panel: name, description, one reference image. The shot stepper, the
  defect picker and the measurement fields are gone from it.
- Selecting **Defect tags** or **Measurements** opens the loop-level editors — the controls that exist
  today, moved up one level. Custom-defect creation stays where it is.
- Reorder (INS-052) and the versioning rules (INS-076) are untouched: same name → next version, new name → v1.

## 7. Populate

`/inspections/[id]/populate`.

```
┌ Items ─────┬──────────────────────────────┬ Unit 7 ──────────┐
│ ● 01 R.slv │   [ reference ]  [ capture ] │ Defect tags      │
│ ▶ 02 L.slv │                              │  ○ Broken stitch │
│ ○ 03 Neck  │   Left sleeve                │  ○ Stain    …    │
│            │   Item 2 of 3 · Unit 7 of 32 │ ── on this unit ─│
│ Units      │                              │  Stain (item 01) │
│ 1..6 ✓     │   ‹ Back   Upload ›  Retake  │ ── measurements ─│
│ ▶ 7  ●●○   │                              │  Chest  __ cm    │
│ ⊞ Grid     │                              │  Waist  __ cm    │
└────────────┴──────────────────────────────┴──────────────────┘
```

### 7.1 Guided flow

Upload advances to the next item; uploading the last item of a cycle rolls to item 01 of the next unit.
`Back` steps within the current cycle. The reference image sits beside the capture slot so the operator is
matching, not guessing. Defect tags come from the loop-global list and record against **the item on screen in
the current unit**. The measurement sheet is per-unit and lives in the right rail for the whole cycle — not a
separate end-of-unit interstitial.

### 7.2 Grid

Toggles a **units × items** matrix; every slot is clickable, including in completed units, and jumps the
guided view to that slot. Partial cycles carry an amber row marker and a **Discard unit** action.

### 7.3 Retake

Any slot that already holds a photo offers **Retake**, in the guided view and from the grid, in the current
cycle or any earlier one. It is a pre-submit action only — the `LOCKED` status set
([populate.service.ts:49](../../../apps/api/src/populate/populate.service.ts#L49)) rejects it once the
inspection is submitted, per the immutability invariant.

Mechanically: presign → PUT bytes → `POST /inspections/:id/photos/:photoId/retake`, which **updates the row
in place** (new `storageKey`, `contentHash`, `capturedAt`, uploader) inside a transaction that appends a
`populate.photoRetaken` audit entry carrying **both** content hashes. In-place update is chosen over
delete-and-insert because the slot is the identity: defect links (`DefectInstancePhoto`) survive untouched,
the unique constraint is never transiently violated, and the audit chain — not the row's mutability — is what
carries provenance. The superseded object is left in storage; the audit entry names its hash, and MVP has no
object-lifecycle policy.

### 7.4 The end gate

The primary action is **End loop & review**. Mid-cycle it opens a modal offering exactly two paths:

> **Unit 7 is incomplete** — 2 of 3 items shot.
> **[ Finish unit 7 ]** jumps to the first missing item · **[ Discard unit 7 ]** deletes that unit's photos,
> defects and measurements.

The API enforces the same rule independently in `submit()`, listing the unit and its missing items in the
400. The UI gate is a convenience; the API gate is the guarantee.

## 8. Report and AQL

- **`evaluateInspection` is untouched.** Defect counts by class do not care about cycles.
- **Canonical snapshot:** `loops[]` → `items[]`; photo entries carry `{itemPosition, cycleIndex}`; the
  snapshot gains `cyclesCompleted` and `sampleSize` so evidence depth versus the sampling plan is visible to
  the buyer rather than silently equivalent.
- **PDF:** photo evidence groups by unit; the measurement sheet becomes a unit × field table; the defect
  narrative reads "Unit 7 · Right sleeve". `zoneByLoopId` in
  [report-pdf.ts:741](../../../apps/api/src/reports/report-pdf.ts#L741) is rewritten against the new shape.
- **Signing is unchanged.** `contentHash` still covers the canonical payload plus ordered photo hashes;
  `verify` recomputes from whatever was stored. Only the payload shape moves — which is safe *because* of the
  clean break in §9. Reports signed under the old shape would not survive it.

## 9. Migration

Clean break, per decision 8. One forward Prisma migration that reshapes the tables and drops the rows in
`loop_presets`, `preset_loop_steps`, `inspections`, `inspection_loops`, `photos`, `defect_instances`,
`inspection_measurements`, `reports`. The global defect library (`defect_catalog`, `orgId IS NULL`) and all
org/user/buyer/supplier/product/PO data survive; re-run the seed afterwards.

This is destructive and irreversible. It is acceptable only because the product is pre-launch and no buyer
holds a signed report that would fail verification afterwards — a fact to re-confirm at execution time, not
assume. The migration is a one-way door: rehearse on a scratch database first.

## 10. Testing

**Unit (no DB)** — the pure core, TDD-first:
- `cycleState`: empty inspection; one complete cycle; partial cycle names its missing items; out-of-order
  uploads; a hole in the middle of an otherwise complete cycle; `nextSlot` after a full cycle rolls to the
  next unit's first item.
- `buildPresetSnapshot` with loop-global defects and measurement fields.

**Integration (`pnpm api test:integration`, real Postgres/Redis/S3):**
- Full loop: create a 3-item preset → inspection → populate two complete cycles → submit → report.
- Submit blocked mid-cycle; the 400 names the unit and the missing items.
- Discard the partial unit, then submit succeeds.
- A second photo into an occupied slot is rejected (409), and the `clientRequestId` replay contract
  (INS-016) still behaves distinctly from a slot collision.
- Retake replaces the bytes, preserves defect links, and appends an audit entry carrying both hashes.
- Submitted inspection rejects retake and cycle-discard.

## 11. Out of scope

- Explicit `InspectionCycle` rows and per-unit metadata (§3.3) — additive follow-up if ever needed.
- Skipping an item within a cycle. Every item is required; an unshootable item means discarding the unit or
  editing the loop (which is a new preset version).
- Mobile capture — still Phase 2.
- Per-item defect overrides. Deliberately removed, not deferred.

## 12. Doc updates on completion

1. Add **INS-081** to [BACKLOG.md](../../future/BACKLOG.md); flip it to `done` when verified.
2. Close **INS-075** as superseded — the vocabulary decision is "Loop item", and this change touches the
   schema and snapshots that INS-075 was written to avoid touching.
3. Note on **INS-073** that the control it fixed no longer exists.
4. Update [STATUS.md](../../STATUS.md) — "Last verified" date and the loop-preset/populate pillar rows.
5. Move this spec and its plan to `docs/done/` on merge, keeping the dated filenames.
