# Inspect Web — Operator-Loop Spine — Design

> **Status:** 🟡 In progress (brainstormed 2026-06-20). First slice of the **frontend integration** phase.
> Wires the QA operator loop (session → create → submit → decide) to the API verified end-to-end on
> 2026-06-20 (see [../plans/2026-06-20-ins-001-stand-up-and-verify.md](../plans/2026-06-20-ins-001-stand-up-and-verify.md)).
> Backlog: closes [INS-028](../../future/BACKLOG.md) and the core of [INS-026](../../future/BACKLOG.md) +
> [INS-027](../../future/BACKLOG.md); adds an inspections list + one AQL-preview endpoint.
> Requirements (frozen): [../../done/specs/2026-06-06-inspect-mvp-requirements-design.md](../../done/specs/2026-06-06-inspect-mvp-requirements-design.md) (§5/§8/§11/§13).

## Goal

Make the **QA Manager operator loop usable in the web console**, wired to the real API: log in and see
the real identity, create an inspection from a Purchase Order, submit it for AQL evaluation, and record
the binding QA decision — all server-enforced for tenancy and RBAC. This is the first slice that turns the
console from static placeholders into a working app on top of the now-verified backend.

## Context

- The full API loop runs **2xx end-to-end against the live DB** (25-step smoke; cross-tenant populate, AQL,
  signed report, verify all green). Every endpoint this slice needs is proven.
- The web client already has the foundation: `apiGet`/`loadOrFallback` + authenticated `apiPost/Put/Patch/Delete`
  + `ApiError` ([apps/web/lib/api.ts](../../../apps/web/lib/api.ts)), and NextAuth Credentials carrying
  `accessToken`/`role`/`orgId` in the session ([apps/web/lib/auth.ts](../../../apps/web/lib/auth.ts)).
- The three target screens are static today: the shell hardcodes the user, create/review are mock data, and
  the review route carries no inspection id.

### Data-model facts that shape the design

- `POST /inspections` takes **`{ poId, loopPresetId, lotSize?, aqlPlan?, assignedInspectorId?, clientRequestId? }`**.
  Buyer/supplier/product are **derived from the PO** (`po.buyerId` etc.) — the create screen selects a **PO**,
  not three independent parties. (`GET /purchase-orders` includes buyer/supplier/product relations.)
- A QA **decision** requires a **submitted** inspection (an `AqlResult` exists). `POST /inspections/:id/submit`
  (`@Roles('QA_MANAGER')`) computes the AQL result; `lotSize` must be set (we set it at create).
- The AQL engine (`apps/api/src/aql`) is **server-side only** — the web cannot import it, so a live "computed
  plan" preview needs a server endpoint (no duplication of the verified tables in the web app).
- Role mapping: API `UserRole` → web `RoleKey`: `INSPECTOR→inspector`, `QA_MANAGER→qa`, `ORG_OWNER→owner`,
  `PLATFORM_ADMIN→platform` (all four already exist in `components/inspect/tokens.ts`).

## Approach

**Server Components for reads + Server Actions for writes.** Pages stay server components calling `apiGet`;
mutations go through `'use server'` actions that call the existing server-only write helpers (which read the
session via `auth()`), then `revalidatePath`/`redirect`. This matches the existing helper contract, keeps the
JWT **server-side only** (never shipped to the browser), and needs no `SessionProvider`. Rejected alternatives:
client-side route-handler proxies (extra surface area) and exposing the token to client components (weaker
security posture).

## Scope

### In scope
1. **Session & shell** (INS-028) — real user/org/role + sign-out.
2. **AQL-preview endpoint** — `GET /inspections/aql-preview` reusing `computeSampling`.
3. **Create inspection** (INS-026) — PO-driven create with a live AQL plan preview.
4. **Inspections list** (new) — navigate to any inspection.
5. **Review + submit + decide** (INS-027) — id-routed, state-driven.

### Out of scope (named next slices)
Admin populate / photo upload (INS-023, needs MinIO) · PDF render + report preview + public verify page
(INS-003/033/017) · guest portal (INS-025) · invite/accept + workspace CRUD + preset builder screens
(INS-029/030/024) · dashboard counts (INS-005) · email delivery (INS-004) · linking `@inspect/shared-types`
(INS-008) · a web test runner / Playwright.

## Component design

### 1. Session & shell (INS-028)
- `app/(console)/layout.tsx` becomes `async`: calls `auth()`; if no session → `redirect('/login')`; maps the
  API role to `RoleKey` and passes `{ userName, role }` into `ConsoleShell` as props.
- `components/inspect/shell.tsx`: `ConsoleShell` accepts the new props; `Sidebar`/`Topbar` render the real
  name/initials/role instead of `DEFAULT_USER` (kept only as a fallback for offline preview).
- **Sign-out:** a server action `signOutAction` (`'use server'`) calling NextAuth `signOut({ redirectTo: '/login' })`,
  wired to a small client button in the topbar user area.
- **Org name:** the session carries `orgId` but not the org name, and the API exposes no tenant-self lookup the
  org-scoped console can call. For this slice the shell keeps `DEFAULT_ORG` as the workspace label (no new
  endpoint, no extra fetch); surfacing the real org name is deferred to a `/me`-enrichment follow-up (with INS-005).

### 2. AQL-preview endpoint (backend, TDD)
- Route: `GET /inspections/aql-preview` on `InspectionsController` (`@Roles('QA_MANAGER')`), query params
  `lotSize` (int ≥ 2, required), `critical`/`major`/`minor` (optional numbers).
- Service: `InspectionsService.aqlPreview(lotSize, plan)` → `computeSampling(lotSize, plan)`; wrap the engine's
  throws (`AqlPlanNotAvailableError`, invalid lot size) in `BadRequestException` with the engine's message so the
  web shows a clean "outside the verified AQL band" rather than a 500.
- Returns `ComputedSampling` (`{ sampleSizeCodeLetter, sampleSize, perClass }`).
- **Tests:** unit spec — in-band lot (e.g. 1000 → `J`, n 80) returns the plan; out-of-band (e.g. AQL not in the
  grid) returns 400; lotSize < 2 → 400.

### 3. Create inspection (INS-026) — `/inspections/new`
- **Server load:** `GET /purchase-orders`, `GET /loop-presets`, `GET /users` (inspectors = role `INSPECTOR`).
- **Empty state:** no POs → prompt "Create a purchase order first" (workspace slice), disabling create.
- **Client form (controlled):** PO select → shows derived buyer/supplier/product read-only; loop-preset select;
  lot-size input; optional inspector select.
- **Live AQL plan panel:** on lot-size (and any AQL override) change, debounced call to `/inspections/aql-preview`;
  render code letter, sample size, per-class AQL/Ac/Re; show the band error inline if returned.
- **Submit:** server action `createInspection({ poId, loopPresetId, lotSize, assignedInspectorId? })` →
  `POST /inspections` → `redirect('/inspections/{id}/review')`. "Save draft" omits the inspector (→ `DRAFT`);
  "Create & assign" requires one (→ `ASSIGNED`).
- Sends a `clientRequestId` (idempotent create) generated per form mount.

### 4. Inspections list (new) — `/inspections`
- Server component: `GET /inspections` → table (PO number · buyer · product · status · system recommendation ·
  created). Rows link to `/inspections/{id}/review`. "New inspection" button → `/inspections/new`.
- Sidebar nav "Inspections" href repointed from `/inspections/new` to `/inspections`.
- Empty state: "No inspections yet — create one."

### 5. Review + submit + decide (INS-027) — `/inspections/[id]/review`
- The static `/review` page moves to `app/(console)/inspections/[id]/review/page.tsx`; the old `/review` route is
  removed (no inbound links remain after the nav/list changes).
- **Server load:** `GET /inspections/:id` (includes `aqlResult`, `loops`, `purchaseOrder`, `buyer`, etc.).
- **State-driven render:**
  - `DRAFT | ASSIGNED | IN_PROGRESS` → "Submit for review" action (server action → `POST /:id/submit`).
    Show the defect tally collected so far (read-only); note photos/defects are added in the admin populate
    step (out of scope) — submit works regardless.
  - `SUBMITTED | UNDER_REVIEW | HOLD` → AQL evaluation table from `aqlResult.perClass` (found/ac/re/result) +
    system recommendation banner + QA decision panel (Pass/Fail/Hold radios + **required** note) → server action
    `decide({ decision, remarks })` → `POST /:id/decision` → revalidate.
  - `APPROVED | REJECTED | REPORT_ISSUED` → read-only final verdict + note. Report generation/preview is the
    next slice.

### Server actions module
`app/(console)/inspections/actions.ts` (`'use server'`): `createInspection`, `submitInspection`, `decideInspection`,
each calling the `lib/api.ts` write helpers, catching `ApiError` → returning `{ error }` for the form, and
`revalidatePath`/`redirect` on success. `signOutAction` lives with the shell wiring.

## Error handling & UX
- Forms use `useActionState`; `ApiError.message` (already surfaces NestJS messages) is rendered inline; submit
  buttons show pending/disabled state.
- Empty states for no-POs and no-inspections.
- Tenancy + RBAC are enforced **server-side** by the JWT; the web does not re-implement them. Screens assume
  QA_MANAGER+ (an INSPECTOR session would get 403s on the write actions — acceptable for this slice).

## Testing
- **Backend:** TDD unit spec for `aqlPreview` (in-band, out-of-band 400, bad lot 400). Keep the 97 unit tests +
  `type-check` green across the workspace.
- **API loop:** already covered by `apps/api/scripts/smoke-loop.mjs` (create/submit/decide).
- **Web:** no test runner exists; verify manually by running `pnpm dev` and walking login → create → submit →
  decide in the browser. A web e2e (Playwright) is a later, separate item.

## File inventory (anticipated)
- `apps/api/src/inspections/inspections.controller.ts` — add `GET /aql-preview`.
- `apps/api/src/inspections/inspections.service.ts` — add `aqlPreview()`.
- `apps/api/src/inspections/aql-preview.spec.ts` (or extend an inspections spec) — TDD.
- `apps/web/app/(console)/layout.tsx` — `auth()` → props.
- `apps/web/components/inspect/shell.tsx` — accept session props + sign-out.
- `apps/web/app/(console)/inspections/new/page.tsx` — server load + client form.
- `apps/web/app/(console)/inspections/new/create-form.tsx` (new client component).
- `apps/web/app/(console)/inspections/page.tsx` — new list.
- `apps/web/app/(console)/inspections/[id]/review/page.tsx` — moved/parameterized review.
- `apps/web/app/(console)/inspections/actions.ts` — server actions.
- `apps/web/app/(console)/review/page.tsx` — removed.
- `apps/web/lib/api.ts` — add response shapes (`ApiPurchaseOrder`, `ApiInspection`, `ApiAqlResult`, preview type).

## Open risks
- **Web has no automated tests** — correctness rests on type-check + manual walkthrough + the API smoke. Accepted
  for this slice; a web e2e is tracked separately.
- **Type drift** — the web redeclares API response shapes (INS-008 still open); minimized by keeping the new
  shapes small and colocated, to be replaced when shared-types is linked.
