# Plan: Web Inspections Lifecycle — Populate, Report, Verify, Filters, Re-inspection

**For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` or
`superpowers:executing-plans`. All steps below use `- [ ]` checkboxes. Do not begin coding
until you have read every reference file cited in "Pattern" and "Current state" sections.

---

## Goal

Complete the inspections experience beyond the already-merged create→submit→decide spine
(INS-026/INS-027 done). Framing: **adding** (create — DONE) → **updating** (populate/enrich)
→ **starting/running** (populate → submit → decide → report → verify).

Concretely this plan wires:
1. **Populate** (`/inspections/[id]/populate`) — Platform Admin uploads photos + tags defects +
   logs measurements then submits for review (INS-023).
2. **Report generation & preview** (`/inspections/[id]/report`) — QA Manager generates the
   Ed25519-signed report and sees live branded preview (INS-033).
3. **Public verification** (`/r/[token]`) — unauthenticated buyer verifies a report token
   (INS-017).
4. **List filters/search** on `/inspections` — `?status=` query param (INS-032, scoped to
   inspection list only).
5. **Re-inspection** — create a linked replacement from a REJECTED/HOLD inspection review page
   using `supersedesInspectionId`.

---

## Architecture

```
apps/web/
├── lib/api.ts                             # extend shapes: ApiPhoto, ApiDefectInstance,
│                                          #   ApiReport, ApiVerifyResult, populate inputs
├── app/(console)/
│   ├── inspections/
│   │   ├── page.tsx                       # EXTEND: add ?status= filter bar (INS-032)
│   │   ├── actions.ts                     # EXTEND: add reInspection()
│   │   └── [id]/
│   │       ├── review/page.tsx            # EXTEND: add Populate / Generate report /
│   │       │                              #   Re-inspect links based on status
│   │       ├── populate/
│   │       │   ├── page.tsx               # NEW: Server Component — load inspection +
│   │       │   │                          #   defect catalog, render <PopulateWorkspace>
│   │       │   └── actions.ts             # NEW: presignPhoto, registerPhoto,
│   │       │                              #   assignPhotoToLoop, addDefect, addMeasurement
│   │       └── report/
│   │           └── page.tsx               # NEW: Server Component — POST generate if absent,
│   │                                      #   load report, render <BrandedReport data=…>
└── app/r/[token]/
    └── page.tsx                           # NEW: PUBLIC — GET /reports/verify/:token,
                                           #   show badge + provenance (INS-017)

components/inspect/
└── branded-report.tsx                     # REFACTOR: accept typed `data` prop;
                                           #   keep existing static markup, replace hardcoded
                                           #   consts with props (INS-033)
```

**Two-principal split:**
- `/inspections/[id]/populate` — **PLATFORM_ADMIN only**. The API `orgId` for the inspection is
  resolved server-side from the inspection record (not the caller's session `orgId`, which is
  `null` for Platform Admin). The page must be accessible only by Platform Admin; show a 403
  message for any lesser role.
- `/inspections/[id]/report`, review links, re-inspection — **QA_MANAGER+** (mirrors existing
  decide flow).
- `/r/[token]` — **PUBLIC** (no auth, outside the `(console)` route group).

---

## Tech Stack

- **Next.js 15 App Router** — Server Components read (via `apiGet`) + `'use server'` actions
  (via `apiPost`/`apiPatch`) + `'use client'` workspace component.
- **Styling** — inline styles only, existing token vocabulary (`ui`, `severity`, `mono`,
  `aqlPlan` from `components/inspect/tokens.ts`). No Tailwind, no CSS modules, no new library.
- **No new runtime dependencies** — photo byte upload uses the browser's native `fetch` against
  the presigned URL; everything else is existing Next.js + server-action patterns.
- **Shapes** — defined locally in `lib/api.ts` (INS-008 not yet linked; do not add
  `@inspect/shared-types` dependency here).

---

## Global Constraints

- No new runtime dependencies in either app.
- All writes via `'use server'` actions calling `apiPost`/`apiPatch` from `lib/api.ts`; catch
  `ApiError` → return `{ error }` from the action; call `redirect()` **outside** try/catch
  (Next.js `redirect` throws internally).
- Token is server-side only — never expose the bearer JWT to the client. The presigned-URL
  fetch to MinIO/S3 is a plain `PUT` from the browser with no auth header.
- Reuse `BrandedReport`, `Btn`, `Mono`, `SeverityTag`, `PageHead`, `UnverifiedBadge` from the
  existing component vocabulary. Do not introduce a second component system.
- After every task: `pnpm type-check` (both apps, zero errors) must pass.
- API unit tests must stay green: `pnpm --filter @inspect/api test` (100 tests expected after
  INS-007 adds populate specs; baseline is 97).
- Web has no unit runner — verified by strict type-check + manual walkthrough:
  - **Populate** requires a PLATFORM_ADMIN login: `admin@inspect.local` / password from root
    `.env` `BOOTSTRAP_ADMIN_PASSWORD`. API on `:3000`, web on `:3001`.
  - **QA flows** (review, report, re-inspect) use: `devowner@inspect.local` / `Devowner!123`.
- The public `/r/[token]` page is outside `(console)` — it must not import the shell layout.

---

## Current State (audit)

The **spine is done** (INS-026 + INS-027 + INS-028 merged): create-inspection form, live AQL
preview, inspections list, `[id]/review` with submit + QA decision, session-aware shell with
sign-out.

The following screens are **fully static and must be wired** by this plan:

| Screen | File | Static evidence |
|---|---|---|
| Populate | `apps/web/app/(console)/populate/page.tsx` | Route `/populate` — not parameterized by inspection id (lines 43–48). PO number (`PO-2026-04812`) hardcoded line 46; status "Populating" hardcoded line 51. `popLoops` const lines 8–15; `collarSlots` lines 17–23; `collarTags` lines 25–29. Progress bar `'46%'` line 73; photo counts `13/28` line 70. All actions inert: Save line 57, Submit for review line 58, Upload photos line 104, slot drop zones lines 119–121, slot MoreVertical line 128, loop sidebar items non-interactive lines 80–90, eye icon line 116, defect pills lines 147–150, +Custom lines 153–155, measurement inputs uncontrolled line 170, +Add measurement point lines 174–176. Active loop permanently "Collar & neckline" (line 100). |
| Report preview | `apps/web/app/(console)/report/page.tsx` | Route `/report` — not parameterized (lines 1–11); renders `<BrandedReport width="100%"/>` with zero data prop. `BrandedReport` in `components/inspect/branded-report.tsx` imports hardcoded `reportData` const lines 6–21; hardcoded `reportClasses` lines 23–27; fake hash/signer in footer ~lines 197–209; component signature `{ width? }` only (line 42). No API calls anywhere. |
| Public verify | — | No `/r/[token]` or `/reports/verify/[token]` route exists anywhere under `apps/web/app`. The `/portal` guest screen is a separate static mock (INS-025, out of scope here). |

---

## File Inventory

### New files
- `apps/web/app/(console)/inspections/[id]/populate/page.tsx` — Server Component
- `apps/web/app/(console)/inspections/[id]/populate/actions.ts` — Server Actions
- `apps/web/app/(console)/inspections/[id]/populate/populate-workspace.tsx` — `'use client'`
- `apps/web/app/(console)/inspections/[id]/report/page.tsx` — Server Component
- `apps/web/app/r/[token]/page.tsx` — PUBLIC Server Component (outside console group)

### Modified files
- `apps/web/lib/api.ts` — add `ApiPhoto`, `ApiDefectInstance`, `ApiReport`,
  `ApiVerifyResult`, `ApiDefectCatalogItem`, `PresignResult`, populate input types
- `apps/web/components/inspect/branded-report.tsx` — refactor to accept `BrandedReportData`
  prop; delete hardcoded `reportData` + `reportClasses` consts
- `apps/web/app/(console)/inspections/actions.ts` — add `reInspection()`
- `apps/web/app/(console)/inspections/page.tsx` — add `?status=` filter bar
- `apps/web/app/(console)/inspections/[id]/review/page.tsx` — add Populate / Generate report
  / Re-inspect contextual links

### Old file to leave in place (do not delete)
- `apps/web/app/(console)/populate/page.tsx` — the flat `/populate` route. Once the
  parameterized route is wired and linked from review, this legacy page can be removed in a
  follow-up cleanup. **Do not delete it in this plan** — it is not linked from nav.

---

## Tasks

### Task A — Extend lib/api.ts shapes

**Files:** `apps/web/lib/api.ts`

**Interfaces to add (exact signatures):**

```ts
// Populate API: presign
export interface PresignResult {
  storageKey: string;
  uploadUrl: string;
  method: 'PUT';
}

// Populate inputs (mirror the API body shapes exactly)
export interface RegisterPhotoInput {
  storageKey: string;
  contentHash: string;
  inspectionLoopId?: string;
  thumbnailKey?: string;
  capturedAt?: string;
  deviceId?: string;
  gps?: string;
  exif?: Record<string, unknown>;
  clientRequestId?: string;
}

export interface AddDefectInput {
  defectCatalogId?: string;    // XOR with customText
  customText?: string;
  severity?: 'CRITICAL' | 'MAJOR' | 'MINOR';
  inspectionLoopId?: string;
  notes?: string;
  photoIds?: string[];
}

export interface AddMeasurementInput {
  inspectionLoopId: string;
  label: string;
  recordedValue?: string;
  unit?: string;
  notes?: string;
}

export interface ApiPhoto {
  id: string;
  storageKey: string;
  contentHash?: string | null;
  inspectionLoopId?: string | null;
  capturedAt?: string | null;
  clientRequestId?: string | null;
}

export interface ApiDefectCatalogItem {
  id: string;
  name: string;
  severity: 'CRITICAL' | 'MAJOR' | 'MINOR';
  category?: string | null;
}

export interface ApiDefectInstance {
  id: string;
  severity: 'CRITICAL' | 'MAJOR' | 'MINOR';
  defectCatalog?: { id: string; name: string } | null;
  customText?: string | null;
  inspectionLoopId?: string | null;
  notes?: string | null;
}

export interface ApiMeasurement {
  id: string;
  label: string;
  recordedValue?: string | null;
  unit?: string | null;
  inspectionLoopId?: string | null;
}

export interface ApiInspectionLoop {
  id: string;
  name: string;
  orderIndex: number;
  requiredPhotoCount?: number | null;
  photos?: ApiPhoto[];
  defects?: ApiDefectInstance[];
  measurements?: ApiMeasurement[];
}

// Extend ApiInspection to include loops, photos, defects (already returned by GET /inspections/:id)
// Add to the existing interface:
//   loops?: ApiInspectionLoop[];
//   inspectorId?: string | null;
//   supersedesInspectionId?: string | null;

export interface ApiReport {
  id: string;
  inspectionId: string;
  reportNo?: string | null;
  canonicalSnapshot?: Record<string, unknown> | null;
  contentHash?: string | null;
  signatureHex?: string | null;
  pdfStorageKey?: string | null;    // null until INS-003 (PDF rendering) is done
  generatedAt: string;
  generatedBy?: { id: string; name: string } | null;
}

export interface ApiVerifyResult {
  valid: boolean;
  hashMatches: boolean;
  signatureValid: boolean;
  reportId?: string | null;
  inspectionId?: string | null;
  generatedAt?: string | null;
}
```

**Steps:**
- [ ] Open `apps/web/lib/api.ts` and append all interfaces above after the existing `AqlPreview`
  interface (line 150).
- [ ] Extend the existing `ApiInspection` interface (line 131) to add:
  `loops?: ApiInspectionLoop[]; inspectorId?: string | null; supersedesInspectionId?: string | null;`
- [ ] Run `pnpm type-check` — zero errors before proceeding.

**Verify:** `pnpm type-check` passes. No runtime test required for this task.

---

### Task B — populate/actions.ts Server Actions

**Files:** `apps/web/app/(console)/inspections/[id]/populate/actions.ts` (new)

**Purpose:** Five server actions called by `<PopulateWorkspace>`, plus a shared error helper.
The presign + PUT-to-URL pattern requires both a server action (presign) and a client-side
fetch (byte upload). The byte upload is gated on MinIO being up (INS-023); the DB-side
registration works without it.

**Exact function signatures:**

```ts
'use server';
// Pattern: catch ApiError → { error }; redirect() outside try/catch.

// 1. Presign a photo upload slot
export async function presignPhoto(
  inspectionId: string
): Promise<{ data?: PresignResult; error?: string }>

// 2. Register photo metadata in the DB (persists even if MinIO is down)
export async function registerPhoto(
  inspectionId: string,
  input: RegisterPhotoInput
): Promise<{ data?: ApiPhoto; error?: string }>

// 3. Assign an already-registered photo to an inspection loop
export async function assignPhotoToLoop(
  inspectionId: string,
  photoId: string,
  inspectionLoopId: string
): Promise<{ error?: string }>

// 4. Tag a defect on the current loop
export async function addDefect(
  inspectionId: string,
  input: AddDefectInput
): Promise<{ data?: ApiDefectInstance; error?: string }>

// 5. Log a measurement on the current loop
export async function addMeasurement(
  inspectionId: string,
  input: AddMeasurementInput
): Promise<{ data?: ApiMeasurement; error?: string }>
```

**Key implementation notes:**

- `presignPhoto` calls `apiPost<PresignResult>(\`/inspections/${inspectionId}/populate/photos/presign\`, {})`.
- `registerPhoto` calls `apiPost<ApiPhoto>(\`/inspections/${inspectionId}/populate/photos\`, input)`.
- `assignPhotoToLoop` calls `apiPatch(\`/inspections/${inspectionId}/populate/photos/${photoId}/loop\`, { inspectionLoopId })`.
- `addDefect` calls `apiPost(\`/inspections/${inspectionId}/populate/defects\`, input)`. Enforce
  the XOR client-side in `<PopulateWorkspace>` before calling (pass either `defectCatalogId` or
  `customText`, never both, never neither).
- `addMeasurement` calls `apiPost(\`/inspections/${inspectionId}/populate/measurements\`, input)`.
- The **client-side PUT helper** is NOT a server action — it runs in the browser:
  ```ts
  // In populate-workspace.tsx (client component)
  async function uploadBytesToPresignedUrl(uploadUrl: string, file: File): Promise<void> {
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  }
  ```
  **Note — MinIO gate (INS-023):** The presigned URL returned by the API is only valid when
  MinIO/S3 is running. Until then, `uploadBytesToPresignedUrl` will throw (likely ECONNREFUSED
  or a non-2xx from the PUT). The DB registration via `registerPhoto` succeeds independently.
  Structure the upload flow so that if the PUT throws, the error is shown inline but the photo
  metadata can still be registered (for testing purposes during development without MinIO). Mark
  any manual verify step that requires actual byte persistence as "gated on MinIO (INS-023)".

**Steps:**
- [ ] Create `apps/web/app/(console)/inspections/[id]/populate/actions.ts` with `'use server'`
  at top.
- [ ] Import `apiPost`, `apiPatch`, `ApiError`, and the populate input/output types from
  `@/lib/api`.
- [ ] Implement `presignPhoto` — `apiPost` the presign endpoint; catch `ApiError` → `{ error }`.
- [ ] Implement `registerPhoto` — `apiPost` photo metadata; `clientRequestId` is generated
  client-side (UUID or `web-${Date.now()}`) and passed in as part of `input`.
- [ ] Implement `assignPhotoToLoop` — `apiPatch` the loop-assignment endpoint.
- [ ] Implement `addDefect` — `apiPost`; return `{ data }` on success.
- [ ] Implement `addMeasurement` — `apiPost`; return `{ data }` on success.
- [ ] Run `pnpm type-check` — zero errors.

**Verify:**
- `pnpm type-check` passes (type-only check; no runtime needed for actions alone).
- With API + DB running (`pnpm api dev`): call `presignPhoto` from a server action test or the
  populate page and confirm the API returns `{ storageKey, uploadUrl, method:'PUT' }` in the
  log / network tab. This does NOT require MinIO.
- `registerPhoto` with a fake `storageKey` + a real sha256 hex string writes a `Photo` row
  (confirm via Prisma Studio). MinIO not required.

---

### Task C — Populate workspace page + client component

**Files:**
- `apps/web/app/(console)/inspections/[id]/populate/page.tsx` (new — Server Component)
- `apps/web/app/(console)/inspections/[id]/populate/populate-workspace.tsx` (new — `'use client'`)

**Purpose:** Replace the flat static `/populate` with a parameterized, fully interactive
workspace accessible at `/inspections/[id]/populate`. Platform Admin only.

#### C.1 — Server Component (page.tsx)

```ts
// Loads inspection + defect catalog; gates on PLATFORM_ADMIN role.
export default async function PopulatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // 1. Verify caller is PLATFORM_ADMIN
  const session = await auth() as { role?: string } | null;
  if (session?.role !== 'PLATFORM_ADMIN') {
    return <div style={{ padding: '24px 32px' }}>Access restricted to Platform Admin.</div>;
  }
  // 2. Load inspection (includes loops, photos, defects, measurements via GET /inspections/:id)
  let inspection: ApiInspection | null = null;
  try { inspection = await apiGet<ApiInspection>(`/inspections/${id}`); }
  catch { inspection = null; }
  if (!inspection) {
    return <div style={{ padding: '24px 32px' }}>Inspection not found.</div>;
  }
  // 3. Load defect catalog
  const catalog = await apiGet<ApiDefectCatalogItem[]>('/defect-catalog').catch(() => []);
  // 4. Render client workspace
  return <PopulateWorkspace inspection={inspection} catalog={catalog} />;
}
```

#### C.2 — Client component (populate-workspace.tsx)

The client component is the full interactive workspace. **Start from the existing static markup
in `apps/web/app/(console)/populate/page.tsx`; parameterize by `inspectionId`, replace all
hardcoded consts (`popLoops`, `collarSlots`, `collarTags`, progress, PO number, product name)
with live data derived from the `inspection` prop, and wire all handlers as described below.**
Do not reproduce all the static JSX in this plan — use the existing file as the starting point.

**Key state:**
```ts
const [activeLoopId, setActiveLoopId] = useState<string>(
  inspection.loops?.[0]?.id ?? ''
);
const [pendingError, setPendingError] = useState<string>();
const [isPending, startTransition] = useTransition();
// Per-loop defect state derived from inspection.loops[i].defects
// Per-loop measurement state derived from inspection.loops[i].measurements
// Per-loop photo state derived from inspection.loops[i].photos
```

**Loop sidebar:** Replace `popLoops` const with `inspection.loops` (sorted by `orderIndex`).
Display `loop.photos.length` / `loop.requiredPhotoCount` per loop. Active loop highlight
controlled by `activeLoopId` state.

**Progress bar:** Compute `totalFilled / totalRequired` from all loops' photo counts.

**Photo upload handler (the core flow):**
```ts
async function handlePhotoUpload(file: File) {
  startTransition(async () => {
    // Step 1: presign (server action — no MinIO contact)
    const presign = await presignPhoto(inspection.id);
    if (presign.error) { setPendingError(presign.error); return; }
    // Step 2: PUT bytes to presigned URL (browser fetch — GATED ON MinIO/INS-023)
    try {
      await uploadBytesToPresignedUrl(presign.data!.uploadUrl, file);
    } catch (e) {
      // Show warning but continue to step 3 so metadata is persisted for dev testing
      setPendingError(`Storage upload failed (MinIO not running?): ${String(e)}`);
    }
    // Step 3: compute contentHash client-side (SHA-256 via SubtleCrypto)
    const hash = await sha256Hex(file);
    // Step 4: register metadata in DB (works without MinIO)
    const reg = await registerPhoto(inspection.id, {
      storageKey: presign.data!.storageKey,
      contentHash: hash,
      inspectionLoopId: activeLoopId || undefined,
      clientRequestId: `web-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
    if (reg.error) { setPendingError(reg.error); return; }
    router.refresh(); // re-fetch inspection to update photo list
  });
}

// SHA-256 helper (client-side, zero deps, uses SubtleCrypto)
async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

**Drag-and-drop / file input:** Wire `<input type="file" accept="image/*">` (hidden, triggered
by the slot "Drop photo" click) to `handlePhotoUpload`. The MoreVertical slot menu can remain
inert in this slice (no slot-level delete in MVP).

**Defect tagging handler:**
```ts
async function handleDefectToggle(catalogItem: ApiDefectCatalogItem, currentlyOn: boolean) {
  if (currentlyOn) return; // MVP: no defect removal from UI (tagged defects are immutable)
  startTransition(async () => {
    const r = await addDefect(inspection.id, {
      defectCatalogId: catalogItem.id,
      severity: catalogItem.severity,
      inspectionLoopId: activeLoopId || undefined,
    });
    if (r.error) setPendingError(r.error);
    else router.refresh();
  });
}

async function handleCustomDefect(text: string, severity: 'CRITICAL' | 'MAJOR' | 'MINOR') {
  startTransition(async () => {
    const r = await addDefect(inspection.id, {
      customText: text,
      severity,
      inspectionLoopId: activeLoopId || undefined,
    });
    if (r.error) setPendingError(r.error);
    else router.refresh();
  });
}
```

**+Custom defect:** Show a small inline text input (on `+Custom` click; toggle visibility with
`useState<SeverityKey | null>`). On submit, call `handleCustomDefect`.

**Defect pills:** Derive active tags from `activeLoop.defects`. A catalog item pill is "on"
when the active loop's `defects` contains a `DefectInstance` referencing that `defectCatalogId`.

**Measurement handler:**
```ts
async function handleMeasurementSave(label: string, value: string, unit: string) {
  startTransition(async () => {
    const r = await addMeasurement(inspection.id, {
      inspectionLoopId: activeLoopId,
      label,
      recordedValue: value,
      unit,
    });
    if (r.error) setPendingError(r.error);
    else router.refresh();
  });
}
```

**Measurement rows:** Render `activeLoop.measurements`. Each row's value field is a controlled
`<input>` that calls `handleMeasurementSave` on blur (not on every keystroke). "+Add measurement
point" opens a new blank row.

**Submit for review:** Reuse the existing `submitInspection(id)` action from
`apps/web/app/(console)/inspections/actions.ts`. On success, `redirect(`/inspections/${id}/review`)`.
Note: in the original spine the Submit button lives on the review page. After this plan lands
it migrates to the populate workspace (Platform Admin submits after populating), and the review
page retains it as a fallback for non-Admin roles.

**Header breadcrumb:** Replace hardcoded `PO-2026-04812` with
`inspection.purchaseOrder?.poNumber ?? id.slice(0, 8)`.

**Steps:**
- [ ] Create `populate/page.tsx` — server component as specified in C.1.
- [ ] Create `populate-workspace.tsx` — `'use client'`; import `useTransition`, `useState`,
  `useRouter` from React/Next.js; import the five server actions from `./actions`; import
  `submitInspection` from `../../actions`; import primitives from
  `@/components/inspect/shell` + tokens.
- [ ] Start from the existing markup in `apps/web/app/(console)/populate/page.tsx`; replace
  all hardcoded consts with props/state as described above.
- [ ] Wire `activeLoopId` state to loop sidebar clicks.
- [ ] Wire photo upload: hidden `<input type="file">` → `handlePhotoUpload`.
- [ ] Render `activeLoop.photos` in the slot grid using `storageKey`-derived thumbnail URLs
  (for now: show the `storageKey` as a label + the `UnverifiedBadge` on every photo; full
  `<img src=presigned-get-url>` thumbnail rendering is gated on MinIO/INS-023).
- [ ] Wire defect pills: derive "on" state from `activeLoop.defects`; call
  `handleDefectToggle` on click.
- [ ] Wire +Custom: toggle inline input; on submit call `handleCustomDefect`.
- [ ] Wire measurement rows: controlled inputs; on blur call `handleMeasurementSave`.
- [ ] Wire +Add measurement point to append a blank row.
- [ ] Wire Submit for review → `submitInspection(id)` + redirect.
- [ ] Run `pnpm type-check` — zero errors.

**Verify:**
- `pnpm type-check` passes.
- Login as `admin@inspect.local` (password: `BOOTSTRAP_ADMIN_PASSWORD` from root `.env`).
  Navigate to `/inspections/<id>/populate` for a DRAFT inspection.
- Confirm loop sidebar shows real loops from the inspection.
- Click a loop — active loop panel updates.
- Click "Upload photos" / drop zone — file picker opens. Selecting an image:
  - Presign succeeds (network tab: POST `/inspections/:id/populate/photos/presign` → 201).
  - Registration succeeds (POST `/inspections/:id/populate/photos` → 201) — the `Photo` row
    appears in Prisma Studio. **MinIO PUT is expected to fail if MinIO is not running; the
    error is shown inline but does not block the metadata registration.**
- Click a defect pill → it toggles to "on" on refresh.
- Enter a measurement label + value + blur → row persists on refresh.
- Submit for review → redirects to review page, status = SUBMITTED.
- **Full byte-upload verification** (photo actually stored in MinIO) is gated on MinIO
  running (INS-023).

---

### Task D — BrandedReport data prop refactor + report route

**Files:**
- `components/inspect/branded-report.tsx` — refactor
- `apps/web/app/(console)/inspections/[id]/report/page.tsx` — new

#### D.1 — Refactor BrandedReport

The component currently has signature `{ width? }` (line 42) and reads from a module-level
`reportData` const (lines 6–21) and `reportClasses` (lines 23–27). These must become a typed
`data` prop so the component can render live inspection data.

**New prop type:**
```ts
export interface BrandedReportData {
  buyer: {
    name: string;
    initials: string;
    color: string;       // primaryColor from buyer record, e.g. '#1457A3'
    loc?: string | null;
  };
  meta: {
    reportNo?: string | null;
    po: string;
    product: string;
    sku?: string | null;
    supplier: string;
    supplierLoc?: string | null;
    inspector?: string | null;
    type: string;        // 'Pre-shipment (FRI)'
    date: string;        // ISO date string
    gps?: string | null;
  };
  conclusion: 'pass' | 'fail' | 'hold';
  qaRemarks?: string | null;
  samplingPlan?: {
    sampleSize: number;
    codeLetter: string;
    lotSize: number;
  } | null;
  classes: {
    sev: 'critical' | 'major' | 'minor';
    aql: number | string;
    found: number;
    ac: number;
    re: number;
  }[];
  photos?: {
    loop: string;
    shots: ApiPhoto[];
    flaggedCount: number;
  }[];
  measurements?: {
    loop: string;
    items: ApiMeasurement[];
  }[];
  tamperProof?: {
    contentHash?: string | null;
    signedBy?: string | null;
    signedAt?: string | null;
  } | null;
}

export function BrandedReport({
  data,
  width = 900,
}: {
  data: BrandedReportData;
  width?: number | string;
})
```

**Refactor steps:**
- Delete the module-level `export const reportData = { … }` const (lines 6–21).
- Delete `const reportClasses` (lines 23–27).
- Replace all references to `reportData.buyer` → `data.buyer`, `reportData.meta` → `data.meta`,
  `reportData.conclusion` → `data.conclusion`, `reportClasses` → `data.classes`.
- In the footer tamper-proof block, render `data.tamperProof?.contentHash` and
  `data.tamperProof?.signedBy` (or "—" if not yet available, i.e. until INS-003).
- In the photo evidence section, render `data.photos` (each photo shows `UnverifiedBadge`; the
  actual `<img>` thumbnail is gated on MinIO/INS-023 — render a placeholder gradient or the
  `storageKey` label until then).
- In the measurement sheet section, render `data.measurements`.
- Keep all existing JSX structure intact — only replace hardcoded const references with prop
  accesses and add graceful `?? '—'` fallbacks for nullable fields.
- Export `BrandedReportData` type from the file for use by the report page.

**Note on `apps/web/app/(console)/report/page.tsx` (the old flat route):** This static page
at `/report` (un-parameterized) can be left as-is for now — its `<BrandedReport width="100%"/>`
call will break the type signature after the refactor. **Update it** to pass a minimal static
data prop (matching the old `reportData` + `reportClasses` consts — just move the hardcoded
values inline as `data={{ … }}`) so it continues to type-check and can serve as a visual
preview stub.

#### D.2 — Report route page.tsx

```ts
// apps/web/app/(console)/inspections/[id]/report/page.tsx
// Server Component — QA_MANAGER+ only.

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // 1. Load inspection to get buyer branding + meta
  const inspection = await apiGet<ApiInspection>(`/inspections/${id}`).catch(() => null);
  if (!inspection) return <div style={{ padding: '24px 32px' }}>Inspection not found.</div>;

  // 2. Generate report if not yet issued (idempotent POST)
  let report: ApiReport | null = null;
  if (inspection.status === 'APPROVED' || inspection.status === 'REPORT_ISSUED') {
    try {
      // POST /inspections/:id/report is idempotent — returns the existing report if present
      report = await apiPost<ApiReport>(`/inspections/${id}/report`);
    } catch (e) {
      // May fail if status is not yet APPROVED — show inline error
    }
  }

  // 3. Map inspection + report → BrandedReportData
  const data = mapToReportData(inspection, report);

  // 4. Render
  return (
    <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 16, background: '#EEF1F5', minHeight: '100%' }}>
      {!report && (
        <div style={{ background: '#FAF1E2', border: '1px solid #EBD9B4', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: '#B5791A' }}>
          Report not yet generated. Status must be APPROVED. Current status: <strong>{inspection.status}</strong>
        </div>
      )}
      {report?.pdfStorageKey == null && report && (
        <div style={{ background: '#EAF3FB', border: '1px solid #BDD6EE', borderRadius: 8, padding: '10px 16px', fontSize: 12.5, color: '#1457A3' }}>
          PDF binary not yet rendered (INS-003 pending). Preview shown from live data. Download unavailable.
        </div>
      )}
      <div style={{ maxWidth: 880, margin: '0 auto', width: '100%', boxShadow: '0 4px 24px rgba(11,18,32,0.12)', borderRadius: 8, overflow: 'hidden' }}>
        <BrandedReport data={data} width="100%" />
      </div>
    </div>
  );
}
```

**`mapToReportData` helper** (can be a local function in the same file):
- `buyer.name` ← `inspection.buyer?.name ?? '—'`
- `buyer.color` ← fetched buyer's `primaryColor` (may need an additional `GET /buyers/:id` if
  not already in the inspection shape) or fall back to `'#1457A3'` (Inspect blue).
- `buyer.initials` ← first letter of each word in buyer name.
- `meta.po` ← `inspection.purchaseOrder?.poNumber ?? '—'`
- `meta.product` ← `inspection.product?.styleNumber ?? '—'`
- `meta.supplier` ← `inspection.supplier?.name ?? '—'`
- `meta.date` ← `report?.generatedAt ?? new Date().toISOString().slice(0, 10)`
- `conclusion` ← map `inspection.aqlResult?.qaDecision` to `'pass' | 'fail' | 'hold'`;
  default to `'fail'` if unknown.
- `classes` ← `inspection.aqlResult?.perClass` → flatten to the three severity rows;
  `aql` from `inspection.computedSampling?.perClass`.
- `tamperProof.contentHash` ← `report?.contentHash`
- `tamperProof.signedBy` ← `report?.generatedBy?.name`
- Photos and measurements ← from `inspection.loops` (once Task C populates them).

**Steps:**
- [ ] D.1: Refactor `branded-report.tsx` — add `BrandedReportData` interface, update component
  signature to `{ data: BrandedReportData; width? }`, remove module-level consts, replace all
  const references with prop accesses, add `?? '—'` fallbacks.
- [ ] D.1: Update old `/report/page.tsx` to pass the hardcoded values inline as a `data` prop
  so it type-checks (prevents a type error on the flat-route stub).
- [ ] D.2: Create `apps/web/app/(console)/inspections/[id]/report/page.tsx` as shown above.
- [ ] D.2: Implement `mapToReportData(inspection, report)` local helper.
- [ ] Run `pnpm type-check` — zero errors.

**Verify:**
- `pnpm type-check` passes (both apps).
- Login as `devowner@inspect.local` / `Devowner!123`. Navigate to
  `/inspections/<approved-id>/report` (use an inspection with status APPROVED).
- Confirm the page calls `POST /inspections/:id/report` (network tab → 201/200).
- `BrandedReport` renders with real buyer name, PO, product, AQL classes from the inspection.
- The tamper-proof footer shows the real `contentHash` and `generatedBy` name (not the fake
  hardcoded values).
- The "Download PDF" path is **not wired** in this plan (gated on INS-003). The banner "PDF
  binary not yet rendered" should be visible.

---

### Task E — Public report verify page `/r/[token]`

**Files:** `apps/web/app/r/[token]/page.tsx` (new — outside `(console)` route group)

**Purpose:** Public, unauthenticated page. A buyer visits `/r/<verifyToken>` and sees whether
the report signature is valid. Implements INS-017.

**Why outside `(console)`:** The `(console)` layout wraps all children in `<ConsoleShell>` and
requires a session. The verify page must render for unauthenticated visitors.

**API call (no auth header):**
```ts
// lib/api.ts apiGet requires auth(); for the public endpoint, use a plain fetch:
const API_URL = process.env.INSPECT_API_URL ?? 'http://localhost:3000';

async function verifyToken(token: string): Promise<ApiVerifyResult> {
  const res = await fetch(`${API_URL}/reports/verify/${token}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`verify failed: ${res.status}`);
  return res.json() as Promise<ApiVerifyResult>;
}
```

**Page layout:**
```tsx
export default async function VerifyPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let result: ApiVerifyResult | null = null;
  let fetchError: string | null = null;
  try { result = await verifyToken(token); }
  catch (e) { fetchError = String(e); }

  // Render: full-page centered card (no shell, no sidebar)
  const allGood = result?.valid && result?.hashMatches && result?.signatureValid;
  // ... render badge + provenance grid
}
```

**UI elements (inline styles, no shell):**
1. **Header bar** — Inspect logo mark (`I` in accent blue, same style as sidebar) + "Report
   Verification" label; right-aligned "Powered by Inspect" text. Height 56px.
2. **Verification badge** — large icon (Check or X), color #1F8A4C on pass / #B42318 on fail.
   Show three sub-rows: "Content hash matches", "Signature valid", "Record found" — each with
   a green Check or red X icon.
3. **Provenance block** (if `result` is not null): show `reportId`, `inspectionId`,
   `generatedAt`.
4. **Error state** (if `fetchError` or `result === null`): "Token not found or expired."
5. **Note on PDF hash:** In the MVP, the `hashMatches` field from the API verifies the
   canonical JSON snapshot hash (Ed25519 over the JSON payload), NOT a PDF byte hash
   (INS-003 pending). Show a small note: "This verifies the signed JSON record. PDF byte
   verification available after INS-003 lands."

**Steps:**
- [ ] Create `apps/web/app/r/[token]/page.tsx` — Server Component; no layout file needed
  (inherits root layout, which must NOT include `<ConsoleShell>`; confirm root `layout.tsx`
  does not wrap children in the console shell — if it does, the `/r/` segment needs its own
  `layout.tsx` returning `{children}` to escape the console shell).
- [ ] Implement `verifyToken` helper (plain `fetch`, no `apiGet`, no `auth()`).
- [ ] Implement the full-page UI as described (badge + sub-checks + provenance + error state).
- [ ] Run `pnpm type-check` — zero errors.

**Verify:**
- `pnpm type-check` passes.
- With API running, generate a report (via Task D), copy its `verifyToken` from the API
  response or DB.
- Visit `http://localhost:3001/r/<verifyToken>` (no login required — open in incognito).
- Confirm: green badge, all three sub-checks green, provenance row shows correct IDs.
- Visit `/r/invalid-token` — confirm 404/error state ("Token not found or expired").
- **Full PDF hash verification** gated on INS-003.

---

### Task F — Inspection list filters (`?status=`)

**Files:** `apps/web/app/(console)/inspections/page.tsx`

**Purpose:** Wire the status filter bar on the inspections list to `?status=` query param,
calling `GET /inspections?status=<value>` on the server side (INS-032, scoped to this list).

**Current state:** `page.tsx` (lines 1–38) calls `apiGet<ApiInspection[]>('/inspections')`
with no filter; there is no filter bar in the current markup.

**Status values** (from the Prisma schema / spine): `DRAFT`, `ASSIGNED`, `IN_PROGRESS`,
`SUBMITTED`, `UNDER_REVIEW`, `HOLD`, `APPROVED`, `REJECTED`, `REPORT_ISSUED`, `CANCELLED`.

**Implementation:**
```ts
// page.tsx becomes async with searchParams
export default async function InspectionsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const inspections = await apiGet<ApiInspection[]>(`/inspections${qs}`).catch(() => []);
  // ...render filter chips + list
}
```

**Filter chips** (inline, above the list table):
```
All | Draft | Submitted | Approved | Rejected | Report Issued
```
Each chip is a `<Link href="/inspections?status=DRAFT">` etc. The "All" chip links to
`/inspections` (no status param). The active chip is styled with `ui.accentSoft` background +
`ui.accent` color (match the existing sidebar active-link style). Derive active chip from the
`status` searchParam.

**Steps:**
- [ ] Update `InspectionsListPage` to accept `searchParams` and pass `?status=` to `apiGet`.
- [ ] Add the filter chip bar above the table (6 chips as described; inline styles from
  existing vocabulary).
- [ ] Update the "N total" sub-heading to reflect the filter: if `status` is set, show
  "N · filtered by <status>", else "N total".
- [ ] Run `pnpm type-check` — zero errors.

**Verify:**
- `pnpm type-check` passes.
- Login. Navigate to `/inspections` — all inspections shown, "All" chip active.
- Click "Draft" — URL becomes `/inspections?status=DRAFT`, list re-renders with only DRAFT rows.
- Click "All" — returns to unfiltered view.

---

### Task G — Review page: contextual links + re-inspection action

**Files:**
- `apps/web/app/(console)/inspections/[id]/review/page.tsx`
- `apps/web/app/(console)/inspections/actions.ts`

#### G.1 — Contextual links in review/page.tsx

Add status-driven action links below the QA decision panel (right column, beneath the existing
panel). Use `<Btn>` from `components/inspect/shell`.

| Inspection status | Show |
|---|---|
| DRAFT, ASSIGNED, IN_PROGRESS | "Populate" link → `/inspections/[id]/populate` (note: only meaningful for Platform Admin; show to all but the API will 403 for non-admins) |
| APPROVED, REPORT_ISSUED | "View report" link → `/inspections/[id]/report` |
| REJECTED, HOLD | "Start re-inspection" button → calls `reInspection(id)` action |

```tsx
{/* Below the existing QA decision panel */}
<div style={{ padding: '12px 20px', borderTop: `1px solid ${ui.line}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
  {POPULATABLE.has(inspection.status) && (
    <Btn kind="ghost" href={`/inspections/${id}/populate`}>
      Populate photos & defects
    </Btn>
  )}
  {REPORTABLE.has(inspection.status) && (
    <Btn kind="ghost" href={`/inspections/${id}/report`}>
      View / generate report
    </Btn>
  )}
  {REINSPECTABLE.has(inspection.status) && (
    <ReInspectButton id={id} />
  )}
</div>

// Status sets to add (alongside existing SUBMITTABLE / DECIDABLE):
const POPULATABLE = new Set(['DRAFT', 'ASSIGNED', 'IN_PROGRESS']);
const REPORTABLE = new Set(['APPROVED', 'REPORT_ISSUED']);
const REINSPECTABLE = new Set(['REJECTED', 'HOLD']);
```

#### G.2 — Re-inspection Server Action

```ts
// In apps/web/app/(console)/inspections/actions.ts
export async function reInspection(id: string): Promise<{ error?: string }> {
  // Look up the original inspection to copy its poId, loopPresetId, lotSize
  let orig: ApiInspection;
  try {
    orig = await apiGet<ApiInspection>(`/inspections/${id}`);
  } catch (e) {
    return { error: msg(e, 'could not load original inspection') };
  }
  const poId = (orig as { purchaseOrder?: { id?: string } }).purchaseOrder?.id;
  if (!poId) return { error: 'No purchase order on original inspection' };
  // POST /inspections with supersedesInspectionId
  let newId: string;
  try {
    const created = await apiPost<{ id: string }>('/inspections', {
      poId,
      loopPresetId: (orig as { loopPresetId?: string }).loopPresetId,
      lotSize: orig.lotSize,
      supersedesInspectionId: id,
    });
    newId = created.id;
  } catch (e) {
    return { error: msg(e, 're-inspection create failed') };
  }
  redirect(`/inspections/${newId}/review`);
}
```

**`ReInspectButton` client component** (small, colocated in `review/decision-panel.tsx` or
inline in a new `re-inspect-button.tsx`):
```tsx
'use client';
export function ReInspectButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {error && <div style={{ fontSize: 12, color: severity.critical.fg }}>{error}</div>}
      <button
        disabled={pending}
        onClick={() => start(async () => {
          const r = await reInspection(id);
          if (r?.error) setError(r.error);
          // redirect happens server-side on success
        })}
        style={{ height: 36, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 8, fontSize: 13, fontWeight: 500, color: ui.ink, cursor: pending ? 'default' : 'pointer', opacity: pending ? 0.7 : 1 }}
      >
        {pending ? 'Creating…' : 'Start re-inspection'}
      </button>
    </div>
  );
}
```

**Note on loopPresetId:** The `ApiInspection` shape (as returned by `GET /inspections/:id`)
may not currently include `loopPresetId` as a top-level field (it may be nested in
`loopPresetSnapshot`). Check the actual API response; if `loopPresetId` is not top-level, cast
to `unknown` and extract from `loopPresetSnapshot?.id` or pass `undefined` (the API may allow
creating without it if the snapshot is already set). Adjust `reInspection` accordingly rather
than inventing fields.

**Steps:**
- [ ] G.1: Add `POPULATABLE`, `REPORTABLE`, `REINSPECTABLE` status sets to
  `review/page.tsx`.
- [ ] G.1: Add the contextual links block below the QA decision panel.
- [ ] G.1: Import `ReInspectButton` from a new `re-inspect-button.tsx` (colocated in `[id]/review/`).
- [ ] G.2: Add `reInspection()` to `apps/web/app/(console)/inspections/actions.ts`.
- [ ] G.2: Create `re-inspect-button.tsx` as a `'use client'` component.
- [ ] Run `pnpm type-check` — zero errors.

**Verify:**
- `pnpm type-check` passes.
- Login as `devowner@inspect.local`. Open a DRAFT inspection's review page.
- Confirm "Populate photos & defects" link appears and navigates to `/inspections/:id/populate`.
- Open an APPROVED inspection review page — "View / generate report" link appears and navigates
  to the report page.
- Open a REJECTED inspection review page — "Start re-inspection" button appears. Click it:
  API creates a new inspection (network tab: POST `/inspections` with `supersedesInspectionId`),
  redirects to the new inspection's review page. Confirm new inspection appears in the list.

---

## Dependencies & Out of Scope

### What this plan IS verifiable without (DB + API must be up; MinIO/PDF not needed):
- Task A (shapes) — type-check only, no runtime needed.
- Task B (actions) — presign + register-photo metadata persist in DB without MinIO.
- Task C (populate workspace) — loop selection, defect tagging, measurement persistence all work
  without MinIO. Photo byte upload (the PUT step) fails gracefully with an inline error.
- Task D (report) — report generation (POST) + preview render from `canonicalSnapshot` work;
  only the "Download PDF" step is blocked.
- Task E (verify page) — full verify flow works once a report exists (token → JSON snapshot
  hash + Ed25519 check). No PDF hash required.
- Task F (list filters) — API `?status=` filtering works with DB.
- Task G (re-inspection, contextual links) — full flow works with DB.

### Hard gates on external work:
| Dependency | Blocks | Tracked |
|---|---|---|
| **MinIO / S3 object storage running** | Actual photo byte persistence in Task C; photo thumbnails in `BrandedReport`; PDF download | INS-023 |
| **PDF rendering (pdf-lib)** | Real PDF download link in Task D; "Download PDF" on portal (INS-025); PDF byte hash in Task E verify | INS-003 |
| **Email delivery** | Report delivery notification; invite-only onboarding | INS-004 |
| **@inspect/shared-types linked** | Type deduplication across apps; not blocking any UI work | INS-008 |

### Out of scope in this plan:
- Buyer guest portal wiring (INS-025) — separate plan.
- Invite-user / accept-invitation flows (INS-029).
- Role-change and workspace CRUD (INS-030).
- Dashboard aggregation endpoints (INS-005 / INS-031).
- Audit-on-every-write (INS-006) — the populate service already uses its existing audit path.
- Search inputs on dashboard/presets/users/portal (INS-032 scoped to inspections list only).
- `BillableEvent` RE_INSPECTION constraint hardening (INS-018) — API concern.
- PDF binary rendering (INS-003).
- `populate.service` unit tests (INS-007) — API concern.

---

## Self-Review: Task → Audit Gap → INS-NNN Mapping

| Task | Audit gap closed | INS-NNN |
|---|---|---|
| A — lib shapes | `ApiPhoto`, `ApiDefectInstance`, `ApiReport`, `ApiVerifyResult` missing from `lib/api.ts` | INS-023, INS-033, INS-017 (type foundation) |
| B — populate actions | `presignPhoto`, `registerPhoto`, `addDefect`, `addMeasurement` unwired | INS-023 |
| C — populate workspace | `/populate` flat static route, all buttons inert (lines 57–58, 104, 119–121) | INS-023 |
| D — BrandedReport refactor + report route | `BrandedReport` reads hardcoded `reportData` const (lines 6–21); `/report` not parameterized (lines 1–11) | INS-033 |
| D — POST /inspections/:id/report wired | Report generation never triggered from web | INS-033 |
| E — public verify page | No `/r/[token]` route exists anywhere in `apps/web` | INS-017 |
| F — list filters | `GET /inspections` called with no `?status=`; filter chips inert (INS-032 scope: inspections) | INS-032 |
| G — review contextual links | Review page has no links to populate / report / re-inspect | INS-023, INS-033 |
| G — re-inspection action | `supersedesInspectionId` exists in API but never passed from web | INS-018 (partial; DB constraint hardening is API-side) |

### Photo byte upload (MinIO gate)
The full photo pipeline (`presign → PUT bytes → register`) is wired end-to-end in Task C but
the PUT step is gated on MinIO running (INS-023). The DB side (presign + register-photo
metadata) is verifiable now. Mark the byte-upload verify step explicitly as
"gated on MinIO / INS-023" in any status update after this plan executes.

### PDF download (INS-003 gate)
Task D wires the POST-generate → live preview path. The "Download PDF" button / link is
intentionally **not implemented** in this plan. A user-facing banner in the report page
makes the gap visible. INS-003 tracks the pdf-lib rendering work independently.

### Portal adjacent (INS-025)
The public `/r/[token]` verify page (Task E) is distinct from the buyer guest portal
(INS-025). The portal shows a buyer-scoped list of all their reports and requires magic-link
token auth. Task E only verifies a single report token, publicly, without authentication.
These must not be conflated.
