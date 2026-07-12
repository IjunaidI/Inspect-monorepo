# Inspect — Dynamic-Data Hardening Sweep — Design

> **Status:** ✅ Done (designed, approved, and fully delivered 2026-07-12 — all 17 plan tasks; 162 unit / 44 integration tests green; moved to done/ same day).
> Source inventory: a 4-agent audit (2026-07-12) found **59 stale/hardcoded/static pieces** across the
> console, web shared layer, API, and docs. This spec turns every one of them functional and dynamic,
> except the two already-tracked big features that stay separate: PDF rendering
> ([INS-003](../../future/BACKLOG.md)) and report delivery ([INS-020](../../future/BACKLOG.md)).
> Backlog: closes [INS-005](../../future/BACKLOG.md), [INS-031](../../future/BACKLOG.md),
> [INS-032](../../future/BACKLOG.md), [INS-044](../../future/BACKLOG.md), and the new
> INS-049..INS-054 filed by this effort. Plan: [../plans/2026-07-12-inspect-dynamic-hardening.md](../plans/2026-07-12-inspect-dynamic-hardening.md).

**Goal:** nothing in the product lies. Every rendered value is real data or an honest "—"; every visible
control does what it looks like it does; every documented behavior matches the code.

**Non-goals:** PDF binary (INS-003), report delivery + `ReportDelivery` rows (INS-020), rate limiting
(INS-047), lint migration (INS-048), DB-level invariant enforcement (INS-010..018 except INS-044).

---

## Workstream A — Truth & cleanup (web + docs, no schema changes)

Small, unambiguous fixes. Design decisions:

- **Stale stub screens.** `app/(console)/populate/page.tsx` and `app/(console)/report/page.tsx` are
  static design mocks fully superseded by `/inspections/[id]/populate` and `/inspections/[id]/report`.
  Replace each with a `redirect('/inspections')` (keep the route so old bookmarks don't 404). Nothing
  in the shell NAV links them (verified).
- **Shell honesty** (`components/inspect/shell.tsx`):
  - Remove the `/settings` NAV item (no settings page exists → 404).
  - Remove the notification bell + hardcoded unread dot (no notifications feature).
  - The fake ⌘K search div becomes the **trigger for the real command palette** (Workstream C.3);
    until that phase lands in the same effort, it stays wired to the palette component from day one.
  - Org name: real (Workstream B.4). Decorative workspace-switcher chevron removed (single-workspace MVP).
- **Invite UX truth** (INS-004 fallout):
  - `users/actions.ts` + `ApiInvitation`: pass through `emailSent` (+ `expiresAt`).
  - `users-client.tsx`: success banner branches — "Invitation emailed to X" (link still shown as
    fallback) vs "Email could not be sent — share this link manually".
  - `buyers/[id]/guests/actions.ts`: response typed to reality `{guest, token, emailSent}`;
    expiry read from `guest.tokenExpiresAt`.
  - `guests-client.tsx`: rename phantom `expiresAt` → `tokenExpiresAt` (fixes "Expires Invalid Date"),
    show `status` + `lastAccessAt`, and **delete the per-row Copy-link** (it copies the DB id — the
    token is deliberately never returned by the list endpoint). A fresh link is available at
    invite/re-invite time only (re-inviting the same email re-issues a token via the existing upsert).
- **Report/portal truth:**
  - `branded-report.tsx`: when `samplingPlan` is null render "—" — never the design-token demo values.
  - `portal-client.tsx`: map `product`/`supplier` from the canonical snapshot (fields exist).
  - `ApiReport`: drop phantom `reportNo`/`signatureHex` (align to the model's `signature`); keep the
    synthetic `IR-${id.slice(0,8)}` display id at the UI layer (documented as synthetic).
- **Misc web:** presets sort uses raw `updatedAt` (fixes the no-op "Last edited" comparator);
  `r/[token]/page.tsx` reuses `apiGetPublic` (kills the 3rd copy of the base-URL constant and the
  mislabeled network-error message); dashboard "Import CSV" button removed (out of MVP scope, per
  INS-030 resolution).
- **Docs truth:** README status/badges/test counts rewritten to current reality; build-index header,
  tech-decisions table (scrypt not argon2, custom HS256 not passport, dep-free SigV4 not aws-sdk,
  no class-validator) and phase-table annotations fixed; `inspect-schema.md` "~22 models" → 25;
  BACKLOG INS-031/INS-005/INS-032 evidence pointers refreshed.

## Workstream B — Dynamic-data core (INS-005 + INS-031 + INS-032 remainder)

1. **List aggregates (API).** Add Prisma `_count` selects (relations exist on the schema):
   - `GET /buyers`: `_count: {purchaseOrders, inspections, reports}`
   - `GET /suppliers`: `_count: {purchaseOrders, inspections}`
   - `GET /products`: `_count: {purchaseOrders, inspections}`
   - `GET /loop-presets`: extend existing `_count` with `inspections` (+ `defaultForBuyers`)
   - "Last activity" = the row's own `updatedAt` (cheap and honest; no cross-relation max-date
     queries in the MVP). Responses stay flat arrays — additive fields only, nothing breaks.
2. **Dashboard summary (API).** New `GET /dashboard/summary` (org-scoped, QA_MANAGER floor):
   `{inspectionsByStatus: Record<status, number>, buyers, suppliers, products, purchaseOrders,
   reports: number}` via one `$transaction` of grouped counts. Consumed by the dashboard header
   tiles. (This is the INS-005 "summary endpoint" shape — deliberately minimal.)
3. **Web consumption (INS-031).** `directory-client.tsx` buyer/supplier rows and `presets/page.tsx`
   cards map the `_count` fields + `updatedAt`; the "industry" tag (no backing field anywhere in the
   schema) is **removed from the card** rather than faked.
4. **Session/org truth.** `GET /auth/me` returns `orgName` (single lookup when `orgId` non-null;
   null for platform admins → shell shows "Platform"). `(console)/layout.tsx` passes it; shell's
   `DEFAULT_ORG` remains only as the offline/demo fallback.
5. **`lastLoginAt`.** `AuthService.validateUser` success path updates `lastLoginAt` (fire-inside-login,
   non-transactional single update). The users table column stops being permanently "—".
6. **Active/archived filter (INS-032 remainder).** Buyers/suppliers/products/presets lists accept
   `?activeOnly=1` (`status: 'ACTIVE'` where clause; default unchanged = all rows, so existing
   consumers are unaffected). Dashboard All/Active chips become real toggles driving the query param
   (server refetch via router `searchParams`).
7. **Inspection detail completeness.** `inspections.get()` include gains
   `loops: {photos, defects: {include: {defectCatalog}}, measurements}` and `assignedInspector`
   (safe select: id/name/email). Fixes: populate workspace losing registered photos/defects on
   reload; report preview rendering zero photos; report meta.
8. **Report page meta truth.** `/inspections/[id]/report` maps real `inspectionType`,
   `assignedInspector.name`, `product.styleNumber`, `supplier.gps`, and
   `buyer.primaryColor` (brand color; `#1457A3` stays only as the no-buyer fallback token).

## Workstream C — Features

### C.1 Photo viewing pipeline (new: INS-049)
- `sigv4.ts`: generalize to `presignS3Url({method: 'GET'|'PUT', ...})`; keep `presignS3PutUrl` as a
  thin wrapper (existing tests + callers untouched). TDD with fixed `now`.
- `StorageService.presignDownload(key, expiresSeconds)` — expiry from config (C.5), default 900s.
- `GET /inspections/:id` response: controller decorates every photo (loop-level and top-level) with
  a short-lived `viewUrl`. No new route; the URL is org-scoped by the endpoint's own guard.
- `GET /guest/reports/:id` (existing token-validated guest endpoint): response gains
  `photos: [{id, viewUrl, contentHash}]` for the report's inspection, so buyer evidence is viewable.
- Web: `populate-workspace.tsx` and `branded-report.tsx` render `<img src={viewUrl}>` thumbnails
  (object-cover, lazy) with click-to-open-full-size (new tab — no lightbox component in MVP);
  gradient placeholder remains only for photos with no `viewUrl` (pre-upload states).

### C.2 Server-side search + pagination (new: INS-050)
- List endpoints (`inspections`, `buyers`, `suppliers`, `products`, `users`, `loop-presets`) accept
  `q`, `take` (default 50, clamped 1..100), `skip` (≥0). `q` is case-insensitive `contains` on
  model-natural fields (buyer/supplier/preset: `name`; product: `styleNumber|description`;
  user: `email|name`; inspection: `purchaseOrder.poNumber | buyer.name | product.styleNumber`).
  A shared `parseListQuery()` helper in `src/common/` (unit-tested) builds `{take, skip}`.
- Responses remain plain arrays (no envelope — avoids breaking every consumer). "More pages exist"
  is inferred client-side by `rows.length === take`.
- Web: dashboard directory + users keep their instant client-side filter for the loaded page, and
  the search inputs ALSO push `q` to the server on submit (Enter). Pagination chevrons become real:
  page state in `searchParams` (`?page=N` → `skip = (N-1)*take`), disabled at the edges.

### C.3 Global search / ⌘K palette (new: INS-051)
- API: `GET /search?q=` (QA_MANAGER floor, org-scoped) returns top-5 matches per type across
  buyers/suppliers/products/POs/inspections: `{type, id, label, sublabel}` — one `$transaction`,
  reusing the same `contains` semantics as C.2.
- Web: `app/api/search/route.ts` route handler proxies with the server-side session JWT (keeps the
  token out of the browser, matching the existing pattern). `CommandPalette` client component in the
  shell: opens on ⌘K/Ctrl-K or clicking the (now real) topbar search; debounced fetch; Enter
  navigates to the matched entity's screen. The topbar div becomes this component's trigger.

### C.4 Preset-builder completions (new: INS-052)
- **Reorder:** the rendered `GripVertical` handles become functional via simple ↑/↓ move buttons on
  loop rows (HTML5 drag-and-drop is deferred — buttons are honest, keyboard-accessible, and 10× less
  code). Step `position` is derived from array order at submit (already the case).
- **Reference images:** the drop zone becomes a real file input reusing the storage presign path
  (PUT via C.1's generalized presign; the existing `POST /inspections/:id/populate/photos/presign`
  is inspection-scoped, so add `POST /loop-presets/presign` (QA_MANAGER floor) issuing keys under
  `orgs/{orgId}/presets/`); `referenceImageUrls` submits the storage keys; the preset detail page
  renders them via presigned GETs.
- **AQL level honesty:** builder select restricted to `II` (the only level the engine implements);
  `loop-presets.service.create` rejects any other value with a clear 400 (stored field can no longer
  silently disagree with computed sampling — `inspections.service` keeps its explicit `'II'`).

### C.5 Config hardening (new: INS-053)
- `main.ts`: CORS origins from `ALLOWED_ORIGINS` (comma-separated; falls back to `WEB_BASE_URL`;
  never `*` when configured).
- CacheModule TTL/LRU from `CACHE_TTL_MS`/`CACHE_LRU_SIZE` (current values become defaults).
- One shared `INVITE_TTL_DAYS` (env, default 14) consumed by `users.service` + `orgs.service`;
  buyer-guest `ttlDays` clamped to 1..365 with env default `GUEST_TTL_DAYS` (30).
- `StorageService`: presign expiry from `PRESIGN_EXPIRES_SECONDS` (default 900); **fail loudly**
  (throw at presign time with a clear message) when `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` are
  missing — no more silently-signed-but-broken URLs.
- `prisma/bootstrap-admin.ts`: remove the `changeme123` fallback — refuse to run without
  `BOOTSTRAP_ADMIN_PASSWORD` (mirrors the app's fail-closed secret validation).
- Remove `ScheduleModule.forRoot()` (zero jobs exist — dead wiring; re-add when a job exists).
- `GET /` returns `{service: 'inspect-api', status: 'ok'}` instead of scaffold "Hello World!".
- All new env vars land in `turbo.json` `globalEnv` + `.env.example` (placeholders only).

### C.6 Verified invite page (new: INS-054)
- API: public `GET /invitations/:token` → `{email, role, orgName, expiresAt}` for a pending, unexpired
  invitation; 404 unknown token; 410 for consumed/expired (distinct so the page can say why).
  Same public-token-in-path model as `GET /reports/verify/:token`. (Rate limiting remains INS-047.)
- Web `/invite`: resolves the invitation server-side from `?token=` and renders **verified** email,
  role, and org name; spoofable `email`/`role` query params are no longer trusted (kept only as
  prefill hints if the lookup fails transiently). Expired/consumed tokens get a friendly error card
  instead of a doomed form.

### C.7 DefectInstance idempotency (existing: INS-044)
- Migration: add `clientRequestId String?` + `@@unique([orgId, clientRequestId])` to `DefectInstance`
  (matches Inspection + Photo). `populate.service.addDefect()` accepts `clientRequestId` and returns
  the existing row on replay. Applied with `prisma migrate deploy` (Railway now, CI automatically).
  Closes the CLAUDE.md-invariant contradiction; a double-tapped defect can no longer flip an AQL verdict.

---

## Error handling
- Every new API param is validated server-side (clamps or 400s); `q` is length-capped (≤200 chars).
- Presign failures (missing S3 creds) are 4xx with actionable messages, not broken URLs.
- Photo `viewUrl` decoration must never fail the inspection read: wrap in try/catch → `viewUrl: null`,
  UI falls back to the placeholder tile.
- Public invitation lookup leaks nothing beyond what the invite email already contains.

## Testing strategy
- **TDD (unit)** for all new pure logic: `presignS3Url` GET-mode (fixed `now`), `parseListQuery`
  clamps, TTL clamp, invitation `getByToken` states (pending/expired/consumed), `addDefect`
  dedupe-on-replay, aqlLevel rejection. House style: hand-rolled stubs.
- **Integration suite extensions** (runs vs live DB + CI): buyers list carries `_count`; inspection
  detail includes loop photos after populate; `GET /invitations/:token` happy + 404 + 410;
  `GET /search` scoping (org A never sees org B rows); `GET /dashboard/summary` shape; defect
  replay idempotency. Existing 36 tests must stay green unchanged (all response changes are additive).
- **Web:** `pnpm type-check` + `next build`; manual smoke of dashboard/users/portal/invite/populate
  against the live API.
- **CI** must stay green (the migration runs in CI's `migrate deploy` automatically).

## Rollout order (one plan, phased — see plan doc)
A (truth fixes) → B-api → B-web → C.6 → C.1 → C.2 → C.7 → C.4 → C.3 → C.5 → docs/verify.
Each phase leaves the tree green (tests + type-check); commits per phase reference the INS ids.
