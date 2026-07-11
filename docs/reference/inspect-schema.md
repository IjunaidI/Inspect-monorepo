# Inspect — Domain Schema Design (Prisma)

> **Living reference** — moved 2026-06-20 from `docs/superpowers/specs/`. The enduring architecture rationale + the app-layer invariants future phases must honor. **Last verified: 2026-06-20.** Current state: [STATUS.md](../STATUS.md) · open schema-invariant work: [future/BACKLOG.md](../future/BACKLOG.md) (INS-010, INS-011, INS-012, INS-014, INS-015, INS-018).
>
> Design record for reconciling the draft `LoopQC_schema.prisma` with the **Inspect MVP Requirements Spec v1.0**.
> **Status:** approved 2026-06-06. **Canonical schema:** [apps/api/prisma/schema.prisma](../../apps/api/prisma/schema.prisma).
> **Requirements:** [done/specs/2026-06-06-inspect-mvp-requirements-design.md](../done/specs/2026-06-06-inspect-mvp-requirements-design.md).

---

## 0. Context & starting point

- The repo migrated **off TypeORM to Prisma** (commit `de6a2e0`); spec §13's "TypeORM" wording is stale — Prisma is the real stack.
- `apps/api/prisma/schema.prisma` (what Prisma generates from) was **empty** (generator + datasource only).
- The root `LoopQC_schema.prisma` was a **standalone draft predating the spec** — it modeled a flexible RBAC system, target/tolerance measurements, `INLINE/MID/FINAL` inspection types, per-shot pass/fail, and named photo "shots", and was **missing** the entire counterparty layer (Buyer/Supplier/PO/Product), the defect catalog/instance split, AQL plan/result, photo provenance, the tamper-proof block, report signing, and the hash-chained audit log.
- This work is therefore a **principled rewrite of the draft into the spec's domain model**, not a tweak.

The design was driven by a multi-agent gap analysis (8 domain analysts + a completeness critic + a Prisma-correctness verifier) and validated by a 4-lens adversarial review of the written schema. `prisma validate` passes on Prisma 6.19.3.

## 1. Decisions taken (with the user)

| # | Decision | Choice |
|---|---|---|
| D1 | **RBAC & membership** | Fixed `UserRole` enum on `User`; **one org per user**; Platform Admin = `User` with `role=PLATFORM_ADMIN`, `orgId=null`. Dropped `Role`/`Permission`/`RolePermission`/`TenantUser`/`SuperAdmin`. (§4, §12 defers custom roles.) |
| D2 | **Capture granularity** | Photos attach to the **loop** (`Photo.inspectionLoopId`, null until placed); preset step carries `requiredShotCount` (a number). Dropped `PresetShot`/`InspectionShot`/`ShotDefectTag`. (§5, §6.) |
| D3 | **Deliverable** | Both: canonical `apps/api/prisma/schema.prisma` + initial migration + seed, **and** a non-authoritative mirror at root `LoopQC_schema.prisma`. |
| D4 | **Implied-but-unmodeled scope (all included)** | Per-inspection `BillableEvent`; quantity/carton verification fields; report delivery (`ReportDelivery`) + access (`ReportAccess`) + public `verificationToken`; `clientRequestId` idempotency on write aggregates. |

## 2. Cross-cutting conventions

- **Naming:** product `Inspect`; tenant root `Organization` / `orgId` / table `organizations`.
- **Isolation:** `orgId` on every *queryable* tenant-scoped aggregate (incl. `InspectionLoop`, `Photo`, `DefectInstance`, `AqlResult`) with `@@index([orgId])`. Pure leaf rows reached only via an already-scoped parent (`InspectionMeasurement`, preset children, `ReportDelivery`/`ReportAccess`, junctions) omit `orgId` to avoid relation sprawl.
- **Tenant-scoped uniqueness:** `@@unique([orgId, …])` for business keys (`Buyer.name`, `Supplier.name`, `Product.styleNumber`, `PurchaseOrder.poNumber`, `LoopPreset (name,version)`).
- **Deletion policy:** `Restrict` on every reference to immutable/historical data (Report→Inspection/Buyer, Inspection→Buyer/PO/Product, BillableEvent→Inspection, *→DefectCatalog, and **all** org-scoped FKs so an Organization is **archived, never hard-deleted**). `SetNull` on optional **actor** refs (deleting a `User` never erases audit/history). `Cascade` only for transient/draft children (`Invitation`; a draft Inspection's loops/photos/defects; preset children; report delivery/access; junctions).
- **Immutability via snapshots (one doctrine):** data feeding a signed artifact is frozen as resolved JSON, not a live FK — `Inspection.loopPresetSnapshot` (zones, shot counts, **resolved** allowed-defect names+severities, measurement labels), `Inspection.aqlPlan` + `computedSampling`, `InspectionLoop.allowedDefectsSnapshot`, `Report.brandingSnapshot`. Originating FKs stay only for lineage.
- **No Postgres composite types** (MongoDB-only): embedded blocks (`tamperProof`, `gps`, `exif`, `branding`, AQL plan/sampling) are `Json` columns.
- **Reference data in code, not DB:** ISO 2859-1 Table I (code letters) + Table II-A (single-sampling Ac/Re) are AQL-engine constants (§8). The **global defect library** (§7) is seeded into `DefectCatalog` (`orgId=null`).
- **Partial unique indexes** (cannot be expressed in `schema.prisma`; added in the migration because Postgres treats NULLs as distinct): unique global defect name `WHERE orgId IS NULL`; single audit `sequence` space `WHERE orgId IS NULL`.

## 3. Model map (25 models)

**Tenancy & identity:** `Organization`, `User`, `Invitation`.
**Counterparties:** `Buyer`, `BuyerGuest` (magic-link, scoped to one buyer/one org), `Supplier`, `Product`, `PurchaseOrder`.
**Presets:** `LoopPreset`, `PresetLoopStep`, `PresetMeasurementField` (free-form label + optional free-text `unit`), `PresetStepAllowedDefect` (junction).
**Defects:** `DefectCatalog` (GLOBAL seeded + per-org), `DefectInstance`, `DefectInstancePhoto` (junction).
**Inspection:** `Inspection` (aggregate, lifecycle, AQL plan/sampling, quantity/carton fields, workmanship/packaging notes, tamper-proof block, re-inspection chain, idempotency), `InspectionLoop`, `InspectionMeasurement`.
**Photos:** `Photo` (provenance `source`, `contentHash`, presigned-S3 friendly).
**AQL:** `AqlResult` (per-class JSON + system recommendation + QA decision).
**Reports:** `Report` (immutable, signed, `verificationToken`, `canonicalSnapshot` = the frozen hashed/signed payload for independent re-verification), `ReportDelivery`, `ReportAccess`.
**Billing & audit:** `BillableEvent`, `AuditLog` (append-only, hash-chained via `prevEntryHash` + per-org `sequence`).

### Lifecycle & enums of note
- `InspectionStatus`: `DRAFT → ASSIGNED → IN_PROGRESS → SUBMITTED → UNDER_REVIEW → APPROVED → REPORT_ISSUED` (+ `REJECTED`/`HOLD`).
- `InspectionType`: `PRE_SHIPMENT` only (extensible).
- `DefectSeverity {CRITICAL, MAJOR, MINOR}` drives AQL class counts; `AqlClassOutcome {PASS, FAIL}`, `QaDecision {PASS, FAIL, HOLD}`.
- `PhotoSource {MOBILE_VERIFIED, MANUAL_UPLOAD}` drives the verified/unverified badge.
- **Assigned inspector vs actual submitter:** `Inspection.assignedInspectorId` (future mobile) is deliberately distinct from the actual populator/submitter recorded in the locked `tamperProof` JSON (Platform Admin in MVP) — so the report footer shows who really populated it.

## 4. Dropped from the draft

`SuperAdmin` (→ `User` role), `Role`/`Permission`/`RolePermission`/`TenantUser`, `PresetShot`/`InspectionShot`/`ShotDefectTag`, target/tolerance/`isWithinSpec` on measurements, per-shot pass/fail, and the `Industry`/`ProductType`/`MeasurementUnit`/`ShotStatus`/`ShotFrameType`/`TenantStatus` enums (`OrgStatus` replaces `TenantStatus`).

> Note on measurement units: spec §9/§14#9 make measurements free-form (no target/tolerance/grading). Because units (SPI, GSM, cm…) are still useful, an **optional free-text `unit`** is kept on `PresetMeasurementField` and `InspectionMeasurement` — this does not reintroduce tolerance/spec logic.

## 5. Artifacts produced

- `apps/api/prisma/schema.prisma` — canonical schema (validated, formatted).
- `apps/api/prisma/migrations/00000000000000_init/migration.sql` — initial migration (+ the two partial unique indexes) and `migration_lock.toml`.
- `apps/api/prisma/seed.ts` — idempotent global defect library seed; wired via `package.json` → `prisma.seed` (`ts-node --transpile-only`).
- `LoopQC_schema.prisma` (root) — non-authoritative mirror. *(Removed 2026-06-20; `apps/api/prisma/schema.prisma` is now the single schema.)*

## 6. Out of scope here / follow-ups (for the implementation plan)

- `packages/shared-types` (spec §13) — derive shared domain types from the Prisma client; introduce with the API work, not in this schema pass.
- Running the migration against a real Postgres + wiring `DATABASE_URL` (no DB available in this environment; migration SQL is generated via `migrate diff`).
- Application-layer enforcement of: append-only audit, immutability of submitted inspections/reports, the `DefectInstance` "catalog XOR custom" rule, and idempotency-key dedupe.
- The AQL engine (ISO 2859-1 lookup + per-class evaluation), report generation/Ed25519 signing, presigned S3 upload — these consume the schema and belong to the build sequence in spec §15.

## 7. Adversarial review outcome (2026-06-06)

A 4-lens review (spec-fidelity, tenancy/RBAC/isolation, immutability/deletion/audit, Prisma/migration) ran against the written schema + migration. The **immutability/deletion/audit lens found zero issues** — the `Restrict`/`SetNull`/`Cascade` policy holds and no cascade path can destroy a signed report, submitted inspection, photo, or audit row.

**Acted on:**
- Added `Report.canonicalSnapshot Json?` — freezes the canonicalized payload that was hashed + signed so the public verification page can recompute/verify independently (§9).
- Clarified comments: `clientRequestId` idempotency semantics; `AuditLog.sequence` is application-assigned.

**Resolved as already-correct (reviewer over-flagged):**
- `clientRequestId` idempotency: `@@unique([orgId, clientRequestId])` already gives the intended semantics — many tokenless rows allowed (Postgres NULLs distinct), non-null tokens unique per org.
- Global-defect / platform-audit uniqueness: enforced by the two partial unique indexes in the migration; schema comments point to them.

**Documented as application-layer invariants (the spec mandates server-side `orgId` enforcement, §13):**
- **`orgId` alignment:** the denormalized `orgId` on children (`InspectionLoop`, `Photo`, `DefectInstance`, `AqlResult`, `BuyerGuest`) is an index/RBAC aid; the authoritative scope is the parent aggregate. The data-access layer must load children through their org-scoped parent and never trust a child `orgId` without verifying it against the parent. **Hardening follow-up (opt-in):** composite foreign keys — e.g. `@@unique([id, orgId])` on parents + `references: [id, orgId]` on children — would enforce alignment at the DB layer for the external-facing `BuyerGuest → Buyer` edge and the inspection-aggregate edges. Deferred to keep the MVP schema lean; flagged here so it's a conscious choice.
- **No hard-delete of non-draft inspections:** `Cascade` from `Inspection` to its loops/photos/defects is safe only because submitted inspections are soft-deleted/archived and `Report`/`BillableEvent`/`Org` references are `Restrict`. The app must block deletion of any inspection with `status != DRAFT`.
- **`DefectInstance` integrity:** exactly one of `defectCatalogId` / `customText` must be set (catalog XOR custom).
- **`BillableEvent` of kind `RE_INSPECTION`** must reference an inspection whose `supersedesInspectionId` is set.
