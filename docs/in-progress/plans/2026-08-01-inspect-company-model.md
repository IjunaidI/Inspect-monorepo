# Unified Company Model (INS-055) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan phase-by-phase. Steps use checkbox (`- [ ]`)
> syntax for tracking.
>
> **Do not start at Phase 1.** Phase 0 is a human sign-off gate. The spec's §0 table lists eight product
> decisions (P1–P8) that must be confirmed in writing first — this epic is deliberately unimplemented
> until then.

**Goal:** replace `Buyer` + `Supplier` with one org-scoped `Company`, where trade role is carried by the
edge (`clientCompanyId` / `factoryCompanyId`) rather than by the row — without weakening tenant
isolation, without changing what a guest can see, and without ever invalidating a report signed before
the migration.

**Architecture:** strictly **additive first**. Phase 1 adds `Company` plus lineage columns and backfills
1:1; nothing is renamed and nothing is dropped. Consumers are repointed one group per phase
(directory/search/dashboard → PO → inspections → guests → reports), each phase shipping green on its
own. The canonical report payload is **versioned, never rewritten**. Legacy tables are dropped only in
the final phase.

**Tech Stack:** NestJS 11 + Prisma 6 (API, port 3000), Next.js 15 App Router + NextAuth v5 (web, port
3001), Jest (unit + DB-backed integration), pnpm 9.12.0 workspaces + Turborepo, PostgreSQL.

**Spec:** [../specs/2026-08-01-inspect-company-model-design.md](../specs/2026-08-01-inspect-company-model-design.md)
**Backlog:** [INS-055](../../future/BACKLOG.md). Prerequisite: [INS-008](../../future/BACKLOG.md).

---

## Global Constraints

- **No migration may `UPDATE reports.canonical_snapshot`, `reports.content_hash`, or
  `reports.signature`.** Ever — not to normalize, not to backfill a version marker. That is the Ed25519
  seal on documents buyers already hold. Every migration in this plan is reviewed for `UPDATE ... reports`
  before it is applied anywhere.
- **Guest report visibility keys on `clientCompanyId` AND `orgId`, both conjuncts, at both call sites.**
  Never a party-agnostic `OR: [{clientCompanyId}, {factoryCompanyId}]` predicate — that hands a factory's
  guest the client's signed report (spec §4.2).
- **Hand-write every `RENAME` migration.** `prisma migrate dev` autogenerates `DROP` + `CREATE` for a
  table rename, which would destroy live guest magic-link tokens and signed report rows. Applies to
  `buyer_guests → company_guests`, `buyer_guests.buyerId → companyId`, and `reports.buyerId →
  clientCompanyId`.
- **Author migrations against a scratch database, not the shared remote dev DB.** Other agents run the
  integration suite against the same `DATABASE_URL`; a half-applied `migrate dev` there breaks them.
- **Every phase ships green and independently.** `pnpm api test`, `pnpm api test:integration`,
  `pnpm type-check`, `pnpm web build` all pass at every phase boundary. If a phase can only be green
  together with the next one, the phase split is wrong — re-split it.
- **Every mutation appends one hash-chained `AuditLog` row inside the same transaction** (CLAUDE.md
  invariant), using `actorTypeFor(actor)`; `SYSTEM` for automated backfills.
- **No new runtime dependencies and no new env vars.** Everything here uses what is already in the
  workspace.
- Node ≥ 20, pnpm 9.12.0. On Windows, if `pnpm` is not on PATH use `npx -y pnpm@9.12.0 <cmd>`.
- **Baseline to hold and grow:** 204 unit tests / 26 suites (`pnpm api test`), 68 integration tests /
  6 suites (`pnpm api test:integration`), `pnpm type-check` clean across 3 packages. Verified 2026-08-01.

---

## Phase map

| Phase | Ships | Reversible? | Gate |
|---|---|---|---|
| 0 | Product sign-off + INS-008 landed | n/a | P1–P8 confirmed in writing |
| 1 | `Company` table + lineage columns + 1:1 backfill | yes (drop the additions) | `migrate diff` shows only ADDs; every Buyer/Supplier row has a `companyId`; suite unchanged |
| 2 | Dedupe + partial CI unique index | **no** (merges are destructive) | Zero unresolved collisions; unique index created |
| 3 | Companies module; directory / search / dashboard read from `Company` | yes | One Companies list in the console; suite green |
| 4 | `PurchaseOrder` two-party FKs | yes | POs created/read via company FKs; self-dealing rejected |
| 5 | `Inspection` two-party FKs | yes | Full core loop green on company FKs |
| 6 | `BuyerGuest` → `CompanyGuest` (in-place rename) | risky | A pre-migration magic link lists **exactly** the same reports |
| 7 | `Report.clientCompanyId` + canonical **v2** | yes | v1 report verifies `valid:true`; v2 report verifies `valid:true` |
| 8 | Drop `buyers`, `suppliers`, lineage columns | **no** | Both backlog acceptance checks, re-run post-drop |
| 9 | Docs close-out | n/a | STATUS + BACKLOG agree with the code |

---

## Phase 0 — Prerequisites and sign-off

No code. This phase exists because the backlog's acceptance condition for the current step is "spec +
plan exist answering the role-model / branding / guest / canonical questions **before any migration is
authored**."

- [ ] **Step 1: Get P1–P8 confirmed**

Walk the spec's §0 table with the product owner. Record each answer (confirm or override) as a dated note
appended to the spec's §0. An override to **P1** (single `companyId` instead of two role FKs) invalidates
Phases 4–7 of this plan — stop and re-plan rather than improvising.

- [ ] **Step 2: Confirm INS-008 is actually done, not just declared**

The workspace dependency edge already exists (`apps/api/package.json:30`, `apps/web/package.json:14`).
What must be true before Phase 1:

```bash
grep -rn "from '@inspect/shared-types'" apps/api/src apps/web/lib apps/web/app | head
```

Expected: real imports in **both** apps, not zero hits. If `apps/web/lib/api.ts:188-217` still declares
its own `ApiBuyer`/`ApiSupplier`, INS-008 is not done — finish it first, or the `Company` DTO gets written
twice on day one (spec §8).

- [ ] **Step 3: Record the real baseline**

```bash
pnpm api test && pnpm type-check
```

Write the actual numbers into the phase-1 commit message. Do not copy the numbers from this document if
they differ — report what you saw.

**Phase 0 gate:** P1–P8 answered in writing; `@inspect/shared-types` imported for real in both apps.

---

## Phase 1 — Additive schema and 1:1 backfill

Nothing is renamed, nothing is dropped, no consumer changes behavior. This phase is a pure ADD, and that
is exactly what its gate checks.

**Files:**
- Modify: `packages/shared-types/src/enums.ts` (add `COMPANY_KINDS`)
- Modify: `apps/api/prisma/schema.prisma` (add `CompanyKind`, `Company`; add `companyId` to `Buyer`,
  `Supplier`, `BuyerGuest`)
- Create: `apps/api/prisma/migrations/<ts>_ins055_company_additive/migration.sql`
- Create: `apps/api/prisma/backfill-companies.ts` (idempotent backfill script)
- Create: `apps/api/test/integration/company-backfill.e2e-spec.ts`

**Interfaces:**
- Produces: `Company` rows with `legacyBuyerId` / `legacySupplierId` lineage, and `Buyer.companyId` /
  `Supplier.companyId` / `BuyerGuest.companyId` pointers. Every later phase reads these.

- [ ] **Step 1: Add the enum to the shared package**

In `packages/shared-types/src/enums.ts`, following the existing tuple + derived-union pattern:

```ts
export const COMPANY_KINDS = ['INTERNAL', 'THIRD_PARTY'] as const;
export type CompanyKind = (typeof COMPANY_KINDS)[number];
```

- [ ] **Step 2: Add `CompanyKind` + `Company` to the Prisma schema**

Copy the model verbatim from the spec (§7). Two things that are easy to get wrong and must be right:

- **No `@@unique([orgId, name])`** — only `@@index([orgId, name])`. Spec §6.1 explains why; a 1:1
  backfill of a colliding pair would fail against it.
- `legacyBuyerId` / `legacySupplierId` are `String? @unique` — the `@unique` is what makes the backfill
  idempotent and re-runnable.

Then add the nullable pointer to the three legacy models:

```prisma
model Buyer      { /* … */ companyId String? }   // + @@index([companyId])
model Supplier   { /* … */ companyId String? }   // + @@index([companyId])
model BuyerGuest { /* … */ companyId String? }   // + @@index([companyId])
```

Leave them **without** FK relations for now: a nullable FK to a table being populated in the same
deployment adds ordering constraints for zero benefit, and Phase 8 removes these columns anyway.

- [ ] **Step 3: Generate the migration against a scratch DB**

```bash
pnpm api prisma:migrate   # name it: ins055_company_additive
```

- [ ] **Step 4: Prove it is additive — this is the backlog's own acceptance check**

```bash
pnpm --filter @inspect/api exec prisma migrate diff \
  --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "$SHADOW_DATABASE_URL" --script
```

Expected: **empty** (schema and migrations agree). Then read the generated `migration.sql` by hand and
confirm every statement is `CREATE TYPE`, `CREATE TABLE`, `ALTER TABLE ... ADD COLUMN`, or
`CREATE INDEX`. **Any `DROP`, `RENAME`, or `UPDATE` means the phase is wrong** — stop and fix the schema
edit, do not hand-patch the SQL.

- [ ] **Step 5: Write the idempotent backfill script**

`apps/api/prisma/backfill-companies.ts`. Contract:

- For each `Buyer` with `companyId IS NULL`: create a `Company` with `kind: 'THIRD_PARTY'`,
  `name`/`logoUrl`/`primaryColor`/`branding`/`defaultLoopPresetId`/`createdByUserId`/`archivedAt`/
  `createdAt` copied over, `legacyBuyerId = buyer.id`; then set `buyer.companyId`.
- For each `Supplier` with `companyId IS NULL`: same, copying `name`/`address`/`gps`/`createdByUserId`/
  `archivedAt`/`createdAt`, `legacySupplierId = supplier.id`.
- For each `BuyerGuest`: `companyId = buyer.companyId`.
- One transaction per org. One `AuditLog` row per org (`action: 'company.backfilled'`,
  `actorType: 'SYSTEM'`, metadata with the counts) inside that transaction.
- **Idempotent:** re-running is a no-op. The `@unique` on `legacyBuyerId`/`legacySupplierId` is the
  safety net; the script must also skip rows that already have a `companyId`.
- `kind` defaults to `THIRD_PARTY` for every backfilled row. Marking an org's own facility `INTERNAL` is a
  human decision made later in the console — the backfill must not guess.

- [ ] **Step 6: Write the integration spec**

`apps/api/test/integration/company-backfill.e2e-spec.ts`:

- After the backfill, **every** `Buyer` and **every** `Supplier` row has a non-null `companyId`
  (`count({ where: { companyId: null } }) === 0`).
- Each `Company` carries exactly one of `legacyBuyerId` / `legacySupplierId`, never both.
- Buyer-derived companies preserve `branding`/`primaryColor`/`logoUrl`/`defaultLoopPresetId`;
  supplier-derived ones preserve `address`/`gps`.
- Every `BuyerGuest.companyId` equals its buyer's `companyId`.
- Running the backfill twice produces the same `Company` count and appends no second audit row.
- `orgId` on each `Company` equals the source row's `orgId` (tenant isolation).

- [ ] **Step 7: Run everything**

```bash
pnpm api test && pnpm type-check
# then, with a scratch DATABASE_URL:
pnpm api test:integration
```

Expected: 204 unit still green; integration **68 + the new spec's tests**, with the pre-existing 68
**unchanged** — no existing test may need editing in this phase. If one does, the phase is not additive.

**Phase 1 gate (backlog acceptance):** `prisma migrate diff` shows only ADDs · every `Buyer`/`Supplier`
row has a backfilled `companyId` · the integration suite passes **unchanged**.

---

## Phase 2 — Dedupe and the real uniqueness constraint

**Irreversible when the chosen mode is MERGE.** Runs before any consumer repoint, deliberately: while
only lineage columns reference `Company`, a merge is a two-row update; after Phase 4/5 it would be a
rewrite of historical inspection rows (spec §6.4).

**Files:**
- Create: `apps/api/prisma/company-collisions.ts` (detect + report)
- Create: `apps/api/src/companies/company-merge.ts` + `company-merge.spec.ts` (pure merge planner)
- Create: `apps/api/prisma/migrations/<ts>_ins055_company_unique/migration.sql` (hand-written partial index)
- Create: `apps/api/test/integration/company-dedupe.e2e-spec.ts`

- [ ] **Step 1: Detect collisions and publish the list**

`company-collisions.ts` runs the spec §6.2 query (case-insensitive, whitespace-trimmed, across archived
rows too) and prints one line per collision: org, name, buyer id, supplier id, and the two companies'
non-null field sets. Run it against **every** environment that will receive the migration and hand the
output to the product owner.

- [ ] **Step 2: TDD the pure merge planner**

Write `company-merge.spec.ts` first. `planMerge(clientSide, factorySide)` must produce: branding fields
from the client-derived row, `address`/`gps` from the factory-derived row, the **earlier** `createdAt`,
the client-side `name` casing, and `archivedAt` non-null only if **both** sides were archived. Field sets
are disjoint, so there is no field-level conflict to resolve — assert that explicitly so a future field
addition breaks the test rather than silently picking a winner.

Run `pnpm api test -- company-merge`. Confirm it fails, then implement, then confirm it passes.

- [ ] **Step 3: Apply the chosen resolution**

Default is **KEEP BOTH** (spec P4): rename the factory-derived company to `"<name> (factory)"`. Apply
MERGE only where the product owner named the pair explicitly. Every merge:

- repoints both legacy rows' `companyId` at the survivor and deletes the orphan `Company`, in one
  transaction;
- appends one `AuditLog` row — `action: 'company.merged'`, `entityType: 'Company'`, `entityId` = survivor,
  metadata `{ mergedFrom, mode }`, `actorType: 'PLATFORM_ADMIN'` for a human-triggered merge;
- is a no-op on re-run.

- [ ] **Step 4: Hand-write the partial unique index**

It cannot be expressed in `schema.prisma` (same reason as the two partial uniques already in the init
migration). Create the migration directory manually and put in `migration.sql`:

```sql
CREATE UNIQUE INDEX "companies_org_name_ci_active_key"
  ON "companies" ("orgId", lower(btrim("name")))
  WHERE "archivedAt" IS NULL;
```

Add a comment in `schema.prisma` above `model Company` recording that this index exists in SQL only —
matching how `DefectCatalog` documents its partial index (schema:447-450).

- [ ] **Step 5: Integration spec**

`company-dedupe.e2e-spec.ts`: creating two active companies with names differing only in case/whitespace
in one org → the second insert fails; the same names in **different** orgs both succeed; archiving one
frees the name for a new active row.

- [ ] **Step 6: Verify**

```bash
pnpm api test && pnpm api test:integration && pnpm type-check
```

**Phase 2 gate:** the collision report is empty for every target environment · the partial unique index
exists · dedupe spec green · the pre-existing 68 integration tests still unchanged.

---

## Phase 3 — Companies module; directory, search, dashboard

First user-visible phase. `Buyer`/`Supplier` tables still exist and still work; the console simply stops
reading them.

**Files:**
- Create: `apps/api/src/companies/{companies.module.ts,companies.controller.ts,companies.service.ts,companies.service.spec.ts}`
- Modify: `apps/api/src/app.module.ts` (register `CompaniesModule`; leave Buyers/Suppliers registered)
- Modify: `apps/api/src/dashboard/dashboard.service.ts:27-40`, `apps/api/src/search/search.service.ts:5,21-27,40-85`
- Modify: `packages/shared-types/src/json-contracts.ts` (Company DTOs)
- Modify (web): `lib/api.ts:182-217`, `dashboard/page.tsx:76-91`, `dashboard/directory-client.tsx`,
  `dashboard/actions.ts`, `command-palette.tsx:29,36-42`, `shell.tsx:209`, `middleware.ts:24`,
  `buyers/[id]/*` + `suppliers/[id]/*` → `companies/[id]/*`
- Create: `apps/api/test/integration/companies.e2e-spec.ts`

- [ ] **Step 1: TDD the service**

`companies.service.spec.ts` first, porting `buyers.service.spec.ts` wholesale — including both
`assertPresetInOrg` cases (`:60`, `:84`), which are a tenant-isolation guard and must not be lost in the
port. Add: `list` filters by `orgId` and by `archivedAt: null` unless `includeArchived`; `archive` is
idempotent and does not overwrite the original timestamp (`buyers.service.ts:112`); `restore` clears it.

- [ ] **Step 2: Implement `CompaniesService` + controller**

`@Controller('companies')` with `@Roles('QA_MANAGER')` at class level, mirroring
`buyers.controller.ts:9-10` and `suppliers.controller.ts:13-14`. Routes: `GET /`, `GET /:id`, `POST /`,
`PATCH /:id`, `DELETE /:id` (archive), `POST /:id/restore`. Add `?kind=` and `?role=` query filters for
the console pickers — `role` resolves through PO history, **not** through a column (spec §2.1, P3).

- [ ] **Step 3: Repoint dashboard + search**

`dashboard.service.ts:29-30` becomes one `company.count`. Decide the summary shape: recommend keeping two
tiles (`clients`, `factories`) derived from PO participation rather than one undifferentiated "Companies"
count — the number an org owner cares about is still per-role. `search.service.ts:5` gains
`type: 'company'` and drops `'buyer' | 'supplier'`; `command-palette.tsx:36-37,42` follows.

- [ ] **Step 4: Repoint the console directory**

`/buyers/[id]` and `/suppliers/[id]` become `/companies/[id]`; the two-tab directory
(`directory-client.tsx:205,231-252`) becomes one Companies list with a **kind** filter. Keep the old
routes as redirects for one release — bookmarks and the guests link (`directory-client.tsx:153`) exist in
the wild. `shell.tsx:209` label becomes `'Companies'`; `middleware.ts:24` swaps `/buyers`,`/suppliers` for
`/companies` (keep the old two while the redirects live).

- [ ] **Step 5: Verify**

```bash
pnpm api test && pnpm api test:integration && pnpm type-check && pnpm web build
```

**Phase 3 gate:** the console shows one Companies directory backed by `GET /companies` · search returns
`type: 'company'` hits · `/buyers/:id` redirects rather than 404s · suite green.

---

## Phase 4 — `PurchaseOrder` becomes explicitly two-party

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (`PurchaseOrder.clientCompanyId` + `factoryCompanyId`)
- Create: `apps/api/prisma/migrations/<ts>_ins055_po_parties/migration.sql`
- Modify: `apps/api/src/purchase-orders/purchase-orders.service.ts:4-10,20-37,39-58,79-93`
- Modify (web): `purchase-orders/{page.tsx,actions.ts,[id]/page.tsx,new/*}`
- Modify: `apps/api/test/integration/support.ts` + the PO paths in `core-loop`, `auth-rbac`,
  `meeting-batch1`, `admin-org-assumption`

- [ ] **Step 1: Add both FKs as nullable, backfill, then require them**

Three sub-steps in one phase, in this order, so no deployment window has an unsatisfiable NOT NULL:

1. `ALTER TABLE purchase_orders ADD COLUMN "clientCompanyId" text, ADD COLUMN "factoryCompanyId" text;`
2. Backfill: `clientCompanyId = (SELECT companyId FROM buyers WHERE id = buyerId)`, likewise
   `factoryCompanyId` from `suppliers`. Assert zero NULLs afterwards.
3. `SET NOT NULL` on both + the FK constraints (`Restrict`, matching schema:350-351) + the named Prisma
   relations `"PurchaseOrderClient"` / `"PurchaseOrderFactory"`.

Keep `buyerId`/`supplierId` in place and **dual-write** them for this phase — Phase 5 still reads them
(`inspections.service.ts:179-180`).

- [ ] **Step 2: Repoint the service, keeping the org guard**

`CreatePurchaseOrderInput` takes `clientCompanyId` / `factoryCompanyId`. `assertBelongsToOrg`
(`:79-93`) becomes two `company.findFirst({ where: { id, orgId } })` lookups with the same
`BadRequestException` shape. Add the self-dealing guard (spec §2.4): `clientCompanyId ===
factoryCompanyId` → `400 'client and factory must differ'`.

- [ ] **Step 3: Integration tests**

Extend the PO specs: a client company from another org → 400; a factory company from another org → 400;
identical client and factory → 400; a valid two-party PO round-trips with both companies included on
`GET`.

- [ ] **Step 4: Repoint the console PO screens**

`purchase-orders/new/create-form.tsx` picks two companies from `GET /companies`; `[id]/page.tsx` and
`page.tsx` render `clientCompany` / `factoryCompany`.

- [ ] **Step 5: Verify**

```bash
pnpm api test && pnpm api test:integration && pnpm type-check && pnpm web build
```

**Phase 4 gate:** POs are created and read entirely through company FKs · `buyerId`/`supplierId` are
still written (dual-write) and still consistent · all three negative guards return 400 · suite green.

---

## Phase 5 — `Inspection` becomes explicitly two-party

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (`Inspection.clientCompanyId` required,
  `Inspection.factoryCompanyId` optional `SetNull`)
- Create: `apps/api/prisma/migrations/<ts>_ins055_inspection_parties/migration.sql`
- Modify: `apps/api/src/inspections/inspections.service.ts:77,86,94-95,179-180`
- Modify: `apps/api/src/populate/populate.service.ts:217-218`
- Modify (web): `inspections/page.tsx`, `inspections/new/create-form.tsx`,
  `inspections/[id]/{review,report,populate}/*`, `lib/api.ts:301-302,318-319,430`

- [ ] **Step 1: Add + backfill, same three-step shape as Phase 4**

`clientCompanyId` nullable → backfill from `buyers.companyId` via `Inspection.buyerId` → `SET NOT NULL`
with `onDelete: Restrict`. `factoryCompanyId` stays nullable with `onDelete: SetNull`, mirroring
today's optional `supplierId` (schema:527).

- [ ] **Step 2: Repoint `create()`**

`inspections.service.ts:179-180` copies from the PO's **new** columns:
`clientCompanyId: po.clientCompanyId, factoryCompanyId: po.factoryCompanyId`. Keep dual-writing
`buyerId`/`supplierId` — Phase 7 still reads them for the canonical payload.

- [ ] **Step 3: Repoint reads**

`:86` and `:94-95` include `clientCompany` / `factoryCompany`; `:77` search-by-buyer-name becomes
`clientCompany: { name: … }`. `populate.service.ts:217-218` likewise.

- [ ] **Step 4: Verify — the whole core loop must still pass**

```bash
pnpm api test && pnpm api test:integration && pnpm type-check && pnpm web build
```

The 25-step `core-loop.e2e-spec.ts` is the real gate here: create PO → create inspection → populate →
submit → decide → report, end to end.

**Phase 5 gate:** the full core loop is green on company FKs · a re-inspection still links via
`supersedesInspectionId` within the same org · suite green.

---

## Phase 6 — `BuyerGuest` → `CompanyGuest` (the security phase)

**The highest-risk phase in this plan.** Read spec §4 in full before touching anything. Two things can go
wrong here and both are severe: destroying live magic-link credentials, and widening the visibility
predicate.

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (`BuyerGuest` → `CompanyGuest`; `ReportAccess.buyerGuestId` →
  `companyGuestId`)
- Create: `apps/api/prisma/migrations/<ts>_ins055_company_guests/migration.sql` — **hand-written**
- Modify: `apps/api/src/guest/guest.service.ts:30-49`, `apps/api/src/buyer-guests/*` →
  `apps/api/src/company-guests/*`, `apps/api/src/mail/mail.service.ts:27-30,144-149`
- Modify (web): `buyers/[id]/guests/*` → `companies/[id]/guests/*`
- Create: `apps/api/test/integration/guest-visibility.e2e-spec.ts`

- [ ] **Step 1: Write the leak regression test FIRST, and watch it fail for the right reason**

`guest-visibility.e2e-spec.ts`, named exactly `'a factory-role guest sees no reports'`:

- Company **C** is the factory and company **D** the client on an inspection that produced a report.
- A guest is attached to **C**.
- `GET /guest/reports?token=…` returns `[]`.
- `GET /guest/reports/:id` for **D**'s report returns 404.

Plus the tenant conjunct: a guest of org A's company sees none of org B's reports.

This test is the phase's reason to exist. It must exist and pass before the repoint is considered done.

- [ ] **Step 2: Hand-write the rename migration**

```sql
ALTER TABLE "buyer_guests" RENAME TO "company_guests";
ALTER TABLE "company_guests" RENAME COLUMN "buyerId" TO "companyId";
ALTER TABLE "report_accesses" RENAME COLUMN "buyerGuestId" TO "companyGuestId";
-- indexes and the unique constraint follow the table; rename them for legibility,
-- and re-create @@unique([companyId, email]) only if the rename did not carry it.
```

Then update `schema.prisma` (`@@map("company_guests")`, field renames) and confirm with
`prisma migrate diff` that schema and migrations agree. **Read the SQL before applying it.** If it
contains `DROP TABLE` or `CREATE TABLE "company_guests"`, it will destroy every live magic link — discard
it and write the `RENAME` by hand.

- [ ] **Step 3: Repoint `guest.service.ts` — the exact predicate, no more**

```ts
// listReports
where: { clientCompanyId: guest.companyId, orgId: guest.orgId }
// getReport
where: { id: reportId, clientCompanyId: guest.companyId, orgId: guest.orgId }
```

Do not touch the photo query at `:61-65`: it fetches by `inspectionId` with no `orgId` filter and is safe
**only** because it is reached through the already-scoped report lookup above. Keep that ordering.

> `Report.clientCompanyId` does not exist until Phase 7. Either (a) run this phase's predicate against
> `buyerId` joined through `buyers.companyId`, or (b) swap Phase 6 and Phase 7. **Recommend (b) if the
> team is comfortable** — repointing guests onto a column that exists is simpler than a join through a
> table being dropped. The order in this plan follows the backlog; if you swap, swap the gates too.

- [ ] **Step 4: Rename the module and the console screens**

`buyer-guests` → `company-guests`; routes `GET|POST /companies/:companyId/guests`,
`DELETE /company-guests/:id` (from `buyer-guests.controller.ts:13,18,27`). `mail.service.ts:145-149`
`buyerName` → `companyName`; the magic-link URL and the `/portal` route are unchanged — the token is the
credential and it is untouched.

- [ ] **Step 5: Prove tokens survived**

Integration test: mint a guest token, apply the migration, list reports with the **same** token → an
identical report id set. Also assert `tokenExpiresAt` and `lastAccessAt` survived.

- [ ] **Step 6: Verify**

```bash
pnpm api test && pnpm api test:integration && pnpm type-check && pnpm web build
```

**Phase 6 gate (backlog acceptance, part 2):** a pre-migration buyer-guest magic link lists **exactly the
same reports** as before · the factory-guest leak test passes · no token value changed.

---

## Phase 7 — `Report.clientCompanyId` and canonical **v2**

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (`Report.buyerId` → `clientCompanyId`; add
  `Report.canonicalVersion Int @default(1)`)
- Create: `apps/api/prisma/migrations/<ts>_ins055_report_company/migration.sql` — **hand-written rename**
- Modify: `packages/shared-types/src/json-contracts.ts` (+ a new `canonical.spec.ts` in the package or
  mirrored under `apps/api/src`)
- Modify: `apps/api/src/reports/reports.service.ts:59-64,124-128,137,188,231-259`
- Modify (web): `portal/page.tsx:58-59`, `portal-client.tsx:28,35,65,71`, `branded-report.tsx:20,31-32`,
  `reports/page.tsx`
- Modify: `apps/api/test/integration/reports*.e2e-spec.ts` (+ a v1/v2 verification spec)

- [ ] **Step 1: TDD the pure version helpers in `@inspect/shared-types`**

Write the tests first (spec §9): `canonicalVersionOf` (absent → 1; `2` → 2; `"2"`/`null`/`{}` → 1),
`photoHashesOf` (v1 and v2 both read the top-level key; missing → `[]`), `readCanonicalParties` (a v1
fixture and a v2 fixture produce **identical** output; `supplier: {id: null, name: null}` → `factory:
null`). Confirm they fail, implement, confirm they pass.

- [ ] **Step 2: Rename the report column — hand-written, with the same DROP-check as Phase 6**

```sql
ALTER TABLE "reports" RENAME COLUMN "buyerId" TO "clientCompanyId";
UPDATE "reports" SET "clientCompanyId" = (SELECT "companyId" FROM "buyers" WHERE "buyers".id = "reports"."clientCompanyId");
ALTER TABLE "reports" ADD COLUMN "canonicalVersion" integer NOT NULL DEFAULT 1;
```

> **This is the one `UPDATE` against `reports` the plan permits** — it rewrites a *foreign key column*,
> which is outside the signed envelope. It must not touch `canonical_snapshot`, `content_hash`, or
> `signature`. Grep the final migration for those three column names and confirm zero hits before
> applying.

- [ ] **Step 3: Emit v2 from `generate()`**

`reports.service.ts:59-64`: replace the `buyer` / `supplier` keys with `client` / `factory` and add
`canonicalVersion: 2` (spec §5.3). **No aliases.** `photoHashes` stays exactly where it is. `:124-128`
resolves `brandingSnapshot` from `inspection.clientCompany`. Set the mirror column
`canonicalVersion: 2` on the row. `:188` list filter becomes `clientCompany: { name: … }`.

- [ ] **Step 4: `verifyByToken` — add the seam, not a branch**

`:246-247` becomes `contentHash(report.canonicalSnapshot, photoHashesOf(report.canonicalSnapshot))`. The
hash/signature check stays a byte-exact recompute with **no** version branch. Add `canonicalVersion:
canonicalVersionOf(report.canonicalSnapshot)` to the response.

- [ ] **Step 5: Presentation readers handle both shapes — via the one adapter**

`portal/page.tsx:58-59`, `portal-client.tsx:35,71`, and `branded-report.tsx:20,31-32` all call
`readCanonicalParties(snapshot)`. Do not write three copies of "if v1 read `buyer`" — that is the drift
INS-008 exists to prevent.

- [ ] **Step 6: Integration proof — both versions**

- A report generated **before** this phase verifies `valid: true, hashMatches: true, signatureValid:
  true, canonicalVersion: 1`.
- A report generated **after** verifies the same with `canonicalVersion: 2`.
- A v1 and a v2 report render identical party rows in `/portal` (manual check + type-check).

- [ ] **Step 7: Verify**

```bash
pnpm api test && pnpm api test:integration && pnpm type-check && pnpm web build
```

**Phase 7 gate:** a **pre-migration** report verifies `valid: true` · a v2 report verifies `valid: true` ·
no stored snapshot, hash, or signature byte changed.

---

## Phase 8 — Drop the legacy tables

**Irreversible.** Do not start until Phases 3–7 have been running in the target environment long enough
that a rollback is genuinely off the table.

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (remove `Buyer`, `Supplier`, their `Organization` back-relations,
  and the `companyId` / `legacyBuyerId` / `legacySupplierId` lineage columns)
- Modify: `apps/api/src/app.module.ts` (drop `BuyersModule`, `SuppliersModule`)
- Delete: `apps/api/src/buyers/`, `apps/api/src/suppliers/`
- Create: `apps/api/prisma/migrations/<ts>_ins055_drop_legacy/migration.sql`

- [ ] **Step 1: Prove nothing reads them**

```bash
grep -rn "prisma.buyer\.\|prisma.supplier\.\|buyerId\|supplierId" apps/api/src apps/web/app apps/web/lib
```

Expected: zero hits outside comments and the migration files. Any hit is a consumer that was missed —
fix it in its own phase, not here.

- [ ] **Step 2: Capture the two pre-drop artifacts (do this BEFORE the migration)**

1. A report's `verificationToken` and `contentHash` — generated before Phase 7, so a genuine **v1** row.
2. A live guest magic-link token, plus the exact list of report ids it currently returns.

- [ ] **Step 3: Drop**

```sql
ALTER TABLE "company_guests" DROP COLUMN IF EXISTS "companyId_legacy";
ALTER TABLE "companies" DROP COLUMN "legacyBuyerId", DROP COLUMN "legacySupplierId";
DROP TABLE "buyers";
DROP TABLE "suppliers";
```

`DROP TABLE` will fail if any FK still references them — that failure is the safety net working, not an
obstacle to force with `CASCADE`. **Never add `CASCADE` here.**

- [ ] **Step 4: Re-run both backlog acceptance checks against the captured artifacts**

- `GET /reports/verify/:token` for the Step 2 report → `valid: true, hashMatches: true, signatureValid:
  true, canonicalVersion: 1`. This is the whole point of the versioning scheme: a document signed before
  any of this still verifies after the tables it referenced no longer exist.
- `GET /guest/reports?token=…` with the Step 2 token → **exactly** the same report id set.

- [ ] **Step 5: Full verification**

```bash
pnpm api test && pnpm api test:integration && pnpm type-check && pnpm web build
```

**Phase 8 gate (backlog acceptance, both parts):** a pre-migration report verifies `valid: true` · a
pre-migration buyer-guest magic link lists exactly the same reports as before · legacy tables gone ·
suite green.

---

## Phase 9 — Documentation close-out

- [ ] **Step 1: Update `docs/reference/inspect-schema.md`**

It is the living schema reference and it currently describes the split (`:33`, `:34`, `:43`, `:92`).
Update the model map ("Counterparties: `Company`, `CompanyGuest`, `Product`, `PurchaseOrder`"), the
tenant-scoped uniqueness bullet, the deletion-policy bullet, and the `orgId`-alignment note (which lists
`BuyerGuest` by name). Record the model count change and re-date "Last verified".

- [ ] **Step 2: Flip the backlog**

`docs/future/BACKLOG.md`: **INS-055** → `status: done` with a dated `done:` line recording the real unit
and integration counts, the migration names, and the dedupe mode actually applied per environment.

- [ ] **Step 3: Update STATUS.md**

Bump **"Last verified"**, add the INS-055 entry, and update the Data-model pillar row.

- [ ] **Step 4: Move the spec and plan**

```bash
git mv docs/in-progress/specs/2026-08-01-inspect-company-model-design.md docs/done/specs/
git mv docs/in-progress/plans/2026-08-01-inspect-company-model.md docs/done/plans/
```

Then verify every relative link still resolves (`../specs/` ↔ `../plans/`, `../../future/BACKLOG.md`,
`../../../apps/...`) rather than assuming.

- [ ] **Step 5: Update `CLAUDE.md`**

Its "Feature modules" list names `buyers`, `suppliers`, `buyer-guests`, and the domain-invariants section
does not yet mention the client/factory role model or the canonical version. Both need updating — this is
the file every future session reads first.

**Phase 9 gate:** STATUS, BACKLOG, `inspect-schema.md`, and `CLAUDE.md` all agree with the code; every
link resolves.

---

## Notes for the implementer

- **If the factory-guest leak test (Phase 6, Step 1) fails, stop.** That is a cross-counterparty data
  leak, not a flaky test to route around.
- **If a "phase-additive" migration contains a `DROP`, `RENAME`, or `UPDATE` you did not deliberately
  write, stop and fix the schema edit.** Do not hand-patch the generated SQL to make the diff look right.
- **Resist the natural generalization** in `guest.service.ts`. Once one model plays both roles,
  `OR: [{clientCompanyId}, {factoryCompanyId}]` reads like a cleanup. It is the bug.
- **Do not "helpfully" normalize old canonical snapshots.** Two shapes existing forever is the design,
  not an oversight.
- **Found while planning, out of scope — report, do not fix here:**
  - `Buyer.defaultLoopPresetId` is write-only: the console sets it (`dashboard/actions.ts:17,35`) but no
    API path reads it — `inspections.service.ts:124` hard-requires an explicit `loopPresetId`. Worth its
    own backlog item (wire it up, or delete the field).
  - `buyers.service.ts` and `suppliers.service.ts` have already drifted — only buyers has
    `assertPresetInOrg` (`:98-107`). The port in Phase 3 must not silently drop it.
  - `purchase-orders.service.ts:68-77` `remove()` is a **hard delete**, which contradicts the
    no-hard-deletes invariant in CLAUDE.md. Unrelated to this epic; file it separately.
