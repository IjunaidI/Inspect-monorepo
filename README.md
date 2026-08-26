<div align="center">

# 🧵 Inspect

### A tamper-proof, AQL-driven quality-control inspection platform for the textile & garment industry.

Guided photo-driven inspections → statistical AQL sampling → a QA-signed, cryptographically verifiable PDF report for the buyer.

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS_11-E0234E?logo=nestjs&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js_15-000000?logo=nextdotjs&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma_6-2D3748?logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL_16-4169E1?logo=postgresql&logoColor=white)
![Turborepo](https://img.shields.io/badge/Turborepo-EF4444?logo=turborepo&logoColor=white)
![Tests](https://img.shields.io/badge/unit_tests-135_passing-3fb950)
![Integration](https://img.shields.io/badge/integration_tests-36_passing-3fb950)
![CI](https://img.shields.io/badge/CI-GitHub_Actions-2088FF?logo=githubactions&logoColor=white)
![Type-safe](https://img.shields.io/badge/strict_TypeScript-end--to--end-3178C6)

</div>

---

## What is Inspect?

When a brand orders 10,000 polo shirts from a factory overseas, someone has to physically inspect a sample before the shipment leaves the dock. Today that's clipboards, loose photos, and trust. **Inspect turns that process into a verifiable digital workflow.**

An inspector walks a product through **guided "loops"** (sleeves → collar → seams → stitching → measurements → packaging), capturing photos, tagging defects, and recording measurements. The system then runs a **statistical acceptance‑sampling calculation (ISO 2859‑1 / ANSI‑ASQ Z1.4)** to recommend pass/fail, a QA Manager makes the binding call, and a **branded PDF report is generated and cryptographically signed** so the buyer can verify it was never altered.

It's a **multi‑tenant B2B SaaS**: each inspection company or manufacturer gets an isolated workspace, with invite‑only onboarding and additive role‑based access control.

> **MVP scope:** web‑first (admin/QA console + backend). Mobile camera capture is a deliberate Phase‑2 follow‑up that reuses the same API.

---

## ✨ Engineering highlights

These are the parts that make the codebase interesting — each is built test‑first:

| Area | What's notable |
|---|---|
| 📊 **AQL sampling engine** | A pure, unit‑tested implementation of **ISO 2859‑1 / ANSI‑ASQ Z1.4** single sampling (Level II): lot size → code letter → sample size → per‑class accept/reject, then whole‑lot evaluation. No library — the statistical tables are encoded and verified. |
| 🔐 **Tamper‑proof reports** | Reports are sealed with a **canonicalized content hash + Ed25519 signature** (Node `crypto`, zero deps) and verifiable on a public page without trusting the portal. |
| ⛓️ **Hash‑chained audit log** | Append‑only audit trail where each entry links to the hash of the previous — any retroactive edit breaks the chain and is detectable. |
| 🏢 **Multi‑tenant RBAC** | `orgId`‑scoped on every row, additive role hierarchy (Inspector ⊆ QA Manager ⊆ Org Owner ⊆ Platform Admin) enforced by global NestJS guards; Platform Admin is the only cross‑tenant principal. |
| 🧾 **Immutability by design** | Submitted inspections and signed reports are frozen; corrections happen via a new linked re‑inspection. Enforced through snapshots + `onDelete: Restrict` + soft‑delete. |
| 🎨 **Design‑faithful console** | An 11‑screen Next.js console rebuilt pixel‑close from a design handoff (Inter + JetBrains Mono, hairline UI), wired to the live API with graceful offline fallback. |
| 🧪 **Test‑driven** | The correctness‑critical core (sampling, crypto, audit, auth) is covered by 135 passing unit tests written RED→GREEN, plus 36 DB‑backed integration tests (auth/RBAC round‑trip, core inspection loop, storage byte‑path) that run in CI. |

---

## 🏗️ Architecture

A pnpm + Turborepo monorepo with a NestJS API and a Next.js console sharing one Postgres schema and one auth authority.

```mermaid
flowchart LR
    subgraph Web["apps/web — Next.js 15 console"]
        UI["28 routes · shadcn/ui · Tailwind"]
        NA["NextAuth (Credentials)"]
    end
    subgraph API["apps/api — NestJS 11"]
        AUTH["JWT + RBAC guards"]
        DOMAIN["AQL engine · Ed25519 · audit chain"]
        MODULES["Inspections · Workspace · Reports · Populate"]
    end
    DB[("PostgreSQL 16<br/>Prisma 6")]
    RD[("Redis 7")]
    S3[("S3 / MinIO<br/>presigned uploads")]

    UI --> NA -->|"POST /auth/login"| AUTH
    UI -->|"Bearer JWT"| MODULES
    AUTH --> MODULES --> DOMAIN
    MODULES --> DB
    API --> RD
    MODULES -->|"presigned PUT"| S3
```

**Inspection lifecycle:** `draft → assigned → in_progress → submitted → under_review → approved → report_issued` (with `rejected` / `hold` and billable re‑inspection chains).

---

## 🧰 Tech stack

**Language & tooling**
- TypeScript (strict, end‑to‑end) · pnpm 9 workspaces · Turborepo · ESLint · Prettier · Node ≥ 20

**Backend — `@inspect/api`**
- NestJS 11 · Prisma 6 (PostgreSQL 16) · Redis 7 (`@nestjs/cache-manager` + Keyv) · `@nestjs/terminus` health checks · Jest
- Node `crypto` for Ed25519 signing, SHA‑256 hashing, scrypt password hashing, HS256 JWT, and **AWS SigV4 presigned uploads — all dependency‑free**

**Frontend — `@inspect/web`**
- Next.js 15 (App Router, RSC) · React 19 · NextAuth v5 (Credentials) · Tailwind CSS · shadcn/ui (Radix) · lucide‑react · Inter + JetBrains Mono

**Infra & domain**
- S3‑compatible object storage (MinIO for local dev) · `docker-compose` dev stack (Postgres + Redis + MinIO) · ISO 2859‑1 / ANSI‑ASQ Z1.4 acceptance sampling

---

## ✅ Implementation status

Legend: ✅ done & verified · ⬜ planned

**Foundation & domain core** — ✅
- [x] Prisma schema — 25 models, multi‑tenant, immutable‑by‑design + initial migration + seed
- [x] ISO 2859‑1 AQL engine *(39 unit tests)*
- [x] Tamper‑proof crypto: canonicalization + SHA‑256 content hash + Ed25519 *(14 tests)*
- [x] Append‑only hash‑chained audit core *(7 tests)*
- [x] Four shared packages — `@inspect/{shared-types,api-client,domain,design-tokens}`, consumed by the API and the console today and by the React Native app in Phase 2 (INS-086 Phase 1)

**Backend API (NestJS)** — ✅ *verified live against Postgres + Redis + S3-compatible object storage: 147 integration tests across 16 suites, plus 656 unit tests. See [docs/STATUS.md](docs/STATUS.md) for what is and is not verified — the integration suite is currently flaky against the remote dev database.*
- [x] JWT auth + additive RBAC guards — scrypt + HS256 *(25 tests)*
- [x] Workspace CRUD — companies, products, purchase orders *(INS-055: one `Company` model is every counterparty; whether it is the client or the factory lives on the PO/Inspection/Report edge)*
- [x] Loop‑preset builder (versioned) + defect catalog (global + per‑org)
- [x] Inspection lifecycle — create→snapshot→AQL sampling, submit→evaluate→result, QA decision
- [x] Admin populate console API — presigned S3 upload, defect tagging, free‑form measurements
- [x] Signed report generation + public verification endpoint + audit writes
- [x] Company guest portal (magic‑link, scoped to a company's CLIENT-role reports) + invite‑only onboarding (orgs / users / guests) with email delivery (`nodemailer`)

**Web console (Next.js)** — ✅
- [x] Design system (tokens, responsive shell, reusable branded report)
- [x] 28 routes — dashboard, inspections (list/create/populate/review/report), companies + guests, products, purchase orders, presets list + builder, reports, users, admin orgs, guest portal, public verify, invite, login
- [x] NextAuth Credentials → API; console screens wired to live reads + server‑action writes with offline fallback

**Next up** — ⬜
- [ ] Aggregation endpoints (dashboard counts, inspections list)
- [ ] PDF rendering (`pdf-lib`) for the signed report artifact
- [ ] App‑layer hardening (audit‑on‑write, immutability guards, idempotency dedupe)
- [ ] Deploy (Railway) — CI (GitHub Actions) is already green
- [ ] **Phase 2 — mobile app** with camera‑only verified capture (signed EXIF/GPS/device)

> Live status & full breakdown: [`docs/STATUS.md`](docs/STATUS.md) (dashboard) · [`docs/future/BACKLOG.md`](docs/future/BACKLOG.md) (`INS-NNN` items).

---

## 🚀 Quick start

**Prerequisites:** Node ≥ 20, pnpm 9, Docker (for the local Postgres + Redis + MinIO stack).

```bash
# 1. Install
git clone <repo-url> Inspect-monorepo && cd Inspect-monorepo
pnpm install

# 2. Spin up Postgres + Redis + MinIO
docker compose -f docker-compose.dev.yml up -d

# 3. Configure env (copy the template, then set local DATABASE_URL / REDIS_URL / secrets)
cp .env.example .env
#   DATABASE_URL=postgresql://inspect:inspect@localhost:5432/inspect?schema=public
#   REDIS_URL=redis://localhost:6379
#   AUTH_SECRET=<32+ chars>   JWT_ACCESS_SECRET / JWT_REFRESH_SECRET=<secrets>

# 4. Create the schema + seed the global defect library
pnpm --filter @inspect/api exec prisma migrate dev
pnpm --filter @inspect/api exec prisma db seed

# 5. Run both apps
pnpm dev
```

- **API** → http://localhost:3000 · health: `GET /health`
- **Console** → http://localhost:3001 (sign in with a seeded user)

Run the test suite:

```bash
pnpm --filter @inspect/api test                # 135 unit tests (no DB needed)
pnpm --filter @inspect/api test:integration    # 36 DB-backed integration tests (needs the docker stack + .env)
pnpm type-check                                # strict tsc across the workspace
pnpm build                                     # nest build + next build
```

---

## 📂 Project structure

```
Inspect-monorepo/
├── apps/
│   ├── api/                         @inspect/api — NestJS + Prisma
│   │   ├── prisma/                  schema.prisma · migrations · seed.ts
│   │   └── src/
│   │       ├── aql/                 ISO 2859-1 sampling engine  (tested)
│   │       ├── tamper-proof/        canonicalize · hash · Ed25519 (tested)
│   │       ├── audit/               hash-chain core + AuditService (tested)
│   │       ├── auth/                JWT · scrypt · RBAC guards     (tested)
│   │       ├── inspections/  reports/  populate/  storage/
│   │       ├── companies/  products/  purchase-orders/
│   │       ├── loop-presets/  defect-catalog/  guest/
│   │       └── orgs/  invitations/  users/  company-guests/
│   └── web/                         @inspect/web — Next.js console
│       ├── app/(console)/           dashboard · inspections · companies · presets · populate · review · users
│       ├── app/{login,invite,portal,report,r}/
│       ├── components/inspect/      tokens · shell · branded-report
│       └── lib/                     auth.ts (NextAuth) · api.ts (Next adapter over @inspect/api-client)
├── packages/
│   ├── shared-types/                 @inspect/shared-types — enums · JSON contracts · every wire DTO
│   ├── api-client/                   @inspect/api-client — fetch client, INJECTED auth provider
│   ├── domain/                       @inspect/domain — platform-free rules (the one ROLE_RANK)
│   └── design-tokens/                @inspect/design-tokens — palette · font stacks · severity maps
├── docs/                            STATUS.md · future/BACKLOG.md · {done,in-progress,future}/ · reference/
└── docker-compose.dev.yml           Postgres + Redis + MinIO
```

---

## 📚 Documentation

- **Status dashboard** (start here) — [`docs/STATUS.md`](docs/STATUS.md) · **Backlog** (`INS-NNN`) — [`docs/future/BACKLOG.md`](docs/future/BACKLOG.md) · **How the docs folder works** — [`docs/README.md`](docs/README.md)
- **Requirements spec** (frozen v1.0) — [`docs/done/specs/2026-06-06-inspect-mvp-requirements-design.md`](docs/done/specs/2026-06-06-inspect-mvp-requirements-design.md)
- **Schema design & rationale** — [`docs/reference/inspect-schema.md`](docs/reference/inspect-schema.md) · **Build index** — [`docs/reference/inspect-build-index.md`](docs/reference/inspect-build-index.md)

---

<div align="center">
<sub>Built with a test-first, spec-driven workflow. Domain logic is verified by unit tests, the DB-bound flows by a live integration suite in CI; the data layer is modeled for tamper-evidence and multi-tenant isolation from the ground up.</sub>
</div>
