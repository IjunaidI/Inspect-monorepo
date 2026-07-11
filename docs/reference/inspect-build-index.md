# Inspect MVP — Build Index (master plan)

> **Living reference** — moved 2026-06-20 from `docs/superpowers/plans/`. The cross-phase router + standing tech defaults. **Last verified: 2026-06-20.** Per-phase status now lives in [STATUS.md](../STATUS.md); the work queue is [future/BACKLOG.md](../future/BACKLOG.md).
>
> **For agentic workers:** This is the master index. Phase plans live under `docs/{done,in-progress,future}/plans/` (Phase 1 → `done/`, Phase 2 → `in-progress/`, Phases 3–7 drafted just-in-time into `in-progress/` when reached). Implement a phase with `superpowers:subagent-driven-development` or `superpowers:executing-plans`, task-by-task, TDD.

**Goal:** Build the Inspect MVP (spec §15) on top of the committed Prisma schema — a web-first, multi-tenant QC inspection platform with an Admin populate console and signed PDF reporting.

**Source of truth:** [requirements](../done/specs/2026-06-06-inspect-mvp-requirements-design.md) · [schema design](./inspect-schema.md) · [schema](../../apps/api/prisma/schema.prisma).

---

## Why this is multiple plans

§15 is **seven independent subsystems**. Per the writing-plans scope rule, each gets its own plan and must produce working, testable software on its own. They are sequenced by dependency below.

## Hard environment constraint (read first)

This workspace has **no Postgres and no Redis**, and the NestJS API refuses to boot without `REDIS_URL` (`apps/api/src/app.module.ts`) and `DATABASE_URL`. Consequences:

- **Phase 1 (foundation + pure-domain core) is fully buildable and unit-testable here** — it is plain TypeScript logic (jest, no DB).
- **Phases 2–7 are DB/IO-bound.** Their plans can be written and code scaffolded, but **verification requires a running Postgres + Redis** (e.g. a local `docker compose` with Postgres 16 + Redis, or testcontainers for integration tests). Do not claim a DB-bound phase "passes" without running it against a database.

A `docker-compose.dev.yml` (Postgres + Redis + MinIO) is itself a Phase-2 task so the rest can be run.

## Tech decisions (defaults — change here if desired)

| Concern | Choice | Notes |
|---|---|---|
| API framework | NestJS 11 (existing) + Prisma 6 | — |
| API auth | JWT access+refresh via `@nestjs/jwt` + Passport-JWT; passwords hashed with **argon2** | API is the RBAC authority (spec §13). Invite-only; no public signup. |
| Web auth | Next.js console stores the API-issued JWT (Auth.js/NextAuth optional shell; API remains canonical) | `NEXTAUTH_URL`/`AUTH_SECRET` already in `turbo.json` globalEnv. Finalize in Phase 2 plan. |
| Validation | `class-validator` + `class-transformer` for DTOs; **Zod** for the `Json`-column contracts (shared-types) | — |
| Object storage | `@aws-sdk/client-s3` + `s3-request-presigner`; **MinIO** for local dev | Presigned uploads, no base64 through the API (spec §13). |
| Email | `nodemailer` (dev: stream transport) | Phase 7. |
| PDF | **`pdf-lib`** (pure JS, no headless browser) | Footer carries hash + Ed25519 signature (spec §10/§9). |
| Ed25519 + hashing | Node built-in `node:crypto` (`ed25519`, `sha256`) | No external crypto dep. |
| Tests | jest (unit, no DB) + integration tests against a test Postgres (testcontainers) | — |

## Phase sequence

| Phase | Plan file | Produces | DB needed? |
|---|---|---|---|
| **1. Foundation & domain core** ✅ | `done/plans/2026-06-06-inspect-phase1-foundation-domain-core.md` | `@inspect/shared-types`; AQL engine (ISO 2859-1); tamper-proof crypto; audit hash-chain — all unit-tested | **No** |
| 2. Auth & tenancy ✅ | `done/plans/2026-06-06-inspect-phase2-auth-tenancy.md` | login, JWT + refresh, multi-tenant RBAC guards (negative matrix integration-tested), invite-only onboarding + email delivery, `docker-compose.dev.yml`, Prisma migrate/seed — *completed 2026-07-11 (INS-009/INS-004)* | Yes |
| 3. Workspace | `…-phase3-workspace.md` (TBW) | Buyer/Supplier/PO/Product CRUD + loop-preset builder (API + console) | Yes |
| 4. Inspection setup | `…-phase4-inspection-setup.md` (TBW) | create/assign-inspection flow; wire AQL engine; snapshot preset; locked tamper-proof block | Yes |
| 5. Admin populate console | `…-phase5-populate-console.md` (TBW) | presigned S3 upload, drag photos into loops, defect tagging, measurements | Yes |
| 6. Decisioning | `…-phase6-decisioning.md` (TBW) | AQL auto-flag on submit; QA review approve/reject/hold; write `AqlResult` | Yes |
| 7. Reporting & guest portal | `…-phase7-reporting.md` (TBW) | branded signed PDF, hash-chained audit writes, email + portal delivery, buyer guest portal, public verification | Yes |

(TBW = to be written when the phase is reached; each is brainstormed/planned just-in-time so it reflects what the prior phase actually produced.)

## Cross-phase invariants (enforced in every DB-bound phase)

- Every tenant-scoped query is filtered by `orgId`; Platform Admin is the only `orgId`-agnostic principal.
- Submitted inspections & generated reports are immutable; no hard-deletes (status/archive only).
- The `DefectInstance` "catalog XOR custom" rule, monotonic per-org audit `sequence`, and append-only audit are enforced in services.
- Writes accept an optional `clientRequestId` and dedupe on `@@unique([orgId, clientRequestId])`.
