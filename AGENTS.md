# AGENTS.md

Operating guide for any AI coding agent working in this repo. Tool-agnostic; [CLAUDE.md](CLAUDE.md) holds the
full architecture detail. If your instructions and this file conflict, the human wins.

## What this is

**Inspect** — a tamper-proof, AQL-driven pre-shipment QC inspection platform for textiles/garments
(multi-tenant B2B SaaS). Core loop: guided photo "loops" → ISO 2859-1 / Z1.4 acceptance-sampling pass/fail →
QA Manager's binding decision → per-buyer-branded, Ed25519-signed PDF report the buyer verifies independently.
MVP is **web-first** (admin/QA console + NestJS API); mobile camera capture is Phase 2.

Monorepo: pnpm + Turborepo. `apps/api` (NestJS 11 + Prisma 6, port 3000) · `apps/web` (Next.js 15 console,
port 3001) · `packages/shared-types` (built but not yet linked). Node ≥ 20, pnpm 9.12.0.

## Read first (in this order)
1. [docs/STATUS.md](docs/STATUS.md) — the dashboard. Where every pillar stands. **Start here every session.**
2. [docs/future/BACKLOG.md](docs/future/BACKLOG.md) — open work, stable `INS-NNN` ids.
3. [CLAUDE.md](CLAUDE.md) — commands, architecture, gotchas, domain invariants.
4. [docs/done/specs/2026-06-06-inspect-mvp-requirements-design.md](docs/done/specs/2026-06-06-inspect-mvp-requirements-design.md) (what the MVP must be) · [docs/reference/inspect-schema.md](docs/reference/inspect-schema.md) (data model + invariants).

## Ground truth (do not over-trust "it's implemented")
The pure domain core (AQL engine, tamper-proof crypto, audit-chain, auth primitives) is unit-tested and solid
(**97 tests**). Everything DB-bound — auth round-trip, all CRUD, the inspection lifecycle, populate, reports —
**compiles and type-checks but has never run against a real Postgres/Redis** ([INS-001](docs/future/BACKLOG.md)).
The web console renders well but **only Login performs a live write** ([INS-022](docs/future/BACKLOG.md)). When you
touch a DB-bound or write path, assume you are the first to run it.

## Commands
- `pnpm install` (root) installs the whole workspace. `pnpm dev` runs API + web. `pnpm test` = API's 97 Jest unit tests (no DB). `pnpm type-check` / `pnpm lint` / `pnpm build` fan out across both apps.
- The **API will not boot without `DATABASE_URL` + `REDIS_URL`** (the cache module throws). Bring up `docker-compose.dev.yml` (Postgres 16 + Redis 7 + MinIO), then `pnpm api prisma:migrate && pnpm --filter @inspect/api exec prisma db seed`.

## Non-negotiable operating rules
- **Uphold the domain invariants** (full list in CLAUDE.md → Domain invariants): `orgId` tenant isolation on every query; additive RBAC; immutability of submitted inspections + signed reports (corrections only via a linked re-inspection); append-only hash-chained audit per mutation; snapshot-freeze data feeding signed artifacts; `DefectInstance` = catalog XOR custom; `clientRequestId` idempotency. Several are app-layer-only today ([INS-010..018](docs/future/BACKLOG.md)) — that means *your code* must enforce them.
- **Never weaken** the tamper-proof or tenancy guarantees to make something pass. If a change would let one org see another's data, or make a "signed" report mutable, stop and flag it.
- **TDD for all new domain logic** (RED → GREEN). The correctness-critical core is test-first; keep it that way.
- **Verify before claiming done.** "Compiles" ≠ "works" for anything DB-bound — run it against a real DB. Quote the command output; don't assert green you didn't observe.
- **Reference `INS-NNN` ids** in plans and commit messages. New work: brainstorm → spec + plan in `docs/in-progress/`, referencing the backlog id.
- **Branch before committing** to `main`; commit/push only when the human asks.

## After every session (documentation workflow)
1. Flip the touched `INS-NNN` item's `status` in [docs/future/BACKLOG.md](docs/future/BACKLOG.md) (→ `done`, with a `done:` line, when verified).
2. Bump [docs/STATUS.md](docs/STATUS.md)'s **"Last verified"** date + any pillar row you changed.
3. On merge, move the spec + plan `docs/in-progress/ → docs/done/`.
4. Check doc links resolve and STATUS + BACKLOG agree with the code.

## Two things to know before any deploy
- [INS-001](docs/future/BACKLOG.md) — stand the stack up against a real DB and drive the core loop end-to-end. **Recommended first task.**
- [INS-002](docs/future/BACKLOG.md) — `.env.example` itself is scrubbed to placeholders, but the real-looking Railway credentials remain in **git history** and the live secrets are unrotated.

## Don't
- The canonical (and only) Prisma schema is `apps/api/prisma/schema.prisma` — the old root `LoopQC_schema.prisma` mirror was removed 2026-06-20; don't recreate it.
- Don't assume a console button submits — `apps/web/lib/api.ts` has no write helper yet.
- Don't commit real secrets; `.env` is gitignored, only `.env.example` (placeholders) is tracked.
- Don't add new specs/plans under the retired `docs/superpowers/` path — use `docs/in-progress/`.
