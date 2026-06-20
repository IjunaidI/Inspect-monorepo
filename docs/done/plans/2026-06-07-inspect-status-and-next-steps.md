# Inspect MVP — Status & Next-Steps Plan

> **⚠️ Superseded 2026-06-20 — historical handoff snapshot.** The living "where we are / what's next" now lives in [STATUS.md](../../STATUS.md) + [future/BACKLOG.md](../../future/BACKLOG.md) (stable `INS-NNN` ids). This dated 2026-06-07 snapshot is kept as the historical record and is **no longer maintained**.
>
> **Handoff doc.** Snapshot of what's built and a phased plan to continue. Start a fresh conversation from any phase below.
> **As of:** 2026-06-07 · **Branch:** `main` @ `34fa0f5` · **Stack:** pnpm + Turborepo · NestJS 11 + Prisma 6 (`apps/api`) · Next.js 15 + shadcn + Tailwind + NextAuth (`apps/web`).
> **Source of truth:** [requirements](../specs/2026-06-06-inspect-mvp-requirements-design.md) · [schema design](../../reference/inspect-schema.md) · [build index](../../reference/inspect-build-index.md).

---

## 1. What is implemented (all on `main`)

### Data model
- **`apps/api/prisma/schema.prisma`** — ~22 models, the full §5 domain (Organization, User, Invitation, Buyer, BuyerGuest, Supplier, Product, PurchaseOrder, LoopPreset/PresetLoopStep/PresetMeasurementField/PresetStepAllowedDefect, DefectCatalog, Inspection, InspectionLoop, InspectionMeasurement, Photo, DefectInstance(+junction), AqlResult, Report(+Delivery/Access), BillableEvent, AuditLog). Fixed `UserRole` enum (no flexible RBAC), `orgId` on every queryable row, `Restrict`/`SetNull`/`Cascade` deletion policy, JSON snapshots, `verificationToken`, `canonicalSnapshot`.
- **Initial migration** `prisma/migrations/00000000000000_init/migration.sql` (+ 2 partial unique indexes for NULL-`orgId` rows) and `migration_lock.toml`.
- **Seed** `prisma/seed.ts` — global defect library (§7), idempotent. Mirror copy at root `LoopQC_schema.prisma`.

### Domain core (pure TS, unit-tested, no DB) — `apps/api/src`
- `aql/` — ISO 2859-1 / Z1.4 single-sampling, Level II: `codeLetterForLotSize`, `sampleSizeForCodeLetter`, `planFor`, `computeSampling`, `evaluateInspection`. **Verified band: code letters G–N at AQL {1.0, 1.5, 2.5, 4.0, 6.5} + critical Ac0**; throws on unverified cells.
- `tamper-proof/` — `canonicalize`, `contentHash` (sha256 over canonical + ordered photo hashes), Ed25519 `sign`/`verify` (node:crypto).
- `audit/audit-chain.ts` — `linkHash` + `verifyChain` (tamper detection).
- `auth/` primitives — `rbac` (additive `hasAtLeast`), `password` (scrypt), `jwt` (HS256).

### NestJS API (compiles, type-checks, `nest build` ✓ — integration not run)
- Auth wiring: `AuthModule` (login/refresh/me), global `JwtAuthGuard` + `RolesGuard`, `@Public/@Roles/@CurrentUser`.
- Workspace CRUD: `buyers`, `suppliers`, `products`, `purchase-orders` (org-scoped, QA-Manager+).
- `loop-presets` (versioned builder), `defect-catalog` (global+org).
- `inspections` — create (snapshot preset + `computeSampling`), submit (count defects → `evaluateInspection` → `AqlResult` + locked tamper-proof + `BillableEvent`), QA decide.
- `populate` (PLATFORM_ADMIN) — presign upload (`storage/` dependency-free **SigV4**), register photo, drag-into-loop, tag defects, free-form measurements.
- `reports` — generate (canonicalSnapshot + contentHash + Ed25519 sign + audit) + public `/reports/verify/:token`; `guest` portal (magic-link); `orgs`/`invitations`/`users`/`buyer-guests` onboarding; `AuditService` (hash-chained writes).

### Web console — `apps/web`
- Design system from the Claude Design handoff: `components/inspect/{tokens.ts, shell.tsx, branded-report.tsx}` (Inter + JetBrains Mono, `#037BF4` accent, hairlines).
- **11 screens:** dashboard (Buyers & Suppliers), create-inspection, presets list + builder, populate, review (QA decision), branded report, guest portal, users, invite-accept, login.
- **API wiring:** NextAuth **Credentials** → API `/auth/login` (session carries JWT + role + orgId); `lib/api.ts` (`apiGet` + `loadOrFallback`). Dashboard / presets / users fetch **live with demo fallback**.

### Infra
- `docker-compose.dev.yml` (Postgres 16 + Redis 7 + MinIO), `.env.example`, `turbo.json` globalEnv.

### Verification done
`prisma validate` ✓ · `tsc --noEmit` (api + web) ✓ · `nest build` ✓ · `next build` ✓ · **97 API unit tests** ✓.

---

## 2. What is NOT done / explicitly unverified

- **Never run against a real DB/Redis** (none in the build env): migrations, `db seed`, the API at runtime, **all integration/e2e**, web↔API end-to-end, browser rendering. Everything DB-bound is "compiles + unit-tested logic," not "works."
- **PDF binary** rendering (`pdf-lib`) — reports are signed records; `pdfStorageKey` is unset.
- **Public verification page UI** (backend endpoint exists).
- **Web form writes not wired** — create-inspection, populate (upload/tag/measure), review submit, preset-builder save, buyer/supplier modals, invite-accept, users invite/role-change. Dropdown reads not wired. (Read-list screens are wired.)
- **Aggregation endpoints missing** — buyer/PO/report counts, inspections list, dashboard numbers (live screens show `—` for these).
- **`@inspect/shared-types` not linked** into api/web (no `pnpm install` of the workspace pkg); both define local types.
- **App-layer invariants not enforced yet:** append-only audit on every mutation, immutability of submitted inspections/reports, idempotency dedupe usage, monotonic per-org `sequence` under concurrency, `DefectInstance` catalog-XOR-custom, composite-FK tenant guard (documented as app-layer in schema design §7).
- **Email delivery** (`nodemailer`) not built (`ReportDelivery` rows modeled).
- **AQL master table** is the MVP band only — full Z1.4 table + arrow rules need an authoritative source.
- **Mobile app** (Phase 2) deferred by spec.
- ⚠️ **`.env.example` contains real-looking Railway secrets** (Postgres/Redis passwords) — **rotate and remove**.

---

## 3. Next-steps plan (phased)

> Each phase is independently startable. Recommended order is dependency-driven. Use `superpowers:writing-plans` to expand a phase into bite-sized TDD tasks before implementing, and TDD for all new logic.

### Phase A — Stand up & verify the stack (do this first)
- `cp .env.example .env`; **rotate the committed secrets**. `docker compose -f docker-compose.dev.yml up -d`.
- `pnpm --filter @inspect/api exec prisma migrate dev` (turns the init migration into a real DB) + `prisma db seed`. Generate an Ed25519 keypair → `REPORT_SIGNING_PRIVATE_KEY_PEM`.
- Boot API (`:3000`) + web (`:3001`). Manually: create org+owner invite → accept → login → create buyer/supplier/PO/preset → create inspection → populate → submit → decide → generate report → verify token → guest portal.
- **Add an integration test harness** (testcontainers-postgres or compose) and write the first e2e: login → guarded route 200/401/403.
- **Acceptance:** the full flow works against a real DB; ≥1 green integration test in CI.

### Phase B — Wire web write actions + reads
- Server actions / route handlers using `lib/api` for: create-inspection (load buyer/supplier/PO/product/preset/inspector dropdowns + POST), populate (presign→upload→register, drag-into-loop, tag defect, add measurement), review submit (decision), preset-builder save, buyer/supplier modals, invite-accept, users invite/role/deactivate.
- Replace remaining demo data with live fetches; surface API validation errors.
- **Acceptance:** every console action hits the API and round-trips; demo fallback only when offline.

### Phase C — Read/aggregation endpoints
- API: dashboard counts (POs/products/reports per buyer; buyers/POs/open-inspections per supplier), an **inspections list** endpoint (filter by status), report list per org/buyer. Add `@@index`-backed queries; keep `orgId`-scoped.
- Wire dashboard numbers + an inspections list screen.
- **Acceptance:** dashboard shows real counts; inspections list paginates.

### Phase D — Reporting completeness
- PDF rendering with **`pdf-lib`** matching `BrandedReport`; upload to S3; set `pdfStorageKey`; embed hash + signature in the footer.
- **Public verification page** UI (`/r/[token]` or similar) calling `/reports/verify/:token`.
- `ReportDelivery` via **`nodemailer`** (dev stream transport) + record `ReportAccess` on guest views.
- **Acceptance:** generated report produces a downloadable signed PDF; public page verifies it; delivery + access logged.

### Phase E — Correctness & security hardening
- App-layer enforcement: audit-append on **every** mutation (in the same tx), block edits/deletes of non-DRAFT inspections & reports, idempotency dedupe on writes, transactional monotonic `sequence`, catalog-XOR-custom check.
- Optional composite-FK tenant-integrity (schema design §7); link **`@inspect/shared-types`** into api/web (`pnpm install`, map Prisma↔contract).
- **AQL:** verify/extend the Z1.4 table against the licensed standard (+ arrow rules); add property tests.
- **Acceptance:** adversarial tests (cross-tenant access, tamper a report/audit, replay a write) all fail closed.

### Phase F — Tests, CI, ops
- Integration/e2e: auth + RBAC matrix, inspection lifecycle, report sign/verify, guest scoping. Web E2E with Playwright on the happy path.
- CI (build + tsc + jest + integration), secret management, deploy (Railway — env already shaped for it).
- **Acceptance:** green CI gates merges; staging deploy reachable.

### Phase G — Mobile (deferred per spec)
- React Native app reusing the API: camera-only verified capture (signed EXIF/GPS/device), inspector capture+tagging. Flip `Photo.source` to `MOBILE_VERIFIED`.

---

## 4. Quick orientation for the next session
- **Run:** `docker compose -f docker-compose.dev.yml up -d` → `pnpm --filter @inspect/api exec prisma migrate dev && prisma db seed` → `pnpm dev`.
- **Tests:** `pnpm --filter @inspect/api test` (97 green).
- **Key dirs:** `apps/api/src/{aql,tamper-proof,audit,auth,inspections,reports,populate,...}` · `apps/web/{app/(console),components/inspect,lib}`.
- **Recommended first move:** Phase A, then `superpowers:writing-plans` on Phase B.
