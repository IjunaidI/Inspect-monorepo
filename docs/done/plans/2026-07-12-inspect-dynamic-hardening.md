# Inspect — Dynamic-Data Hardening Sweep — Implementation Plan

> **✅ EXECUTED 2026-07-12** — all 17 tasks delivered the same day (parallel waves: web-truth + docs agents alongside the API core, then features), verified 162 unit / 44 integration green vs the live DB, type-check + next build clean. Deliberate adaptations discovered at implementation time: `status:'ACTIVE'` filters became `archivedAt`/`isArchived` (the actual schema columns), loop reorder shipped as ↑/↓ buttons, portal photos load via a lazy guest-detail proxy route (ReportAccess logs fire on real views), and the report photo prop kept its existing grouped shape.
>
> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or
> superpowers:executing-plans. TDD for all new logic. Checkbox steps. Every phase leaves the tree
> green (`pnpm api test` + `pnpm type-check`; integration where noted). Commit per task with the
> INS ids in the message.
> Spec: [../specs/2026-07-12-inspect-dynamic-hardening-design.md](../specs/2026-07-12-inspect-dynamic-hardening-design.md).

**Goal:** eliminate all 59 audited stale/hardcoded/static pieces — every rendered value becomes real
data or an honest "—", every visible control works, every doc claim matches the code.

**Architecture:** additive API changes only (Prisma `_count` selects, new `q/take/skip/activeOnly`
params, `viewUrl` decoration, 3 new endpoints: `GET /dashboard/summary`, `GET /search`,
`GET /invitations/:token`) so no existing consumer breaks; web screens consume the new fields via the
established Server Component (reads) + Server Action (writes) pattern; one Prisma migration (INS-044).

**Tech Stack:** NestJS 11, Prisma 6, Next.js 15 App Router, node:crypto SigV4 (dep-free), Jest.

## Global Constraints
- Responses stay **flat arrays / additive fields** — never wrap an existing list in an envelope.
- JWT stays server-side on the web (client components go through route handlers/server actions).
- New env vars MUST be added to `turbo.json` `globalEnv` **and** `.env.example` (placeholders only).
- House test style: hand-rolled stub objects, no module mocking (see `invitations.service.spec.ts`).
- Verification bar per task: `pnpm api test` green, `pnpm type-check` green; integration
  (`pnpm api test:integration`, needs the root `.env` DB) for tasks marked ⛁; CI green after push.

---

## Phase A — Truth & cleanup

### Task 1: Retire stale stub screens + shell honesty
**Files:** Modify `apps/web/app/(console)/populate/page.tsx`, `apps/web/app/(console)/report/page.tsx`
(each becomes 3 lines: `import { redirect } from 'next/navigation'; export default function Page() { redirect('/inspections'); }`),
`apps/web/components/inspect/shell.tsx` (remove the `/settings` NAV entry ~line 210; remove the
notification-bell button + unread dot ~line 345; remove the decorative workspace-switcher ChevronDown
~line 214 — the fake ⌘K search div at ~line 339 is REPLACED in Task 15, leave it for now with a
`{/* becomes CommandPalette trigger — Task 15 */}` comment).
- [ ] Apply edits; `pnpm web type-check` green; verify `grep -r "\"/settings\"" apps/web` → 0 hits.
- [ ] Commit: `fix(web): retire static populate/report mocks; remove 404 settings link + fake notification dot`

### Task 2: Invite/guest UX truth (emailSent, tokenExpiresAt, broken copy-link)
**Files:** Modify `apps/web/lib/api.ts` (`ApiInvitation` gains `emailSent?: boolean; expiresAt?: string`;
`ApiBuyerGuest` renames `expiresAt` → `tokenExpiresAt` and gains `status: string; lastAccessAt: string | null`),
`apps/web/app/(console)/users/actions.ts` (return `emailSent` + `expiresAt` from the POST body),
`apps/web/app/(console)/users/users-client.tsx` (banner branches: `emailSent ? 'Invitation emailed to {email} — link below as backup.' : 'Email could not be sent — share this link manually:'`),
`apps/web/app/(console)/buyers/[id]/guests/actions.ts` (type response `{ guest: ApiBuyerGuest; token: string; emailSent: boolean }`; derive expiry from `guest.tokenExpiresAt`),
`apps/web/app/(console)/buyers/[id]/guests/guests-client.tsx` (use `tokenExpiresAt`; add Status +
Last access columns; DELETE the per-row "Copy link" button — it copies the DB id, which is never a
valid token; the copyable link exists only in the invite-success state).
**Interfaces:** API already returns these fields (`users.service.ts:84`, `buyer-guests.service.ts:63`,
guests list SAFE_SELECT `buyer-guests.service.ts:7-14`) — this task only stops dropping them.
- [ ] Apply edits; `pnpm web type-check` green.
- [ ] Manual smoke (⛁ optional): invite a user against the live API → banner says "emailed"; guests
      table shows a real date, no "Invalid Date".
- [ ] Commit: `fix(web): surface emailSent + real guest expiry/status; remove broken per-row magic-link copy (INS-004 fallout)`

### Task 3: Report/portal truth + misc web
**Files:** Modify `apps/web/components/inspect/branded-report.tsx` (when `data.samplingPlan` is null
render `'—'` for code letter/sample size — delete the `tokens.ts` `aqlPlan` fallback import for these
cells), `apps/web/app/portal/portal-client.tsx` (extend the mapper's `Snap` type with
`product?: { styleNumber?: string | null; description?: string | null }; supplier?: { name?: string | null }`
and map them instead of `'—'`), `apps/web/lib/api.ts` (delete phantom `ApiReport.reportNo` +
`signatureHex` → `signature`; delete `ApiGuestReport.reportNo`; fix consumers to keep the synthetic
`IR-${id.slice(0,8)}` display id), `apps/web/app/(console)/presets/page.tsx` +
`presets-list.tsx` (pass raw `updatedAt: string` into `PresetRow`, sort comparator
`(a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)`; drop the fabricated `industry` tag from
the card), `apps/web/app/r/[token]/page.tsx` (replace the hand-rolled fetch + base-URL copy with
`apiGetPublic` from `lib/api.ts`; network failure message becomes "Could not reach the verification
service" — distinct from not-found), `apps/web/app/(console)/dashboard/page.tsx` (delete the inert
Import CSV button).
- [ ] Apply edits; `pnpm web type-check` green.
- [ ] Commit: `fix(web): honest report fallbacks, real portal product/supplier, working preset sort, drop phantom fields (INS-031/032 slice)`

### Task 4: Docs truth pass
**Files:** Modify `README.md` (badge + all "97 passing" → current counts; "22 models" → 25; backend
status 🟡→verified-live + integration suite + CI; prune the done items from "Next up"),
`docs/reference/inspect-build-index.md` (header `in-progress/` → `done/`; last-verified date; tech
table rows: scrypt/node:crypto not argon2+passport, no class-validator, dep-free SigV4 not aws-sdk;
annotate phase rows 3–7 done-via-backlog with INS ids), `docs/reference/inspect-schema.md`
("~22 models" → 25), `docs/future/BACKLOG.md` (INS-031 evidence → `directory-client.tsx:259-262,341-344`
+ `presets/page.tsx:47,51`; INS-005 evidence adds `GET /inspections/aql-preview` to the route list;
INS-032 note → true remainder: All/Active chips + pagination + topbar palette).
- [ ] Apply edits; every changed relative link resolves (spot-check with Glob).
- [ ] Commit: `docs: truth pass — counts, tech-decision table, phase annotations, evidence pointers`

## Phase B — Dynamic-data core (INS-005 / INS-031 / INS-032)

### Task 5: List aggregates + activeOnly (API) ⛁
**Files:** Modify `apps/api/src/buyers/buyers.service.ts` (`list(orgId, activeOnly?: boolean)` →
`where: { orgId, ...(activeOnly ? { status: 'ACTIVE' } : {}) }, include: { _count: { select: {
purchaseOrders: true, inspections: true, reports: true } } }`), `suppliers.service.ts` (+`_count:
{ purchaseOrders, inspections }`), `products.service.ts` (+`_count: { purchaseOrders, inspections }`),
`loop-presets.service.ts` (extend existing `_count` select with `inspections: true,
defaultForBuyers: true`), 4 controllers (pass `@Query('activeOnly')` → `activeOnly === '1'`).
Verify relation names against `schema.prisma` before coding (adjust to the actual relation field names).
**Test:** extend `apps/api/src/buyers/buyers.service.spec.ts` (house stubs) asserting the include shape
passed to `findMany`; integration: extend `test/integration/core-loop.e2e-spec.ts` — after the
workspace step, `GET /buyers` row for the created buyer has `_count.purchaseOrders === 1`.
- [ ] Failing unit test → implement → green. `pnpm api test` green.
- [ ] ⛁ `pnpm api test:integration` green (counts assertion added).
- [ ] Commit: `feat(api): INS-005 list aggregates (_count) + activeOnly filter`

### Task 6: Session truth — /auth/me orgName + lastLoginAt (API) ⛁
**Files:** Modify `apps/api/src/auth/auth.controller.ts` (`me()` becomes async: when `user.orgId`,
`prisma.organization.findUnique({ where: { id: user.orgId }, select: { name: true } })` → return
`{ ...user, orgName: org?.name ?? null }`; platform admin → `orgName: null`; inject PrismaService via
AuthModule), `apps/api/src/auth/auth.service.ts` (`validateUser` success path:
`await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })`).
**Test:** `auth.service.spec.ts` — stub gains `user.update` jest.fn; assert called once on success and
NOT on failure. Integration `auth-rbac.e2e-spec.ts`: owner `/auth/me` returns `orgName === 'E2E Org …'`.
- [ ] Failing tests → implement → green; ⛁ integration green.
- [ ] Commit: `feat(api): /auth/me returns orgName; write lastLoginAt on login`

### Task 7: Inspection detail completeness (API) ⛁
**Files:** Modify `apps/api/src/inspections/inspections.service.ts` `get()` include:
`loops: { orderBy: { position: 'asc' }, include: { photos: true, defects: { include: { defectCatalog: true } }, measurements: true } }, assignedInspector: { select: { id: true, name: true, email: true } }`
(keep existing buyer/supplier/product/purchaseOrder/aqlResult/report).
**Test:** integration `core-loop.e2e-spec.ts` — after populate, re-`GET /inspections/:id`: the loop
carries the registered photo + tagged defect + measurement (this is the regression that photos
"vanish on reload").
- [ ] Implement; ⛁ integration assertion added + green; `pnpm api test` green.
- [ ] Commit: `fix(api): inspection detail includes loop photos/defects/measurements + inspector (populate reload truth)`

### Task 8: Dashboard summary endpoint + tiles ⛁
**Files:** Create `apps/api/src/dashboard/dashboard.module.ts`, `dashboard.controller.ts`
(`@Controller('dashboard') @Roles('QA_MANAGER')`, `@Get('summary')` → `requireOrgId`),
`dashboard.service.ts`:
```ts
async summary(orgId: string) {
  const [byStatus, buyers, suppliers, products, purchaseOrders, reports] =
    await this.prisma.$transaction([
      this.prisma.inspection.groupBy({ by: ['status'], where: { orgId }, _count: { _all: true } }),
      this.prisma.buyer.count({ where: { orgId } }),
      this.prisma.supplier.count({ where: { orgId } }),
      this.prisma.product.count({ where: { orgId } }),
      this.prisma.purchaseOrder.count({ where: { orgId } }),
      this.prisma.report.count({ where: { orgId } }),
    ]);
  return {
    inspectionsByStatus: Object.fromEntries(byStatus.map(r => [r.status, r._count._all])),
    buyers, suppliers, products, purchaseOrders, reports,
  };
}
```
Register in `app.module.ts`. Web: `apps/web/lib/api.ts` gains `ApiDashboardSummary`;
`apps/web/app/(console)/dashboard/page.tsx` loads it via `loadOrFallback` and feeds the header tiles.
**Test:** integration — summary returns the counts created earlier in the run (≥1 buyer etc.), and
org-scoping (org B's summary excludes org A rows).
- [ ] Implement API + web; ⛁ integration test green; type-check green.
- [ ] Commit: `feat(api,web): INS-005 org dashboard summary endpoint + live tiles`

### Task 9: Consume the aggregates (web) — kill the "—" columns
**Files:** Modify `apps/web/lib/api.ts` (`ApiBuyer`/`ApiSupplier`/`ApiProduct`/`ApiLoopPreset` gain
`_count?: Record<string, number>` and `updatedAt?: string`), `apps/web/app/(console)/dashboard/directory-client.tsx`
(buyer rows: Open POs = `_count.purchaseOrders`, Products = `_count.inspections`→(use correct column
semantics: Products column shows `_count.products`? No product relation on buyer — show POs/Inspections/
Reports/Last activity = `updatedAt` formatted; relabel headers to match real data rather than fake
columns), suppliers likewise; **All/Active chips**: `const [activeOnly, setActiveOnly] = useState(false)`
→ chips get `onClick={() => setActiveOnly(v)}` and the row source filters `status === 'ACTIVE'` when
active (server `activeOnly=1` is wired in Task 12's pagination refetch — until then client-side filter
over the loaded rows is real behavior, not a mock), `apps/web/app/(console)/presets/page.tsx`
(used = `_count.inspections`, loops = `_count.steps`, edited = `updatedAt`),
`apps/web/app/(console)/inspections/[id]/report/page.tsx` (map `inspectionType`,
`assignedInspector?.name`, `product?.styleNumber`, `supplier?.gps`, `buyer?.primaryColor ?? '#1457A3'`).
- [ ] Apply edits; `pnpm web type-check` green; manual smoke vs live API — no "—" where data exists.
- [ ] Commit: `feat(web): INS-031 real counts/last-activity/report meta; working All-Active chips`

## Phase C — Features

### Task 10: INS-054 verified invite page ⛁
**Files:** Modify `apps/api/src/invitations/invitations.controller.ts` (add
`@Public() @Get(':token') get(@Param('token') token: string)`),
`invitations.service.ts` (add):
```ts
async getByToken(token: string) {
  const inv = await this.prisma.invitation.findUnique({
    where: { token },
    include: { org: { select: { name: true } } },
  });
  if (!inv) throw new NotFoundException('Invitation not found');
  if (inv.acceptedAt) throw new GoneException('Invitation already used');
  if (inv.expiresAt < new Date()) throw new GoneException('Invitation expired');
  return { email: inv.email, role: inv.role, orgName: inv.org?.name ?? null, expiresAt: inv.expiresAt };
}
```
(verify the org relation field name on Invitation in `schema.prisma`; import `GoneException` from
`@nestjs/common`). Web `apps/web/app/invite/page.tsx`: server component resolves
`apiGetPublic('/invitations/' + token)`; renders verified email/role/org; 404/410 → friendly error
card; spoofable `email`/`role` query params no longer rendered.
**Test:** unit `invitations.service.spec.ts` — pending→data, unknown→NotFound, accepted→Gone,
expired→Gone (house stubs). Integration `auth-rbac.e2e-spec.ts` — lookup of a fresh invite 200 with
correct email; garbage token 404; accepted token 410.
- [ ] Failing unit tests → implement → green; ⛁ integration green; web type-check green.
- [ ] Commit: `feat(api,web): INS-054 public invitation lookup; /invite renders verified data`

### Task 11: INS-049 photo viewing pipeline ⛁
**Files:** Modify `apps/api/src/storage/sigv4.ts` — generalize:
```ts
export interface PresignOptions { /* unchanged fields */ method?: 'GET' | 'PUT'; }
// canonicalRequest first line becomes (opts.method ?? 'PUT')
export function presignS3Url(opts: PresignOptions): string { /* current body */ }
export const presignS3PutUrl = (opts: PresignOptions) => presignS3Url({ ...opts, method: 'PUT' });
```
`storage.service.ts` (+`presignDownload(key, expiresSeconds = this.presignExpiry)` using method GET),
`apps/api/src/inspections/inspections.controller.ts` `get()` → after service call, decorate
(try/catch → `viewUrl: null`): every `loops[].photos[]` and top-level `photos[]` element gains
`viewUrl: storage.presignDownload(p.storageKey)`. `apps/api/src/guest/guest.service.ts` report detail
gains `photos: [{ id, contentHash, viewUrl }]` for the report's inspection. Web:
`populate-workspace.tsx` photo cards `<img src={photo.viewUrl} className="h-full w-full object-cover" loading="lazy" />`
when `viewUrl`, gradient placeholder otherwise; Eye overlay → `<a href={photo.viewUrl} target="_blank">`;
`branded-report.tsx` evidence tiles likewise (prop extended with optional `photos: {id, viewUrl}[]`).
**Test:** unit `sigv4.spec.ts` — GET presign with fixed `now` produces `GET` in the canonical request
(assert exact URL for a known-answer vector, mirroring the existing PUT test); existing PUT tests
unchanged. Integration `storage-bytes.e2e-spec.ts` — after byte upload, `GET /inspections/:id` photo
has a `viewUrl`; `fetch(viewUrl)` returns the exact uploaded bytes (hash matches). Runs in CI vs MinIO.
- [ ] Failing sigv4 test → implement → green; ⛁ integration extended (byte round-trip) green locally
      (skips without MinIO) and in CI; web type-check green.
- [ ] Commit: `feat(api,web): INS-049 presigned photo viewing — real thumbnails in populate + reports`

### Task 12: INS-050 server search + pagination ⛁
**Files:** Create `apps/api/src/common/list-query.ts`:
```ts
export interface ListQuery { take: number; skip: number; q?: string }
export function parseListQuery(raw: { q?: string; take?: string; skip?: string }): ListQuery {
  const take = Math.min(Math.max(parseInt(raw.take ?? '', 10) || 50, 1), 100);
  const skip = Math.max(parseInt(raw.skip ?? '', 10) || 0, 0);
  const q = raw.q?.trim().slice(0, 200) || undefined;
  return { take, skip, q };
}
```
+ `list-query.spec.ts` (defaults, clamps 1..100, negative skip→0, q trimmed/capped/undefined-when-empty).
Modify the 6 list services/controllers (buyers, suppliers, products, users, loop-presets, inspections)
to accept `ListQuery`: `where` gains `...(q ? { name: { contains: q, mode: 'insensitive' } } : {})`
(products: `OR: [{styleNumber…},{description…}]`; users: `OR: [{email…},{name…}]`; inspections:
`OR: [{ purchaseOrder: { poNumber: { contains: q, mode: 'insensitive' } } }, { buyer: { name: … } }, { product: { styleNumber: … } }]`),
plus `take, skip`. Web: dashboard directory + users + inspections list push `?q=` on Enter (form GET →
`searchParams`), pagination chevrons become links `?page=N` (server component computes
`skip=(page-1)*50`, disables prev on page 1 and next when `rows.length < 50`); the Task 9 client-side
instant filter stays for the loaded page.
**Test:** unit `list-query.spec.ts` (TDD). Integration: `GET /buyers?q=<created buyer name fragment>`
returns it and `q=zzz-no-match` returns []; `take=1&skip=1` slices deterministically (`orderBy` exists).
- [ ] Failing unit tests → implement → green; ⛁ integration green; web type-check green.
- [ ] Commit: `feat(api,web): INS-050 q/take/skip on list endpoints + real pagination`

### Task 13: INS-044 DefectInstance idempotency (migration) ⛁
**Files:** Modify `apps/api/prisma/schema.prisma` — `DefectInstance` gains
`clientRequestId String?` + `@@unique([orgId, clientRequestId])`; run
`pnpm --filter @inspect/api exec prisma migrate dev --name defect-instance-client-request-id`
(against the Railway DB via root `.env`). Modify `populate.service.ts` `addDefect()`: accept
`clientRequestId?: string`; when present, `findFirst({ where: { orgId, clientRequestId } })` → return
existing before create; pass it into `create` data. `populate.controller.ts` body type gains the field.
**Test:** integration `core-loop.e2e-spec.ts` — tag the defect with `clientRequestId`, replay the exact
call, assert same defect id back and total defect count for the inspection is 1 (AQL unaffected).
- [ ] Migration authored + applied (`prisma migrate status` clean); failing integration replay
      assertion → implement dedupe → ⛁ green.
- [ ] Commit: `feat(api): INS-044 DefectInstance clientRequestId idempotency (schema migration + dedupe)`

### Task 14: INS-052 preset-builder completions
**Files:** Modify `apps/web/app/(console)/presets/new/builder.tsx` — loop rows get ↑/↓ move buttons
(swap array positions; `GripVertical` icon removed; positions derive from array order at submit —
already true); AQL Level select options restricted to `II` with helper text "ISO 2859-1 General
Level II (MVP)"; reference-image drop zone becomes `<input type="file" accept="image/*">` →
new server action `presignPresetImage()` calling `POST /loop-presets/presign` → PUT bytes from the
client → collected storage keys submitted as `referenceImageUrls`. API: `loop-presets.controller.ts`
gains `@Post('presign')` (QA_MANAGER floor) → `storage.keyForPresetImage(orgId)` (new StorageService
helper: `orgs/${orgId}/presets/${randomUUID()}.${ext}`) + presigned PUT; `loop-presets.service.ts`
`create()` rejects `aqlLevel !== 'II'` with
`BadRequestException("Only AQL General Level II is supported (got '<value>')")`; preset detail page
renders reference images via `presignDownload` decoration on `GET /loop-presets/:id`.
**Test:** unit — new `loop-presets.service.spec.ts` (house stubs): level III → 400, level II → creates;
web type-check; manual smoke: reorder, upload a reference image (vs MinIO in CI is covered by presign
sign-shape only — byte PUT smoke is manual/CI-optional).
- [ ] Failing unit test → implement → green; web type-check green.
- [ ] Commit: `feat(api,web): INS-052 loop reorder, real reference-image upload, honest AQL-level options`

### Task 15: INS-051 global search + ⌘K palette ⛁
**Files:** Create `apps/api/src/search/search.module.ts`, `search.controller.ts`
(`@Controller('search') @Roles('QA_MANAGER')`, `@Get()` q via `parseListQuery`), `search.service.ts` —
one `$transaction` of 5 `findMany({ where: { orgId, <nameField> contains q, mode insensitive }, take: 5 })`
mapped to `{ type: 'buyer'|'supplier'|'product'|'po'|'inspection', id, label, sublabel }` (inspection
label = PO number + status; empty q → `[]`). Register in `app.module.ts`. Web: create
`apps/web/app/api/search/route.ts` (route handler: session JWT server-side → proxy `GET /search?q=`),
`apps/web/components/inspect/command-palette.tsx` (`'use client'`: dialog, opens on ⌘K/Ctrl-K or
topbar-trigger click, 200ms debounced fetch to `/api/search`, arrow-key selection, Enter →
`router.push` to `/dashboard`-family route per type: buyer→`/buyers/{id}`, supplier→`/suppliers/{id}`,
product→`/products/{id}`, po→`/purchase-orders/{id}`, inspection→`/inspections/{id}/review`);
`shell.tsx` topbar fake-search div → the palette trigger showing real ⌘K behavior.
**Test:** integration — `GET /search?q=<buyer name>` as owner A returns the buyer; as owner B returns
`[]` (cross-org isolation); no-token → 401. Web type-check + manual smoke.
- [ ] Implement API (integration test first) → ⛁ green; web palette; type-check green.
- [ ] Commit: `feat(api,web): INS-051 org-scoped global search + command palette (⌘K)`

### Task 16: INS-053 config hardening ⛁
**Files:** Modify `apps/api/src/main.ts`:
```ts
const origins = (process.env.ALLOWED_ORIGINS ?? process.env.WEB_BASE_URL ?? '')
  .split(',').map(s => s.trim()).filter(Boolean);
app.enableCors(origins.length ? { origin: origins } : {}); // empty config = dev-open, logged
```
`app.module.ts` (CacheModule TTL/LRU from `CACHE_TTL_MS`/`CACHE_LRU_SIZE`, current values as defaults;
remove `ScheduleModule.forRoot()` + import), `apps/api/src/common/config.ts` (new: `inviteTtlMs()`
reading `INVITE_TTL_DAYS` default 14, `clampGuestTtlDays(n)` → 1..365 with `GUEST_TTL_DAYS` default 30)
consumed by `users.service.ts`, `orgs.service.ts`, `buyer-guests.service.ts`;
`storage.service.ts` (expiry from `PRESIGN_EXPIRES_SECONDS` default 900; `presignUpload`/`presignDownload`
throw `BadRequestException('S3 credentials are not configured (S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY)')`
when creds empty), `apps/api/prisma/bootstrap-admin.ts` (remove `changeme123`/email defaults — exit(1)
with message when env unset), `apps/api/src/app.service.ts` (`getHello()` →
`JSON.stringify` not needed; controller returns `{ service: 'inspect-api', status: 'ok' }` — update
`app.controller.spec.ts` + `test/app.e2e-spec.ts` expectation), `turbo.json` + `.env.example`
(ALLOWED_ORIGINS, CACHE_TTL_MS, CACHE_LRU_SIZE, INVITE_TTL_DAYS, GUEST_TTL_DAYS, PRESIGN_EXPIRES_SECONDS).
**Test:** unit `common/config.spec.ts` (TDD: defaults, env override, guest clamp 0→1, 9999→365);
storage spec asserts the missing-creds throw; app spec updated. ⛁ integration suite still green
(CI sets S3 creds; local `.env` has them).
- [ ] Failing unit tests → implement → green; ⛁ integration green; update `test/app.e2e-spec.ts`.
- [ ] Commit: `feat(api): INS-053 config hardening — CORS origins, env TTLs, fail-loud S3, fail-closed bootstrap`

### Task 17: Docs sync + full verification + review
**Files:** Modify `docs/future/BACKLOG.md` (file INS-049..054 as done-with-notes; flip INS-005/031/044
→ done; INS-032 → done with the palette note), `docs/STATUS.md` (Tests counts, pillar rows: Workspace
CRUD counts live, Web console, Infra; Active-work entry for this sweep), move
`docs/in-progress/specs|plans/2026-07-12-…` → `docs/done/` per lifecycle, `CLAUDE.md` if any claim
went stale (web data-layer note).
- [ ] Full battery: `pnpm api test`, `pnpm api test:integration` ⛁, `pnpm type-check`, `pnpm web build`.
- [ ] Push; CI green on GitHub (byte path REQUIRED).
- [ ] Adversarial review workflow over the whole diff; fix confirmed findings.
- [ ] Commit: `docs: close INS-005/031/032/044/049..054 — dynamic-data hardening sweep complete`

---

## Self-review
- **Spec coverage:** A→Tasks 1-4; B.1→5, B.2→8, B.3→9, B.4/5→6, B.6→5+9, B.7→7, B.8→9;
  C.1→11, C.2→12, C.3→15, C.4→14, C.5→16, C.6→10, C.7→13; docs/verify→17. All 59 findings map to a task.
- **Order rationale:** 10 (invite) before 11 (photos) is swapped vs the spec's list — actual execution
  order follows this plan's task numbering; both orders are dependency-safe. Task 12 depends on Task 5's
  service signatures; Task 14/15 depend on Task 11's `presignS3Url` + Task 12's `parseListQuery`.
- **Schema caution:** relation names for `_count` selects and the Invitation→org relation MUST be read
  from `schema.prisma` at implementation time; the plan names are believed-correct but unverified.
- **Response-shape safety:** every API change is additive; the only removals are web-side phantom types.
