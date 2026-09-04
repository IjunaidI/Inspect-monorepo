# Backlog — Inspect

> Source of truth for remaining work. Severity-grouped. Every item has a stable `INS-NNN` id —
> plans and commit messages reference items by id, and ids are never reused.
> Keep each `status` current (see [../../CLAUDE.md](../../CLAUDE.md) → Documentation workflow). Dashboard: [../STATUS.md](../STATUS.md).
>
> **Trimmed 2026-09-02:** the 83 closed items (and their full status histories) moved to
> [../done/2026-09-02-backlog-archive.md](../done/2026-09-02-backlog-archive.md). Only open items
> live here. A reference to a closed `INS-NNN` resolves in the archive.

**Item template**
```
### INS-NNN · <title>   [SEVERITY]
- status: todo            # todo | in-progress | done | wont-fix
- area: <subsystem>
- evidence: <file:line or doc>
- problem: <what's wrong>
- fix: <intended change>
- verify: <a concrete, checkable condition>
- refs: <links to spec/plan, or —>
```

Severity: **BLOCKER** = must clear before any real deploy · **HIGH** = core MVP completeness · **MEDIUM** = correctness/robustness hardening · **LOW** = cosmetic/test-debt.

---

## Blockers

### INS-002 · Committed real-looking secrets in `.env.example`   [BLOCKER]
- status: in-progress    # user-side only. `.env.example` is scrubbed (verified). Remaining: the old dev Railway credentials sit unrotated in git history — rotate or abandon that project. When any environment is minted (the INS-090 remote dev one included, and non-negotiably production later): generate a FRESH Ed25519 `REPORT_SIGNING_PRIVATE_KEY_PEM` there; a signing key that has sat on a dev machine or in a repo must never sign anything trusted.
- area: Infra & CI
- evidence: git history of `.env.example` (pre-scrub revisions carry real-shaped `POSTGRES_PASSWORD`/`REDIS_PASSWORD`/`DATABASE_URL`).
- problem: Live-shaped credentials shipped in git; anything still live must be rotated (or the project abandoned) before a real deploy, or tenant isolation + the signing guarantee are compromised.
- fix: Rotate/abandon the old Railway project's credentials; secret-scan history; mint a fresh signing keypair per environment.
- verify: A secret scan of tracked files + history finds no live credential; any keypair that ever appeared in a commit is rotated/revoked.
- refs: [../done/2026-09-02-backlog-archive.md](../done/2026-09-02-backlog-archive.md) (full history)

---

## High

### INS-090 · The API is not deployed anywhere — a phone cannot reach it   [HIGH]
- status: done
- done: 2026-09-02 — the API was already auto-deploying to Railway project **QCLink** (service `Main Application`, from GitHub `main`, `apps/api/Dockerfile`) but answered 502 on every request: Railway routed to its injected `PORT` while the API listens on `API_PORT`. Fixed the domain's target port (3000) + `API_PORT=3000` + `PORT=3000` (Railway health-checks on `PORT` too); added the missing `REPORT_SIGNING_PRIVATE_KEY_PEM` (**fresh** Ed25519, minted for this environment), `ALLOWED_ORIGINS`, `WEB_BASE_URL`, `RATE_LIMIT_TRUSTED_PROXIES=1`; set the service settings (`/health` check, pre-deploy `prisma migrate deploy` + seed, start command) — mirrored in the new `apps/api/railway.json`, which can become the config-file authority once it is on GitHub main (a config path to a file absent from main fails the deploy at SNAPSHOT_CODE). Pre-deploy must be `sh -c "…"` — Railway runs the string without a shell, so a bare `a && b` silently ran only the migrate; proven by a new bootstrap password logging in 401 → 201. From-source deployment `4efbcfe4` passed every step incl. PRE_DEPLOY_COMMAND ("Seed complete", "Bootstrap Platform Admin ready") and HEALTHCHECK. Verified from outside the LAN: `GET /health` → db + redis up; `POST /auth/login` → tokens; `GET /auth/me` → PLATFORM_ADMIN; CORS header echoes the console origin; `/docs` 404 (production). Real origins written into `apps/mobile/eas.json`. Runbook: [../reference/deploy-railway.md](../reference/deploy-railway.md). Note: `railway.json` is deprecated by Railway after 2026-12-01 (migrate to `.railway/railway.ts`).
- area: Infra & CI
- evidence: `INSPECT_API_URL` defaults to `http://localhost:3000`; no deploy has ever run.
- problem: The INS-086 device acceptance needs a reachable HTTPS origin — a phone cannot resolve `localhost`.
- fix: Deploy `apps/api` (root build context, `apps/api/Dockerfile`). **Build:** `pnpm install --frozen-lockfile` + `pnpm build:api` (never a bare `--filter` build). **Start:** `node dist/main` from `apps/api`. **Release:** `prisma migrate deploy` + seed once. **Env (all required to boot):** `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `REPORT_SIGNING_PRIVATE_KEY_PEM` (mint fresh — INS-002), `S3_*`, `ALLOWED_ORIGINS` widened. Node 20+, pnpm 9.12.0. Health: `GET /health`.
- verify: `GET https://<host>/health` reports db+redis up from a device off the local network; a phone-browser login round-trip works.
- refs: spec [../in-progress/specs/2026-08-26-inspect-react-native-migration-design.md](../in-progress/specs/2026-08-26-inspect-react-native-migration-design.md) §6 · gates the [INS-086](BACKLOG.md) device pass · [INS-002](BACKLOG.md) related, not gating

### INS-086 · EPIC: React Native app (iOS + Android) — console parity minus Platform Admin, plus camera   [HIGH]
- status: in-progress    # 2026-09-02: **PHASE 4 IS CODE-COMPLETE — every screen-migration-ledger row is BUILT** (25 routes bundle green; ledger: [../reference/screen-migration-map.md](../reference/screen-migration-map.md)). Phases 1–3 shipped earlier (shared packages · scaffold+auth · capture loop w/ offline photo queue + mobile's Vitest suite). The sweep also fixed six live web bugs, turned two API P2002 500-leaks into 409s (duplicate styleNumber / poNumber), grew `@inspect/domain` to 29 tests (status sets+buckets, report display, ranking, hashing), and moved ~14 wire shapes into `@inspect/shared-types`. **The epic now waits on exactly one thing (user decision 2026-09-02: verify ONCE, after Phase 4): the on-device acceptance pass. [INS-090](BACKLOG.md) is done and `eas.json` carries the real origins (`EXPO_PUBLIC_INSPECT_API_URL` + `EXPO_PUBLIC_INSPECT_WEB_URL`) as of 2026-09-02 — what remains is `eas build --profile preview --platform android` and walking the ledger on the phone.** Known deferrals recorded in the ledger: preset reference-image upload + company-logo upload (both need an expo-image-picker decision); direct add-member stays web-only. Full phase-by-phase history: the archive + git log.
- area: Mobile / Architecture
- evidence: `apps/mobile` (Expo SDK 57, expo-router, RN 0.86) — 25 routes; the four shared packages; the ledger.
- problem: The product needs a native app for the one job a phone is required for — the guided capture cycle with a camera, offline-tolerant, in a factory.
- fix: Approach A — shared `@inspect/{shared-types,api-client,domain,design-tokens}`; UI per platform; the §4.4 re-point rule (a rule moving to domain re-points web in the same change) is non-negotiable.
- verify: An inspector completes a real multi-cycle inspection on a physical device, offline for part of it, and submits; every ledger row's on-device acceptance checked in the single post-Phase-4 pass.
- refs: spec [../in-progress/specs/2026-08-26-inspect-react-native-migration-design.md](../in-progress/specs/2026-08-26-inspect-react-native-migration-design.md) · ledger [../reference/screen-migration-map.md](../reference/screen-migration-map.md) · procedure: the `migrate-screen` skill · `/admin/orgs`, `/portal`, `/r/[token]` permanently web-only

### INS-091 · Pickers cannot create what is missing — four-screen detour to start an inspection   [HIGH]
- status: done
- done: 2026-09-04 — `EntityPicker` (web) / grown `OptionPicker` (mobile) are searchable via the shared `filterOptions` and end in "+ Add new…"; company, product and PO quick-create dialogs/sheets (nested one level) append + select; web `Modal` (portal, focus trap, stack, scroll lock) + `ErrorBanner` replaced every `alert()`; mobile `FormScreen` gives every form keyboard avoidance + persistent taps; `/companies` on mobile can create; both new-inspection forms lost their dead-end empty state and honour the client's `defaultLoopPresetId`. First web component tests (jsdom + Testing Library): `modal.test.tsx`, `entity-picker.test.tsx`. API: `POST /purchase-orders` now answers in the list/get shape (parties included) — found by the browser click-through, where a just-created PO showed "—" for its parties. Verified 2026-09-04 in Chrome (`/inspections/new` → nested PO → company dialogs → inspection created) and on the Android emulator (same nested flow via sheets; one tap on Create works with the keyboard up).
- area: Console + mobile (forms/pickers) / shared contract
- evidence: `apps/web/app/(console)/inspections/new/create-form.tsx` (former dead-end paragraph), `apps/mobile/src/app/inspections/new.tsx` ("create … in the console first"), no `/companies/new` on mobile.
- problem: Every related-entity picker was an unsearchable list with no create path; starting an inspection on a fresh org meant four screens (two on another platform for mobile) and the form's typed state was lost.
- fix: Inline quick-create from pickers on both platforms + the friction blockers on the same screens.
- verify: On an org with zero POs, `/inspections/new` on web and mobile reaches a created inspection without leaving the screen; `grep alert(` finds nothing under `apps/web/app/(console)`.
- refs: spec [../done/specs/2026-09-04-inline-create-and-friction-design.md](../done/specs/2026-09-04-inline-create-and-friction-design.md) · plan [../done/plans/2026-09-04-inline-create-and-friction.md](../done/plans/2026-09-04-inline-create-and-friction.md)

---

## Medium

### INS-089 · Nothing records who generated a signed report   [MEDIUM]
- status: todo            # filed 2026-08-27 during INS-086 Phase 1, by the wire-contract guard. `ReportDto` declared a `generatedBy` relation the Report model has no column for, so `report.generatedBy?.name` was always undefined and the branded report's tamper-proof block rendered '—' for "signed by" on EVERY report. The phantom field is removed and the read is now an explicit `null`; actually capturing the signer needs a schema change, which is this item.
- area: Reports & verification
- evidence: `apps/api/prisma/schema.prisma` `model Report` has no `generatedByUserId`; `reports.service.getForOrg()` includes only `deliveries` + `accesses`; both the web report page and mobile's `/inspections/[id]/report` render '—' for "signed by".
- problem: The report is the product's binding artifact and its tamper-proof panel claims to name a signer. The Ed25519 signature is the platform's, not a person's, so the panel is really asking "which human stands behind this call" — and the answer is not stored. The canonical snapshot does carry `aqlResult.decidedByUserId`, but that is an id, not a name.
- fix: Decide what "signed by" means first — the QA Manager who made the binding decision is the honest answer, and `AqlResult.decidedByUserId` already records it. Either resolve that id to a name on the report read, or add `generatedByUserId` to `Report` and set it in `generate()`. Do NOT backfill onto existing rows and do NOT touch `canonicalSnapshot`/`contentHash`/`signature` — a presentation fix on top of signed data, not a change to it.
- verify: A generated report shows a real person's name in the tamper-proof block; `GET /reports/verify/:token` still returns `valid:true` for reports signed before and after; `wire-contract.spec.ts` stays green.
- refs: found by `apps/api/src/common/wire-contract.spec.ts` · archive: INS-038 (signature coverage), INS-039 (audit actor identity)

---

## Low

### INS-034 · Workspace CRUD and onboarding modules untested   [LOW]
- status: in-progress    # reduced to ONE module: `guest` alone has no spec. Deliberately deferred — the mobile app never touches the buyer-guest portal (permanently web-only, decision D1) — but the guest visibility predicate is a security boundary (clientCompanyId AND orgId), so a spec is still worth writing.
- area: Workspace CRUD
- evidence: `apps/api/src/guest/` has no `*.spec.ts`.
- problem: The guest module's magic-link auth and report-visibility predicate are unverified by unit tests (the integration suite does cover the guest read path).
- fix: Add a guest.service spec pinning: token→guest resolution, ACTIVE+unexpired checks, and the client-role-only visibility predicate (a factory's guest must never see the client's report).
- verify: Spec green; mutation-check that dropping `clientCompanyId` from the predicate fails a test.
- refs: [../done/specs/2026-06-06-inspect-mvp-requirements-design.md](../done/specs/2026-06-06-inspect-mvp-requirements-design.md) §4.2

### INS-087 · PO party pickers ignore trade role when ranking   [LOW]
- status: todo            # filed 2026-08-26 during INS-055. 2026-09-02: the comparator was consolidated into `@inspect/domain` `rankCompaniesByActivity` (web + mobile both read it), so when per-role counts land the change really is one place now.
- area: Console + mobile (purchase orders) / shared contract
- evidence: `packages/domain/src/company-ranking.ts` ranks by the flattened `_count.purchaseOrders`; `CompaniesService.list()` deliberately flattens the four role edges into one count, so the wire shape cannot distinguish roles.
- problem: INS-055 spec §0 P3 rejected `canBeClient`/`canBeFactory` flags and promised "rank by recently used in THAT role" instead. The replacement was never built — both pickers render identically ordered.
- fix: (a) expose per-role counts on the DTO (`asClient`/`asFactory` alongside the flattened counts) and rank each picker on its own edge; or (b) drop the promise and rank by name. (a) is the honest reading of the spec.
- verify: The Client picker's top entries differ from the Factory picker's for an org where different companies play the two roles; the flattened `_count` the directory renders is unchanged.
- refs: archive: INS-055 spec §0 P3 · `companies.service.spec.ts` "flattens the four role-edge counts"

### INS-085 · `pnpm api test` exits 134 / fails on Windows after tests report green   [LOW]
- status: todo            # annotated. Mechanism identified 2026-08-26: V8 OOM in Jest's parallel workers under memory pressure ("Zone Allocation failed", exit 134) — reproduced again 2026-09-02 as "Deriving bits failed" in the four scrypt-exercising suites + 2 worker crashes (608/656 ran); the serial `--runInBand` re-run was 656/656 and Linux CI stayed green. Not a code bug. Suggested fix: pin `maxWorkers` in the API jest config; until then, `node_modules/.bin/jest --runInBand` is the Windows command.
- area: Infra & CI
- evidence: parallel-run failures land only in scrypt/crypto-heavy suites and only under low free RAM; `--runInBand` is deterministic-green; CI (Linux) green.
- problem: The API's verification command cries wolf on Windows, costing a diagnosis each time or training people to ignore it.
- fix: Set `maxWorkers` (e.g. `50%`) in `apps/api/jest` config; close after a green stretch of parallel runs on this machine.
- verify: `pnpm api test` exits 0 on Windows repeatedly without `--runInBand`; CI stays green.
- refs: [../in-progress/specs/2026-08-26-inspect-react-native-migration-design.md](../in-progress/specs/2026-08-26-inspect-react-native-migration-design.md) §3 P0-10

### INS-092 · UX friction audit residue (2026-09-04)   [LOW]
- status: todo
- area: Console + mobile
- evidence: audit recorded in the INS-091 spec §0; each line below names its file.
- problem: Papercuts found while auditing for INS-091 and deliberately left out of it. **Web:** no shared Field/Input/Label primitives — styles copy-pasted in ~8 forms; create-from-list actions redirect to the detail page and lose the list (`dashboard/actions.ts` createCompany, `products/actions.ts`, `purchase-orders/actions.ts`); PO client/factory/product immutable after create with no UI hint (`purchase-orders/[id]/edit-form.tsx`); no breadcrumb component (three hand-rolled); `directory-client.tsx` row click uses `window.location.href`; the Create Company submit lacks `loading=` (no double-submit guard); `users-client.tsx` "Add member" toggle discards typed input; `/inspections/new` preset dropdown lists every version of every preset (INS-076 residue). **Mobile:** no shared Field/Input/Button primitives; sub-44pt targets (`presets/new.tsx` reorder glyphs, `users.tsx` deactivate link, `companies/index.tsx` chips); no `RefreshControl` on any `[id]`/`new` screen; retry re-runs the whole `Promise.all`; no success feedback after create (no toast primitive); `products/new.tsx` form flashes before the role probe resolves; AQL preview flickers to a spinner on every debounce; `users.tsx` role change is non-optimistic; PO list has no search/paging (API `GET /purchase-orders` takes no query params); `presets/new.tsx` dead `void seed;`.
- fix: Pick per item; the shared-primitive extractions on each platform are the highest-leverage first steps.
- verify: Per item.
- refs: [BACKLOG.md](BACKLOG.md) INS-091 · INS-087 (per-role picker ranking, related)

---

## ⚠️ Needs a human

> Nothing here is blocked on engineering. Each needs a credential or a decision only the account owner has.

1. **[INS-086](BACKLOG.md) device pass** — the API is deployed and `eas.json` carries the real origins
   ([INS-090](BACKLOG.md) done 2026-09-02); run `eas build --profile preview --platform android`
   (`eas` is already authenticated) and walk the ledger on a phone.
2. **[INS-002](BACKLOG.md)** — rotate the QCLink credentials (DB, Redis, S3, JWT secrets — the user
   has said everything will be rotated after INS-090; the remote signing key is already fresh) and
   decide on the git-history scrub.
3. **Product decisions parked in [STATUS](../STATUS.md) observations** — whether a preset's defect-tag
   selection should LIMIT populate's tag list (today populate offers the whole org catalog), and whether
   an archived company being silently editable via `PATCH /companies/:id` is acceptable.
