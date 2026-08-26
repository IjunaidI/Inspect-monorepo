# Unified Company Model (INS-055) — Implementation Plan  ✅ EXECUTED 2026-08-26

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.
>
> **✅ EXECUTED 2026-08-26 — all 9 tasks shipped.** One correction the next reader should know: Tasks 4–7
> (PO / Inspection / Report / guests) shipped as ONE commit, not four. Each denormalizes its parties from the
> previous one, so the moment the PO stopped writing `buyerId` the whole chain went null — the split in this
> document does not hold. A third migration was also needed: dropping a column does not drop the INS-014
> trigger that guards it by name. See the INS-055 entry in [BACKLOG](../../future/BACKLOG.md).
>
> **Re-scoped 2026-08-26 — this document REPLACES the 10-phase plan authored 2026-08-01.** The repo-root
> `CLAUDE.md` now carries a ⚠️ TEMPORARY pre-production policy: this project has no deployment and the
> Railway database is a scratch dev database whose rows are worth nothing. Most of the old plan's
> structure existed to *preserve rows* — a 1:1 backfill, `legacyBuyerId`/`legacySupplierId` lineage
> columns, a human-adjudicated same-name dedupe, hand-written `RENAME` migrations to save live guest
> tokens, and a staged table drop. **All of that is deleted.** What is kept is every decision that is
> about the *code*: the two-FK role model, the guest-visibility predicate, canonical v1/v2 versioning,
> and the partial case-insensitive unique index. See "What changed in the re-scope" below.

**Goal:** replace `Buyer` + `Supplier` with one org-scoped `Company`, where trade role is carried by the
edge (`clientCompanyId` / `factoryCompanyId`) rather than by the row — without weakening tenant
isolation, without widening what a guest can see, and without producing a report the public verifier
cannot check.

**Architecture:** a **clean break in two migrations**. Migration A adds `Company`, `CompanyGuest`, the
role FKs and `Report.canonicalVersion`, and relaxes the legacy `buyerId`/`supplierId` columns to
nullable — nothing is backfilled, because nothing in the database is worth carrying. Consumers are then
repointed one product surface at a time (**API and console together in the same task**, per
`.claude/rules/migration-discipline.md`), each task shipping green. Migration B drops the legacy tables
and columns, tightens the new FKs to `NOT NULL` and adds the business-key unique index. The canonical
report payload is **versioned, never rewritten**.

**Tech Stack:** NestJS 11 + Prisma 6 (API, port 3000), Next.js 15 App Router + NextAuth v5 (web, port
3001), Jest (API unit + DB-backed integration), Vitest (web unit), pnpm 9.12.0 workspaces + Turborepo,
PostgreSQL 16.

**Spec:** [../specs/2026-08-01-inspect-company-model-design.md](../specs/2026-08-01-inspect-company-model-design.md)
— §0's P1–P8 product sign-off (2026-08-26, all eight defaults confirmed, no overrides) is the authority
for every shape below.
**Backlog:** [INS-055](../../future/BACKLOG.md). Prerequisite [INS-008](../../future/BACKLOG.md) is
**done** — `BuyerDto` / `SupplierDto` / `ProductDto` / `BuyerGuestDto` already live in
`@inspect/shared-types`, which is why the `Company` DTO gets written exactly once.

---

## What changed in the re-scope (read once, then work from the tasks)

| Old plan | Now | Why |
|---|---|---|
| Phase 1: additive `Company` + **1:1 backfill** from every Buyer/Supplier row | Task 2: additive `Company`, **no backfill** | There is no row worth carrying. |
| `legacyBuyerId` / `legacySupplierId` lineage columns | **Deleted from the design** | They exist only to trace a backfill that no longer happens. |
| Phase 2: collision-detection query + **human-adjudicated dedupe**, irreversible merges | **Deleted.** The partial CI unique index lands in migration B | Nothing to deduplicate on an empty table. |
| Phase 6: hand-written `ALTER TABLE … RENAME` so **live magic links survive**; a "token survival" integration test | `company_guests` is a plain `CREATE TABLE`; **no token-survival test** | The tokens are dev tokens. Spec §4.3's *mechanism* is dropped; spec §4.2's **predicate** is not. |
| Phase 7/8 gate: "a report signed **before** the migration still verifies" | Same guarantee, proven by a **v1 fixture** the test builds itself | A better test: repeatable, and it survives `migrate reset`. The requirement is about the *format*, not about historical rows. |
| Phase 8: staged legacy drop | Task 8: one migration, applied by `prisma migrate reset` + reseed | Sanctioned by the pre-production policy. |
| 10 phases | **9 tasks** | — |

**Not relaxed by the policy, and still binding:** spec §2's role model (two FKs — P1 stands), spec §4.2's
guest-visibility predicate (a security boundary), spec §5's canonical v1/v2 versioning, tenant isolation,
audit-on-write, and the immutability of any report the code produces *after* the change.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **No code path and no migration may `UPDATE reports."canonicalSnapshot"`, `reports."contentHash"` or
  `reports."signature"`.** Not to normalize, not to backfill a version marker, not to add an alias. That
  is the Ed25519 seal. `Report.canonicalVersion` is a **new, unsigned column**; adding a column is fine,
  rewriting the envelope is not. Grep every migration for `UPDATE "reports"` before applying it.
- **Guest report visibility keys on `clientCompanyId` AND `orgId` — both conjuncts, at all three call
  sites** (`listReports`, `getReport`, `downloadReportPdf`). **Never** a party-agnostic
  `OR: [{ clientCompanyId }, { factoryCompanyId }]`: that hands a factory's guest the client's signed
  report. It gets its own named regression test in Task 7.
- **Trade role belongs to the edge, never to the row.** Do not add `Company.role`, `Company.canBeClient`
  or `Company.canBeFactory` (spec §0 P3). `Company.kind` is the orthogonal *ownership* axis
  (`INTERNAL | THIRD_PARTY`) and is not a role.
- **API and console are repointed in the SAME task** (`.claude/rules/migration-discipline.md`). A surface
  is not done while the console still reads the field the API stopped writing.
- **No DTO or enum is redeclared** (`.claude/rules/wire-contract.md`). Anything crossing the wire lives in
  `packages/shared-types/src/` and is imported. `shared-types` has no runtime dependencies.
- **Every mutation appends one hash-chained `AuditLog` row inside the same transaction**, using
  `actorTypeFor(actor)`.
- **Every task ships green**: `pnpm lint`, `pnpm type-check`, `pnpm test`, `pnpm api test:integration`
  and `pnpm build` all pass at the task boundary. If a task can only be green together with the next
  one, the split is wrong — re-split it.
- **`@inspect/shared-types` must be rebuilt before the API's Jest suite sees a runtime change.** The
  package resolves through `dist`. Root `pnpm test` handles this (`turbo`'s `test` task carries
  `dependsOn: ["^build"]`); the filtered `pnpm api test` does **not**. After touching the package run
  `pnpm --filter @inspect/shared-types build` first.
- **No new runtime dependencies and no new env vars.**
- Node ≥ 20, pnpm 9.12.0. On Windows, if `pnpm` is not on PATH use `npx -y pnpm@9.12.0 <cmd>`.
  `pnpm api test` can exit 134 on Windows from a Jest worker teardown *after* every test reports green
  ([INS-085](../../future/BACKLOG.md)) — `jest --runInBand` exits 0. Do not chase it.

**Baseline to hold and grow** (measured 2026-08-26, not copied): API unit **597 passing / 41 suites**,
web unit **32 / 2**, integration **139 passing / 15 suites, exit 0** against live Postgres + Redis + S3,
`pnpm type-check` 4/4, `pnpm lint` 0 errors, `pnpm build` 3/3.

---

## File structure

**Created**

| File | Responsibility |
|---|---|
| `apps/api/prisma/migrations/20260826000000_company_model/migration.sql` | Migration A — additive: `companies`, `company_guests`, role FKs, `canonicalVersion`; legacy columns relaxed to nullable |
| `apps/api/prisma/migrations/20260827000000_drop_buyer_supplier/migration.sql` | Migration B — drop legacy tables/columns, tighten FKs to `NOT NULL`, add the partial CI unique index |
| `apps/api/src/companies/companies.{module,service,controller}.ts` | Company CRUD, logo presign, archive/restore, audit — replaces `buyers/` **and** `suppliers/` |
| `apps/api/src/companies/companies.{service,controller}.spec.ts` | Unit specs ported from `buyers.*.spec.ts` + `suppliers.service.spec.ts` |
| `apps/api/src/company-guests/company-guests.{module,service,controller}.ts` | Magic-link guests attached to a company in its **client** role only |
| `apps/api/src/company-guests/company-guests.service.spec.ts` | Ported from `buyer-guests.service.spec.ts` |
| `apps/api/src/reports/canonical.spec.ts` | Unit spec for the pure shared-types canonical readers (no DB) |
| `apps/api/test/integration/company-model.e2e-spec.ts` | Guest-visibility boundary, self-dealing, cross-org party rejection, v1-fixture verification |
| `apps/web/app/(console)/companies/[id]/{page.tsx,edit-form.tsx}` | One company detail screen (branding **and** address/GPS) |
| `apps/web/app/(console)/companies/[id]/guests/{page.tsx,actions.ts,guests-client.tsx}` | Guests for a company acting as client |

**Modified** — `apps/api/prisma/schema.prisma`; `packages/shared-types/src/{enums,json-contracts,dtos}.ts`;
API `purchase-orders/`, `inspections/`, `reports/`, `guest/`, `search/`, `dashboard/`, `populate/`,
`loop-presets/`, `mail/`, `app.module.ts`, `openapi.json`; web `lib/api.ts`,
`app/(console)/dashboard/{page.tsx,actions.ts,directory-client.tsx}`,
`app/(console)/purchase-orders/**`, `app/(console)/inspections/**`, `app/(console)/reports/page.tsx`,
`app/portal/**`, `app/r/[token]/page.tsx`, `components/inspect/{shell,command-palette,branded-report}.tsx`,
`middleware.ts`; integration `support.ts` plus the specs that name a buyer or supplier.

**Deleted** (Task 8, once nothing imports them) — `apps/api/src/buyers/`, `apps/api/src/suppliers/`,
`apps/api/src/buyer-guests/`, `apps/web/app/(console)/buyers/`, `apps/web/app/(console)/suppliers/`,
and `BuyerDto` / `SupplierDto` / `BuyerGuestDto` from `shared-types`.

---

## Task map

| # | Ships | Reversible? | Gate |
|---|---|---|---|
| 1 | `shared-types`: `CompanyKind`, Company DTOs, canonical v1/v2 readers | yes | New unit spec green; both apps still type-check |
| 2 | Migration A + schema (additive, no backfill) | yes | `migrate diff` clean; full suite unchanged |
| 3 | Companies module + console directory (search, dashboard, palette follow) | yes | One Companies list; `/buyers` + `/suppliers` screens gone |
| 4 | `PurchaseOrder` two-party | yes | PO created/read via company FKs; self-dealing → 400 |
| 5 | `Inspection` two-party | yes | Full core loop green on company FKs |
| 6 | `Report` client FK + canonical **v2** | yes | v1 fixture verifies `valid:true`; v2 verifies `valid:true` |
| 7 | `CompanyGuest` + guest portal (**security**) | yes | A factory-role guest sees **zero** reports |
| 8 | Migration B: drop legacy, `NOT NULL`, CI unique index | **no** | `migrate reset` + reseed; no `buyer`/`supplier` identifier left |
| 9 | Docs close-out | n/a | STATUS + BACKLOG + schema doc agree with the code |

**Accepted intermediate state:** between Task 2 and Task 8 the schema carries both the legacy columns and
the new FKs. This costs nothing — there is no data to keep in sync — and it is what lets every task ship
green instead of leaving the tree broken across eight commits.

---

## Task 1: `@inspect/shared-types` — the Company contract and the canonical readers

**Files:**
- Modify: `packages/shared-types/src/enums.ts` (append `COMPANY_KINDS`)
- Modify: `packages/shared-types/src/json-contracts.ts` (append the canonical section)
- Modify: `packages/shared-types/src/dtos.ts` (append `CompanyDto` + inputs + `CompanyGuestDto`)
- Test: `apps/api/src/reports/canonical.spec.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `COMPANY_KINDS: readonly ['INTERNAL', 'THIRD_PARTY']`, `type CompanyKind`
  - `canonicalVersionOf(snapshot: unknown): 1 | 2`
  - `photoHashesOf(snapshot: unknown): string[]`
  - `readCanonicalParties(snapshot: unknown): CanonicalParties`
  - `interface CanonicalParties { client: CanonicalParty; factory: CanonicalParty | null }`
    where `CanonicalParty = { companyId: string | null; name: string | null }`
  - `CompanyDto`, `CreateCompanyInput`, `UpdateCompanyInput`, `CompanyGuestDto`

`BuyerDto` / `SupplierDto` / `BuyerGuestDto` stay for now — the console still imports them. They are
deleted in Task 8.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/reports/canonical.spec.ts`. It lives in the API because `shared-types` has no test
runner and the API's Jest suite already imports the built package — so this spec proves the *published*
artifact, not the source.

```ts
import {
  canonicalVersionOf,
  photoHashesOf,
  readCanonicalParties,
} from '@inspect/shared-types';

/** A payload in the shape reports.service.ts signed before INS-055. */
const v1 = {
  inspectionId: 'insp_1',
  buyer: { id: 'buy_1', name: 'Acme Retail' },
  supplier: { id: 'sup_1', name: 'Dhaka Mills' },
  photoHashes: ['aa', 'bb'],
};

/** The shape it signs after INS-055 (spec §5.3). */
const v2 = {
  canonicalVersion: 2,
  inspectionId: 'insp_1',
  client: { companyId: 'buy_1', name: 'Acme Retail', kind: 'THIRD_PARTY' },
  factory: { companyId: 'sup_1', name: 'Dhaka Mills', kind: 'INTERNAL' },
  photoHashes: ['aa', 'bb'],
};

describe('canonicalVersionOf', () => {
  it('reads an absent marker as v1 — every report signed before INS-055', () => {
    expect(canonicalVersionOf(v1)).toBe(1);
  });

  it('reads the embedded marker as v2', () => {
    expect(canonicalVersionOf(v2)).toBe(2);
  });

  it.each([['2'], [null], [{}], [undefined], [[]], [2.5]])(
    'falls back to v1 for the hostile value %p rather than trusting it',
    (value) => {
      expect(canonicalVersionOf({ canonicalVersion: value })).toBe(1);
    },
  );

  it('treats a non-object snapshot as v1', () => {
    expect(canonicalVersionOf(null)).toBe(1);
    expect(canonicalVersionOf('nonsense')).toBe(1);
  });
});

describe('photoHashesOf', () => {
  it('reads the top-level array from both versions — the key never moves', () => {
    expect(photoHashesOf(v1)).toEqual(['aa', 'bb']);
    expect(photoHashesOf(v2)).toEqual(['aa', 'bb']);
  });

  it('yields [] when the key is missing, matching the verifier today', () => {
    expect(photoHashesOf({ inspectionId: 'x' })).toEqual([]);
    expect(photoHashesOf(null)).toEqual([]);
  });

  it('yields [] for a non-array value rather than passing junk to the hasher', () => {
    expect(photoHashesOf({ photoHashes: 'aa' })).toEqual([]);
  });
});

describe('readCanonicalParties', () => {
  it('produces identical output for a v1 and a v2 snapshot of the same report', () => {
    expect(readCanonicalParties(v1)).toEqual(readCanonicalParties(v2));
  });

  it('maps v1 buyer/supplier onto client/factory', () => {
    expect(readCanonicalParties(v1)).toEqual({
      client: { companyId: 'buy_1', name: 'Acme Retail' },
      factory: { companyId: 'sup_1', name: 'Dhaka Mills' },
    });
  });

  it('reports factory: null when a v1 supplier was absent', () => {
    const noFactory = { ...v1, supplier: { id: null, name: null } };
    expect(readCanonicalParties(noFactory).factory).toBeNull();
  });

  it('reports factory: null when the v1 supplier key is missing entirely', () => {
    const { supplier: _omitted, ...noKey } = v1;
    expect(readCanonicalParties(noKey).factory).toBeNull();
  });

  it('reports factory: null for an explicitly null v2 factory', () => {
    expect(readCanonicalParties({ ...v2, factory: null }).factory).toBeNull();
  });

  it('degrades to nulls rather than throwing on a junk snapshot', () => {
    expect(readCanonicalParties(null)).toEqual({
      client: { companyId: null, name: null },
      factory: null,
    });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails for the right reason**

```
pnpm --filter @inspect/shared-types build
pnpm --filter @inspect/api exec jest src/reports/canonical.spec.ts --runInBand
```

Expected: FAIL — `canonicalVersionOf is not a function` (or a TS2305 "has no exported member"). If it
fails on anything else, stop and read the error before writing code.

- [ ] **Step 3: Add `COMPANY_KINDS` to `enums.ts`**

Append, following the existing tuple-plus-union shape:

```ts
/**
 * Company OWNERSHIP, not trade role (INS-055 spec §2.1). Whether a company acts
 * as the client or the factory is a property of the PurchaseOrder / Inspection /
 * Report edge, never of the row — the same company can be a client on one PO and
 * the factory on another.
 */
export const COMPANY_KINDS = ['INTERNAL', 'THIRD_PARTY'] as const;
export type CompanyKind = (typeof COMPANY_KINDS)[number];
```

- [ ] **Step 4: Add the canonical section to `json-contracts.ts`**

Append (and while you are here, retarget the `GpsPoint` doc comment from "stored on `Supplier.gps`" to
"stored on `Company.gps`"):

```ts
// ── Canonical report payload (INS-055 spec §5) ───────────────────────────────

/** One party inside a canonical payload, in either version's shape. */
export interface CanonicalParty {
  companyId: string | null;
  name: string | null;
}

export interface CanonicalParties {
  client: CanonicalParty;
  /** null when the inspection recorded no factory. */
  factory: CanonicalParty | null;
}

/**
 * Which canonical shape a stored snapshot uses.
 *
 * The marker lives INSIDE the payload, so it is hashed and signed and cannot be
 * spoofed by editing a side column. `Report.canonicalVersion` mirrors it for
 * indexing and ops only and is NEVER the dispatch authority: if the two
 * disagree, the payload wins and the row was edited.
 *
 * Absent (or anything that is not exactly the number 2) means v1 — the shape of
 * every report signed before INS-055. Defaulting to v1 is deliberate: a hostile
 * `"2"` must not be able to select a reader.
 */
export function canonicalVersionOf(snapshot: unknown): 1 | 2 {
  const v = (snapshot as { canonicalVersion?: unknown } | null)
    ?.canonicalVersion;
  return v === 2 ? 2 : 1;
}

/**
 * The ordered photo hashes the signature covers.
 *
 * `photoHashes` deliberately stays at the TOP LEVEL under the same key in both
 * versions, so the verifier's only shape dependency is stable forever. This
 * function is version-independent on purpose; it exists as a named function so
 * the coupling is visible rather than inlined at the call site.
 */
export function photoHashesOf(snapshot: unknown): string[] {
  const v = (snapshot as { photoHashes?: unknown } | null)?.photoHashes;
  return Array.isArray(v) ? (v as string[]) : [];
}

function partyOf(value: unknown, idKey: 'id' | 'companyId'): CanonicalParty | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const companyId = typeof raw[idKey] === 'string' ? (raw[idKey] as string) : null;
  const name = typeof raw.name === 'string' ? raw.name : null;
  if (companyId === null && name === null) return null;
  return { companyId, name };
}

/**
 * Read party identity from a canonical snapshot of EITHER version.
 *
 * v1 rows are immutable and will exist for the life of the product, so this is
 * permanent code, not migration scaffolding. Write the "if v1 read buyer else
 * read client" rule exactly ONCE — here — never in a presentation component.
 */
export function readCanonicalParties(snapshot: unknown): CanonicalParties {
  const snap = (snapshot ?? {}) as Record<string, unknown>;
  if (canonicalVersionOf(snapshot) === 2) {
    return {
      client: partyOf(snap.client, 'companyId') ?? { companyId: null, name: null },
      factory: partyOf(snap.factory, 'companyId'),
    };
  }
  return {
    client: partyOf(snap.buyer, 'id') ?? { companyId: null, name: null },
    factory: partyOf(snap.supplier, 'id'),
  };
}
```

- [ ] **Step 5: Add the Company DTOs to `dtos.ts`**

```ts
import type { CompanyKind } from './enums';

/**
 * A counterparty in one tenant (INS-055). Trade role is a property of the PO /
 * Inspection / Report edge, NOT of this row, so there is deliberately no `role`
 * and no `canBeClient` / `canBeFactory` flag (spec §0 P3).
 */
export interface CompanyDto {
  id: string;
  name: string;
  kind: CompanyKind;
  /**
   * Client-role identity. DURABLE value (INS-072): an object key in this org's
   * company namespace (`orgs/{orgId}/companies/<uuid>.<ext>`) or a legacy
   * absolute `https://…` URL — never a presigned URL, because it freezes
   * verbatim into the signed report's `brandingSnapshot`.
   */
  logoUrl?: string | null;
  /** Render-time only: a short-lived presigned GET, or null. Never submitted. */
  logoViewUrl?: string | null;
  primaryColor?: string | null;
  branding?: Record<string, unknown> | null;
  defaultLoopPresetId?: string | null;
  /** Factory-role identity. */
  address?: string | null;
  gps?: GpsPoint | null;
  archivedAt?: string | null;
  updatedAt?: string;
  _count?: RelationCounts;
}

export interface CreateCompanyInput {
  name: string;
  kind?: CompanyKind;
  logoUrl?: string | null;
  primaryColor?: string | null;
  branding?: unknown;
  defaultLoopPresetId?: string | null;
  address?: string | null;
  gps?: GpsPoint | null;
}

export type UpdateCompanyInput = Partial<CreateCompanyInput>;

/**
 * A guest holding a magic-link token, attached to a company acting in its
 * CLIENT role only (spec §0 P7 — there is no factory-side portal). The
 * visibility predicate this implies is a security boundary (spec §4.2), never a
 * field to widen casually.
 */
export interface CompanyGuestDto {
  id: string;
  email: string;
  status: string;
  lastAccessAt: string | null;
  tokenExpiresAt: string;
  createdAt: string;
}
```

`RelationCounts` already gains nothing new — `reports?: number` covers the client-role count.

- [ ] **Step 6: Rebuild and run the test to verify it passes**

```
pnpm --filter @inspect/shared-types build
pnpm --filter @inspect/api exec jest src/reports/canonical.spec.ts --runInBand
```

Expected: PASS, ~17 tests.

- [ ] **Step 7: Full verification**

```
pnpm type-check
pnpm test
pnpm lint
```

Expected: type-check 4/4 clean; API unit count grown from 597 by the number of new cases; web 32
unchanged; lint 0 errors.

- [ ] **Step 8: Commit**

```bash
git add packages/shared-types/src apps/api/src/reports/canonical.spec.ts
git commit -m "feat(shared-types): Company contract + canonical v1/v2 readers (INS-055)"
```

---

## Task 2: schema + migration A (additive, no backfill)

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260826000000_company_model/migration.sql`

**Interfaces:**
- Consumes: `CompanyKind` (Task 1) — the Prisma enum must have the same members in the same order.
- Produces: Prisma models `Company`, `CompanyGuest`; `PurchaseOrder.{clientCompanyId,factoryCompanyId}`,
  `Inspection.{clientCompanyId,factoryCompanyId}`, `Report.clientCompanyId`, `Report.canonicalVersion`,
  `ReportAccess.companyGuestId` — all nullable in this task.

**Why nullable now:** the legacy `buyerId`/`supplierId` columns are `NOT NULL` today, so a write path
cannot stop setting them one at a time unless both sides are optional for the duration. They are tightened
to `NOT NULL` in Task 8. Nothing is backfilled — the pre-production policy makes existing rows worthless,
and Task 8 applies its migration with `prisma migrate reset`.

- [ ] **Step 1: Add the enum and the two new models to `schema.prisma`**

Place `CompanyKind` beside the other enums, and the models where `Buyer`/`Supplier` sit today (leave
`Buyer`, `BuyerGuest` and `Supplier` in place — they are deleted in Task 8).

```prisma
enum CompanyKind {
  INTERNAL
  THIRD_PARTY
}

/// A counterparty in one tenant (INS-055). Trade role (client / factory) is a
/// property of the PurchaseOrder / Inspection / Report EDGE, not of this row —
/// the same company may be a client on one PO and the factory on another.
/// `kind` is the orthogonal ownership axis: our own facility vs an external party.
model Company {
  id                  String      @id @default(cuid())
  orgId               String
  name                String
  kind                CompanyKind @default(THIRD_PARTY)

  // Client-role identity (ex-Buyer). Frozen into Report.brandingSnapshot at
  // generate time — never read live by a report.
  logoUrl             String?
  primaryColor        String?
  branding            Json?
  defaultLoopPresetId String?

  // Factory-role identity (ex-Supplier).
  address             String?
  gps                 Json?

  createdByUserId     String?
  archivedAt          DateTime?
  createdAt           DateTime    @default(now())
  updatedAt           DateTime    @updatedAt

  organization      Organization @relation(fields: [orgId], references: [id], onDelete: Restrict)
  defaultLoopPreset LoopPreset?  @relation("CompanyDefaultPreset", fields: [defaultLoopPresetId], references: [id], onDelete: SetNull)

  guests        CompanyGuest[]
  poAsClient    PurchaseOrder[] @relation("PurchaseOrderClient")
  poAsFactory   PurchaseOrder[] @relation("PurchaseOrderFactory")
  inspAsClient  Inspection[]    @relation("InspectionClient")
  inspAsFactory Inspection[]    @relation("InspectionFactory")
  reports       Report[]        @relation("ReportClient")

  /// INS-010: composite parent key so CompanyGuest can carry a tenant-aligned FK
  /// the DATABASE checks, not just the app layer.
  @@unique([id, orgId])
  @@index([orgId])
  @@index([orgId, name])
  @@map("companies")
}

/// Read-only guest login scoped to ONE company's CLIENT-role reports within ONE
/// tenant (spec §4). Magic-link auth. There is no factory-side portal (P7).
model CompanyGuest {
  id             String     @id @default(cuid())
  companyId      String
  orgId          String
  email          String
  status         UserStatus @default(INVITED)
  token          String?    @unique
  tokenExpiresAt DateTime?
  lastAccessAt   DateTime?
  createdAt      DateTime   @default(now())

  // INS-010: tenant-aligned composite FK — a guest can only hang off a company
  // in its OWN org, enforced by the database rather than caller discipline.
  company        Company        @relation(fields: [companyId, orgId], references: [id, orgId], onDelete: Cascade)
  organization   Organization   @relation(fields: [orgId], references: [id], onDelete: Restrict)
  reportAccesses ReportAccess[]

  @@unique([companyId, email])
  @@index([orgId])
  @@index([token])
  @@map("company_guests")
}
```

Note: **no `@@unique([orgId, name])`**. The business key is the partial case-insensitive index, which
cannot be expressed in `schema.prisma` and is added by hand in Task 8 (spec §6.6).

- [ ] **Step 2: Add the role FKs and back-relations to the existing models**

```prisma
// Organization — add to the relation list:
  companies     Company[]
  companyGuests CompanyGuest[]

// LoopPreset — add beside defaultForBuyers:
  defaultForCompanies Company[] @relation("CompanyDefaultPreset")

// PurchaseOrder — add fields + relations + indexes; relax the legacy pair:
  buyerId          String?   // legacy, dropped in Task 8
  supplierId       String?   // legacy, dropped in Task 8
  clientCompanyId  String?
  factoryCompanyId String?
  buyer          Buyer?    @relation(fields: [buyerId], references: [id], onDelete: Restrict)
  supplier       Supplier? @relation(fields: [supplierId], references: [id], onDelete: Restrict)
  clientCompany  Company?  @relation("PurchaseOrderClient", fields: [clientCompanyId], references: [id], onDelete: Restrict)
  factoryCompany Company?  @relation("PurchaseOrderFactory", fields: [factoryCompanyId], references: [id], onDelete: Restrict)
  @@index([clientCompanyId])
  @@index([factoryCompanyId])

// Inspection — same pattern; the factory edge is SetNull, mirroring supplier today:
  buyerId          String?   // legacy, dropped in Task 8
  clientCompanyId  String?
  factoryCompanyId String?
  clientCompany  Company? @relation("InspectionClient", fields: [clientCompanyId], references: [id], onDelete: Restrict)
  factoryCompany Company? @relation("InspectionFactory", fields: [factoryCompanyId], references: [id], onDelete: SetNull)
  @@index([clientCompanyId])

// Report — client FK + the UNSIGNED version column:
  buyerId          String?   // legacy, dropped in Task 8
  clientCompanyId  String?
  /// Mirrors the `canonicalVersion` marker INSIDE canonicalSnapshot, for
  /// indexing and ops ONLY. Never the dispatch authority — canonicalVersionOf()
  /// reads the signed payload. A disagreement means the row was edited.
  canonicalVersion Int @default(1)
  clientCompany Company? @relation("ReportClient", fields: [clientCompanyId], references: [id], onDelete: Restrict)
  @@index([clientCompanyId])

// ReportAccess — the guest FK moves:
  companyGuestId String?
  companyGuest   CompanyGuest? @relation(fields: [companyGuestId], references: [id], onDelete: SetNull)
  @@index([companyGuestId])
```

Both `Buyer` and `Company` keep their `@@unique([id, orgId])`; both `BuyerGuest` and `CompanyGuest`
exist, each with its own composite FK. That coexistence is the whole point of the additive step.

- [ ] **Step 3: Validate the schema, then author the migration**

```
pnpm --filter @inspect/api exec prisma validate
pnpm --filter @inspect/api exec prisma migrate dev --create-only --name company_model
```

Expected: `prisma validate` prints "The schema at prisma/schema.prisma is valid"; the second command
writes `migrations/20260826.../migration.sql` **without applying it**. Rename the directory to
`20260826000000_company_model` so it sorts with the repo's existing hand-dated migrations.

- [ ] **Step 4: Review the generated SQL — this is a required review, not a formality**

Read the whole file and confirm:
- it contains `CREATE TABLE "companies"` and `CREATE TABLE "company_guests"`;
- it contains **no** `UPDATE "reports"` — grep for it explicitly:
  `grep -n 'UPDATE "reports"' apps/api/prisma/migrations/20260826000000_company_model/migration.sql`
  must print nothing;
- it contains **no** `DROP TABLE "buyers"`, `"suppliers"` or `"buyer_guests"` — those belong to Task 8.
  If Prisma emitted a drop, the schema edit removed a model it should not have;
- the legacy columns are altered with `DROP NOT NULL`, not dropped;
- `ALTER TABLE "reports" ADD COLUMN "canonicalVersion" INTEGER NOT NULL DEFAULT 1` is present.

- [ ] **Step 5: Apply it and regenerate the client**

```
pnpm --filter @inspect/api exec prisma migrate dev
pnpm --filter @inspect/api exec prisma generate
```

Expected: "The following migration(s) have been applied", then a generated client.

- [ ] **Step 6: Prove the schema and the database agree**

```
pnpm --filter @inspect/api exec prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code
```

Expected: exit 0 with "No difference detected". A non-zero exit means the migration does not reproduce
the schema — fix the SQL, do not hand-patch the database.

- [ ] **Step 7: Full verification — nothing reads the new columns yet, so the suite must be unchanged**

```
pnpm type-check
pnpm test
pnpm api test:integration
```

Expected: identical counts to the Task 1 boundary. Any change here means a model edit leaked into a
consumer.

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma
git commit -m "feat(api): additive Company + CompanyGuest schema and role FKs (INS-055)"
```

---

## Task 3: the Companies module and the console directory

Replaces `buyers/` **and** `suppliers/` with one module, and the console's two-tab directory with one
Companies list. The legacy modules stay registered and working until Task 8, so this task is reversible.

**Files:**
- Create: `apps/api/src/companies/companies.service.ts`, `companies.controller.ts`, `companies.module.ts`
- Create: `apps/api/src/companies/companies.service.spec.ts`, `companies.controller.spec.ts`
- Modify: `apps/api/src/app.module.ts` (register `CompaniesModule`)
- Modify: `apps/api/src/search/search.service.ts`, `apps/api/src/dashboard/dashboard.service.ts`,
  `apps/api/src/loop-presets/loop-presets.service.ts:61`
- Modify: `apps/web/lib/api.ts`, `apps/web/app/(console)/dashboard/{page.tsx,actions.ts,directory-client.tsx}`,
  `apps/web/components/inspect/{shell.tsx,command-palette.tsx}`, `apps/web/middleware.ts`
- Create: `apps/web/app/(console)/companies/[id]/{page.tsx,edit-form.tsx}`
- Delete: `apps/web/app/(console)/buyers/[id]/{page.tsx,edit-form.tsx}`,
  `apps/web/app/(console)/suppliers/[id]/{page.tsx,edit-form.tsx}`
  (the `buyers/[id]/guests/` subtree moves in Task 7)
- Test: `apps/api/test/integration/workspace-validation.e2e-spec.ts` (repoint to `/companies`)

**Interfaces:**
- Consumes: `CompanyDto`, `CreateCompanyInput`, `UpdateCompanyInput`, `CompanyKind`, `COMPANY_KINDS`.
- Produces:
  - REST: `GET /companies`, `GET /companies/:id`, `POST /companies`, `POST /companies/presign`,
    `PATCH /companies/:id`, `DELETE /companies/:id`, `POST /companies/:id/restore` — class floor
    `@Roles('QA_MANAGER')`, exactly as `buyers` and `suppliers` have today.
  - `companyLogoPrefix(orgId: string): string` → `orgs/${orgId}/companies/`
  - `normalizePrimaryColor(value: unknown): string | null | undefined` (moved verbatim from
    `buyers.service.ts`)
  - `normalizeGps(value: unknown): GpsCoordinates | null | undefined` and
    `gpsWrite(...)` (moved verbatim from `suppliers.service.ts`)
  - `SearchHit['type']` loses `'buyer' | 'supplier'` and gains `'company'`
  - `DashboardSummary` loses `buyers` + `suppliers` and gains `companies: number`

- [ ] **Step 1: Write the failing unit spec**

Create `apps/api/src/companies/companies.service.spec.ts` by porting every case from
`buyers.service.spec.ts` (57 buyer references) and `suppliers.service.spec.ts`, against one service. The
two cases that must survive by name are the tenant guard's:

```ts
import { BadRequestException } from '@nestjs/common';
import { CompaniesService, normalizePrimaryColor, normalizeGps } from './companies.service';

describe('CompaniesService.assertPresetInOrg (tenant isolation)', () => {
  it('rejects a defaultLoopPresetId that belongs to another org', async () => {
    const prisma = {
      loopPreset: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any;
    const service = new CompaniesService(prisma, { append: jest.fn() } as any);
    await expect(
      service.create('org_1', { userId: 'u1', role: 'ORG_OWNER' } as any, {
        name: 'Acme',
        defaultLoopPresetId: 'preset_from_org_2',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.loopPreset.findFirst).toHaveBeenCalledWith({
      where: { id: 'preset_from_org_2', orgId: 'org_1' },
      select: { id: true },
    });
  });

  it('passes a null preset straight through (explicit clear)', async () => {
    const prisma = {
      loopPreset: { findFirst: jest.fn() },
      $transaction: jest.fn(async (fn: any) => fn({ company: { create: jest.fn().mockResolvedValue({ id: 'c1', name: 'Acme' }) } })),
    } as any;
    const service = new CompaniesService(prisma, { append: jest.fn() } as any);
    await service.create('org_1', { userId: 'u1', role: 'ORG_OWNER' } as any, {
      name: 'Acme',
      defaultLoopPresetId: null,
    });
    expect(prisma.loopPreset.findFirst).not.toHaveBeenCalled();
  });
});

describe('company kind', () => {
  it('defaults to THIRD_PARTY when the caller omits it', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'c1', name: 'Acme' });
    const prisma = {
      $transaction: jest.fn(async (fn: any) => fn({ company: { create } })),
    } as any;
    const service = new CompaniesService(prisma, { append: jest.fn() } as any);
    await service.create('org_1', { userId: 'u1', role: 'ORG_OWNER' } as any, { name: 'Acme' });
    expect(create.mock.calls[0][0].data.kind).toBe('THIRD_PARTY');
  });

  it('rejects a kind outside COMPANY_KINDS instead of writing it', async () => {
    const service = new CompaniesService({} as any, { append: jest.fn() } as any);
    await expect(
      service.create('org_1', { userId: 'u1', role: 'ORG_OWNER' } as any, {
        name: 'Acme',
        kind: 'PARTNER' as any,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

Then port, unchanged in substance: `normalizePrimaryColor`'s accept/reject/normalize cases from
`buyers.service.spec.ts` and `normalizeGps`'s shape, range, clear and round-trip cases from
`suppliers.service.spec.ts`. Port `buyers.controller.spec.ts`'s `logoViewUrl` cases into
`companies.controller.spec.ts` — in particular **the foreign-org key must still resolve to `null`**,
because that decoration would otherwise be a signing oracle over another tenant's objects.

- [ ] **Step 2: Run it and confirm it fails**

```
pnpm --filter @inspect/api exec jest src/companies --runInBand
```

Expected: FAIL — `Cannot find module './companies.service'`.

- [ ] **Step 3: Write `companies.service.ts`**

Start from `buyers.service.ts` verbatim and fold in the supplier half:
- `prisma.buyer` → `prisma.company` throughout.
- `CreateBuyerInput`/`UpdateBuyerInput` → import `CreateCompanyInput`/`UpdateCompanyInput` from
  `@inspect/shared-types` (do **not** redeclare them — `.claude/rules/wire-contract.md`).
- Copy `normalizePrimaryColor` from `buyers.service.ts` and `normalizeGps` + `gpsWrite` +
  `GpsCoordinates` from `suppliers.service.ts`, unchanged.
- Add kind validation before any DB call:

```ts
function normalizeKind(value: unknown): CompanyKind | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !COMPANY_KINDS.includes(value as CompanyKind)) {
    throw new BadRequestException(
      `kind must be one of ${COMPANY_KINDS.join(', ')}`,
    );
  }
  return value as CompanyKind;
}
```

- `list()` keeps the `_count` include, now spanning both roles:

```ts
include: {
  _count: {
    select: { poAsClient: true, poAsFactory: true, inspAsClient: true, inspAsFactory: true, reports: true },
  },
},
```

  and the service flattens it to the wire shape `RelationCounts`
  (`purchaseOrders = poAsClient + poAsFactory`, `inspections = inspAsClient + inspAsFactory`,
  `reports`), so `CompanyDto._count` stays the DTO the console already knows.
- `assertPresetInOrg` moves across **unchanged** — same query, same message.
- Audit actions become `company.created` / `company.updated` / `company.archived` / `company.restored`
  with `entityType: 'Company'`, each still appended inside the business transaction.

- [ ] **Step 4: Write `companies.controller.ts` and `companies.module.ts`**

Port `buyers.controller.ts` verbatim, with:
- `@Controller('companies')`, class floor `@Roles('QA_MANAGER')`;
- `companyLogoPrefix(orgId) = \`orgs/${orgId}/companies/\``;
- `POST /companies/presign` declared **above** the `:id` routes so the param cannot swallow it;
- `withLogoViewUrl` / `logoViewUrl` copied with the org-prefix guard and the legacy-absolute-URL branch
  intact.

`companies.module.ts` mirrors `buyers.module.ts` (imports `StorageModule`, provides the service,
exports it). Register `CompaniesModule` in `app.module.ts` alongside — not instead of — the legacy
modules.

- [ ] **Step 5: Run the unit spec to verify it passes**

```
pnpm --filter @inspect/shared-types build
pnpm --filter @inspect/api exec jest src/companies --runInBand
```

Expected: PASS.

- [ ] **Step 6: Repoint search, dashboard and the preset count**

`search.service.ts`: replace the two `buyer`/`supplier` queries with one `company` query, and collapse
the hit type.

```ts
export interface SearchHit {
  type: 'company' | 'product' | 'po' | 'inspection';
  id: string;
  label: string;
  sublabel: string | null;
}
```

The company query keeps `take: PER_TYPE` and `{ orgId, name: contains }`; hits map to
`{ type: 'company', id, label: name, sublabel: null }`. Leave the PO and inspection queries reading
`buyer` for now — Tasks 4 and 5 own those; they are still populated.

`dashboard.service.ts`: replace the `buyer` + `supplier` counts with one

```ts
this.prisma.company.count({ where: { orgId, archivedAt: null } }),
```

and change `DashboardSummary` to carry `companies: number` instead of `buyers` + `suppliers`.

`loop-presets.service.ts:61`: `defaultForBuyers` → `defaultForCompanies` in the `_count` select.

- [ ] **Step 7: Repoint the console — one directory, one detail screen**

`apps/web/lib/api.ts`: export `type ApiCompany = CompanyDto` (the aliasing convention already used for
`ApiBuyer`), change `ApiDashboardSummary` to `companies: number`, change the preset `_count` key to
`defaultForCompanies`, and change `SearchHit['type']`.

`dashboard/actions.ts`: collapse `createBuyer`/`createSupplier` → `createCompany`,
`updateBuyer`/`updateSupplier` → `updateCompany`, `archive*`/`restore*` → `archiveCompany` /
`restoreCompany`, `presignBuyerLogo` → `presignCompanyLogo` (`POST /companies/presign`). The form
parses **both** the logo fields and the GPS pair; the existing "half a pair" GPS guard moves across
unchanged. Redirects go to `/companies/${id}`.

`dashboard/directory-client.tsx`: delete the `buyers | suppliers` tab state and render **one** table
fed by `companies`. Replace the tabs with `kind` filter chips — `All` · `Third-party` · `Internal` —
keeping the existing Active/Archived view toggle and the `Pager`. The single Add form carries Name,
Kind, logo upload, primary colour, default preset, address and GPS. `RowMenu` loses its `type` prop
and always offers Open · Guests · Archive/Restore. Reset to page 1 when the kind filter changes, for
the same reason the tab switch does today.

`dashboard/page.tsx`: merge the `DEMO_BUYERS` and `DEMO_SUPPLIERS` fallback fixtures into one
`DEMO_COMPANIES: ApiCompany[]` (give the branded rows `kind: 'THIRD_PARTY'` and the factory rows
`kind: 'INTERNAL'` so the filter chips have something to show when the API is unreachable), then one
`loadOrFallback<ApiCompany[]>(\`/companies${qs}\`, DEMO_COMPANIES)`. The KPI row shows one **Companies**
tile; the header copy becomes "Companies — every counterparty you trade with. Whether a company is the
client or the factory is decided per purchase order."

`companies/[id]/page.tsx` + `edit-form.tsx`: one detail screen merging `buyers/[id]/edit-form.tsx`
(logo, primary colour, default preset) and `suppliers/[id]/edit-form.tsx` (address, GPS), plus the kind
selector. Delete the four `buyers/[id]` and `suppliers/[id]` files it replaces.

`components/inspect/shell.tsx`: nav label `Buyers & Suppliers` → `Companies`; the placeholder copy at
`:449` → "Search inspections, companies, POs…".

`components/inspect/command-palette.tsx`: one `company` entry routing to `/companies/${id}`;
`TYPE_ORDER` becomes `['company', 'product', 'po', 'inspection']`.

`middleware.ts:24`: `'/buyers', '/suppliers'` → `'/companies'` in the console-route list.

- [ ] **Step 8: Repoint the integration suite**

`workspace-validation.e2e-spec.ts` is the spec that names buyers and suppliers most (74 references) and
maps one-to-one: `POST /buyers` → `POST /companies`, `POST /suppliers` → `POST /companies`,
`/buyers/presign` → `/companies/presign`, and the org-prefix guard now expects
`orgs/{orgId}/companies/`. Its three `describe` blocks become `company primaryColor`, `company gps` and
`company logo`. Update the RBAC matrix rows in `auth-rbac.e2e-spec.ts` that hit `/buyers` or
`/suppliers` to `/companies`, keeping the same expected statuses per role.

In `test/integration/support.ts`, add company creation **without** removing the buyer/supplier fixture
yet — `createWorkspace` still has to feed the PO create path, which does not change until Task 4:

```ts
// NB: `client` is already the ApiClient in this file — name the rows clientCo /
// factoryCo, or the const shadows it and every later call is a TDZ error.
const clientCo = expect2xx(
  await client.post('/companies', {
    token: ownerToken,
    body: { name: `E2E Client ${tag}`, kind: 'THIRD_PARTY' },
  }),
  'POST /companies (client)',
);
const factoryCo = expect2xx(
  await client.post('/companies', {
    token: ownerToken,
    body: { name: `E2E Factory ${tag}`, kind: 'INTERNAL', address: 'Dhaka' },
  }),
  'POST /companies (factory)',
);
```

and return `clientCompanyId: clientCo.id, factoryCompanyId: factoryCo.id` alongside the existing
`buyerId`/`supplierId`.

- [ ] **Step 9: Full verification**

```
pnpm --filter @inspect/shared-types build
pnpm lint
pnpm type-check
pnpm test
pnpm api test:integration
pnpm build
```

Expected: all green. Integration count grows (companies now exercised) and none of the existing 139 are
lost.

- [ ] **Step 10: Manual console pass**

`pnpm dev`, then at `http://localhost:3001/dashboard`: the directory shows **one** Companies list with
kind chips; Add Company creates a row with a logo upload and a GPS pair; the row menu opens
`/companies/:id`; edit saves; archive then restore round-trips; the command palette (`Cmd/Ctrl-K`)
finds the company and navigates to `/companies/:id`.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src apps/web packages/shared-types apps/api/test
git commit -m "feat: one Companies module and console directory, replacing buyers+suppliers (INS-055)"
```

---

## Task 4: `PurchaseOrder` becomes explicitly two-party

**Files:**
- Modify: `apps/api/src/purchase-orders/purchase-orders.service.ts` (+ `.spec.ts`)
- Modify: `apps/api/src/search/search.service.ts` (the PO hit's sublabel)
- Modify: `apps/web/lib/api.ts` (`ApiPurchaseOrder`), `apps/web/app/(console)/purchase-orders/**`
- Modify: `apps/api/test/integration/support.ts`, `core-loop.e2e-spec.ts`, `meeting-batch1.e2e-spec.ts`,
  `admin-org-assumption.e2e-spec.ts`
- Test: `apps/api/test/integration/company-model.e2e-spec.ts` (new file, first two cases)

**Interfaces:**
- Consumes: `Company` rows created via `POST /companies` (Task 3).
- Produces: `CreatePurchaseOrderInput { poNumber, clientCompanyId, factoryCompanyId, productId, totalQuantity? }`
  — `buyerId`/`supplierId` are gone from the wire. PO reads include
  `clientCompany` + `factoryCompany` instead of `buyer` + `supplier`.

- [ ] **Step 1: Write the failing integration tests**

Create `apps/api/test/integration/company-model.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import {
  ApiClient, apiClient, bootApp, createOrgWithOwner, expect2xx, loginAdmin,
  OrgFixture, runTag,
} from './support';

describe('Company model (integration)', () => {
  let app: INestApplication;
  let client: ApiClient;
  let org: OrgFixture;
  let adminToken: string;

  beforeAll(async () => {
    app = await bootApp();
    client = apiClient(app);
    adminToken = await loginAdmin(client);
    org = await createOrgWithOwner(client, adminToken, runTag('company'));
  });
  afterAll(async () => { await app.close(); });

  describe('purchase order parties', () => {
    it('rejects a PO whose client and factory are the same company (self-dealing)', async () => {
      const tag = runTag('self');
      const co = expect2xx(await client.post('/companies', {
        token: org.ownerToken, body: { name: `Self ${tag}` },
      }), 'POST /companies');
      const product = expect2xx(await client.post('/products', {
        token: org.ownerToken, body: { styleNumber: `STYLE-${tag}` },
      }), 'POST /products');

      const res = await client.post('/purchase-orders', {
        token: org.ownerToken,
        body: {
          poNumber: `PO-${tag}`,
          clientCompanyId: co.id,
          factoryCompanyId: co.id,
          productId: product.id,
        },
      });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/client and factory must differ/i);
    });

    it('rejects a party company that belongs to another organization', async () => {
      const tag = runTag('xorg');
      const other = await createOrgWithOwner(client, adminToken, `${tag}-other`);
      const foreign = expect2xx(await client.post('/companies', {
        token: other.ownerToken, body: { name: `Foreign ${tag}` },
      }), 'POST /companies (other org)');
      const mine = expect2xx(await client.post('/companies', {
        token: org.ownerToken, body: { name: `Mine ${tag}` },
      }), 'POST /companies');
      const product = expect2xx(await client.post('/products', {
        token: org.ownerToken, body: { styleNumber: `STYLE-${tag}` },
      }), 'POST /products');

      const res = await client.post('/purchase-orders', {
        token: org.ownerToken,
        body: {
          poNumber: `PO-${tag}`,
          clientCompanyId: mine.id,
          factoryCompanyId: foreign.id,
          productId: product.id,
        },
      });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/factory.*not found in organization/i);
    });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```
pnpm --filter @inspect/api exec jest --config ./test/jest-e2e.json test/integration/company-model.e2e-spec.ts --runInBand --forceExit
```

Expected: FAIL — the create currently 400s on the *missing* `buyerId`, not on self-dealing, so the
message assertion fails.

- [ ] **Step 3: Repoint `purchase-orders.service.ts`**

```ts
export interface CreatePurchaseOrderInput {
  poNumber: string;
  clientCompanyId: string;
  factoryCompanyId: string;
  productId: string;
  totalQuantity?: number;
}
```

- `create()` requires all three ids, then — **before** the org check, so the message is the specific one:

```ts
if (input.clientCompanyId === input.factoryCompanyId) {
  throw new BadRequestException('client and factory must differ');
}
```

  Spec §2.4 puts this at the application layer deliberately, not as a DB check constraint, consistent
  with every other cross-field invariant in this codebase and easy to relax if internal self-inspection
  becomes a real workflow.
- `assertBelongsToOrg` takes `(orgId, clientCompanyId, factoryCompanyId, productId)` and issues two
  `prisma.company.findFirst({ where: { id, orgId }, select: { id: true } })` lookups plus the product
  one, with messages `client company not found in organization`,
  `factory company not found in organization`, `product not found in organization`.
- `create()` writes only `clientCompanyId` / `factoryCompanyId` — **not** the legacy pair, which is now
  nullable.
- The audit metadata carries `clientCompanyId` + `factoryCompanyId`.
- `list()` and `get()` `include: { clientCompany: true, factoryCompany: true, product: true }`.

`search.service.ts`: the PO hit's sublabel becomes `po.clientCompany?.name ?? null`, and its select
reads `clientCompany: { select: { name: true } }`.

- [ ] **Step 4: Repoint the console PO screens**

`lib/api.ts`: `ApiPurchaseOrder` carries
`clientCompany?: { id: string; name: string } | null` and `factoryCompany?: …` instead of
`buyer`/`supplier`.

`purchase-orders/new/{page.tsx,create-form.tsx}`: load `/companies` **once** and feed both pickers.
Label them **Client** and **Factory**, not Buyer and Supplier — the whole point is that the same row can
appear in either. Rank each picker by most-recently-used-in-that-role (spec §0 P3's replacement for
capability flags): sort by the company's `_count.poAsClient` / `_count.poAsFactory` descending, then by
name. The form rejects the same company in both slots client-side with the API's wording, and still
surfaces the server 400 if it slips through.

`purchase-orders/page.tsx`, `[id]/page.tsx`, `[id]/edit-form.tsx`, `actions.ts`: read
`clientCompany`/`factoryCompany`; column headers become **Client** and **Factory**.

- [ ] **Step 5: Repoint the integration fixture**

In `support.ts`, `createWorkspace` now posts the PO with
`clientCompanyId: client.id, factoryCompanyId: factory.id`, and `WorkspaceFixture` drops `buyerId` /
`supplierId` in favour of `clientCompanyId` / `factoryCompanyId`. Fix every spec the compiler then flags
(`core-loop`, `meeting-batch1`, `admin-org-assumption`, `dashboard-kpi`, `aql-config`).

- [ ] **Step 6: Run the tests to verify they pass**

```
pnpm --filter @inspect/api exec jest --config ./test/jest-e2e.json test/integration/company-model.e2e-spec.ts --runInBand --forceExit
pnpm api test:integration
```

Expected: the two new cases PASS; the whole suite green.

- [ ] **Step 7: Full verification**

```
pnpm lint && pnpm type-check && pnpm test && pnpm build
```

- [ ] **Step 8: Commit**

```bash
git commit -am "feat(api,web): PurchaseOrder carries client + factory companies (INS-055)"
```

---

## Task 5: `Inspection` becomes explicitly two-party

**Files:**
- Modify: `apps/api/src/inspections/inspections.service.ts` (`:97`, `:117-118`, `:130-131`, `:242-243`)
- Modify: `apps/api/src/populate/populate.service.ts:621-622`
- Modify: `apps/api/src/search/search.service.ts` (the inspection query's `buyer` leg)
- Modify: `apps/web/lib/api.ts` (`ApiInspection`), `apps/web/app/(console)/inspections/**`
- Test: `apps/api/test/integration/core-loop.e2e-spec.ts` (assertions), `company-model.e2e-spec.ts`

**Interfaces:**
- Consumes: `PurchaseOrder.clientCompanyId` / `factoryCompanyId` (Task 4).
- Produces: `Inspection.clientCompanyId` (required in practice, denormalized from the PO) and
  `Inspection.factoryCompanyId` (optional). Inspection reads include `clientCompany` + `factoryCompany`.

- [ ] **Step 1: Write the failing test**

Add to `company-model.e2e-spec.ts`:

```ts
describe('inspection parties', () => {
  it('denormalizes both parties from the purchase order at create time', async () => {
    const tag = runTag('insp');
    const ws = await createWorkspace(client, org.ownerToken, tag);
    const insp = expect2xx(await client.post('/inspections', {
      token: org.ownerToken,
      body: { poId: ws.poId, loopPresetId: ws.presetId, lotSize: 500 },
    }), 'POST /inspections');

    const read = expect2xx(
      await client.get(`/inspections/${insp.id}`, { token: org.ownerToken }),
      'GET /inspections/:id',
    );
    expect(read.clientCompany?.id).toBe(ws.clientCompanyId);
    expect(read.factoryCompany?.id).toBe(ws.factoryCompanyId);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Expected: FAIL — `read.clientCompany` is `undefined`.

- [ ] **Step 3: Repoint the service**

`inspections.service.ts`:
- `create()` at `:242-243`: `clientCompanyId: po.clientCompanyId, factoryCompanyId: po.factoryCompanyId`
  (drop the legacy pair).
- `:117-118` and `:130-131`: `include: { clientCompany: true, factoryCompany: true, … }`.
- `:97`: the nested `buyer` select inside the list query becomes `clientCompany`.

`populate.service.ts:621-622`: `buyer: true, supplier: true` → `clientCompany: true, factoryCompany: true`
(and the read that consumes them).

`search.service.ts`: the inspection `OR` leg `{ buyer: { name: contains } }` becomes
`{ clientCompany: { name: contains } }`; the select and the sublabel follow.

- [ ] **Step 4: Repoint the console inspection screens**

`lib/api.ts`: `ApiInspection` carries
`clientCompany?: { id: string; name: string; primaryColor?: string | null } | null` and
`factoryCompany?: { id: string; name: string; gps?: { lat: number; lng: number } | null } | null`
(replacing the `buyer`/`supplier` members at `:386-387` and `:416-417`).

`inspections/page.tsx`, `new/create-form.tsx`, `[id]/review/page.tsx`,
`[id]/populate/populate-workspace.tsx`: read the new members; the PO picker shows
"Client → Factory" so the operator can see both parties before starting.

`inspections/[id]/report/page.tsx` is the console's live preview of an unsigned inspection: it reads
`inspection.clientCompany?.name` / `?.primaryColor` and `inspection.factoryCompany?.name` / `?.gps`.
(Its **signed** counterpart, which reads a snapshot, is Task 6.)

- [ ] **Step 5: Run the tests to verify they pass**

```
pnpm api test:integration
```

Expected: the new case PASSES; the full core loop (create → populate → submit → decide → report) stays
green on company FKs.

- [ ] **Step 6: Full verification, then commit**

```
pnpm lint && pnpm type-check && pnpm test && pnpm build
git commit -am "feat(api,web): Inspection carries client + factory companies (INS-055)"
```

---

## Task 6: `Report` — client FK, canonical **v2**, and both readers

The signature task. Read spec §5 before starting.

**Files:**
- Modify: `apps/api/src/reports/reports.service.ts` (`:103-104`, `:162-165`, `:226-252`, `:410-493`,
  `:548`, `:577`, `:618-640`), `reports.service.spec.ts`
- Modify: `apps/api/src/reports/report-pdf.ts` (`:53-54`, `:442`, `:631`), `report-pdf.spec.ts`
- Modify: `apps/api/src/mail/mail.service.ts` (+ `mail.service.spec.ts`, `mail-report.spec.ts`)
- Modify: `apps/web/lib/api.ts`, `apps/web/app/(console)/reports/page.tsx`,
  `apps/web/app/r/[token]/page.tsx`, `apps/web/components/inspect/branded-report.tsx`
- Test: `apps/api/test/integration/company-model.e2e-spec.ts` (verification cases)

**Interfaces:**
- Consumes: `canonicalVersionOf`, `photoHashesOf`, `readCanonicalParties` (Task 1);
  `Inspection.clientCompanyId` / `factoryCompanyId` (Task 5).
- Produces:
  - `Report.clientCompanyId` written at generate time; `Report.canonicalVersion = 2` on new reports.
  - The v2 canonical payload (spec §5.3): `canonicalVersion: 2`, `client: {companyId,name,kind}`,
    `factory: {companyId,name,kind} | null`, **every other key unchanged from v1, `photoHashes` still at
    the top level**. No `buyer`/`supplier` aliases — duplicating a fact inside a signed envelope doubles
    the surface where a later edit can desynchronize it.
  - `verifyByToken` response gains `canonicalVersion`.
  - `BrandedReportData.client` replaces `.buyer`; `meta.factory` replaces `meta.supplier`.

- [ ] **Step 1: Write the failing tests**

Add to `company-model.e2e-spec.ts`. The first case is the re-scoped replacement for the old plan's
"a report signed before the migration still verifies" gate: it **builds a v1 report itself** with the
same signing key the service uses, so the guarantee is proven repeatably instead of depending on rows
that `migrate reset` will delete.

```ts
describe('canonical payload versioning', () => {
  it('verifies a v1 report — the shape signed before INS-055 — as valid:true', async () => {
    const tag = runTag('v1');
    // Build a v1-shaped payload (buyer/supplier keys, no canonicalVersion),
    // hash + sign it exactly as the pre-INS-055 service did, and insert it.
    const snapshot = {
      inspectionId: 'legacy',
      buyer: { id: 'legacy_buyer', name: `Legacy Client ${tag}` },
      supplier: { id: 'legacy_supplier', name: `Legacy Factory ${tag}` },
      photoHashes: [] as string[],
    };
    const { verificationToken } = await insertLegacyV1Report(app, snapshot);

    const res = await client.get(`/reports/verify/${verificationToken}`);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.hashMatches).toBe(true);
    expect(res.body.signatureValid).toBe(true);
    expect(res.body.canonicalVersion).toBe(1);
  });

  it('signs new reports as v2 and verifies them as valid:true', async () => {
    const tag = runTag('v2');
    const ws = await createWorkspace(client, org.ownerToken, tag);
    const report = await generateApprovedReport(client, org, ws); // helper in support.ts

    const res = await client.get(`/reports/verify/${report.verificationToken}`);
    expect(res.body.valid).toBe(true);
    expect(res.body.canonicalVersion).toBe(2);

    const snap = report.canonicalSnapshot as any;
    expect(snap.canonicalVersion).toBe(2);
    expect(snap.client.companyId).toBe(ws.clientCompanyId);
    expect(snap.factory.companyId).toBe(ws.factoryCompanyId);
    // No aliases inside a signed envelope (spec §5.3).
    expect(snap.buyer).toBeUndefined();
    expect(snap.supplier).toBeUndefined();
    // The verifier's only shape dependency must not move.
    expect(Array.isArray(snap.photoHashes)).toBe(true);
  });
});
```

Add `insertLegacyV1Report` to `test/integration/support.ts`: it reads
`REPORT_SIGNING_PRIVATE_KEY_PEM` from config, computes
`contentHash(canonical, photoHashesOf(canonical))` with the repo's own helpers, signs it, and inserts a
`reports` row via `PrismaService` with `canonicalVersion` left at its `1` default. Add
`generateApprovedReport(client, org, ws)` too — it runs the existing core-loop steps (create → populate
one cycle → submit → approve → `POST /reports`) and returns the report, so later specs stop repeating
them.

- [ ] **Step 2: Run them and confirm both fail**

Expected: case 1 fails on `canonicalVersion` being absent from the response; case 2 fails because the
payload still has `buyer`/`supplier` keys.

- [ ] **Step 3: Build the v2 payload in `reports.service.ts`**

At `:103-104` include `clientCompany: true, factoryCompany: true` instead of `buyer` + `supplier`.
Replace the party keys at `:162-165`:

```ts
const rawCanonical = {
  // Version marker INSIDE the payload: hashed and signed, so it is
  // tamper-evident and cannot be spoofed by editing the mirrored column.
  canonicalVersion: 2 as const,
  inspectionId: inspection.id,
  inspectionType: inspection.inspectionType,
  poNumber: inspection.purchaseOrder?.poNumber ?? null,
  client: {
    companyId: inspection.clientCompanyId,
    name: inspection.clientCompany?.name ?? null,
    kind: inspection.clientCompany?.kind ?? null,
  },
  factory: inspection.factoryCompanyId
    ? {
        companyId: inspection.factoryCompanyId,
        name: inspection.factoryCompany?.name ?? null,
        kind: inspection.factoryCompany?.kind ?? null,
      }
    : null,
  // …every other key unchanged, INCLUDING photoHashes at the top level.
};
```

Leave `:231`'s JSON round-trip, `:233`'s `contentHash` and `:234`'s `sign` **exactly as they are**.
The branding source at `:236-238` becomes `inspection.clientCompany?.…`. The `report.create` at
`:247-252` writes `clientCompanyId: inspection.clientCompanyId` and `canonicalVersion: 2`, and stops
writing `buyerId`.

- [ ] **Step 4: Make the verifier version-aware without adding a version branch to the hash**

In `verifyByToken`, replace the inline snapshot cast with the shared readers and report the version:

```ts
const recomputed = contentHash(
  report.canonicalSnapshot,
  photoHashesOf(report.canonicalSnapshot),
);
// …unchanged hash + signature comparison…
return {
  valid: hashMatches && signatureValid,
  hashMatches,
  signatureValid,
  canonicalVersion: canonicalVersionOf(report.canonicalSnapshot),
  reportId: report.id,
  inspectionId: report.inspectionId,
  generatedAt: report.generatedAt,
};
```

The hash and signature check stays a byte-exact recompute over the stored snapshot with **no** version
branch — that is what makes v1 rows keep verifying (spec §5.4).

- [ ] **Step 5: Repoint the remaining report reads**

- `list()` (`:548`, `:577`): search leg `buyer.name` → `clientCompany.name`; select
  `clientCompany: { select: { id: true, name: true } }`.
- `deliver()` (`:410`, `:423-426`, `:471`, `:493`): include `clientCompany`; eligible guests are read
  from `companyGuest` **in Task 7** — for now keep the existing `buyerGuest` query so this task stays
  green, and leave a one-line `// INS-055 Task 7: switch to companyGuest` marker.
- `report-pdf.ts`: `ReportSnapshotInput` (`:53-54`) gains `client`/`factory` and keeps `buyer`/`supplier`
  optional, and the renderer resolves parties through `readCanonicalParties(snap)` so a v1 and a v2
  report render identically. `:442` `buyerName` → `clientName`; `:631`'s `['Supplier', …]` row label
  becomes `['Factory', …]` reading `parties.factory?.name`. Update `report-pdf.spec.ts` and add one case
  asserting a v1 snapshot and a v2 snapshot produce the same header and party rows.
- `mail.service.ts`: `BuyerGuestMagicLinkMail` → `CompanyGuestMagicLinkMail`,
  `sendBuyerGuestMagicLink` → `sendCompanyGuestMagicLink`, `buyerName` → `companyName` on both mail
  inputs. The human-facing copy keeps its wording.

- [ ] **Step 6: Repoint the console report readers through `readCanonicalParties`**

This is spec §5.5's rule: the "if v1 read `buyer` else read `client`" logic exists **once**, in
`shared-types`, and never in a component.

- `portal/page.tsx:58-59`: `readCanonicalParties(first?.canonicalSnapshot).client.name ?? 'Client'`.
- `portal/portal-client.tsx:35,71`: `meta.factory` from `readCanonicalParties(snap).factory?.name ?? '—'`;
  the `buyer` prop threaded through the component becomes `client`.
- `components/inspect/branded-report.tsx`: `BrandedReportData.buyer` → `.client`,
  `meta.supplier`/`meta.supplierLoc` → `meta.factory`/`meta.factoryLoc`. Update both callers
  (`inspections/[id]/report/page.tsx`, `portal-client.tsx`).
- `app/r/[token]/page.tsx`: render the `canonicalVersion` the verify response now returns, so someone
  checking a signature can see which shape they read.
- `reports/page.tsx`: the Buyer column becomes Client, reading `r.clientCompany?.name`; the search
  placeholder becomes "Search PO or client…".

- [ ] **Step 7: Run the tests to verify they pass**

```
pnpm --filter @inspect/shared-types build
pnpm test
pnpm api test:integration
```

Expected: both new cases PASS. The existing tamper-evidence spec (mutate the stored canonical → public
verify flips to `valid:false`) must still pass **unchanged** — if it needed editing, something rewrote a
snapshot.

- [ ] **Step 8: Prove no migration or code path rewrites a signed report**

```
grep -rn 'UPDATE "reports"' apps/api/prisma/migrations
grep -rn 'canonicalSnapshot:' apps/api/src --include=*.ts | grep -v 'spec.ts'
```

Expected: the first prints nothing. The second shows `canonicalSnapshot` written **only** inside
`reports.service.ts`'s `report.create`, never in an `update`.

- [ ] **Step 9: Full verification, then commit**

```
pnpm lint && pnpm type-check && pnpm build
git commit -am "feat(api,web): Report client company + canonical v2, v1 still verifies (INS-055)"
```

---

## Task 7: `CompanyGuest` and the guest portal — the security task

**Read spec §4.2 first.** A mistake here is a cross-counterparty data leak.

**Files:**
- Create: `apps/api/src/company-guests/company-guests.{module,service,controller}.ts`, `.service.spec.ts`
- Modify: `apps/api/src/guest/guest.service.ts` (all three call sites),
  `apps/api/src/reports/reports.service.ts` (`deliver()`'s guest query), `app.module.ts`
- Create: `apps/web/app/(console)/companies/[id]/guests/{page.tsx,actions.ts,guests-client.tsx}`
- Delete: `apps/web/app/(console)/buyers/[id]/guests/**`
- Test: `apps/api/test/integration/company-model.e2e-spec.ts` (the named boundary tests)

**Interfaces:**
- Consumes: `Report.clientCompanyId` (Task 6) — the predicate is meaningless until reports carry it.
- Produces: `GET/POST /companies/:companyId/guests`, `DELETE /company-guests/:id`
  (floor `@Roles('QA_MANAGER')`, as today); `CompanyGuestDto`.

- [ ] **Step 1: Write the failing security tests**

Add to `company-model.e2e-spec.ts`. The first is the test spec §9 names explicitly.

```ts
describe('guest visibility boundary (spec §4.2)', () => {
  it('a factory-role guest sees no reports', async () => {
    const tag = runTag('factory-guest');
    const ws = await createWorkspace(client, org.ownerToken, tag);
    const report = await generateApprovedReport(client, org, ws);

    // Invite a guest of the FACTORY company — the party that made the goods.
    const invited = expect2xx(await client.post(
      `/companies/${ws.factoryCompanyId}/guests`,
      { token: org.ownerToken, body: { email: `factory-${tag}@example.com` } },
    ), 'POST /companies/:id/guests (factory)');

    const list = await client.get(`/guest/reports?token=${invited.token}`);
    expect(list.status).toBe(200);
    expect(list.body).toEqual([]);          // zero — not "the client's report"

    const direct = await client.get(
      `/guest/reports/${report.id}?token=${invited.token}`,
    );
    expect(direct.status).toBe(404);
  });

  it('a client-role guest sees exactly that company\'s reports', async () => {
    const tag = runTag('client-guest');
    const ws = await createWorkspace(client, org.ownerToken, tag);
    const report = await generateApprovedReport(client, org, ws);
    const invited = expect2xx(await client.post(
      `/companies/${ws.clientCompanyId}/guests`,
      { token: org.ownerToken, body: { email: `client-${tag}@example.com` } },
    ), 'POST /companies/:id/guests (client)');

    const list = expect2xx(
      await client.get(`/guest/reports?token=${invited.token}`),
      'GET /guest/reports',
    );
    expect(list.map((r: any) => r.id)).toEqual([report.id]);
  });

  it('a guest of one org sees none of another org\'s reports', async () => {
    const tag = runTag('xorg-guest');
    const other = await createOrgWithOwner(client, adminToken, `${tag}-other`);
    const otherWs = await createWorkspace(client, other.ownerToken, `${tag}-o`);
    await generateApprovedReport(client, other, otherWs);

    const ws = await createWorkspace(client, org.ownerToken, tag);
    const invited = expect2xx(await client.post(
      `/companies/${ws.clientCompanyId}/guests`,
      { token: org.ownerToken, body: { email: `xorg-${tag}@example.com` } },
    ), 'POST /companies/:id/guests');

    const list = expect2xx(
      await client.get(`/guest/reports?token=${invited.token}`),
      'GET /guest/reports',
    );
    expect(list).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Expected: FAIL — `POST /companies/:id/guests` 404s (the route does not exist yet).

- [ ] **Step 3: Write the `company-guests` module**

Port `buyer-guests.service.ts` verbatim with `prisma.buyerGuest` → `prisma.companyGuest`,
`buyerId` → `companyId`, the upsert key `buyerId_email` → `companyId_email`, the parent lookup
`prisma.buyer` → `prisma.company` (message: `Company not found`), audit actions
`companyGuest.invited` / `companyGuest.revoked` with `entityType: 'CompanyGuest'`, and
`mail.sendCompanyGuestMagicLink({ to, token, companyName: company.name })`. `SAFE_SELECT` is unchanged —
the token is still never selected into a list response.

Controller: `GET/POST 'companies/:companyId/guests'`, `DELETE 'company-guests/:id'`, class floor
`@Roles('QA_MANAGER')`. Register `CompanyGuestsModule` in `app.module.ts`.

Port `buyer-guests.service.spec.ts` to `company-guests.service.spec.ts`, keeping the case that asserts
the audit row does **not** contain the token.

- [ ] **Step 4: Repoint `guest.service.ts` — the predicate itself**

`guestByToken` reads `prisma.companyGuest.findUnique({ where: { token } })`; `lastAccessAt` updates the
same table. Then, at **all three** call sites:

```ts
// listReports
where: { clientCompanyId: guest.companyId, orgId: guest.orgId }
// getReport
where: { id: reportId, clientCompanyId: guest.companyId, orgId: guest.orgId }
// downloadReportPdf
where: { id: reportId, clientCompanyId: guest.companyId, orgId: guest.orgId }
```

Three rules the implementation must not violate:
1. **Keep the `orgId` conjunct.** It is the tenant boundary, not belt-and-braces. Never "simplify" to
   `clientCompanyId` alone — that would rest entirely on company ids being unguessable.
2. **Key on `clientCompanyId` only.** An `OR: [{ clientCompanyId }, { factoryCompanyId }]` reads like a
   natural generalization now that one model plays both roles, and it is exactly the leak the first test
   above exists to catch.
3. **Leave the photo query's reachability alone.** `guest.service.ts`'s photo fetch has no `orgId`
   filter and is safe *only* because it is reached through an already-scoped report lookup. Keep that
   ordering: scoped report first, photos second, never photos from a caller-supplied id.

`recordAccess` writes `companyGuestId` instead of `buyerGuestId`.

`reports.service.ts` `deliver()`: replace the marked `buyerGuest.findMany` with
`companyGuest.findMany({ where: { orgId: report.orgId, companyId: report.clientCompanyId, status: 'ACTIVE', token: { not: null } } })`,
and the delivery audit metadata follows.

- [ ] **Step 5: Repoint the console guests screen**

Move `buyers/[id]/guests/**` to `companies/[id]/guests/**`: `apiGet` `/companies/${id}/guests`,
`apiPost` the invite, `apiDelete` `/company-guests/${id}`. `lib/api.ts` exports
`type ApiCompanyGuest = CompanyGuestDto`. Copy on the page states that guests see reports where this
company is the **client**, so the boundary is visible in the product, not only in the code. Delete the
old subtree and update the `RowMenu` link added in Task 3.

- [ ] **Step 6: Run the tests to verify they pass**

```
pnpm api test:integration
```

Expected: all three boundary cases PASS.

- [ ] **Step 7: Prove the leak predicate is absent from the tree**

```
grep -rn "factoryCompanyId" apps/api/src/guest apps/api/src/reports | grep -i "OR"
```

Expected: no output. If this ever prints, a guest query has been widened to a party-agnostic predicate.

- [ ] **Step 8: Full verification, then commit**

```
pnpm lint && pnpm type-check && pnpm test && pnpm build
git commit -am "feat(api,web): CompanyGuest + client-only guest visibility (INS-055)"
```

---

## Task 8: migration B — drop the legacy model

Irreversible. Nothing may import `Buyer`, `Supplier` or `BuyerGuest` before this starts.

**Files:**
- Create: `apps/api/prisma/migrations/20260827000000_drop_buyer_supplier/migration.sql`
- Modify: `apps/api/prisma/schema.prisma` (delete three models, tighten the FKs)
- Delete: `apps/api/src/buyers/`, `apps/api/src/suppliers/`, `apps/api/src/buyer-guests/`;
  their registrations in `app.module.ts`
- Modify: `packages/shared-types/src/dtos.ts` (delete `BuyerDto`, `SupplierDto`, `BuyerGuestDto`)
- Modify: `apps/web/lib/api.ts` (delete `ApiBuyer`, `ApiSupplier`, `ApiBuyerGuest`)
- Modify: `apps/api/openapi.json` (regenerated, not hand-edited)

- [ ] **Step 1: Prove nothing references the legacy model**

```
grep -rn "prisma\.buyer\|prisma\.supplier\|prisma\.buyerGuest" apps/api/src
grep -rln "ApiBuyer\|ApiSupplier\|ApiBuyerGuest" apps/web --include=*.ts --include=*.tsx | grep -v node_modules | grep -v '\.next'
```

Expected: both print nothing. Anything they find belongs to Tasks 3–7 — go back and finish it. Do not
proceed with a live reference.

- [ ] **Step 2: Edit the schema to its final shape**

- Delete the `Buyer`, `BuyerGuest` and `Supplier` models and the `Organization` back-relations
  `buyers`, `buyerGuests`, `suppliers`.
- Delete `LoopPreset.defaultForBuyers` and the `"BuyerDefaultPreset"` relation.
- Delete `PurchaseOrder.buyerId` / `supplierId` / `buyer` / `supplier` and their indexes;
  `Inspection.buyerId` / `supplierId` / `buyer` / `supplier`; `Report.buyerId` / `buyer`;
  `ReportAccess.buyerGuestId` / `buyerGuest`.
- Make required: `PurchaseOrder.clientCompanyId` and `factoryCompanyId`,
  `Inspection.clientCompanyId`, `Report.clientCompanyId` (all `String`, `Restrict`).
  `Inspection.factoryCompanyId` **stays optional** with `SetNull` — that is the deletion policy carried
  over from `inspect-schema.md §2` and it mirrors `supplierId` today.
- Update the `@@index` lists to drop `buyerId` / `supplierId`.

- [ ] **Step 3: Author and hand-complete the migration**

```
pnpm --filter @inspect/api exec prisma migrate dev --create-only --name drop_buyer_supplier
```

Rename the directory to `20260827000000_drop_buyer_supplier`. Prisma will emit the drops and the
`SET NOT NULL`s. **Append by hand** the business-key index, which cannot be expressed in
`schema.prisma` (spec §6.6):

```sql
-- INS-055 spec §6.6 / P5: company names are unique per org, case- and
-- whitespace-insensitively, among ACTIVE rows only — archiving a company frees
-- its name. Follows the schema's existing partial-index practice.
CREATE UNIQUE INDEX "companies_org_name_ci_active_key"
  ON "companies" ("orgId", lower(btrim("name")))
  WHERE "archivedAt" IS NULL;
```

- [ ] **Step 4: Review the SQL, then apply by reset**

```
grep -n 'UPDATE "reports"' apps/api/prisma/migrations/20260827000000_drop_buyer_supplier/migration.sql
```

Expected: nothing. Then, because the `SET NOT NULL`s only hold on an empty table and the dev database is
disposable by policy:

```
pnpm --filter @inspect/api exec prisma migrate reset --force
pnpm --filter @inspect/api exec prisma db seed
pnpm --filter @inspect/api exec prisma generate
```

Expected: all seven migrations replay from scratch, the 14-defect global library seeds, and the
bootstrap admin converges to `BOOTSTRAP_ADMIN_*`. **If login 401s afterwards, re-seed — that is by
design, not a bug.**

- [ ] **Step 5: Delete the legacy code and DTOs**

Remove the three API module directories and their `app.module.ts` registrations; remove `BuyerDto`,
`SupplierDto` and `BuyerGuestDto` from `shared-types/src/dtos.ts` and the `ApiBuyer` / `ApiSupplier` /
`ApiBuyerGuest` aliases from `apps/web/lib/api.ts`.

- [ ] **Step 6: Regenerate the OpenAPI contract**

```
pnpm --filter @inspect/api openapi:generate
git diff --stat apps/api/openapi.json
```

Expected: `/buyers*`, `/suppliers*` and `/buyer-guests*` gone; `/companies*` and `/company-guests*`
present, each carrying its role floor. This is a CI gate — a stale `openapi.json` fails the build. Note
the generator boots the real Nest container, so `DATABASE_URL` + `REDIS_URL` must be live.

- [ ] **Step 7: Prove the vocabulary is gone**

```
grep -rn "buyerId\|supplierId\|BuyerGuest\|prisma\.buyer\|prisma\.supplier" apps/api/src apps/api/prisma/schema.prisma packages/shared-types/src
grep -rn "ApiBuyer\|ApiSupplier\|/buyers\|/suppliers" apps/web --include=*.ts --include=*.tsx | grep -v node_modules | grep -v '\.next'
```

Expected: no output from either. Prose that says "buyer" in user-facing copy about *the client's* report
is fine and should be reviewed for meaning, not blindly renamed — but no identifier, route or column may
survive.

- [ ] **Step 8: Full verification against the reset database**

```
pnpm --filter @inspect/shared-types build
pnpm lint
pnpm type-check
pnpm test
pnpm api test:integration
pnpm build
```

Expected: everything green, integration exit 0, with the guest-boundary and canonical-version cases
included. Record the exact counts — they go into STATUS in Task 9.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(api): drop Buyer/Supplier/BuyerGuest; Company is the only counterparty (INS-055)"
```

---

## Task 9: documentation close-out

**Files:**
- Modify: `docs/STATUS.md`, `docs/future/BACKLOG.md`, `docs/reference/inspect-schema.md`,
  `CLAUDE.md`, `apps/api/CLAUDE.md`, `docs/reference/screen-migration-map.md`
- Move: this plan and its spec from `docs/in-progress/` to `docs/done/` (keep the dated stems)

- [ ] **Step 1: Update the schema reference**

`docs/reference/inspect-schema.md`: replace the Buyer/Supplier/BuyerGuest entries with `Company`,
`CompanyGuest` and `CompanyKind`; record that trade role lives on the edge; record the partial
CI unique index beside the two the init migration already ships; record `Report.canonicalVersion` as an
**unsigned mirror** whose authority is the payload marker. Model count goes from 25 to **24**
(three models out, two in).

- [ ] **Step 2: Update `CLAUDE.md` (root) and `apps/api/CLAUDE.md`**

Root: the "Loop shape" and "Snapshots" invariants are unchanged, but the domain-invariants list gains
one line — *"**Trade role is a property of the edge:** `clientCompanyId` / `factoryCompanyId` on
PO/Inspection/Report. Never put a role on `Company`. Guest report visibility keys on `clientCompanyId`
**and** `orgId`, never a party-agnostic predicate."* — and the schema line becomes 24 models. Leave the
⚠️ TEMPORARY pre-production block exactly where it is; it is not this task's to remove.

`apps/api/CLAUDE.md`: the feature-module list drops `buyers`, `suppliers`, `buyer-guests` and gains
`companies`, `company-guests`.

- [ ] **Step 3: Flip the backlog item**

`INS-055` → `status: done` with a dated `done:` line recording: the re-scope actually taken; the two
migrations; that P1–P8 were honoured with no override; that canonical **v2** ships while v1 still
verifies (proven by a self-built fixture, not by surviving rows); the named factory-guest regression
test; and the final measured counts. Note in `INS-086` that Phase 0's last code item is closed and
Phase 1 (extraction into `@inspect/{api-client,domain,design-tokens}`) is now unblocked — the contract
being frozen is the Company one.

- [ ] **Step 4: Update STATUS.md**

Bump **Last verified**, add a summary entry for this session, replace the "NEXT SESSION STARTS HERE —
INS-055" block with the RN Phase 1 entry point, and update the Data-model and Tamper-proof pillar rows.
Record the counts measured in Task 8 Step 8 — **measured, not copied**.

- [ ] **Step 5: Move the spec and plan to `docs/done/`**

```bash
git mv docs/in-progress/specs/2026-08-01-inspect-company-model-design.md docs/done/specs/
git mv docs/in-progress/plans/2026-08-01-inspect-company-model.md docs/done/plans/
```

Then fix the relative links inside both files (they gain a directory level) and the links that pointed
at them from STATUS, BACKLOG and the RN spec.

- [ ] **Step 6: Verify the docs agree with the code**

Re-read STATUS and BACKLOG against the tree: every `INS-NNN` referenced resolves, every count matches
what Task 8 measured, and no document still describes a `Buyer` table. Check that every relative link in
the two moved files resolves from its new location.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs: close INS-055 — Company model shipped, RN Phase 1 unblocked"
```

---

## Notes for the implementer

- **The `_count` flattening in Task 3 is load-bearing.** `Company` has four PO/inspection relations
  (client and factory sides) but the wire DTO keeps two numbers. Flatten in the service, not the
  component, or the console and a future mobile client will each invent their own arithmetic.
- **`Inspection.factoryCompanyId` is optional on purpose.** It mirrors `supplierId` today and its
  `SetNull` policy. Do not "tidy" it to required in Task 8.
- **`Report` gets no `factoryCompanyId`.** The factory identity that matters legally is frozen inside the
  signed snapshot; a live FK for it would be a second, mutable source of truth for a fact the signature
  already covers (spec §2.2).
- **If a test needs the signing key**, it is `REPORT_SIGNING_PRIVATE_KEY_PEM` from the repo-root `.env`
  — the same one the service reads. A test that mints its own key proves nothing about the deployed
  verifier.
- **Two canonical shapes exist forever.** `readCanonicalParties` and its spec are permanent code, not
  migration scaffolding. Do not delete them once the dev database has no v1 rows — the requirement is
  about the format.
- **Nothing re-renders a historical PDF** (spec §0 P8). Reports are immutable artifacts: the stored bytes
  and the stored snapshot are frozen. `ensurePdf()` still backfills a *missing* rendition — that is the
  existing INS-003 behaviour and is not a re-render. Do not add a party-relabelling pass over old PDFs.
- **Spec §9's "no test runner exists on the web side" is stale.** `apps/web` has had Vitest since
  [INS-082](../../future/BACKLOG.md) (32 tests, run by root `pnpm test`). `lib/api.test.ts` and
  `lib/roles.test.ts` do not assert on buyers or suppliers, so they should pass untouched — if one goes
  red, a repoint changed `loadOrFallback`'s branch table or the role gate, which is a real regression,
  not a test to update.
- **Spec §9's "company merge planner (pure)" unit test does not apply.** It belonged to the deleted
  dedupe phase.
- **The pre-production policy block in the root `CLAUDE.md` is temporary.** This plan leans on it hard.
  If it has been removed by the time you read this, stop: migration B is no longer safe as written.
