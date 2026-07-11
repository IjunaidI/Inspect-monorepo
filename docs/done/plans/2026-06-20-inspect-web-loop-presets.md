# Plan: Loop Presets — List · Builder · New-Version · Archive · View

> **Status: ✅ DONE — shipped 2026-06-28; moved to `done/` 2026-07-11.** Full builder (loop sidebar, shot counter,
> severity-grouped defect chips, measurement fields, custom-defect creation), list search/sort, new-version + archive
> flows are wired live. Closes INS-024. See [STATUS.md](../../STATUS.md). (Checkbox state below is stale.)

**For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` or `superpowers:executing-plans`.
All actionable items are `- [ ]` checkboxes. Complete them in the order listed; the dependency graph is strictly top-down within each task group.

---

## Goal

Wire the full Loop Preset CRUD surface in the web console:

- **List** (`/presets`): real fields from the API, search + sort, MoreVertical menu (Archive, Duplicate → clone).
- **Builder** (`/presets/new`): live `'use client'` component with nested step state; defects sourced from `GET /defect-catalog`; Save → `POST /loop-presets`.
- **New-version ("Edit") flow** (`/presets/new?from=:id`): load existing preset via `GET /loop-presets/:id`, prefill builder, Save creates the next version (same name — the API auto-increments).
- **Archive**: `DELETE /loop-presets/:id` via a Server Action from the list MoreVertical menu.
- **View / Detail**: `/presets/[id]` server page showing full step detail (read-only), with an "Edit (new version)" link into the builder.

This closes **INS-024** (builder static), materially advances **INS-031** (list lossy) and **INS-032** (search/sort inert), and adds the defect-catalog write path (`POST /defect-catalog` for org-scoped custom defects).

---

## Architecture

```
/presets/
  page.tsx                  ← async Server Component; loads /loop-presets; renders list
  actions.ts                ← 'use server'; createPreset, archivePreset, createDefect
  [id]/
    page.tsx                ← async Server Component; loads /loop-presets/:id (detail)
  new/
    page.tsx                ← async Server Component; loads /defect-catalog + optionally
                              /loop-presets/:id (for ?from= clone); passes to builder
    builder.tsx             ← 'use client'; all nested step state; calls createPreset
```

**Read path:** Server Components call `apiGet<T>` / `loadOrFallback` from `apps/web/lib/api.ts`; the session bearer token is attached server-side by `apiToken()`.

**Write path:** `'use server'` actions in `presets/actions.ts` call `apiPost` / `apiDelete`; catch `ApiError` → `{ error }`; `revalidatePath` on in-place mutations; `redirect()` called OUTSIDE try/catch on success (Next.js throws `NEXT_REDIRECT` internally — catching it suppresses the redirect).

**Builder state:** a single `useReducer`-style dispatch pattern over a `BuilderState` type (see Task C for the exact model). All add/remove/reorder mutations happen in the client; only the final Save dispatches a Server Action via a regular `async` call (not `useActionState`, because the payload is structured not FormData).

---

## Tech Stack

- Next.js 15 App Router, React 19
- `'use server'` Server Actions (`next/navigation` redirect / `next/cache` revalidatePath)
- `useReducer` + `useTransition` in the builder client component
- `apiGet`, `apiPost`, `apiDelete`, `ApiError`, `loadOrFallback` from `apps/web/lib/api.ts`
- Design system: `Btn`, `PageHead`, `Mono`, `SeverityTag` from `apps/web/components/inspect/shell.tsx`; token primitives (`ui`, `mono`, `severity`) from `apps/web/components/inspect/tokens.ts`
- Inline styles only — no Tailwind, no CSS modules, no new component library

---

## Global Constraints

- **No new runtime dependencies.** The full plan is implemented with what is already in the monorepo.
- **Server Actions exclusively** for writes; no API route handlers (`app/api/`).
- **Session token server-side only** — `apiToken()` is server-only; never pass the raw JWT to the client.
- **Reuse the design system** — `Btn`, `PageHead`, `Mono`, `SeverityTag`, token primitives. Do not introduce a second component vocabulary.
- **`pnpm type-check` must stay green across both apps** after every task.
- **`pnpm --filter @inspect/api test` count must stay at 100** (or equal to whatever the current passing count is) — no API source changes are permitted.
- **Web verification gate**: type-check + manual walkthrough as `devowner@inspect.local` / `Devowner!123` on `:3001` (API `:3000`).
- **Min role: QA\_MANAGER+** for all preset and defect-catalog reads/writes (the API already enforces this; the web just needs a session).

---

## Current State

### `apps/web/app/(console)/presets/page.tsx` — list (`/presets`)

| Line | Issue |
|------|-------|
| 43 | `loadOrFallback('/loop-presets', [])` — read is live but lossy |
| 47 | `industry: '—'` — `ApiLoopPreset` has no `industry` field (low priority; omit or leave `'—'`) |
| 48 | `loops: []` — step names/counts unavailable from list endpoint (API returns `_count.steps` only) |
| 50 | `loopCount: p._count?.steps ?? 0` — this is correct; keep it |
| 51 | `used: '—'` — no `_count.buyers` or similar in the API response (depends on INS-005 + INS-031) |
| 52 | `edited: '—'` — `ApiLoopPreset` has no `updatedAt` field; extend the shape or leave `'—'` |
| 61 | "New Preset" → `href="/presets/new"` — already correct; keep |
| 67 | Search input — no `value`/`onChange` (INS-032) |
| 71 | Sort dropdown — inert (INS-032) |
| 89 | Per-card `MoreVertical` — no onClick; needs Archive + Duplicate |
| 117 | `"Edit →"` — no `href`/`onClick`; must link to the clone/new-version route |

### `apps/web/app/(console)/presets/new/page.tsx` — builder (`/presets/new`)

| Line | Issue |
|------|-------|
| 18–25 | `builderLoops` — hardcoded const; active loop hardcoded to index 2 |
| 26–32 | `collarShots` — hardcoded |
| 33–37 | `loopDefects` — hardcoded; must come from `GET /defect-catalog` |
| 39–43 | `measurementFields` — hardcoded |
| 50 | `PresetBuilderPage` is a plain function (no `async`, no hooks) — entire component must become a `'use client'` builder or be refactored into a server shell + client builder |
| 66 | Cancel button — no `onClick` |
| 67 | "Save Preset" button — no `onClick` |
| 73 | Preset name input — `defaultValue` (uncontrolled) |
| 104 | "Add Loop" — no `onClick` |
| 112 | Active loop title input — `defaultValue` |
| 133 | Shot name inputs — `defaultValue` |
| 139 | "Add Shot" — no `onClick` |
| 163 | Defect chip X — no `onClick` |
| 171 | Add-custom-defect input — uncontrolled |
| 175 | "Add" (defect) button — no `onClick` |
| 193 | "Add measurement field" — no `onClick` |
| — | No version-note / description field exists |
| — | No `aqlLevel` selector exists |

### `apps/web/lib/api.ts` — shape gaps

| Lines | Issue |
|-------|-------|
| 109–116 | `ApiLoopPreset` — missing `updatedAt`, `aqlLevel`; no `ApiLoopPresetDetail` (with `steps`) |
| — | `ApiDefectCatalog` shape absent |

---

## File Inventory

### Modified
| File | Change |
|------|--------|
| `apps/web/lib/api.ts` | Extend `ApiLoopPreset`; add `ApiLoopPresetDetail`, `ApiPresetStep`, `ApiMeasurementField`, `ApiAllowedDefect`, `ApiDefectCatalog` |
| `apps/web/app/(console)/presets/page.tsx` | Wire MoreVertical (Archive action, Duplicate link), "Edit →" link, search state (`useRouter`/query-param), sort; show `updatedAt` when available |
| `apps/web/app/(console)/presets/new/page.tsx` | Convert to `async` server page; load `/defect-catalog` (and optionally `?from=` preset detail); pass catalog + seed data to `<PresetBuilder>` |

### New
| File | Purpose |
|------|---------|
| `apps/web/app/(console)/presets/actions.ts` | Server Actions: `createPreset`, `archivePreset`, `createDefect` |
| `apps/web/app/(console)/presets/new/builder.tsx` | `'use client'` builder component; full nested step state; defect picker; Save → `createPreset` |
| `apps/web/app/(console)/presets/[id]/page.tsx` | Read-only detail view; loads `GET /loop-presets/:id`; "Edit (new version)" link |

---

## Tasks

### Task A — Extend lib shapes

**Files:** `apps/web/lib/api.ts`

**Interfaces to add (exact signatures):**

```ts
// Extend existing ApiLoopPreset:
export interface ApiLoopPreset {
  id: string;
  name: string;
  version: number;
  description?: string | null;
  aqlLevel?: string | null;             // 'I'|'II'|'III'|'S1'|'S2'|'S3'|'S4'
  isArchived: boolean;
  updatedAt?: string;                   // ISO string; add when API returns it
  _count?: { steps: number };
}

export interface ApiMeasurementField {
  id: string;
  label: string;
  unit?: string | null;
  position: number;
}

export interface ApiAllowedDefect {
  id: string;
  defectCatalog: {
    id: string;
    name: string;
    defaultSeverity: 'CRITICAL' | 'MAJOR' | 'MINOR';
  };
}

export interface ApiPresetStep {
  id: string;
  zoneName: string;
  description?: string | null;
  referenceImageUrls: string[];
  requiredShotCount: number;
  position: number;
  measurementFields: ApiMeasurementField[];
  allowedDefects: ApiAllowedDefect[];
}

export interface ApiLoopPresetDetail extends ApiLoopPreset {
  steps: ApiPresetStep[];
}

export interface ApiDefectCatalog {
  id: string;
  name: string;
  defaultSeverity: 'CRITICAL' | 'MAJOR' | 'MINOR';
  scope: 'GLOBAL' | 'ORG';   // global = seeded; org = custom
  isArchived: boolean;
}
```

**Checkbox steps:**
- [ ] Add `updatedAt?: string` to existing `ApiLoopPreset`; add `aqlLevel?: string | null`
- [ ] Add `ApiMeasurementField`, `ApiAllowedDefect`, `ApiPresetStep` interfaces
- [ ] Add `ApiLoopPresetDetail extends ApiLoopPreset` interface
- [ ] Add `ApiDefectCatalog` interface
- [ ] Run `pnpm type-check` — must be green

**Verify:** `pnpm type-check` exits 0; `grep -n 'ApiLoopPresetDetail\|ApiDefectCatalog' apps/web/lib/api.ts` shows both.

---

### Task B — `presets/actions.ts` (Server Actions)

**Files:** `apps/web/app/(console)/presets/actions.ts` (new file)

**Interfaces (exact signatures):**

```ts
// input shapes for the builder → action boundary
export interface PresetStepInput {
  zoneName: string;
  description?: string;
  referenceImageUrls?: string[];
  requiredShotCount?: number;
  measurementFields?: { label: string; unit?: string }[];
  allowedDefectCatalogIds?: string[];
}

export interface CreatePresetInput {
  name: string;
  description?: string;
  aqlLevel?: string;
  steps: PresetStepInput[];
}
```

**Server Actions:**

```ts
'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { apiPost, apiDelete, ApiError } from '@/lib/api';

const msg = (e: unknown, fb: string) =>
  e instanceof ApiError || e instanceof Error ? e.message : fb;

export async function createPreset(
  input: CreatePresetInput,
): Promise<{ error?: string }> {
  if (!input.name.trim()) return { error: 'Preset name is required' };
  if (!input.steps.length) return { error: 'Add at least one loop' };
  for (const s of input.steps) {
    if (!s.zoneName.trim()) return { error: 'Each loop must have a name' };
  }
  let id: string;
  try {
    const p = await apiPost<{ id: string }>('/loop-presets', input);
    id = p.id;
  } catch (e) {
    return { error: msg(e, 'create failed') };
  }
  redirect('/presets');          // OUTSIDE try/catch — Next.js throws NEXT_REDIRECT
}

export async function archivePreset(id: string): Promise<{ error?: string }> {
  try {
    await apiDelete(`/loop-presets/${id}`);
    revalidatePath('/presets');
    return {};
  } catch (e) {
    return { error: msg(e, 'archive failed') };
  }
}

export async function createDefect(
  name: string,
  defaultSeverity: 'CRITICAL' | 'MAJOR' | 'MINOR',
): Promise<{ data?: { id: string; name: string; defaultSeverity: string }; error?: string }> {
  if (!name.trim()) return { error: 'Defect name is required' };
  try {
    const d = await apiPost<{ id: string; name: string; defaultSeverity: string }>(
      '/defect-catalog',
      { name: name.trim(), defaultSeverity },
    );
    return { data: d };
  } catch (e) {
    return { error: msg(e, 'create defect failed') };
  }
}
```

**Checkbox steps:**
- [ ] Create `apps/web/app/(console)/presets/actions.ts` with the `'use server'` directive
- [ ] Implement `createPreset` — validate name + steps, call `apiPost('/loop-presets', input)`, `redirect('/presets')` outside try/catch
- [ ] Implement `archivePreset` — call `apiDelete('/loop-presets/:id')`, `revalidatePath('/presets')`
- [ ] Implement `createDefect` — call `apiPost('/defect-catalog', { name, defaultSeverity })`, return `{ data }` on success
- [ ] Run `pnpm type-check` — green

**Verify:** TypeScript compiles; `grep 'use server' apps/web/app/\(console\)/presets/actions.ts` → first line.

---

### Task C — `presets/new/builder.tsx` (client builder component)

**Files:** `apps/web/app/(console)/presets/new/builder.tsx` (new file)

This is the largest task. The approach: start from the existing static markup in `apps/web/app/(console)/presets/new/page.tsx` (lines 50–217), convert it to a `'use client'` component, replace all hardcoded consts with state, and wire the handlers.

**TypeScript state model:**

```ts
// Builder state types — define at the top of builder.tsx
interface MeasurementFieldDraft {
  id: string;           // client-side uuid (crypto.randomUUID())
  label: string;
  unit: string;
}

interface StepDraft {
  id: string;           // client-side uuid
  zoneName: string;
  description: string;
  requiredShotCount: number;
  measurementFields: MeasurementFieldDraft[];
  allowedDefectCatalogIds: Set<string>;   // toggled on/off in the picker
}

interface BuilderState {
  presetName: string;
  description: string;
  aqlLevel: string;                       // default 'II'
  steps: StepDraft[];
  activeStepIndex: number;
  // Defect picker inline state
  customDefectName: string;
  customDefectSeverity: 'CRITICAL' | 'MAJOR' | 'MINOR';
  saving: boolean;
  saveError: string | null;
}
```

**Key handlers (implement as named functions, not an external reducer):**

```ts
// Add / remove steps
function addStep(): void { /* append a blank StepDraft, set activeStepIndex to new index */ }
function removeStep(index: number): void { /* splice; clamp activeStepIndex */ }
function updateStepField<K extends keyof StepDraft>(
  index: number, field: K, value: StepDraft[K]
): void { /* immutable update */ }

// Shot count (requiredShotCount is the numeric count — there is NO named-shot array
// in the API model; the builder UI shows "Required shots · N" and the field is just a count)
function incrementShots(index: number): void
function decrementShots(index: number): void

// Measurement fields
function addMeasurementField(stepIndex: number): void
function updateMeasurementField(
  stepIndex: number, fieldId: string,
  key: 'label' | 'unit', value: string
): void
function removeMeasurementField(stepIndex: number, fieldId: string): void

// Defect picker — toggles a defectCatalogId in the active step's Set
function toggleDefect(stepIndex: number, defectCatalogId: string): void

// Custom defect (calls createDefect Server Action, then toggles the returned id)
async function handleAddCustomDefect(stepIndex: number): Promise<void>

// Save
async function handleSave(): Promise<void> {
  // 1. setSaving(true)
  // 2. Build CreatePresetInput from state
  // 3. const result = await createPreset(input)
  // 4. if result.error → setSaveError; setSaving(false); return
  // 5. On success: createPreset redirects; no client-side redirect needed
}
```

**Component signature:**

```tsx
'use client';

import type { ApiDefectCatalog, ApiLoopPresetDetail } from '@/lib/api';
import type { CreatePresetInput } from '../actions';
import { createPreset, createDefect } from '../actions';

interface PresetBuilderProps {
  catalog: ApiDefectCatalog[];     // from server; non-archived only
  seed?: ApiLoopPresetDetail;      // when cloning (?from=:id flow); undefined for new
}

export default function PresetBuilder({ catalog, seed }: PresetBuilderProps) { ... }
```

**Initializing from `seed`:** When `seed` is provided (new-version flow), initialize `BuilderState` from it: `presetName = seed.name`, `steps = seed.steps.map(s => ({ id: crypto.randomUUID(), zoneName: s.zoneName, description: s.description ?? '', requiredShotCount: s.requiredShotCount, measurementFields: s.measurementFields.map(...), allowedDefectCatalogIds: new Set(s.allowedDefects.map(a => a.defectCatalog.id)) }))`.

**Defect picker UI:** Group `catalog` by `defaultSeverity` (CRITICAL / MAJOR / MINOR). For each defect, render a togglable chip: filled (severity bg/fg) when `allowedDefectCatalogIds.has(d.id)`, hairline (ui.lineSoft bg) when not. Clicking toggles. Below the grouped chips, keep the existing "Add custom defect tag…" input row — wire it to `handleAddCustomDefect`: call `createDefect(customDefectName, customDefectSeverity)`, on success push the new catalog entry into a local `extraDefects` state array and toggle its id into the active step.

**Styling:** Inline styles throughout; preserve existing visual structure from the static file. The only structural changes are: (a) all `defaultValue` inputs become `value` + `onChange`; (b) all inert `<button>` / `<div>` click targets get `onClick` handlers; (c) the sidebar loop list is driven by `state.steps`; (d) the main panel is driven by `state.steps[state.activeStepIndex]`.

**Note on shots:** The API `requiredShotCount` is a number (default 1) — not a named list. The existing shot-name rows in the static markup are a UX fiction; replace them with a simple `+` / `−` counter for `requiredShotCount`. Keep the visual panel rows but make them show "Shot 01 … Shot N" labels auto-generated from the count, with no individual naming (spec §6 does not name individual shots — they are just photos taken in sequence).

**Checkbox steps:**
- [ ] Create `apps/web/app/(console)/presets/new/builder.tsx` with `'use client'`
- [ ] Define all types (`MeasurementFieldDraft`, `StepDraft`, `BuilderState`) at the top of the file
- [ ] Implement `useState<BuilderState>` initialized from `seed` when provided, otherwise a single blank step
- [ ] Wire the preset-name input (`value={state.presetName}` + `onChange`)
- [ ] Wire the description textarea (optional; add below the preset-name input)
- [ ] Wire the aqlLevel selector (optional; default `'II'`; a simple `<select>` with the 7 levels)
- [ ] Implement `addStep` / `removeStep` / `updateStepField`; wire sidebar "Add Loop" and per-loop click-to-activate
- [ ] Implement `incrementShots` / `decrementShots`; replace static shot rows with auto-generated "Shot 01…N" rows and +/− buttons
- [ ] Implement `addMeasurementField` / `updateMeasurementField` / `removeMeasurementField`; wire existing measurement-field rows
- [ ] Implement `toggleDefect`; render defect chips from `catalog` grouped by severity; replace static `loopDefects` entirely
- [ ] Implement `handleAddCustomDefect` calling `createDefect` Server Action; wire the existing "Add custom defect tag…" input + Add button
- [ ] Implement `handleSave` → `createPreset`; wire Save Preset button; show inline error when `saveError !== null`; disable button while `saving`
- [ ] Wire Cancel button → `router.push('/presets')` (use `useRouter` from `next/navigation`)
- [ ] Run `pnpm type-check` — green

**Verify:** Component renders; no TypeScript errors. Full manual walkthrough in Task F.

---

### Task D — Wire `/presets/new` server page

**Files:** `apps/web/app/(console)/presets/new/page.tsx` (rewrite)

**Convert the current plain function into an `async` Server Component:**

```tsx
import { apiGet, loadOrFallback, type ApiDefectCatalog, type ApiLoopPresetDetail } from '@/lib/api';
import PresetBuilder from './builder';

export const dynamic = 'force-dynamic';

export default async function PresetBuilderPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;

  // Load defect catalog (required — builder cannot work without it)
  const { data: catalog } = await loadOrFallback<ApiDefectCatalog[]>('/defect-catalog', []);

  // Optionally load an existing preset to seed the builder (new-version flow)
  let seed: ApiLoopPresetDetail | undefined;
  if (from) {
    try {
      seed = await apiGet<ApiLoopPresetDetail>(`/loop-presets/${from}`);
    } catch {
      // Preset not found or not accessible — proceed as new
    }
  }

  return <PresetBuilder catalog={catalog} seed={seed} />;
}
```

**Checkbox steps:**
- [ ] Replace the current static function body with the `async` server component above
- [ ] Remove the hardcoded `builderLoops`, `collarShots`, `loopDefects`, `measurementFields` consts (they move into client state in `builder.tsx`)
- [ ] Remove the static JSX return and replace with `<PresetBuilder catalog={catalog} seed={seed} />`
- [ ] Confirm `export const dynamic = 'force-dynamic'` is set
- [ ] Run `pnpm type-check` — green

**Verify:** `GET /presets/new` renders `<PresetBuilder>` with live catalog (or empty list when API offline). `GET /presets/new?from=<existing-id>` renders with preset pre-filled.

---

### Task E — New-version ("Edit") flow + detail page

**Files:**
- `apps/web/app/(console)/presets/[id]/page.tsx` (new)
- `apps/web/app/(console)/presets/page.tsx` (update "Edit →" link)

**Detail page (`/presets/[id]`):**

```tsx
import { apiGet, type ApiLoopPresetDetail } from '@/lib/api';
import { notFound } from 'next/navigation';
// ...shell imports...

export const dynamic = 'force-dynamic';

export default async function PresetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let preset: ApiLoopPresetDetail;
  try {
    preset = await apiGet<ApiLoopPresetDetail>(`/loop-presets/${id}`);
  } catch {
    notFound();
  }

  return (
    // Read-only detail view:
    // - PageHead: preset.name, v{preset.version}, description
    // - Per step: zoneName, requiredShotCount, measurementFields list, allowedDefects chips
    // - "Edit (new version)" → Btn href={`/presets/new?from=${id}`}
    // - Inline styles only; reuse card/chip patterns from presets/page.tsx
  );
}
```

**List page update (`presets/page.tsx`):**
- Line 117: Change `"Edit →"` from an inert `<div>` to: `<Btn kind="ghost" small href={`/presets/${p.id}`}>View →</Btn>` (links to the detail page; the detail page has the "Edit (new version)" CTA).
- For `live` mode, include `p.id` in the mapped `PresetRow` (add `id: string` field to the interface).

**Checkbox steps:**
- [ ] Create `apps/web/app/(console)/presets/[id]/page.tsx` with the detail view
- [ ] Render: preset name + version badge, description, `aqlLevel`, step count
- [ ] Render each step: zoneName, `requiredShotCount`, `measurementFields` list, `allowedDefects` chips (grouped by severity using `SeverityTag`)
- [ ] Add "Edit (new version)" `Btn` linking to `/presets/new?from=${preset.id}`
- [ ] Add `id: string` to `PresetRow` interface in `presets/page.tsx`; populate it in the live mapper (`id: p.id`)
- [ ] Update "Edit →" on line 117 to `<Btn kind="ghost" small href={`/presets/${p.id}`}>View →</Btn>`
- [ ] Run `pnpm type-check` — green

**Verify:** `GET /presets/<real-id>` shows read-only step detail. "Edit (new version)" → `/presets/new?from=<id>` prefills the builder with the preset's current data.

---

### Task F — List wiring: MoreVertical menu, search, sort (INS-031 / INS-032 partial)

**Files:** `apps/web/app/(console)/presets/page.tsx`

This task makes the list interactive. Convert the page to a **hybrid**: keep the outer wrapper as a Server Component that loads data; extract a `'use client'` `PresetsList` sub-component that handles local search/sort/MoreVertical state.

**`PresetsList` client component (inline in `presets/page.tsx` or a sibling `presets-list.tsx`):**

```tsx
'use client';
import { useTransition } from 'react';
import { archivePreset } from './actions';

interface PresetRow { id: string; name: string; /* ... all existing fields */ }

export function PresetsList({ presets, live }: { presets: PresetRow[]; live: boolean }) {
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'name' | 'edited'>('edited');
  const [menuOpen, setMenuOpen] = useState<string | null>(null); // preset id

  const filtered = presets
    .filter(p => p.name.toLowerCase().includes(search.toLowerCase()))
    .sort(sort === 'name'
      ? (a, b) => a.name.localeCompare(b.name)
      : () => 0  // server already orders by [name asc, version desc]; keep
    );

  function handleArchive(id: string) {
    startTransition(async () => {
      const result = await archivePreset(id);
      if (result.error) alert(result.error); // TODO: replace with inline toast (INS-future)
      setMenuOpen(null);
    });
  }

  // Render: wire search input value/onChange, sort dropdown onChange,
  // MoreVertical onClick → setMenuOpen, per-card menu showing "Archive" (handleArchive)
  // and "Duplicate" (link to /presets/new?from=<id>).
  // Disable Archive button while pending.
}
```

**Checkbox steps:**
- [ ] Add `id: string` to `PresetRow` if not already done in Task E
- [ ] Extract `PresetsList` as a `'use client'` component (inline or sibling file)
- [ ] Wire search `<input>` with `value={search}` / `onChange`; filter `filtered` array
- [ ] Wire sort dropdown with `value={sort}` / `onChange`; re-sort `filtered`
- [ ] Wire `MoreVertical` per-card to open/close an inline dropdown menu (set `menuOpen` to the preset id, close on outside click or Escape — a simple `useEffect`)
- [ ] Menu item "Archive": call `handleArchive(id)` via `useTransition`; show disabled state while `pending`
- [ ] Menu item "Duplicate → Edit": render as `<a href={/presets/new?from=${p.id}}>Duplicate (new version)</a>` — no JS needed
- [ ] "Edit →" / "View →" card link: already wired in Task E
- [ ] In the server `PresetsPage`, replace the static card loop with `<PresetsList presets={...} live={live} />`
- [ ] Run `pnpm type-check` — green

**Verify:** Search box filters cards in real time. MoreVertical → Archive calls `DELETE /loop-presets/:id` and the card disappears after revalidation. MoreVertical → "Duplicate (new version)" navigates to `/presets/new?from=<id>` with the builder pre-filled.

---

### Task G — End-to-end manual walkthrough (verification gate)

**Prerequisite:** API running at `:3000` with Postgres + Redis (INS-001 stack up). Seeded global defect catalog (14 entries).

**Steps:**
1. Login as `devowner@inspect.local` / `Devowner!123` at `http://localhost:3001/login`.
2. Navigate to `/presets` — list renders live data (or demo fallback if API offline; badge says "Demo data · API offline").
3. Click "New Preset":
   - Builder loads with empty state and the seeded defect catalog grouped by severity.
   - Enter preset name "2-Loop Smoke Test".
   - Add a description.
   - The first loop "Loop 01" is pre-created; rename it to "Fabric Check".
   - Set `requiredShotCount` to 2 using the +/− control.
   - Toggle 1 CRITICAL defect and 1 MINOR defect from the catalog.
   - Add a measurement field: label "GSM weight", unit "g/m²".
   - Click "Add Loop" → new "Loop 02" appears; rename to "Final Pack".
   - Set `requiredShotCount` to 3.
   - Click "Save Preset" → redirects to `/presets`.
   - "2-Loop Smoke Test" appears in the list with `loopCount = 2` and `v1`.
4. Open the card's MoreVertical → "Duplicate (new version)" → builder opens pre-filled with "2-Loop Smoke Test" data.
   - Change the description; click "Save Preset" → redirects to `/presets`.
   - The preset now shows `v2` (same name, new version).
5. Click "View →" on the v2 card → detail page shows both loops, the measurement field, and the defect chips.
6. From the detail page click "Edit (new version)" → builder opens pre-filled.
7. Back on list: MoreVertical → Archive → card disappears from the list.
8. Add a custom org-scoped defect: in the builder, type "Broken zip" in the "Add custom defect tag…" input, set severity to Major, click Add → the new chip appears in the Major group and is toggled on.

**Checkbox steps:**
- [ ] Run `pnpm type-check` across both apps (zero errors)
- [ ] Confirm `pnpm --filter @inspect/api test` count unchanged
- [ ] Execute the 8-step walkthrough above; all steps complete without JS console errors
- [ ] Archive flow: archived preset is gone from `/presets` list on reload

---

## Dependencies & Out of Scope

| Item | Notes |
|------|-------|
| `referenceImageUrls` / photo upload | Needs MinIO presigned upload (INS-023). For this plan: accept the field as an empty array `[]`; the builder shows the "Drop image or pick from library" drop-zone as a visual placeholder with no wired upload. |
| `used: N buyers` count | Requires API aggregation (INS-005 / INS-031). Map: `used: '—'` until that lands. |
| `edited` timestamp | `ApiLoopPreset` does not currently expose `updatedAt`. Map: `edited: p.updatedAt ? relativeTime(p.updatedAt) : '—'`. Add `updatedAt?` to the shape (Task A) but accept `'—'` until the API surfaces it. |
| `industry` tag | No `industry` field on `LoopPreset` in the Prisma schema. Keep `industry: '—'` and the neutral tag style. |
| No PATCH/PUT on presets | By design — the versioning model requires creating a new record with the same name. The `createPreset` action covers both "new" and "update" flows. |
| INS-008 (shared-types) | `@inspect/shared-types` is not linked; response shapes are redeclared in `lib/api.ts`. Do not attempt to link the package in this plan. |
| Search/sort server-side filtering | For this plan, filtering is client-side in `PresetsList`. True server-side search (query params → API query) is deferred to INS-032. |
| Pagination | Deferred to INS-032. |
| Drag-to-reorder loops / shots | Phase 2. The sidebar shows a `GripVertical` icon (already in static markup); do not implement drag logic. |

---

## Self-Review — Audit Gap Mapping

| Backlog item | Addressed by |
|--------------|-------------|
| **INS-024** · Loop-preset builder static (no persistence) | Tasks C + D + G — builder gets full client state, Save calls `createPreset`, redirect on success |
| **INS-031** · Live list renders lossy data | Task F (search/sort wired), Task A (`updatedAt` shape), Task E (`id` in row), partial — `used` + `industry` remain `'—'` pending INS-005 |
| **INS-032** · Search inputs and filter chips inert | Task F — search and sort wired client-side in `PresetsList`; full server-side filtering deferred |
| **INS-022** · Web client has no write helper | Already done (in-progress); `apiPost` / `apiDelete` are in `lib/api.ts` — plan uses them directly |
| **INS-008** · shared-types not linked | Out of scope for this plan |
| **INS-005** · Aggregation endpoints absent | Out of scope; `used` + `industry` stay `'—'` |
| **INS-023** · Object storage / presigned upload | Out of scope; `referenceImageUrls` always `[]` |

### Gaps this plan does NOT close (by design)

- `isArchived=true` presets still shown if the API ever returns them — the API list endpoint already filters them (`GET /loop-presets` returns non-archived only); no web-side filter needed.
- The defect catalog `DELETE /defect-catalog/:id` (archive org defect) is not surfaced in this plan — out of scope.
- AQL level selector in the builder is optional; if the field is omitted from the POST body, the API creates the preset without it.
