# Inspect — Unified Company Model — Design

> **Status:** 🟡 Designed 2026-08-01, **not approved** — §0 lists the decisions that need a human product
> call before Phase 1 may start. No migration is authored by this document.
> Backlog: **[INS-055](../../future/BACKLOG.md)** (this effort). Sequenced **after**
> [INS-008](../../future/BACKLOG.md) (see §8). Plan: `../plans/2026-08-01-inspect-company-model.md`.
> Schema rationale + invariants: [../../reference/inspect-schema.md](../../reference/inspect-schema.md).
> Origin: product meeting 2026-07-17 (same batch as
> [../../done/specs/2026-07-18-inspect-meeting-batch-1-design.md](../../done/specs/2026-07-18-inspect-meeting-batch-1-design.md)).

**Goal:** retire the `Buyer`/`Supplier` split for a single org-scoped `Company` model, so that every
counterparty is one row that can act in either trade role, without weakening tenant isolation, guest
report visibility, or the Ed25519-signed artifact — and without ever invalidating a report that was
signed before the migration.

**Non-goals:** a company hierarchy (parent/subsidiary/site tree); cross-org company identity (a global
company registry shared between tenants — companies stay strictly `orgId`-scoped); contacts/CRM fields on
`Company`; changing `Product` or `PurchaseOrder` semantics beyond the two party FKs; changing the AQL
engine, the audit chain, or the role hierarchy; a PDF re-render of historical reports.

---

## 0. Decisions that need a human product call

This epic is deliberately left unimplemented until these are confirmed. Each row has a **recommended
default** — the human only has to confirm or override. The plan's Phase 0 gate is "every row below is
confirmed in writing."

| # | Question | Recommended default | Cost of overriding |
|---|---|---|---|
| **P1** | Two role FKs (`clientCompanyId` + `factoryCompanyId`) on PO/Inspection/Report, or the meeting's literal "one company attached"? | **Two role FKs** (§2). The meeting's framing describes *what a company is*, not *how many parties a PO has*. | Overriding to a single FK breaks 5 things listed in §2.3, one of which (guest visibility) is a data leak. Not recommended at any price. |
| **P2** | Does `Company.kind` stay a 2-value enum `INTERNAL \| THIRD_PARTY`? | **Yes**, exactly as the backlog states. `kind` is *ownership* (is this our own facility?), orthogonal to trade *role*. | A third value later is an additive enum change — cheap. Deciding now costs nothing. |
| **P3** | Add capability flags (`canBeClient` / `canBeFactory`) to constrain the PO party pickers? | **No flags.** Role is a property of the edge, not the row; flags re-encode the split we are removing. Rank the picker by "recently used in this role" instead. | Adding flags later is additive. Adding them now risks re-creating Buyer/Supplier under new names. |
| **P4** | Same-name collision policy at dedupe time (§6) — merge, or keep both? | **Keep both**, disambiguating the factory-derived row as `"<name> (factory)"`. Field sets are disjoint, so nothing is lost; a wrong merge is not cheaply reversible, a wrong split is one click. | Overriding to auto-merge is faster but fuses two counterparty identities permanently and changes who future reports are visible to. |
| **P5** | Is company-name uniqueness case-**in**sensitive after the migration? | **Yes** — partial unique on `(orgId, lower(name)) WHERE archived_at IS NULL`. | Today `@@unique([orgId, name])` is case-sensitive and covers archived rows, so "Acme"/"ACME" both exist legally. Tightening will surface collisions at dedupe; that is the point. Keeping today's behavior is also fine, but then say so — the dedupe query must match. |
| **P6** | Keep `defaultLoopPresetId` at all? | **Keep and move it** to `Company`. | It is currently **write-only decoration** — set by the console (`dashboard/actions.ts:17,35`) but never read by any API code path (`inspections.service.ts:124` requires an explicit `loopPresetId`). Deleting it is defensible; moving it is one column and preserves the intent. |
| **P7** | Does the guest portal ever show a **factory-side** guest anything? | **No.** Guests remain client-side only. | This is the security boundary in §5. A "factory portal" is a separate epic with its own visibility model — never a widened predicate on the existing one. |
| **P8** | Do we re-render historical report PDFs with the new party labels? | **No.** Reports are immutable artifacts; the stored bytes and the stored snapshot are frozen forever. | Re-rendering would break the immutability doctrine and gains nothing — the signature covers the snapshot, not the labels. |

---

## 1. Problem

The split is structural at every layer, not cosmetic.

**Schema** ([`prisma/schema.prisma`](../../../apps/api/prisma/schema.prisma)):

| Where | Line | What it encodes |
|---|---|---|
| `Buyer` | 247–271 | `logoUrl`, `primaryColor`, `branding`, `defaultLoopPresetId`, and the `guests` / `reports` back-relations |
| `Supplier` | 297–315 | `address`, `gps` — a **disjoint** field set from `Buyer` |
| `BuyerGuest` | 275–294 | `buyerId` + `@@unique([buyerId, email])` + the unique magic-link `token` |
| `PurchaseOrder` | 341–342 | `buyerId` **and** `supplierId`, both required |
| `Inspection` | 480–481 | denormalized required `buyerId` + optional `supplierId` |
| `Report` | 721, 739 | `buyerId` (required, `Restrict`) — the report is **buyer-owned** |
| `ReportAccess` | 768, 775 | `buyerGuestId` |

**Services.** `purchase-orders.service.ts:43-45,79-93` requires and org-validates both parties.
`inspections.service.ts:179-180` copies `po.buyerId`/`po.supplierId` onto the inspection.
`reports.service.ts:63-64` embeds **distinct `buyer` and `supplier` keys inside the signed canonical
payload**; `:124-128` derives `brandingSnapshot` from `inspection.buyer`.
`guest.service.ts:37,45` scopes guest report visibility by `buyerId` — a security boundary, not a filter.
`dashboard.service.ts:29-30` and `search.service.ts:21-27,62-65` present two parallel entity types.
`buyers.service.ts` and `suppliers.service.ts` are near-identical CRUD twins that have already drifted:
buyers carry `assertPresetInOrg` (`:98-107`), suppliers carry nothing equivalent.

**Web.** 30 non-generated files under `apps/web` reference buyer or supplier, including the directory
tabs (`dashboard/directory-client.tsx:205,236-242`), the command palette's typed routes
(`command-palette.tsx:36-37,42`), the middleware console-route list (`middleware.ts:24`), the nav label
`'Buyers & Suppliers'` (`shell.tsx:209`), and — importantly — two **snapshot readers**:
`portal/page.tsx:58-59` reads `canonicalSnapshot.buyer.name` and `portal-client.tsx:35,71` reads
`snap.supplier?.name`, with `branded-report.tsx:20,31-32` rendering both.

**Tests.** 112 buyer/supplier-matching lines (147 raw occurrences) across `apps/api/test/integration/` —
auth-rbac 46, admin-org-assumption 28, meeting-batch1 16, support 13, core-loop 9. (The backlog's "68"
predates the INS-079 suite; counted again 2026-08-01.)

A one-shot rename would put tenant isolation, immutability, and the signed-snapshot invariant at risk
**simultaneously**, across 25 models and both apps, with no intermediate state that is safe to ship.
Hence: additive, phased, one consumer group per phase.

---

## 2. Role model (backlog question **a**)

### 2.1 The core insight

**Trade role belongs to the edge, not to the row.** "Client" and "factory" describe how a company
participates in *one* purchase order or inspection — the same company can be a client on one PO and a
factory on another, and `Company` must be able to express that without duplicate rows. Any design that
puts the role *on the company* (a `role: BUYER | SUPPLIER` column, or capability flags used as the
authority) reintroduces exactly the split this epic removes.

`Company.kind` is a different axis. It answers *whose facility is this* — `INTERNAL` (the operating org's
own site or own brand) vs `THIRD_PARTY` (an external counterparty). That is the meeting's "internal or
third-party" framing, and it is **orthogonal** to role: an INTERNAL company is usually the factory but can
be the client on an internal-QC inspection.

### 2.2 Recommendation

Two role-typed FKs, named explicitly — never a single `companyId`:

| Model | Field | Required? | Prisma relation name | Mirrors today |
|---|---|---|---|---|
| `PurchaseOrder` | `clientCompanyId` | **required** | `"PurchaseOrderClient"` | `buyerId` (schema:341) |
| `PurchaseOrder` | `factoryCompanyId` | **required** | `"PurchaseOrderFactory"` | `supplierId` (schema:342) |
| `Inspection` | `clientCompanyId` | **required** | `"InspectionClient"` | `buyerId` (schema:480) |
| `Inspection` | `factoryCompanyId` | optional (`SetNull`) | `"InspectionFactory"` | `supplierId` (schema:481) |
| `Report` | `clientCompanyId` | **required** (`Restrict`) | `"ReportClient"` | `buyerId` (schema:721) |
| `CompanyGuest` | `companyId` | **required** (`Cascade`) | — | `BuyerGuest.buyerId` (schema:276) |

Prisma requires named relations when two FKs on one model target the same model, so the names above are
load-bearing, not decoration. Deletion policy is carried over verbatim from
[inspect-schema.md §2](../../reference/inspect-schema.md): `Restrict` on every reference to
immutable/historical data, `SetNull` on the optional factory edge, `Cascade` only for the guest child.

`Report` gets **no** `factoryCompanyId`. The factory identity that matters legally is already frozen
inside the signed canonical snapshot (§4); adding a live FK for it would create a second, mutable source
of truth for a fact the signature already covers.

Deliberately **not** added: `Company.role`, `Company.canBeClient`, `Company.canBeFactory` (P3).

### 2.3 What breaks with a single `companyId`

Five concrete failures, in descending severity:

1. **Guest visibility collapses into a data leak.** `guest.service.ts:37` filters reports by
   `buyerId: guest.buyerId`. With one FK there is no way to express "the client sees this report, the
   factory does not." Any implementation would have to match "the company appears on this report," which
   makes a factory's guest able to read the client's signed report. This is the single strongest argument
   and it is not recoverable by a policy layer — the schema has to be able to say it.
2. **The signed artifact loses the factory.** `reports.service.ts:63-64` puts `buyer` **and** `supplier`
   into the canonical payload. Which factory produced the lot is the most consequential fact on a
   pre-shipment report. Collapsing to one party would still verify `valid:true` — it would just be a
   materially weaker document, which is worse than an obvious break.
3. **`brandingSnapshot` has no subject.** `reports.service.ts:124-128` resolves branding from
   `inspection.buyer`. With one FK, "whose logo goes on this report" is unanswerable.
4. **`PurchaseOrder` stops being a trade document.** `purchase-orders.service.ts:43-45` rejects a PO
   missing either party, and `:79-93` org-validates both. A PO with one party is not a PO.
5. **The console loses its information architecture.** `search.service.ts:5,62-65` types hits as
   `buyer | supplier`; `directory-client.tsx:205` is a two-tab directory. With one FK the role could only
   be inferred by joining through POs — expensive and ambiguous for a company that plays both.

### 2.4 Self-dealing

Two FKs make `clientCompanyId === factoryCompanyId` *expressible*, which today is impossible. Recommend
an application-layer guard in `purchase-orders.service.ts` (`400 "client and factory must differ"`)
rather than a DB check constraint — consistent with how every other cross-field invariant in this
codebase is enforced (see [inspect-schema.md §6](../../reference/inspect-schema.md)) and easy to relax if
internal self-inspection turns out to be a real workflow.

---

## 3. Branding and `defaultLoopPresetId` (backlog question **b**)

### 3.1 Branding lives on `Company`, unconditionally

`logoUrl`, `primaryColor`, `branding: Json` move to `Company` verbatim. They are only *meaningful* when
the company acts as a client, but they describe the company's identity, not the edge, so storing them on
the row is correct and avoids a per-edge branding table nobody asked for. An `INTERNAL` company may carry
branding; nothing forbids it.

**The snapshot doctrine is untouched.** `Report.brandingSnapshot` stays a frozen JSON blob resolved at
generate time — `reports.service.ts:124-128` changes only its source expression
(`inspection.buyer` → `inspection.clientCompany`). No report ever reads a live company row, before or
after this epic. Historical `brandingSnapshot` values are never rewritten (see §4.1).

### 3.2 `defaultLoopPresetId` moves as-is, and is currently dead

`Buyer.defaultLoopPresetId` (schema:253, FK at :261 with `SetNull`) becomes
`Company.defaultLoopPresetId` with the same FK and the same `SetNull`. The tenant guard
`assertPresetInOrg` (`buyers.service.ts:98-107`) — which stops a caller pointing at another tenant's
preset, since the DB FK only checks existence — moves with it **unchanged**, and its two unit tests
(`buyers.service.spec.ts:60,84`) move with it too.

Worth stating plainly, because it changes how much care the move deserves: **nothing consumes this field
today.** The console writes it (`dashboard/actions.ts:17,20,35-38`, `buyers/[id]/edit-form.tsx:43`) and
`loop-presets.service.ts:38` counts `defaultForBuyers` for a badge, but `inspections.service.ts:124`
hard-requires an explicit `loopPresetId` and never falls back to a default. So the field is write-only
decoration. Moving it is cheap; deleting it is also defensible (P6).

The `LoopPreset.defaultForBuyers` back-relation (schema:384) is renamed `defaultForCompanies`, and the
`_count` select at `loop-presets.service.ts:38` plus its web consumer (`lib/api.ts:236`) follow.

---

## 4. Guests and the visibility boundary (backlog question **c**)

**This is the section where a mistake is a cross-tenant / cross-counterparty data leak. Treat every rule
here as load-bearing.**

### 4.1 Where the guest lives

`BuyerGuest` → `CompanyGuest`, `buyerId` → `companyId`, `@@unique([buyerId, email])` →
`@@unique([companyId, email])`, table `buyer_guests` → `company_guests`. `ReportAccess.buyerGuestId` →
`companyGuestId` (schema:768, 775). The denormalized `orgId` **stays**, with the same caveat it has today
([inspect-schema.md:92](../../reference/inspect-schema.md)): it is an index/RBAC aid, the authoritative
scope is the org-scoped parent, and the data-access layer must never trust it alone.

Guests attach to the company in its **client** role only (P7). There is no factory-side portal.

### 4.2 The exact predicate, preserved

Today (`guest.service.ts:30-40, 42-49`):

```ts
// listReports
where: { buyerId: guest.buyerId, orgId: guest.orgId }
// getReport
where: { id: reportId, buyerId: guest.buyerId, orgId: guest.orgId }
```

After:

```ts
// listReports
where: { clientCompanyId: guest.companyId, orgId: guest.orgId }
// getReport
where: { id: reportId, clientCompanyId: guest.companyId, orgId: guest.orgId }
```

Three rules the implementation must not violate:

1. **Keep the `orgId` conjunct.** It is not redundant belt-and-braces — it is the tenant boundary. A
   rewrite that "simplifies" to `clientCompanyId` alone relies entirely on company ids being
   unguessable. Both predicates, both call sites, always.
2. **Key on `clientCompanyId` only — never on a party-agnostic predicate.** A refactor to
   `OR: [{ clientCompanyId: c }, { factoryCompanyId: c }]` — which reads like a natural generalization
   once one model plays both roles — hands a factory's guest the client's signed report. That leak does
   not exist today and must not be introduced. This gets its own named regression test (§9).
3. **Leave the photo query's reachability alone.** `guest.service.ts:61-65` fetches photos by
   `inspectionId` with **no** `orgId` filter. That is safe today *only* because it is reached through an
   already-scoped report lookup. The repoint must keep that ordering: scoped report first, photos second,
   never photos from a caller-supplied id.

### 4.3 Live magic links must survive — do not re-issue tokens

`BuyerGuest.token` is `@unique` (schema:281) and is the credential already sitting in buyers' inboxes.
The migration must **rename the table in place**, preserving `id`, `token`, `tokenExpiresAt`,
`lastAccessAt`, and `status`:

```sql
ALTER TABLE "buyer_guests" RENAME TO "company_guests";
ALTER TABLE "company_guests" RENAME COLUMN "buyerId" TO "companyId";
```

**Prisma gotcha, and it is a real one:** changing `@@map` and a field name makes
`prisma migrate dev` autogenerate a `DROP TABLE` + `CREATE TABLE`, silently destroying every live guest
credential. The migration SQL for this step **must be hand-written as `RENAME`** and reviewed as such.
The same applies to `buyers`/`suppliers` → the final-phase drop (§7), and to `reports.buyerId` →
`clientCompanyId`.

The phase gate is exactly the backlog's: a magic link minted **before** the migration lists **exactly the
same report ids** after it.

---

## 5. Canonical-payload versioning (backlog question **d**)

### 5.1 What is actually true today

`reports.service.ts:59-116` builds the payload with `buyer: { id, name }` and `supplier: { id, name }`
keys; `:120` normalizes it through a JSON round-trip (so generate-time and verify-time bytes match);
`:122-123` hashes and signs; `:138` freezes it into `Report.canonicalSnapshot`.

`verifyByToken` (`:231-259`) recomputes
`contentHash(report.canonicalSnapshot, snapshot?.photoHashes ?? [])` and verifies the signature against
the stored `contentHash`. Crucially, `canonicalize` sorts keys recursively over *whatever JSON it is
given* (`canonicalize.ts`) — so **verification is already shape-agnostic for the payload body**. The one
and only shape dependency in the verifier is the top-level `photoHashes` key at `:246-247`.

That yields the whole strategy: historical reports keep verifying **iff** (1) nobody rewrites the stored
snapshot bytes, and (2) `photoHashes` stays at the top level under that exact key.

### 5.2 Hard rule

> **No migration in this epic may `UPDATE reports.canonical_snapshot`, `reports.content_hash`, or
> `reports.signature`. Ever. Not to "normalize", not to backfill a version key, not to add an alias.**

Any such statement invalidates the Ed25519 seal on a document a buyer may already hold. The final-phase
migration must be reviewed line-by-line for any `UPDATE` against `reports`. Adding a **new column** to
`reports` is fine — columns are outside the signed envelope.

### 5.3 The versioning scheme

**Version marker inside the payload, mirrored to an unsigned column for ops.**

1. New reports embed `canonicalVersion: 2` **inside** the payload. Inside means it is hashed and signed,
   so it is tamper-evident and cannot be spoofed by editing a side column. Pre-migration rows have no
   such key.
2. `Report.canonicalVersion Int @default(1)` is added as a **queryable, unsigned** column, for indexing
   and operational reporting only. It is **never** the dispatch authority. If the column and the payload
   key disagree, the payload wins and the mismatch is worth logging — it means someone edited the row.
3. Dispatch is a pure function in `@inspect/shared-types` (§8), unit-tested with no DB:

```ts
/** Absent marker ⇒ v1 (every report signed before INS-055). */
export function canonicalVersionOf(snapshot: unknown): 1 | 2 {
  const v = (snapshot as { canonicalVersion?: unknown } | null)?.canonicalVersion;
  return v === 2 ? 2 : 1;
}
```

4. **`photoHashes` does not move.** v2 keeps it at the top level under the same key, deliberately, so the
   verifier's only shape dependency is stable across versions. `photoHashesOf(snapshot)` is therefore
   version-independent; it exists as a named function anyway so the coupling is visible.
5. **v2 payload shape** — `buyer`/`supplier` are replaced, not aliased:

```jsonc
{
  "canonicalVersion": 2,
  "client":  { "companyId": "…", "name": "…", "kind": "THIRD_PARTY" },
  "factory": { "companyId": "…", "name": "…", "kind": "INTERNAL" },   // or null
  // …every other key unchanged from v1, including photoHashes at the top level
}
```

   No `buyer`/`supplier` aliases in v2. Duplicating the same fact under two keys inside a signed envelope
   doubles the surface where a future edit can desynchronize them, and a mismatch inside a signed
   document is far worse than a missing key.

### 5.4 How `verifyByToken` picks the shape

It mostly doesn't — and that is the point.

- The **hash + signature check stays a byte-exact recompute over the stored snapshot**, with no version
  branch. `contentHash(report.canonicalSnapshot, photoHashesOf(report.canonicalSnapshot))`, exactly as
  today.
- The version selects only (a) the `photoHashes` reader (currently identical for both versions, kept as a
  seam) and (b) the **presentation** mapping used by anything that wants to display parties.
- The response gains `canonicalVersion` so a verifier client can report which shape it read.

### 5.5 Presentation readers must handle both shapes forever

v1 rows are immutable and will exist for the life of the product. Three readers destructure the snapshot
for display: `portal/page.tsx:58-59` (`canonicalSnapshot.buyer.name`), `portal-client.tsx:28,35,65,71`
(`snap.supplier?.name`), and `branded-report.tsx:20,31-32`. Each must render a v1 and a v2 report
identically.

**Write that logic exactly once**, in `@inspect/shared-types`:

```ts
export interface CanonicalParties {
  client:  { companyId: string | null; name: string | null };
  factory: { companyId: string | null; name: string | null } | null;
}
/** Reads party identity from a canonical snapshot of either version. */
export function readCanonicalParties(snapshot: unknown): CanonicalParties;
```

Three implementations of "if v1 read `buyer` else read `client`" scattered across the console is exactly
the drift INS-008 exists to prevent — which is why INS-008 is a prerequisite, not a nicety (§8).

---

## 6. Dedupe (backlog question **e**)

### 6.1 Why Phase 1 must not carry `@@unique([orgId, name])`

`Buyer` and `Supplier` each have their own `@@unique([orgId, name])` (schema:268, 312), so one org may
legally hold a buyer *and* a supplier both named "Acme". The backlog mandates a **1:1** backfill — two
`Company` rows — which would violate a `@@unique([orgId, name])` on `Company` the moment it ran.

Therefore: **Phase 1 creates `Company` with `@@index([orgId, name])` only.** Uniqueness lands in the
dedupe phase, after collisions are resolved. Shipping a table without its business-key uniqueness is a
deliberate, time-boxed exception, and it is why dedupe is the very next phase.

### 6.2 Detection

Case-insensitive, because today's constraint is case- and whitespace-sensitive (`buyers.service.ts:65`
only `.trim()`s), so "Acme" and "ACME" are both legal today and are both collisions tomorrow (P5):

```sql
SELECT b."orgId", b.name AS buyer_name, s.name AS supplier_name, b.id AS buyer_id, s.id AS supplier_id
FROM buyers b
JOIN suppliers s
  ON s."orgId" = b."orgId"
 AND lower(btrim(s.name)) = lower(btrim(b.name))
ORDER BY b."orgId", b.name;
```

Archived rows are included in detection (they still hold names) but exempted from the final constraint —
see 6.4.

### 6.3 Resolution, per collision, human-chosen

| Mode | What happens | When |
|---|---|---|
| **KEEP BOTH** (default, P4) | Both `Company` rows survive; the factory-derived row is renamed `"<name> (factory)"`. | Default whenever nobody explicitly decides. |
| **MERGE** | One `Company` survives; both legacy rows point at it; the orphan `Company` is deleted. Branding comes from the buyer side, `address`/`gps` from the supplier side (**disjoint field sets — no field-level conflict**); `createdAt` takes the earlier, `name` keeps the buyer-side casing. | Only when a human confirms these are the same legal entity. |

**Why KEEP BOTH is the default.** The two field sets are disjoint, so keeping both loses nothing —
the cost is one extra directory row. A wrong merge, by contrast, permanently fuses two counterparty
identities: it is not cheaply reversible, and going forward every report issued to the merged company is
visible to guests inherited from *both* original rows. (To be precise about the blast radius: there is no
*retroactive* leak, because a `Supplier` row owns no reports today — `Report.buyerId` is the only
report-owning edge. The exposure is forward-looking. That is still a bad trade against a purely cosmetic
downside.) A wrong split, meanwhile, is fixed by merging later.

### 6.4 Ordering — dedupe runs before any consumer repoint

The backlog lists the dedupe step after the repoints. **Recommend moving it earlier — Phase 2, directly
after the backfill.** Reasoning: while only the two lineage columns (`buyers.companyId`,
`suppliers.companyId`) reference `Company`, a merge is a two-row update. Once `PurchaseOrder`,
`Inspection`, and `Report` carry `clientCompanyId`/`factoryCompanyId`, the same merge becomes a data
migration rewriting **historical inspection and report rows** — touching frozen history to fix a naming
question. Do it while it is cheap.

### 6.5 Auditability

Every merge appends one `AuditLog` row inside the same transaction (CLAUDE.md invariant), with
`action: 'company.merged'`, `entityType: 'Company'`, `entityId` = surviving id, and metadata carrying
both source ids and the mode. Actor type follows the existing convention: `SYSTEM` for the automated
backfill, `PLATFORM_ADMIN` for a human-triggered merge (precedent: `orgs.service.ts:63`,
`audit/actor-type.ts`). The merge tool must be idempotent — re-running it on an already-merged org is a
no-op that appends nothing.

### 6.6 The constraint that finally lands

Following the schema's existing partial-index practice
([inspect-schema.md §2](../../reference/inspect-schema.md); the init migration already ships two partial
uniques), added by hand in the migration because it cannot be expressed in `schema.prisma`:

```sql
CREATE UNIQUE INDEX "companies_org_name_ci_active_key"
  ON "companies" ("orgId", lower(btrim("name")))
  WHERE "archivedAt" IS NULL;
```

Archived rows are exempt, so archiving a company frees its name. That is a small, intentional change from
today's behavior — flagged as P5.

---

## 7. The `Company` model

Shape proposed for Phase 1 (lineage columns marked; they are dropped in the final phase):

```prisma
enum CompanyKind {
  INTERNAL
  THIRD_PARTY
}

/// A counterparty in one tenant. Trade role (client / factory) is a property of
/// the PurchaseOrder / Inspection / Report edge, NOT of this row — the same
/// company may be a client on one PO and the factory on another. `kind` is the
/// orthogonal ownership axis: our own facility vs an external party.
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

  // Migration lineage only — dropped in the final phase (INS-055).
  legacyBuyerId       String?     @unique
  legacySupplierId    String?     @unique

  createdByUserId     String?
  archivedAt          DateTime?
  createdAt           DateTime    @default(now())
  updatedAt           DateTime    @updatedAt

  organization      Organization @relation(fields: [orgId], references: [id], onDelete: Restrict)
  defaultLoopPreset LoopPreset?  @relation("CompanyDefaultPreset", fields: [defaultLoopPresetId], references: [id], onDelete: SetNull)

  guests           CompanyGuest[]
  poAsClient       PurchaseOrder[] @relation("PurchaseOrderClient")
  poAsFactory      PurchaseOrder[] @relation("PurchaseOrderFactory")
  inspAsClient     Inspection[]    @relation("InspectionClient")
  inspAsFactory    Inspection[]    @relation("InspectionFactory")
  reports          Report[]        @relation("ReportClient")

  // NOT @@unique([orgId, name]) in Phase 1 — see §6.1. The partial CI unique
  // lands in the dedupe phase.
  @@index([orgId])
  @@index([orgId, name])
  @@map("companies")
}
```

The legacy tables `buyers`, `buyer_guests`, and `suppliers` are dropped **only in the final phase**, and
`company_guests` arrives by `RENAME`, never by drop/create (§4.3).

---

## 8. Sequencing: INS-008 lands first (backlog question **f**)

**[INS-008](../../future/BACKLOG.md) — link `@inspect/shared-types` into both apps — is a hard
prerequisite for Phase 1**, for one reason: this epic introduces exactly the kind of contract that must
exist once.

Today the console redeclares its own DTOs independently of the API's: `apps/web/lib/api.ts:188-217`
defines `ApiBuyer` / `ApiSupplier` / `ApiBuyerGuest`, while `buyers.service.ts:7-20` and
`suppliers.service.ts:7-16` define `CreateBuyerInput` / `CreateSupplierInput`. Unifying the model while
that duplication stands means writing the `Company` DTO, the `CompanyKind` enum, and the canonical
v1/v2 reader **twice**, in two files that have already drifted once — and §5.5's `readCanonicalParties`
would end up reimplemented in three web components.

**INS-008 is being wired in this same overall effort.** As of 2026-08-01 the dependency edge already
exists — `apps/api/package.json:30` and `apps/web/package.json:14` both carry
`"@inspect/shared-types": "workspace:^"`. What remains is replacing the redeclared types with real
imports. Phase 0 of the plan gates on that being done.

What this epic then adds to the package:

- `src/enums.ts`: `COMPANY_KINDS = ['INTERNAL', 'THIRD_PARTY'] as const` + `CompanyKind`.
- `src/json-contracts.ts`: `CanonicalPayloadV1` / `CanonicalPayloadV2`, `canonicalVersionOf`,
  `photoHashesOf`, `readCanonicalParties` (§5.3, §5.5) — all pure, all unit-tested with no DB.
- Company DTOs (`CompanyDto`, `CreateCompanyInput`, `UpdateCompanyInput`) imported by both apps.

Note `GpsPoint` in `json-contracts.ts:16` is already documented as "stored on Supplier.gps" — that
comment moves to `Company.gps` with the field.

---

## 9. Testing

Per-phase verification conditions live in the plan. The cross-cutting suites:

### Unit (`pnpm api test`, no DB) — baseline 204 tests / 26 suites, must grow and stay green

- `canonicalVersionOf`: absent marker → 1; `2` → 2; a hostile value (`"2"`, `null`, `{}`) → 1.
- `photoHashesOf`: v1 and v2 snapshots both yield the top-level array; a missing key yields `[]`
  (matching today's `?? []` at `reports.service.ts:247`).
- `readCanonicalParties`: a v1 fixture (`buyer`/`supplier` keys) and a v2 fixture (`client`/`factory`)
  produce **identical** output; a v1 fixture with `supplier: {id: null, name: null}` yields
  `factory: null`.
- `assertPresetInOrg` moved to the companies service: both existing cases
  (`buyers.service.spec.ts:60,84`) still pass against `Company`.
- Company merge planner (pure): given a collision pair, produces the correct field-level merge (branding
  from client side, address/gps from factory side, earlier `createdAt`, buyer-side name casing).

### Integration (`pnpm api test:integration`, live Postgres+Redis)

- **Guest visibility (the §4.2 boundary).** A named test, `'a factory-role guest sees no reports'`:
  company C is the factory on an inspection that produced a report for client D; a guest of C lists **zero**
  reports and gets 404 on D's report id. This test must exist before the guest repoint ships.
- Cross-org: a guest of org A's company sees none of org B's reports (today's `orgId` conjunct).
- **Token survival.** Mint a guest token, run the rename migration, list reports with the *same* token →
  identical report id set.
- **Pre-migration report still verifies.** Generate a report before the final phase, capture
  `{ verificationToken, contentHash }`; after the final phase `GET /reports/verify/:token` returns
  `valid: true, hashMatches: true, signatureValid: true` and `canonicalVersion: 1`.
- A v2 report verifies `valid: true` with `canonicalVersion: 2`.
- PO create rejects a client or factory company from another org (port `purchase-orders.service.ts:79-93`).
- Self-dealing: PO with `clientCompanyId === factoryCompanyId` → 400 (§2.4).
- The existing 112 buyer/supplier-matching lines across the integration suite are repointed **phase by
  phase**, never in one commit.

### Web

No test runner exists on the web side. Verified by `pnpm type-check` + `pnpm web build`, plus a manual
pass per phase: directory renders one Companies list; PO create picks two parties; a v1 report and a v2
report render identically in `/portal` and on the branded report.

---

## 10. Accepted risks

1. **`Company` ships without its business-key uniqueness for one phase** (§6.1). Time-boxed to the gap
   between Phase 1 and Phase 2, which is why dedupe is moved to Phase 2. During that window a duplicate
   name is possible; it is caught by the Phase 2 detection query.
2. **Hand-written `RENAME` migrations bypass Prisma's autogeneration** (§4.3, §7). Necessary — the
   autogenerated form is `DROP` + `CREATE` on tables holding live guest credentials and signed reports.
   Mitigated by an explicit review step in the plan and by `prisma migrate diff` being run against the
   result.
3. **Two canonical shapes exist forever.** v1 reports are immutable, so `readCanonicalParties` and its
   tests are permanent code, not migration scaffolding. Accepted: the alternative is rewriting signed
   snapshots, which is not an alternative.
4. **Blast radius.** ~12 API modules, 30 web files, 112 integration-test occurrences. Mitigated entirely
   by phasing: every phase ships green, and the two irreversible steps (dedupe, legacy drop) are isolated
   into their own phases with their own gates.
5. **`Company.kind` may prove under-modeled.** If orgs need more than INTERNAL/THIRD_PARTY, it is an
   additive enum value — the cheapest thing in this document to get wrong (P2).
