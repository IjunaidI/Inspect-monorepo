# Meeting Batch 1 — lifecycle correctness, RBAC, reversibility, reports visibility (design)

> Executes 12 items from the **2026-07-17 product-feedback batch** ([../../future/BACKLOG.md](../../future/BACKLOG.md)):
> INS-056, INS-057, INS-058, INS-059, INS-061, INS-062, INS-064, INS-065, INS-066, INS-067, INS-069, INS-070.
> Paired plan: [../plans/2026-07-18-inspect-meeting-batch-1.md](../plans/2026-07-18-inspect-meeting-batch-1.md).
> Out of batch (deliberately): INS-055 (Company epic — needs its own spec), INS-060 (storage byte path — needs
> Docker/MinIO decisions), INS-063 (AQL config), INS-068 (KPI dashboard), and the LOW polish items (071-077).

## Why this batch

The 2026-07-17 meeting triage (10-agent read-only sweep, STATUS.md 2026-07-18) confirmed a cluster of
correctness and permission gaps that block real multi-role usage: submit mints PASS from absent evidence,
INSPECTOR cannot touch any inspection route, archive is irreversible, org users cannot see their own signed
reports, and the users module enforces its safety rules only in React. These 12 items form one coherent,
DB-migration-free slice: every change is app-layer (API + web), fully verifiable by the existing unit +
integration harness.

## Locked decisions (defaults chosen where the backlog said "product call")

| # | Decision | Rationale |
|---|---|---|
| D1 | **INS-056 gate = hard block.** `submit()` rejects (400) while any loop has fewer photos than `requiredShotCount`. No new enum state, no migration. | A signed artifact must never embed a verdict computed from missing evidence; simplest rule; the existing integration core-loop already registers + assigns 1 photo per its 1-shot preset, so the suite stays green. |
| D2 | **Report preview shows `pending`, never REJECTED, for undecided inspections.** `BrandedReportData.conclusion` gains `'pending'`. | The current `mapConclusion(null) → 'fail'` fabricates a verdict. |
| D3 | **INS-057: reads/submit relax to INSPECTOR per-handler; create/decision stay QA_MANAGER.** INSPECTOR is scoped to `assignedInspectorId === userId` in the service (foreign rows 404). New `POST /:id/start` (ASSIGNED→IN_PROGRESS) and `POST /:id/reset` (IN_PROGRESS→ASSIGNED). Start is optional — submit still accepts DRAFT/ASSIGNED/IN_PROGRESS. | `RolesGuard` already resolves handler-over-class; 404 (not 403) on foreign ids avoids an existence oracle; not forcing start keeps every existing flow + test valid. |
| D4 | **INS-059 keeps the invite flow** alongside the new direct-add (`POST /users`); direct-added users are ACTIVE immediately, min-8-char password, same role-floor + foreign-email guards as invite (INS-035 class). Same-org duplicate email gets the same generic 403 as foreign (no oracle). | Invite plumbing (INS-004/054) is done and used; removal is a later product call. |
| E5 | **INS-058 adds a reactivate endpoint** (`PATCH /users/:id/reactivate`) so deactivation is reversible; the last-ACTIVE-owner guard applies to owner demote + deactivate. Known caveat documented: deactivation bites at login/refresh; live access tokens survive their TTL (stateless guard) — per-request status checks are out of scope. | Without reactivate, the lockout guard just moves the dead end. |
| D6 | **INS-061 restore = explicit `POST /:id/restore`** on buyers/suppliers/products (not a widened PATCH); re-archive of an archived row is an idempotent no-op (original timestamp preserved). Detail-page restore affordances are deferred; the directory RowMenu + Archived chip cover the meeting ask. | Keeps `archivedAt` out of the general update surface; distinct audit event. |
| D7 | **Audit rows on every NEW mutation** in this batch (start/reset/PATCH inspection, archive/restore ×3, role-change/deactivate/reactivate/direct-add, no change to submit/decide audit — that remains INS-006), appended via `audit.append(input, tx)` inside the same `$transaction`. | Moves toward INS-006 without expanding into its full sweep. |
| D8 | **INS-062 list endpoint** `GET /reports` (QA floor, org-scoped, `q/take/skip` per INS-050, newest-first) **never returns `canonicalSnapshot`** (large; list payload is metadata + joins only). |  |
| D9 | **INS-064 is fixed web-side**: `ApiInspectionLoop` adopts the wire names (`zoneName`/`position`/`requiredShotCount`). Zero API surface change; INS-008 remains the long-term fix. |  |
| D10 | **INS-065:** sidebar filters by a `minRole` per NAV entry (directory/presets/products/POs/reports = qa; inspections = inspector; users = owner), fail-closed to inspector when role is missing; `/inspections/new` gets a server-side redirect gate; **`GET /users` relaxes to QA_MANAGER** so the QA create-screen inspector dropdown works (the RBAC matrix pins INSPECTOR→403, which still holds). Web gating is UX only — the API stays the authority. |  |
| D11 | **INS-066 PATCH** accepts only `assignedInspectorId` + `lotSize` (aqlPlan editing belongs to INS-063), only in DRAFT/ASSIGNED/IN_PROGRESS; lotSize changes recompute `computedSampling` (wrapped → 400); DRAFT+assign → ASSIGNED, ASSIGNED+unassign → DRAFT. Row menu: Open / Copy link / Start / Reset / Reassign. The start confirmation ("Starting cannot be stopped — only reset and restarted.") uses a new shared `ConfirmDialog` in `components/inspect/` — the design system's first modal, also used for Archive. |  |
| D12 | **INS-067:** third "Archived" chip (client-filtered over the `includeArchived=1` result set), archived rows dimmed, badge restyled to the AA-passing severity.minor pair, and a `ui.danger = '#B42318'` token replaces every `#DC2626` literal touched in this batch. |  |
| D13 | **INS-069 recipients:** submit → ACTIVE org users with role ≥ QA_MANAGER; decide → assigned inspector + ACTIVE owners; the acting user is excluded; emails deduped; sends fire **after** the transaction commits via the never-throwing MailService (orgs.service pattern). No queue. |  |
| D14 | **INS-070:** remove the platform legend card + dead 'platform' row paths; proper Deactivated/Suspended badges; deactivated rows get a Reactivate action and a disabled role select. |  |

## Non-goals

- No Prisma schema change, no migration, no new dependency (API or web).
- No change to the AQL engine, the signed canonical payload, or any snapshot shape.
- No audit sweep of pre-existing mutations (INS-006), no rate limiting (INS-047), no PDF (INS-003).

## Verification strategy

- **Unit:** new `inspections.service.spec.ts` (gate + notification fan-out), new `mail-inspection.spec.ts`
  (templates), extended `users.service.spec.ts` (guards, reactivate, direct-add), extended
  `buyers.service.spec.ts` (restore, idempotent re-archive).
- **Integration:** one new `test/integration/meeting-batch1.e2e-spec.ts` (shared org A/B fixture) covering
  inspector scoping + start/reset, the submit gate, PATCH reassign + frozen-after-submit, archive→restore
  round-trip + cross-org 404, the reports list (isolation + no snapshot + inspector 403), users self-guards +
  last-owner + reactivate→login, direct-add→login, and QA users-list access. Existing 44 tests must stay green
  — the only touched assertion class was checked: `INSPECTOR cannot list users` pins INSPECTOR, not QA.
- **Web:** `pnpm type-check` (the INS-064 rename is driven by compiler errors) + `pnpm web build`.
