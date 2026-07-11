# Plan: Buyers & Suppliers Directory — Workspace CRUD (Web)

> **Status: ✅ DONE — shipped 2026-06-28; moved to `done/` 2026-07-11.** Directory (buyers/suppliers tabs, search,
> add/edit/archive), products, purchase-orders, and buyer-guest management are all wired live. Closes INS-030 and
> advances INS-032. See [STATUS.md](../../STATUS.md). (Checkbox state below is stale; see STATUS/BACKLOG + code.)

**For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Steps use `- [ ]` checkboxes.

---

## Goal

Wire the Buyers & Suppliers directory screen (route `/dashboard`) from a largely-static design placeholder into a fully interactive workspace management surface: live listing, tabbed navigation (Buyers / Suppliers), client-side search/filter, Add / Edit / Archive per-entity, and the supporting data entities (Products, Purchase Orders) that are prerequisites for creating inspections. Also covers buyer-guest token management (list / invite / revoke).

Closes or progresses: INS-030 (Add Buyer / Add Supplier / workspace actions), INS-031 (lossy live columns — partially, pending INS-005), INS-032 (search/filter/tabs).

---

## Architecture

```
apps/web/
  lib/api.ts                          ← extend shapes; no new file
  app/(console)/
    dashboard/
      page.tsx                        ← server component; fetch buyers + suppliers; pass to DirectoryClient
      directory-client.tsx  [NEW]     ← 'use client'; tab state, search filter, row menus
      actions.ts            [NEW]     ← 'use server'; buyer/supplier create/update/archive
    buyers/
      [id]/
        page.tsx            [NEW]     ← server component; detail/edit page for a buyer
        edit-form.tsx       [NEW]     ← 'use client'; edit buyer (name, logoUrl, primaryColor, defaultLoopPresetId)
        guests/
          page.tsx          [NEW]     ← server component; list buyer-guests + invite/revoke
          guests-client.tsx [NEW]     ← 'use client'; invite form + revoke buttons; surfaces token
    suppliers/
      [id]/
        page.tsx            [NEW]     ← server component; detail/edit page
        edit-form.tsx       [NEW]     ← 'use client'; edit supplier
    products/
      page.tsx              [NEW]     ← server component; list all products
      new/
        page.tsx            [NEW]     ← server component shell
        create-form.tsx     [NEW]     ← 'use client'; create product form
      [id]/
        page.tsx            [NEW]     ← server component; edit product
        edit-form.tsx       [NEW]     ← 'use client'
      actions.ts            [NEW]     ← 'use server'; product create/update/archive
    purchase-orders/
      page.tsx              [NEW]     ← server component; list all POs
      new/
        page.tsx            [NEW]     ← server component shell
        create-form.tsx     [NEW]     ← 'use client'; create PO (buyer/supplier/product selectors)
      [id]/
        page.tsx            [NEW]     ← server component; edit PO (poNumber, totalQuantity only — FKs immutable)
        edit-form.tsx       [NEW]     ← 'use client'
      actions.ts            [NEW]     ← 'use server'; PO create/update/delete
```

No new npm dependencies. No new component library. All styles are inline, matching `ui.*` / `mono` from `tokens.ts`.

---

## Tech Stack

- **Next.js 15 App Router** — Server Components for data fetch; `'use client'` only where interaction is needed.
- **Server Actions** (`'use server'`) — one `actions.ts` per route segment; called via `useActionState` (forms) or `useTransition` (buttons).
- **`lib/api.ts`** — `apiGet`/`loadOrFallback` for reads; `apiPost`/`apiPatch`/`apiDelete` + `ApiError` for writes (already present as of INS-022).
- **`shell.tsx` primitives** — `Btn`, `PageHead`, `Mono`, `Avatar`; no shadcn/Tailwind.
- **`tokens.ts`** — `ui.*`, `mono` for all inline styles.

---

## Global Constraints

1. **No new runtime dependencies.** Use only what is already installed.
2. **Server Actions for all writes.** Every mutation goes through a `'use server'` function in a colocated `actions.ts`; never `fetch` directly from a Client Component.
3. **Token attaches server-side.** `apiToken()` is called inside Server Actions and Server Components only — never passed to the client.
4. **Reuse the existing design system.** `Btn`, `PageHead`, `Mono`, `Avatar`, `ui.*`, `mono` from `components/inspect/`. Inline styles only. No Tailwind classes, no new design primitives.
5. **`pnpm type-check` must stay green in both apps** (`tsc --noEmit` on both `apps/api` and `apps/web`).
6. **`pnpm --filter @inspect/api test` must stay at 97+ passing** (unit tests, no DB). These tasks touch only `apps/web`.
7. **Verified by dev-owner login.** Manual walkthrough uses credentials `devowner@inspect.local` / `Devowner!123` at `http://localhost:3001` with API on `:3000`.
8. **RBAC enforced server-side.** All endpoints require `QA_MANAGER` minimum; Server Actions must not try to work around this — they surface `403` via `ApiError` → `{ error }`.
9. **`redirect()` must be called OUTSIDE try/catch** (Next.js throws a special error that must not be swallowed). `revalidatePath()` must be called before `redirect()`.
10. **Idempotency:** PO `poNumber` is unique per org — the Server Action must surface the API's `409` message verbatim via `ApiError`. Buyer-guest invite is non-idempotent; a fresh token is always returned.

---

## Current State

Audit of `apps/web/app/(console)/dashboard/page.tsx`:

| Concern | Detail | File:line |
|---|---|---|
| Live reads present | `loadOrFallback('/buyers',[])` and `loadOrFallback('/suppliers',[])` already called | `dashboard/page.tsx:37-38` |
| Buyer live mapping lossy | `loc`, `pos`, `products`, `reports`, `last` all hardcoded `'—'` even in live mode | `dashboard/page.tsx:40` |
| Supplier live mapping lossy | `buyers`, `pos`, `open`, `last` all hardcoded `'—'` even in live mode | `dashboard/page.tsx:43` |
| `ApiBuyer` shape incomplete | `logoUrl` present but never rendered; `branding`/`defaultLoopPresetId` absent from the shape | `lib/api.ts:97-102` |
| `ApiSupplier` shape minimal | Only `id, name, address?, gps?` | `lib/api.ts:103-108` |
| No `ApiProduct` shape | Missing entirely — only appears inline inside `ApiInspection` / `ApiPurchaseOrder` | `lib/api.ts:139-149` |
| `ApiPurchaseOrder` partial | Exists but only for inspection form use; missing `totalQuantity` and `orgId`-scoped standalone fields | `lib/api.ts:143-149` |
| Import CSV button inert | `<Btn kind="ghost">Import CSV</Btn>` — no handler | `dashboard/page.tsx:53` |
| Add Buyer button inert | `<Btn kind="primary" …>Add Buyer</Btn>` — no handler | `dashboard/page.tsx:54` |
| Tabs are static divs | Buyers/Suppliers tab divs have no state or click handler; Suppliers section is always rendered below | `dashboard/page.tsx:63` |
| Search input inert | No `value`/`onChange` | `dashboard/page.tsx:74` |
| Filter chips inert | All/Active chips have no state | `dashboard/page.tsx:77-78` |
| Per-buyer MoreVertical inert | `<MoreVertical>` div has no onClick; no edit/archive actions wired | `dashboard/page.tsx:118` |
| Buyer rows not clickable | No `onClick` or `<Link>` wrapping the row | `dashboard/page.tsx:98-121` |
| Add Supplier inert | `<Btn kind="ghost" …>Add Supplier</Btn>` — no handler | `dashboard/page.tsx:137` |
| No per-supplier action | Supplier rows have no `MoreVertical` / action control at all | `dashboard/page.tsx:154` |
| `logoUrl` never rendered | Present in `ApiBuyer` but not displayed in the buyer color-swatch cell | `dashboard/page.tsx:100-112` |
| No Products screen | No route `/products` or product list/CRUD screens | — |
| No POs screen | No standalone `/purchase-orders` route beyond the inspection new-form selector | — |
| No buyer-guest UI | No UI to list, invite, or revoke buyer-guests | — |

---

## File Inventory

| File | Status | Responsibility |
|---|---|---|
| `apps/web/lib/api.ts` | MODIFY | Add `branding?`, `defaultLoopPresetId?` to `ApiBuyer`; add `ApiProduct`; expand `ApiSupplier`; expand `ApiPurchaseOrder`; add `ApiBuyerGuest` |
| `apps/web/app/(console)/dashboard/page.tsx` | MODIFY | Remain Server Component; pass raw API arrays to new `DirectoryClient`; remove static BuyerRow/SupplierRow transformation |
| `apps/web/app/(console)/dashboard/directory-client.tsx` | CREATE | `'use client'`; tab state; client-side search/filter; MoreVertical menu per row (edit → navigate; archive → call action); Add Buyer / Add Supplier modal (inline forms calling `actions.ts`); pagination |
| `apps/web/app/(console)/dashboard/actions.ts` | CREATE | `'use server'`; `createBuyer`, `updateBuyer`, `archiveBuyer`, `createSupplier`, `updateSupplier`, `archiveSupplier` |
| `apps/web/app/(console)/buyers/[id]/page.tsx` | CREATE | Server Component; `apiGet('/buyers/:id')` + `apiGet('/loop-presets')`; render `EditBuyerForm` |
| `apps/web/app/(console)/buyers/[id]/edit-form.tsx` | CREATE | `'use client'`; controlled fields for name, logoUrl, primaryColor (color picker input), defaultLoopPresetId selector; `useActionState(updateBuyer)` |
| `apps/web/app/(console)/buyers/[id]/guests/page.tsx` | CREATE | Server Component; `apiGet('/buyers/:id/guests')`; render `GuestsClient` |
| `apps/web/app/(console)/buyers/[id]/guests/guests-client.tsx` | CREATE | `'use client'`; invite form (email + ttlDays); display returned token in a copyable box; revoke buttons via `useTransition` |
| `apps/web/app/(console)/buyers/[id]/guests/actions.ts` | CREATE | `'use server'`; `inviteBuyerGuest`, `revokeBuyerGuest` |
| `apps/web/app/(console)/suppliers/[id]/page.tsx` | CREATE | Server Component; `apiGet('/suppliers/:id')`; render `EditSupplierForm` |
| `apps/web/app/(console)/suppliers/[id]/edit-form.tsx` | CREATE | `'use client'`; controlled name, address, gps (JSON textarea); `useActionState(updateSupplier)` |
| `apps/web/app/(console)/products/page.tsx` | CREATE | Server Component; `apiGet<ApiProduct[]>('/products')`; table list + Add button linking to `/products/new` |
| `apps/web/app/(console)/products/new/page.tsx` | CREATE | Server Component shell; render `CreateProductForm` |
| `apps/web/app/(console)/products/new/create-form.tsx` | CREATE | `'use client'`; `styleNumber` (required) + `description`; `useActionState(createProduct)` → redirect to `/products` |
| `apps/web/app/(console)/products/[id]/page.tsx` | CREATE | Server Component; `apiGet('/products/:id')`; render `EditProductForm` |
| `apps/web/app/(console)/products/[id]/edit-form.tsx` | CREATE | `'use client'`; edit `styleNumber`, `description`; archive button |
| `apps/web/app/(console)/products/actions.ts` | CREATE | `'use server'`; `createProduct`, `updateProduct`, `archiveProduct` |
| `apps/web/app/(console)/purchase-orders/page.tsx` | CREATE | Server Component; `apiGet<ApiPurchaseOrder[]>('/purchase-orders')`; table + Add button |
| `apps/web/app/(console)/purchase-orders/new/page.tsx` | CREATE | Server Component; fetch `/buyers`, `/suppliers`, `/products` for selectors; render `CreatePOForm` |
| `apps/web/app/(console)/purchase-orders/new/create-form.tsx` | CREATE | `'use client'`; buyer/supplier/product selects (required) + poNumber + totalQuantity; `useActionState(createPurchaseOrder)` |
| `apps/web/app/(console)/purchase-orders/[id]/page.tsx` | CREATE | Server Component; `apiGet('/purchase-orders/:id')`; render `EditPOForm` (FKs shown read-only) |
| `apps/web/app/(console)/purchase-orders/[id]/edit-form.tsx` | CREATE | `'use client'`; editable `poNumber`, `totalQuantity` only; buyer/supplier/product shown as static text (immutable FKs); hard-delete button with confirmation |
| `apps/web/app/(console)/purchase-orders/actions.ts` | CREATE | `'use server'`; `createPurchaseOrder`, `updatePurchaseOrder`, `deletePurchaseOrder` |

---

## Tasks

### Phase A — Extend API shapes in `lib/api.ts`

**Files:** `apps/web/lib/api.ts`

**Interfaces produced:**

```ts
// Extend existing ApiBuyer
export interface ApiBuyer {
  id: string;
  name: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  branding?: Record<string, unknown> | null;      // raw JSON from API
  defaultLoopPresetId?: string | null;
}

// Extend existing ApiSupplier (gps was `unknown` — keep, just doc it)
export interface ApiSupplier {
  id: string;
  name: string;
  address?: string | null;
  gps?: { lat: number; lng: number } | null;       // JSON; serialised as string in form
}

// New
export interface ApiProduct {
  id: string;
  styleNumber: string;
  description?: string | null;
}

// Expand existing ApiPurchaseOrder (buyer/supplier/product already present)
export interface ApiPurchaseOrder {
  id: string;
  poNumber: string;
  totalQuantity?: number | null;
  buyer?: { id: string; name: string } | null;
  supplier?: { id: string; name: string } | null;
  product?: { id: string; styleNumber: string } | null;
}

// New
export interface ApiBuyerGuest {
  id: string;
  email: string;
  createdAt: string;
  expiresAt: string;
}
```

- [ ] Open `apps/web/lib/api.ts`. Add `branding?` and `defaultLoopPresetId?` to `ApiBuyer` (lines 97-102). Add `gps` typed as `{ lat: number; lng: number } | null` to `ApiSupplier`. Add `totalQuantity?` to `ApiPurchaseOrder`. Add `ApiProduct` interface. Add `ApiBuyerGuest` interface.
- [ ] **Verify:** `pnpm type-check` (both apps) passes with no new errors.

---

### Phase B — Workspace `actions.ts` for buyers and suppliers

**Files:** `apps/web/app/(console)/dashboard/actions.ts` (CREATE)

**Interfaces consumed:** `apiPost`, `apiPatch`, `apiDelete`, `ApiError` from `lib/api.ts`

**Interfaces produced (return type for each action):**
```ts
type ActionResult = { error?: string };
```

Key code pattern (mirror `inspections/actions.ts` exactly):

```ts
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { apiPost, apiPatch, apiDelete, ApiError } from '@/lib/api';

const msg = (e: unknown, fallback: string) =>
  e instanceof ApiError || e instanceof Error ? e.message : fallback;

export async function createBuyer(_prev: unknown, formData: FormData): Promise<{ error?: string }> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: 'Name is required' };
  const logoUrl = (formData.get('logoUrl') as string) || undefined;
  const primaryColor = (formData.get('primaryColor') as string) || undefined;
  const defaultLoopPresetId = (formData.get('defaultLoopPresetId') as string) || undefined;
  let id: string;
  try {
    const b = await apiPost<{ id: string }>('/buyers', { name, logoUrl, primaryColor, defaultLoopPresetId });
    id = b.id;
  } catch (e) {
    return { error: msg(e, 'create failed') };
  }
  revalidatePath('/dashboard');
  redirect(`/buyers/${id}`);
}

export async function updateBuyer(_prev: unknown, formData: FormData): Promise<{ error?: string }> {
  const id = String(formData.get('id') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: 'Name is required' };
  const logoUrl = (formData.get('logoUrl') as string) || undefined;
  const primaryColor = (formData.get('primaryColor') as string) || undefined;
  const rawPreset = formData.get('defaultLoopPresetId') as string;
  const defaultLoopPresetId = rawPreset === '' ? null : rawPreset || undefined;
  try {
    await apiPatch(`/buyers/${id}`, { name, logoUrl, primaryColor, defaultLoopPresetId });
  } catch (e) {
    return { error: msg(e, 'update failed') };
  }
  revalidatePath('/dashboard');
  revalidatePath(`/buyers/${id}`);
  redirect(`/buyers/${id}`);
}

export async function archiveBuyer(id: string): Promise<{ error?: string }> {
  try {
    await apiDelete(`/buyers/${id}`);
  } catch (e) {
    return { error: msg(e, 'archive failed') };
  }
  revalidatePath('/dashboard');
  redirect('/dashboard');
}

// createSupplier / updateSupplier / archiveSupplier — same pattern
// POST /suppliers {name(req), address?, gps?(JSON)}
// PATCH /suppliers/:id
// DELETE /suppliers/:id
```

Note: `archiveBuyer` / `archiveSupplier` accept the entity `id` directly (called from a button `onClick` that wraps them in `useTransition`). The `redirect()` calls are OUTSIDE the try/catch in `create*` and `update*`. For `archive*`, `redirect` is also outside try/catch.

- [ ] Create `apps/web/app/(console)/dashboard/actions.ts` with `createBuyer`, `updateBuyer`, `archiveBuyer`, `createSupplier`, `updateSupplier`, `archiveSupplier` following the pattern above.
- [ ] For `gps` in supplier: accept a `gpsJson` string field from the form; parse it inside the action; pass the parsed object (or `undefined` on empty/invalid) to the API.
- [ ] **Verify:** `pnpm type-check` green. No unused imports.

---

### Phase C — Add Buyer / Add Supplier form modals wired (INS-030 partial)

**Files:**
- `apps/web/app/(console)/dashboard/directory-client.tsx` (CREATE)
- `apps/web/app/(console)/dashboard/page.tsx` (MODIFY)

**Goal:** Replace the static dashboard `BuyerRow`/`SupplierRow` transforms and inert "Add Buyer" / "Add Supplier" buttons with a `'use client'` component that manages tab state and opens inline create forms.

**Interfaces consumed:**
```ts
import type { ApiBuyer, ApiSupplier, ApiLoopPreset } from '@/lib/api';
import { createBuyer, archiveBuyer, createSupplier, archiveSupplier } from './actions';
```

**Key structure of `directory-client.tsx`:**

```tsx
'use client';

import { useState, useTransition, useActionState } from 'react';
// ... ui, mono, Btn, Avatar, Mono, PageHead from existing system

export function DirectoryClient({
  buyers,
  suppliers,
  presets,
  live,
}: {
  buyers: ApiBuyer[];
  suppliers: ApiSupplier[];
  presets: ApiLoopPreset[];
  live: boolean;
}) {
  const [tab, setTab] = useState<'buyers' | 'suppliers'>('buyers');
  const [search, setSearch] = useState('');
  const [showAddBuyer, setShowAddBuyer] = useState(false);
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [buyerState, buyerAction] = useActionState(createBuyer, {});
  const [supplierState, supplierAction] = useActionState(createSupplier, {});

  const filteredBuyers = buyers.filter(b =>
    b.name.toLowerCase().includes(search.toLowerCase())
  );
  const filteredSuppliers = suppliers.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.address ?? '').toLowerCase().includes(search.toLowerCase())
  );
  // ... render tabs, search bar, table, per-row MoreVertical menu,
  //     inline add-forms (modal overlay or collapsible panel above the table)
}
```

**Add Buyer inline form** (inside `DirectoryClient`, shown when `showAddBuyer`):
- Fields: `name` (required text), `logoUrl` (optional text), `primaryColor` (optional `<input type="color">`), `defaultLoopPresetId` (optional `<select>` from `presets` prop, empty-option = "None").
- Submit via `<form action={buyerAction}>`. Show `buyerState.error` in red.
- On success (no error + `showAddBuyer` stays open — but the redirect from `createBuyer` closes it naturally by navigating away).

**Add Supplier inline form** (analogous):
- Fields: `name` (required), `address` (optional textarea), `gpsJson` (optional text, placeholder `{"lat":0,"lng":0}`).

**Per-row MoreVertical menu** (buyers):
- "Edit" → `router.push(`/buyers/${b.id}`)` using `useRouter`.
- "Manage guests" → `router.push(`/buyers/${b.id}/guests`)`.
- "Archive" → `startTransition(async () => { const r = await archiveBuyer(b.id); if (r?.error) alert(r.error); })`.

**Per-row MoreVertical menu** (suppliers):
- "Edit" → `router.push(`/suppliers/${s.id}`)`.
- "Archive" → `startTransition(async () => { const r = await archiveSupplier(s.id); if (r?.error) alert(r.error); })`.

**Branding cell** — for live buyers: if `b.logoUrl` render `<img src={b.logoUrl} … />` (24 px height, object-contain), otherwise fall back to the existing color-swatch + hex.

**Modify `dashboard/page.tsx`:**
- Add `apiGet<ApiLoopPreset[]>('/loop-presets').catch(() => [])` to the parallel fetch.
- Pass raw `ApiBuyer[]`, `ApiSupplier[]`, `ApiLoopPreset[]`, and `live` (from `buyersRes.live`) to `<DirectoryClient>`.
- Remove the static `BuyerRow`/`SupplierRow` interfaces, `DEMO_*` arrays, and the table markup — those move into `DirectoryClient`.
- Keep `export const dynamic = 'force-dynamic'`.
- Keep `loadOrFallback` for buyers/suppliers (so the page still renders offline with DEMO data — pass the demo arrays as the fallback).

Steps:
- [ ] Create `apps/web/app/(console)/dashboard/directory-client.tsx` implementing tab switching, search filter, buyers table (live columns: name, initials+color, branding cell with logoUrl/color; counts stay `'—'`), suppliers table (name, address, gps pin), per-row MoreVertical menus (edit/archive for both; manage-guests for buyers), and inline Add Buyer / Add Supplier forms wired to actions.
- [ ] Modify `apps/web/app/(console)/dashboard/page.tsx`: fetch `loop-presets`; replace static transforms with a `<DirectoryClient buyers={} suppliers={} presets={} live={} />` pass-through.
- [ ] **Verify:**
  - `pnpm type-check` green.
  - `http://localhost:3001/dashboard` (logged in as dev-owner): tabs switch between Buyers and Suppliers; search narrows the visible rows in real time; "Add Buyer" form appears and submits (creates row, redirects to `/buyers/:id`); "Add Supplier" form appears and submits; MoreVertical menu is clickable per row.

---

### Phase D — Edit + Archive per-row (buyer and supplier detail pages)

**Files:**
- `apps/web/app/(console)/buyers/[id]/page.tsx` (CREATE)
- `apps/web/app/(console)/buyers/[id]/edit-form.tsx` (CREATE)
- `apps/web/app/(console)/suppliers/[id]/page.tsx` (CREATE)
- `apps/web/app/(console)/suppliers/[id]/edit-form.tsx` (CREATE)

**Buyer edit page (`/buyers/[id]`):**

```tsx
// page.tsx — Server Component
import { apiGet } from '@/lib/api';
import type { ApiBuyer, ApiLoopPreset } from '@/lib/api';
import { EditBuyerForm } from './edit-form';

export default async function BuyerDetailPage({ params }: { params: { id: string } }) {
  const [buyer, presets] = await Promise.all([
    apiGet<ApiBuyer>(`/buyers/${params.id}`),
    apiGet<ApiLoopPreset[]>('/loop-presets').catch(() => []),
  ]);
  return (
    <div style={{ padding: '24px 32px 40px' }}>
      <PageHead title={buyer.name} sub="Buyer configuration" />
      <EditBuyerForm buyer={buyer} presets={presets} />
    </div>
  );
}
```

`edit-form.tsx` (`'use client'`):
- Imports `updateBuyer`, `archiveBuyer` from `../../dashboard/actions` (or a co-located actions file — use the dashboard one to avoid duplication).
- `useActionState(updateBuyer, {})` for the save form.
- Fields: `name`, `logoUrl`, `primaryColor` (color input), `defaultLoopPresetId` (select with "None" option = `''`).
- Hidden field `id` set to `buyer.id`.
- Archive button: `useTransition` → `archiveBuyer(buyer.id)` → on error show inline; on success the server redirects.

Supplier edit follows the same structure with `name`, `address`, `gpsJson` fields; no preset selector.

- [ ] Create `apps/web/app/(console)/buyers/[id]/page.tsx` and `edit-form.tsx`.
- [ ] Create `apps/web/app/(console)/suppliers/[id]/page.tsx` and `edit-form.tsx`.
- [ ] **Verify:**
  - Navigating to `/buyers/:id` shows the buyer's current fields pre-populated.
  - Editing the name and saving reloads with the new name.
  - Clicking Archive redirects to `/dashboard` and the buyer no longer appears in the live list.
  - Same flow works for suppliers.

---

### Phase E — Tab switching + client search/filter (INS-032 partial)

This is already implemented as part of Phase C (`DirectoryClient` holds `tab` and `search` state). The separate tasks here cover edge cases and the filter chip:

- [ ] Wire the "Active" chip: filtered list excludes archived buyers/suppliers. Since the API `GET /buyers` already excludes archived rows (soft-delete), the "All" vs "Active" distinction is only meaningful when the API adds a `?includeArchived=true` param — for now, "All" = "Active" = the live API response. Render both chips; clicking "Active" is a no-op but visually toggles; add a TODO comment to hook into the API param when available.
- [ ] Pagination: the current page shows all rows (no server-side pagination yet). Show a static "Showing N buyers" footer as before. Disable the chevron buttons (render them greyed out) rather than hiding them. Add a TODO comment for pagination query params.
- [ ] **Verify:**
  - Typing in the search box filters rows instantly (client-side).
  - Tab click toggles between buyers and suppliers tables.
  - Filter chips are clickable without JS errors.
  - `pnpm type-check` green.

---

### Phase F — Products CRUD (create-inspection prerequisite)

**Files:**
- `apps/web/app/(console)/products/actions.ts` (CREATE)
- `apps/web/app/(console)/products/page.tsx` (CREATE)
- `apps/web/app/(console)/products/new/page.tsx` (CREATE)
- `apps/web/app/(console)/products/new/create-form.tsx` (CREATE)
- `apps/web/app/(console)/products/[id]/page.tsx` (CREATE)
- `apps/web/app/(console)/products/[id]/edit-form.tsx` (CREATE)

**`products/actions.ts`:**

```ts
'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { apiPost, apiPatch, apiDelete, ApiError } from '@/lib/api';

const msg = (e: unknown, fb: string) => e instanceof ApiError || e instanceof Error ? e.message : fb;

export async function createProduct(_prev: unknown, fd: FormData): Promise<{ error?: string }> {
  const styleNumber = String(fd.get('styleNumber') ?? '').trim();
  if (!styleNumber) return { error: 'Style number is required' };
  const description = (fd.get('description') as string) || undefined;
  let id: string;
  try {
    const p = await apiPost<{ id: string }>('/products', { styleNumber, description });
    id = p.id;
  } catch (e) { return { error: msg(e, 'create failed') }; }
  revalidatePath('/products');
  redirect('/products');
}

export async function updateProduct(_prev: unknown, fd: FormData): Promise<{ error?: string }> {
  const id = String(fd.get('id') ?? '');
  const styleNumber = String(fd.get('styleNumber') ?? '').trim();
  if (!styleNumber) return { error: 'Style number is required' };
  const description = (fd.get('description') as string) || undefined;
  try {
    await apiPatch(`/products/${id}`, { styleNumber, description });
  } catch (e) { return { error: msg(e, 'update failed') }; }
  revalidatePath('/products');
  revalidatePath(`/products/${id}`);
  redirect('/products');
}

export async function archiveProduct(id: string): Promise<{ error?: string }> {
  try { await apiDelete(`/products/${id}`); } catch (e) { return { error: msg(e, 'archive failed') }; }
  revalidatePath('/products');
  redirect('/products');
}
```

**`products/page.tsx`:** Server Component; `apiGet<ApiProduct[]>('/products')`; table with columns Style Number, Description, Actions (Edit link / Archive); `<PageHead title="Products" actions={<Btn href="/products/new">Add Product</Btn>} />`.

**`products/new/create-form.tsx`:** `'use client'`; `useActionState(createProduct, {})`; fields: `styleNumber` (required), `description` (optional textarea); submit button; error display.

**`products/[id]/page.tsx`:** `apiGet<ApiProduct>('/products/:id')`; render `EditProductForm`.

**`products/[id]/edit-form.tsx`:** `'use client'`; pre-populated `styleNumber`, `description`; save + archive buttons.

- [ ] Create `products/actions.ts` with `createProduct`, `updateProduct`, `archiveProduct`.
- [ ] Create `products/page.tsx` (list).
- [ ] Create `products/new/page.tsx` and `products/new/create-form.tsx`.
- [ ] Create `products/[id]/page.tsx` and `products/[id]/edit-form.tsx`.
- [ ] Add a "Products" link to the sidebar NAV in `shell.tsx` — OR link to `/products` from the dashboard summary row (prefer a nav addition; update the `NAV` array in `shell.tsx` under "Buyers & Suppliers").
- [ ] **Verify:**
  - `/products` shows the live product list.
  - "Add Product" form creates a product; it appears in the list.
  - Edit and save updates the product.
  - Archive removes it from the list.
  - `pnpm type-check` green.

---

### Phase G — Purchase Orders CRUD (create-inspection prerequisite)

**Files:**
- `apps/web/app/(console)/purchase-orders/actions.ts` (CREATE)
- `apps/web/app/(console)/purchase-orders/page.tsx` (CREATE)
- `apps/web/app/(console)/purchase-orders/new/page.tsx` + `create-form.tsx` (CREATE)
- `apps/web/app/(console)/purchase-orders/[id]/page.tsx` + `edit-form.tsx` (CREATE)

**`purchase-orders/actions.ts`:**

```ts
'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { apiPost, apiPatch, apiDelete, ApiError } from '@/lib/api';

const msg = (e: unknown, fb: string) => e instanceof ApiError || e instanceof Error ? e.message : fb;

export async function createPurchaseOrder(_prev: unknown, fd: FormData): Promise<{ error?: string }> {
  const poNumber = String(fd.get('poNumber') ?? '').trim();
  const buyerId = String(fd.get('buyerId') ?? '');
  const supplierId = String(fd.get('supplierId') ?? '');
  const productId = String(fd.get('productId') ?? '');
  const totalQuantity = fd.get('totalQuantity') ? Number(fd.get('totalQuantity')) : undefined;
  if (!poNumber) return { error: 'PO number is required' };
  if (!buyerId) return { error: 'Select a buyer' };
  if (!supplierId) return { error: 'Select a supplier' };
  if (!productId) return { error: 'Select a product' };
  let id: string;
  try {
    const po = await apiPost<{ id: string }>('/purchase-orders', { poNumber, buyerId, supplierId, productId, totalQuantity });
    id = po.id;
  } catch (e) { return { error: msg(e, 'create failed') }; }  // 409 poNumber-unique surfaced verbatim
  revalidatePath('/purchase-orders');
  redirect('/purchase-orders');
}

export async function updatePurchaseOrder(_prev: unknown, fd: FormData): Promise<{ error?: string }> {
  const id = String(fd.get('id') ?? '');
  const poNumber = String(fd.get('poNumber') ?? '').trim();
  if (!poNumber) return { error: 'PO number is required' };
  const totalQuantity = fd.get('totalQuantity') ? Number(fd.get('totalQuantity')) : undefined;
  try {
    await apiPatch(`/purchase-orders/${id}`, { poNumber, totalQuantity });
  } catch (e) { return { error: msg(e, 'update failed') }; }
  revalidatePath('/purchase-orders');
  revalidatePath(`/purchase-orders/${id}`);
  redirect('/purchase-orders');
}

// Hard-delete — fails if PO is referenced by inspections (API returns 409/422)
export async function deletePurchaseOrder(id: string): Promise<{ error?: string }> {
  try { await apiDelete(`/purchase-orders/${id}`); } catch (e) { return { error: msg(e, 'delete failed') }; }
  revalidatePath('/purchase-orders');
  redirect('/purchase-orders');
}
```

**`purchase-orders/page.tsx`:** Server Component; `apiGet<ApiPurchaseOrder[]>('/purchase-orders')`; table with columns PO#, Buyer, Supplier, Product, Qty, Actions (Edit / Delete). `<PageHead title="Purchase Orders" actions={<Btn href="/purchase-orders/new">Add PO</Btn>} />`.

**`purchase-orders/new/page.tsx`:** Server Component; parallel fetch buyers/suppliers/products for selectors; render `CreatePOForm`.

**`purchase-orders/new/create-form.tsx`:** `'use client'`; selects for buyer/supplier/product (required); text for `poNumber` (required); number for `totalQuantity` (optional); `useActionState(createPurchaseOrder, {})`.

**`purchase-orders/[id]/page.tsx`:** `apiGet<ApiPurchaseOrder>('/purchase-orders/:id')`; render `EditPOForm`.

**`purchase-orders/[id]/edit-form.tsx`:** `'use client'`; `poNumber` and `totalQuantity` editable; buyer/supplier/product shown as static `<Mono>` text (immutable FKs — do NOT render as inputs); hard-delete button with an inline confirmation (`window.confirm` is sufficient for MVP).

- [ ] Create `purchase-orders/actions.ts` with `createPurchaseOrder`, `updatePurchaseOrder`, `deletePurchaseOrder`.
- [ ] Create `purchase-orders/page.tsx` (list).
- [ ] Create `purchase-orders/new/page.tsx` and `create-form.tsx`.
- [ ] Create `purchase-orders/[id]/page.tsx` and `edit-form.tsx`.
- [ ] Add "Purchase Orders" nav item (or link from dashboard) — same approach as Products (Phase F).
- [ ] **Verify:**
  - `/purchase-orders` shows live PO list.
  - "Add PO" form creates a PO linking a buyer, supplier, and product; it appears in the list.
  - Edit saves `poNumber` / `totalQuantity` changes; buyer/supplier/product stay read-only.
  - Delete on a PO not referenced by inspections succeeds; on a referenced PO the API error is shown inline.
  - A PO created here is now selectable in the Create Inspection form at `/inspections/new`.
  - `pnpm type-check` green.

---

### Phase H — Buyer-guest management (list / invite / revoke)

**Files:**
- `apps/web/app/(console)/buyers/[id]/guests/actions.ts` (CREATE)
- `apps/web/app/(console)/buyers/[id]/guests/page.tsx` (CREATE)
- `apps/web/app/(console)/buyers/[id]/guests/guests-client.tsx` (CREATE)

**`guests/actions.ts`:**

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { apiPost, apiDelete, ApiError } from '@/lib/api';

const msg = (e: unknown, fb: string) => e instanceof ApiError || e instanceof Error ? e.message : fb;

export async function inviteBuyerGuest(
  buyerId: string,
  _prev: unknown,
  fd: FormData,
): Promise<{ error?: string; token?: string; guestId?: string }> {
  const email = String(fd.get('email') ?? '').trim();
  if (!email) return { error: 'Email is required' };
  const ttlDays = fd.get('ttlDays') ? Number(fd.get('ttlDays')) : undefined;
  try {
    const res = await apiPost<{ guest: { id: string }; token: string }>(
      `/buyers/${buyerId}/guests`,
      { email, ttlDays },
    );
    revalidatePath(`/buyers/${buyerId}/guests`);
    return { token: res.token, guestId: res.guest.id };
  } catch (e) { return { error: msg(e, 'invite failed') }; }
}

export async function revokeBuyerGuest(buyerId: string, guestId: string): Promise<{ error?: string }> {
  try { await apiDelete(`/buyer-guests/${guestId}`); } catch (e) { return { error: msg(e, 'revoke failed') }; }
  revalidatePath(`/buyers/${buyerId}/guests`);
  return {};
}
```

Note: `inviteBuyerGuest` takes `buyerId` as a curried first argument — it is called via `useActionState` with a partial application:

```tsx
// In guests-client.tsx:
const boundInvite = inviteBuyerGuest.bind(null, buyerId);
const [state, action] = useActionState(boundInvite, {});
```

**`guests/page.tsx`:** Server Component; `apiGet<ApiBuyerGuest[]>(`/buyers/${id}/guests`)`; `apiGet<ApiBuyer>(`/buyers/${id}`)` for the breadcrumb name; render `<GuestsClient buyerId={id} guests={guests} />`.

**`guests-client.tsx`:** `'use client'`; table of guests (email, created, expires, revoke button); invite form (email text + ttlDays number, default 30); on success from `state.token`: render a copyable token box:

```tsx
{state.token && (
  <div style={{ background: '#F0F8FF', border: `1px solid ${ui.accent}`, borderRadius: 8, padding: '12px 16px', marginTop: 12 }}>
    <div style={{ fontSize: 12, fontWeight: 600, color: ui.accent, marginBottom: 6 }}>
      Magic-link token (copy now — shown once)
    </div>
    <Mono style={{ fontSize: 12, wordBreak: 'break-all' }}>{state.token}</Mono>
  </div>
)}
```

Revoke: per-row revoke button → `useTransition` wrapping `revokeBuyerGuest(buyerId, guest.id)` → on error show inline message; on success the `revalidatePath` in the action will re-render the server component list.

- [ ] Create `guests/actions.ts` with `inviteBuyerGuest` and `revokeBuyerGuest`.
- [ ] Create `guests/page.tsx` (server component).
- [ ] Create `guests-client.tsx` with invite form + token display + guest table with revoke buttons.
- [ ] **Verify:**
  - Navigating to `/buyers/:id/guests` shows existing guests (empty initially).
  - Submitting the invite form with a valid email returns a token displayed in the copyable box.
  - Submitting again for the same email creates another guest (non-idempotent by design — INS-004).
  - Clicking Revoke removes the guest from the list.
  - `pnpm type-check` green.

---

### Phase I — Optional backend: `_count` aggregation for list columns (INS-005 dependency)

> **This phase is OPTIONAL and is a backend task (`apps/api`). It is listed here so the implementer can deliver it in the same branch or defer it. It does NOT block Phases A-H.**

**Problem:** Even after all web phases are done, the buyer and supplier list columns for Open POs, Products, Reports, and Last-activity will show `'—'` because the `GET /buyers` response returns only `{id, name, logoUrl?, primaryColor?}` — no counts. This is tracked as INS-005.

**What to add (if implementing now):**

In `apps/api/src/buyers/buyers.service.ts`, extend the `findAll` query:

```ts
// Approximate — verify the actual Prisma field names against schema.prisma
return this.prisma.buyer.findMany({
  where: { orgId },
  include: {
    _count: { select: { purchaseOrders: true, products: true, reports: true } },
  },
  orderBy: { name: 'asc' },
});
```

Add `_count?: { purchaseOrders: number; products: number; reports: number }` to `ApiBuyer` in `lib/api.ts`. Update the `DirectoryClient` buyer table to render `b._count?.purchaseOrders ?? '—'` etc.

- [ ] (Optional) Add `_count` to `buyers.service.ts` `findAll` and `suppliers.service.ts` (for a `purchaseOrders` count).
- [ ] (Optional) Extend `ApiBuyer` and `ApiSupplier` shapes in `lib/api.ts`.
- [ ] (Optional) Update the buyer/supplier table cells in `DirectoryClient` to render real counts.
- [ ] (Optional) **Verify:** `pnpm --filter @inspect/api test` still 97+ passing; list screens show real count values instead of `'—'`.

---

## Dependencies & Out of Scope

| Item | Note |
|---|---|
| **INS-005** (count aggregation) | Phase I above is the web side; the backend half is in the INS-005 backlog item. Phases A-H deliver fully without it — counts stay `'—'`. |
| **INS-004** (guest/invite email) | Buyer-guest tokens are returned from the API and displayed in a copyable box (Phase H). Email delivery is deliberately deferred to INS-004. The plan surfaces the token to the operator who can manually share it. |
| **INS-008** (shared-types linking) | Both apps currently redeclare their own types. Shapes added to `lib/api.ts` in Phase A follow the existing pattern — they will be replaced by `@inspect/shared-types` imports when INS-008 lands. |
| **PO hard-delete constraint** | `DELETE /purchase-orders/:id` is a hard-delete. If the PO is referenced by one or more inspections, the API returns an error (the Prisma FK constraint prevents deletion). Phase G surfaces this API error inline. Do not attempt soft-delete on the web side — let the API be authoritative. |
| **Import CSV** | The "Import CSV" button is out of scope for this plan. Keep it rendered as an inert `<Btn kind="ghost">` with a TODO comment. |
| **INS-003** (PDF render) | Report columns in the buyer list (Reports count) depend on INS-003 and INS-005. Keep as `'—'`. |
| **Buyer-guest portal** | Phase H wires the management UI (invite/revoke, display token). The buyer-facing `/portal` screen (reading the magic-link token and rendering the report list) is a separate item tracked as INS-025. |
| **Pagination / server-side search** | All search/filter in this plan is client-side. Server-side pagination and query-param filtering are deferred; the current MVP list sizes fit in a single response. |
| **Sidebar navigation update** | Adding Products and Purchase Orders nav links (Phase F/G) modifies `apps/web/components/inspect/shell.tsx`. The NAV array is a `const` — add entries without changing the TypeScript type. Verify the sidebar still renders correctly at all existing routes. |

---

## Self-Review: Audit Gaps → Plan Tasks

| Audit gap (dashboard/page.tsx file:line) | INS id | Plan task |
|---|---|---|
| Add Buyer / Add Supplier inert (`:53-54`, `:137`) | INS-030 | Phase C (inline create form in `DirectoryClient`) |
| MoreVertical has no handler (`:118`); no per-supplier action (`:154`) | INS-030 | Phase C (per-row MoreVertical menu with edit/archive/guests) |
| Tabs are static divs (`:63`) | INS-032 | Phase C (`tab` state in `DirectoryClient`) |
| Search input inert (`:74`) | INS-032 | Phase C/E (`search` state + `filteredBuyers`/`filteredSuppliers`) |
| Filter chips inert (`:77-78`) | INS-032 | Phase E (chips wired, "Active" = no-op with TODO) |
| Buyer live mapping lossy (`:40`) | INS-031 | Phase A (extend `ApiBuyer`); Phase I (optional `_count`) |
| Supplier live mapping lossy (`:43`) | INS-031 | Phase A (extend `ApiSupplier`); Phase I (optional `_count`) |
| `logoUrl` never rendered (`:100-112`) | INS-031 | Phase C (branding cell renders logo if present) |
| No `ApiProduct` shape | — | Phase A |
| `ApiPurchaseOrder` partial | — | Phase A |
| No Products screen | — | Phase F |
| No PO standalone screen | — | Phase G |
| No buyer-guest UI | INS-025 (management side) | Phase H |
| `branding`/`defaultLoopPresetId` absent from `ApiBuyer` | — | Phase A + Phase C (Add Buyer form) + Phase D (Edit form) |
