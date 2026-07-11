# Backlog — Inspect

> Source of truth for remaining work. Severity-grouped. Every item has a stable `INS-NNN` id —
> plans and commit messages reference items by id, and ids are never reused.
> Derived from the verified 2026-06-20 code audit (docs + `apps/api` + `apps/web` + Prisma schema).
> Keep each `status` current (see [../../CLAUDE.md](../../CLAUDE.md) → Documentation workflow). Dashboard: [../STATUS.md](../STATUS.md).

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

### INS-001 · Stack has never run against a real Postgres/Redis   [BLOCKER]
- status: done            # 2026-06-20: FULL LOOP VERIFIED LIVE end-to-end (acceptance a+b) — the committed smoke driver (apps/api/scripts/smoke-loop.mjs) drives all 25 steps 2xx against the Railway Postgres+Redis. 2026-07-11: acceptance (c) closed — the smoke assertions folded into a 36-test Jest integration suite (apps/api/test/integration/: negative RBAC matrix, live token refresh, core loop, tamper-evidence + immutability regressions) verified green vs the live Postgres, plus .github/workflows/ci.yml running migrate→seed→unit→integration against containerized Postgres 16 + Redis 7 (+MinIO for the INS-023 byte path) on every push/PR.
- area: Infra & CI
- evidence: `prisma/migrations/` has only `00000000000000_init` (never applied); API testCount is "compiles, type-checks; logic unit-tested"; only `apps/api/test/app.e2e-spec.ts` (1 test) exists.
- problem: The entire DB-bound surface (auth login/me, guards, onboarding, all CRUD, inspection lifecycle, populate, reports, audit) is coded but has **never executed against a real database**. Correctness, migrations, FK policies, and the seven app-layer invariants are all unproven.
- fix: Bring up `docker-compose.dev.yml` (Postgres 16 + Redis 7 + MinIO), run `prisma migrate deploy` + `db seed`, generate an Ed25519 keypair, boot the API, and drive the core loop (login → create inspection → populate → submit → AQL evaluate → sign report → verify token) manually and via a smoke e2e (testcontainers).
- verify: `prisma migrate status` shows the init migration applied; the API boots clean; a scripted login→create→submit→decision→report flow returns 2xx end-to-end against a containerized Postgres.
- refs: [../done/plans/2026-06-20-ins-001-stand-up-and-verify.md](../done/plans/2026-06-20-ins-001-stand-up-and-verify.md) (runbook) · [../done/plans/2026-06-07-inspect-status-and-next-steps.md](../done/plans/2026-06-07-inspect-status-and-next-steps.md) (Phase A)

### INS-002 · Committed real-looking secrets in `.env.example`   [BLOCKER]
- status: in-progress    # 2026-06-20: .env.example scrubbed to placeholders (working tree clean, verified). PENDING (user-side): rotate the live Railway creds + decide on git-history scrub.
- area: Infra & CI
- evidence: `.env.example:22` `POSTGRES_PASSWORD="gIqPI…"`, `:31` `REDIS_PASSWORD="uuDWR…"`, `:10-11` live-shaped `DATABASE_URL`/`DATABASE_PUBLIC_URL` — real-looking Railway credentials, not placeholders. `.gitignore` correctly ignores `.env*` but `.env.example` is (intentionally) tracked, so the values ship in git.
- problem: Real-looking DB/Redis passwords (and other secret-shaped values) are committed in the tracked `.env.example`. Anything live must be rotated and scrubbed before a public/Railway deploy, or tenant isolation + the tamper-proof signing guarantee are compromised.
- fix: Replace every value in `.env.example` with obvious placeholders (`<postgres-password>`); rotate any credential that was ever real in Railway; confirm no other secret is committed (scan history); regenerate the Ed25519 report-signing keypair.
- verify: `.env.example` contains only placeholders; a secret scan of tracked files + history finds no live credential; the signing keypair used in any prior commit is rotated/revoked.
- refs: [../done/plans/2026-06-20-ins-001-stand-up-and-verify.md](../done/plans/2026-06-20-ins-001-stand-up-and-verify.md)

### INS-035 · Invitation accept can take over / relocate a cross-org account   [BLOCKER]
- status: done            # 2026-07-11 (security review): fixed. accept() now looks up the existing user by (globally-unique) email and throws ForbiddenException if it belongs to a different org; invite-creation paths (users.service.invite, orgs.service.create) also refuse an email already registered in another org. Regression spec: invitations.service.spec.ts (cross-tenant reject + brand-new activate + same-org allow).
- area: Tenancy & onboarding
- evidence: `apps/api/src/invitations/invitations.service.ts` `accept()` upserted `tx.user` keyed on `where:{email}` (User.email is `@unique` globally, `schema.prisma:196`) with no org check.
- problem: Any ORG_OWNER could invite an email that already had an account in another tenant; accepting the invite (public `POST /invitations/accept`) rewrote that user's `orgId`, `role`, `passwordHash` and `status` — a silent cross-tenant account takeover + password reset, orphaning the victim's org if they were its sole owner.
- fix: Scope the accept to `invitation.orgId`; refuse if an account with that email exists in a different org; block inviting an already-registered foreign email at creation time.
- verify: Accepting an invite for an email owned by another org is rejected (403) and the foreign account is untouched; a brand-new or same-org invitee still activates. ✅ unit-tested.
- refs: security review 2026-07-11 · [../reference/inspect-schema.md](../reference/inspect-schema.md) (§2 tenant isolation)

---

## High

> **Security review batch (2026-07-11).** INS-036..039 below were surfaced by the multi-agent business-logic
> review + adversarial-verification pass and fixed in the same session. The AQL engine reviewed clean.

### INS-036 · JWT secret falls back to a source-visible default (forge PLATFORM_ADMIN)   [HIGH]
- status: done            # 2026-07-11 (security review): fixed. Removed the `?? 'dev-access-secret'`/`'dev-refresh-secret'` fallbacks (new auth/jwt-secret.ts `requireSecret` throws on missing/CHANGE_ME); added a fail-closed ConfigModule `validate` in app.module.ts that refuses to boot without strong JWT_ACCESS_SECRET/JWT_REFRESH_SECRET, mirroring the REDIS_URL hard-fail. type-check + 100 tests green.
- area: Auth & RBAC
- evidence: `apps/api/src/auth/jwt-auth.guard.ts:40` + `auth.service.ts:22,25` used `?? 'dev-*-secret'`; no boot-time validation; `.env.example` shipped the secrets as `CHANGE_ME`.
- problem: If JWT_ACCESS_SECRET is unset (or left as CHANGE_ME) the app booted anyway and both issued and verified tokens under a public constant, so anyone could HMAC-sign a `{role:'PLATFORM_ADMIN', orgId:null}` access token and gain the sole cross-tenant principal — total auth bypass.
- fix: Fail closed — no default secret; validate at boot; verify at point of use.
- verify: Booting without a strong JWT_ACCESS_SECRET/JWT_REFRESH_SECRET throws; a forged token signed with any guessed default is rejected.
- refs: security review 2026-07-11

### INS-037 · Invitation token uses guessable cuid() default instead of a CSPRNG   [HIGH]
- status: done            # 2026-07-11 (security review): fixed. users.service.invite + orgs.service.create now set `token: randomUUID()` explicitly (mirroring buyer-guests.service). Rate-limiting the public accept route remains a follow-up (see INS-047).
- area: Tenancy & onboarding
- evidence: `schema.prisma:227` `token String @unique @default(cuid())`, never overridden; the only credential on the unauthenticated `POST /invitations/accept`.
- problem: cuid v1 is Math.random-backed (not a CSPRNG); an attacker who observes any same-process cuid (their own invite token, or a public `Report.verificationToken`) can narrow the search space and guess a valid invitation token to activate an account.
- fix: Generate the token with a CSPRNG (`randomUUID`) on create; add rate limiting to the accept endpoint.
- verify: Invitation tokens are UUIDv4 (128-bit CSPRNG); grep shows no reliance on the cuid default for security tokens.
- refs: security review 2026-07-11

### INS-038 · Signed report canonicalSnapshot omits the defect list + quantity/notes   [HIGH]
- status: done            # 2026-07-11 (security review): fixed. reports.service.generate() now includes defects (with evidence photoIds), supplier/product, and freezes quantity/carton fields, workmanship/packaging notes, inspectionType, and the decision author/timestamp into the Ed25519-signed canonical; payload is normalized via JSON round-trip before hashing so generate-time and verify-time hashes match (also closes the undefined→null jsonb-drop trap). type-check + tests green.
- area: Reports & verification
- evidence: `apps/api/src/reports/reports.service.ts:46-76` (pre-fix) hashed only buyer/PO/aqlResult(perClass)/loops/photoHashes — never the DefectInstance rows or quantity/notes.
- problem: The core buyer-facing content (defect narrative + photo-evidence mapping, quantity shortfall, cartons, workmanship/packaging notes) was OUTSIDE the tamper-proof envelope, so it could be altered after signing while public `GET /reports/verify/:token` still returned `valid:true` — defeating the central tamper-proof guarantee.
- fix: Add every buyer-visible result field (incl. an ordered, canonicalized defect list with evidence ids) to the signed canonical.
- verify: Editing a DefectInstance / quantity field after report generation makes public verification return `valid:false`.
- refs: security review 2026-07-11 · [../done/specs/2026-06-06-inspect-mvp-requirements-design.md](../done/specs/2026-06-06-inspect-mvp-requirements-design.md) (§9)

### INS-039 · Audit hash omits actor identity + timestamp (forgeable attribution)   [HIGH]
- status: done            # 2026-07-11 (security review): fixed. audit.service.append() now folds orgId, actorType, actorUserId, ipAddress, userAgent and an app-assigned createdAt (ISO) into the versioned payloadHash, so a direct row UPDATE of the "who"/"when" breaks the chain and verifyChain() detects it. Corrected the misleading concurrency NOTE. type-check + tests green.
- area: Tamper-proof & audit
- evidence: `apps/api/src/audit/audit.service.ts:36-46` (pre-fix) hashed only action/entityType/entityId/metadata; actorUserId/actorType/createdAt were persisted outside the hash.
- problem: An attacker with DB write access (the exact threat a hash chain defends against) could rewrite `actor_user_id`/`created_at` on any audit row and `verifyChain()` still returned true — the forensically decisive fields were forgeable with no tamper evidence.
- fix: Fold all immutable, security-relevant columns (incl. an application-assigned timestamp) into the payload hash; version the payload format.
- verify: A direct UPDATE of actor/timestamp on an audit row breaks chain verification. (Full DB-backed audit.service spec is INS-013.)
- refs: security review 2026-07-11 · [../reference/inspect-schema.md](../reference/inspect-schema.md) (§9)

### INS-003 · PDF binary is never rendered   [HIGH]
- status: todo
- area: Reports & verification
- evidence: `apps/api/src/reports/reports.service.ts:97` — comment "pdfStorageKey is set when the PDF binary is rendered (pdf-lib, follow-up)"; no `pdf-lib`/`pdfkit`/`puppeteer` in `apps/api/package.json`.
- problem: `reports.service` creates the signed report record + Ed25519 signature but never produces a PDF; `pdfStorageKey` stays null, so there is no per-buyer-branded artifact to deliver, download, or verify — a core MVP deliverable is absent.
- fix: Add `pdf-lib`; render the `canonicalSnapshot` into a per-buyer-branded PDF matching `BrandedReport`; hash the bytes consistently with the signed content; upload to S3/MinIO; set `report.pdfStorageKey` and embed hash+signature in the footer.
- verify: Generating a report writes a non-null `pdfStorageKey` pointing to a downloadable PDF whose content hash matches the signed hash.
- refs: [../done/specs/2026-06-06-inspect-mvp-requirements-design.md](../done/specs/2026-06-06-inspect-mvp-requirements-design.md) (§9/§10)

### INS-004 · Email / magic-link delivery not implemented   [HIGH]
- status: done            # 2026-07-11: @Global MailModule + MailService (nodemailer — SMTP_URL transport, dev/json fallback when unset, logged once at boot). users.invite, orgs.create (first ORG_OWNER, sent post-commit), and buyer-guests.invite now await sendUserInvitation / sendBuyerGuestMagicLink built on WEB_BASE_URL (/invite?token&email&role, /portal?token — URL-encoded). Sends never throw (failures log + return {sent:false}) so the business write survives; the copyable link stays in each response as fallback. New env SMTP_URL/MAIL_FROM/WEB_BASE_URL in .env.example + turbo.json globalEnv. Review-hardened same day: short SMTP timeouts (5s connect/greeting, 10s socket — nodemailer's 30–120s defaults would stall the invite HTTP path), malformed/scheme-less SMTP_URL degrades loudly to dev/json mode instead of crashing boot, dev/json mode actually logs each message, and invite/guest responses expose emailSent. 24 new unit tests (mail/users/orgs/buyer-guests specs), API suite 135 green; not yet exercised against a real SMTP server. Report-delivery email + ReportDelivery rows remain INS-020 (blocked on INS-003 PDF).
- area: Tenancy & onboarding
- evidence: `apps/api/src/buyer-guests/buyer-guests.service.ts:33` comment calls the token "the credential to send them" but `invite()` just returns it to the caller; no `nodemailer`/SMTP in `apps/api/package.json`.
- problem: Invitations, buyer-guest magic links, and report deliveries generate tokens but nothing emails them, so onboarding and report delivery cannot complete without manually copying tokens.
- fix: Add an email provider (`nodemailer`/SMTP, dev stream transport); send invitation, buyer-guest magic-link, and report-delivery emails; write `ReportDelivery`/`DeliveryChannel` rows on send.
- verify: Inviting a user / buyer guest / delivering a report sends an email with the correct tokenized link and writes a delivery record; no token is returned to the API caller as the only credential.
- refs: [../done/plans/2026-06-06-inspect-phase2-auth-tenancy.md](../done/plans/2026-06-06-inspect-phase2-auth-tenancy.md) (Task 7)

### INS-005 · Aggregation / count / dashboard endpoints absent   [HIGH]
- status: todo
- area: Workspace CRUD
- evidence: grep `count|stats|summary|aggregate|dashboard|metrics` across `*.controller.ts` = zero routes; `inspections.controller.ts` exposes only `GET /`, `GET /:id`, `POST`, `POST /:id/submit`, `POST /:id/decision`.
- problem: No endpoints return counts/rollups, so dashboard and list screens cannot show real PO/product/report/last-activity figures; the web list screens collapse those columns to "—" even in live mode.
- fix: Add aggregation endpoints (`/buyers` with `_count` relations, a dashboard summary, an inspections list with status counts), `@@index`-backed and `orgId`-scoped.
- verify: GET dashboard/list endpoints return relation counts; the dashboard and presets screens render real numbers instead of "—" when live.
- refs: [../done/plans/2026-06-07-inspect-status-and-next-steps.md](../done/plans/2026-06-07-inspect-status-and-next-steps.md) (Phase C)

### INS-006 · Audit-on-write not enforced across mutations   [HIGH]
- status: todo
- area: Tamper-proof & audit
- evidence: `audit.append` called in only TWO places — `reports.service.ts:104` (report.generated) and `orgs.service.ts:45` (org.created); inspections submit/decide, populate, and all workspace CRUD mutate **without** audit entries.
- problem: The append-only hash-chained audit log is meant to record every mutating action, but ~13 mutating services write none, leaving the tamper-evidence story incomplete and the chain sparse.
- fix: Wrap every mutating service action in the audited write transaction and call `audit.append` with the right event kind, asserting the `prevEntryHash` chain and monotonic per-org sequence.
- verify: Each mutating action (inspection create/submit/decide, populate add-defect/register-photo/add-measurement, all CRUD) writes exactly one `AuditLog` row with a correct chain link; an audit-chain integration test passes.
- refs: [../reference/inspect-schema.md](../reference/inspect-schema.md) (§6/§7)

### INS-007 · populate.service invariant-heavy logic has no tests   [HIGH]
- status: todo
- area: Populate console
- evidence: `populate.service.ts` enforces LOCKED immutability, catalog-XOR-custom (`addDefect:130-135`), and `clientRequestId` idempotency but has no spec (module `tested:false`).
- problem: The populate service is the only place enforcing immutability of submitted inspections, catalog-XOR-custom, and photo idempotency, yet it is completely untested — regressions in these critical invariants would go unnoticed.
- fix: Add unit/integration specs covering: writes rejected once status is LOCKED, `addDefect` rejecting both-set and both-null defect inputs, and `registerPhoto` deduping on `(orgId, clientRequestId)`.
- verify: New `populate.service.spec` passes, asserting each invariant path (locked-reject, XOR-reject, idempotent-replay) with explicit cases.
- refs: [../done/specs/2026-06-06-inspect-mvp-requirements-design.md](../done/specs/2026-06-06-inspect-mvp-requirements-design.md)

### INS-008 · @inspect/shared-types built but never linked   [HIGH]
- status: todo
- area: Infra & CI
- evidence: package exists at `packages/shared-types` (dist+src) but the only reference in `apps/` is a comment in `apps/api/src/auth/rbac.ts:7`; it is not in `apps/api` or `apps/web` `package.json`. (README marks it "done" — a contradiction.)
- problem: The shared contract package is effectively dead code: API and web each redeclare their own types, so the client/server contract can silently drift.
- fix: Add `@inspect/shared-types` as a workspace dependency in both apps; replace duplicated role/enum/DTO types with imports from it; remove the placeholder comment in `rbac.ts`.
- verify: grep shows real `import … from '@inspect/shared-types'` in both apps; both build with the shared types as the single source of truth.
- refs: [../done/plans/2026-06-06-inspect-phase1-foundation-domain-core.md](../done/plans/2026-06-06-inspect-phase1-foundation-domain-core.md) (Task 7)

### INS-009 · No integration/e2e suite against a real DB; CI absent   [HIGH]
- status: done            # 2026-07-11: 36-test Jest integration suite at apps/api/test/integration/ (run: pnpm api test:integration; env-driven DATABASE_URL/REDIS_URL — the repo-root .env locally, service containers in CI). Covers the negative RBAC matrix (401 no/garbage/forged-dev-secret/expired/refresh-as-access tokens; 403 role floors incl. the no-org-admin tenant guard; cross-org 404s + list isolation; INS-035 cross-tenant invite refusal), the live token-refresh round-trip, the full 25-step core loop, DB-level tamper-evidence (INS-038) and post-lock immutability, and the presigned byte-upload path (INS-023, self-skips without MinIO). Verified green against the live Railway Postgres+Redis. CI: .github/workflows/ci.yml (Postgres 16 + Redis 7 services, MinIO via docker run, per-run Ed25519 key, migrate→seed→type-check→unit→integration→build) on push/PR to main. Chose env-driven service containers over testcontainers (no Docker on the dev machine; CI provides the containers).
- area: Infra & CI
- evidence: only `apps/api/test/app.e2e-spec.ts` (1 test); all 97 passing tests are pure-unit; no CI workflow in the repo.
- problem: Nothing exercises Prisma, guards, RBAC-by-`orgId`, or the inspection lifecycle against a database, and there is no CI gate, so DB-layer regressions are invisible.
- fix: Add a testcontainers-backed integration suite for the core flows and tenant-isolation, and a CI workflow running lint + unit + integration on every PR.
- verify: CI runs unit + a testcontainers integration suite green on a clean checkout; tenant-isolation tests prove `orgId` scoping blocks cross-org reads.
- refs: [../reference/inspect-build-index.md](../reference/inspect-build-index.md)

### INS-010 · Composite-FK tenant guard not DB-enforced (orgId alignment)   [HIGH]
- status: todo
- area: Data model & schema
- evidence: single-column FKs only — `inspection_loops_orgId_fkey`, `photos_orgId_fkey` reference `organizations(id)`, never a composite parent key (`schema.prisma` convention note + [inspect-schema.md](../reference/inspect-schema.md) §7).
- problem: Children (InspectionLoop, Photo, DefectInstance, AqlResult, BuyerGuest) carry a denormalized `orgId` the DB never checks against their parent aggregate, so a bug or bad write could attach a child to the wrong tenant with no DB rejection.
- fix: Add the opt-in composite-FK hardening (`@@unique([id, orgId])` on parents + `references:[id, orgId]` on children), or enforce alignment in a data-access layer that always loads children through their org-scoped parent.
- verify: Writing a child row with an `orgId` different from its parent is rejected (DB constraint or service guard); an integration test proves it.
- refs: [../reference/inspect-schema.md](../reference/inspect-schema.md) (§7)

### INS-022 · Web client has no write helper (apiPost/Put/Patch/Delete)   [HIGH]
- status: done    # 2026-07-11: apiPost/Put/Patch/Delete + apiSend + ApiError (surfaces NestJS messages) live in apps/web/lib/api.ts (:105-137) and consumed by every server-action file (inspections/presets/dashboard/users/products/purchase-orders/buyers/suppliers/invite/populate/guests actions.ts). The full write loop was exercised live against the Railway DB (2026-06-20 smoke). Closed by the security-review pass verification.
- area: Web console
- evidence: `apps/web/lib/api.ts:15-39` exposes only `apiGet` + `loadOrFallback`; the only POST in the whole app is `lib/auth.ts:26` (login).
- problem: No screen can perform any mutation through the client because the API client exposes only reads, so every primary action button across the console is structurally inert.
- fix: Add authenticated `apiPost/apiPut/apiPatch/apiDelete` helpers in `lib/api.ts` that attach the session JWT and surface API errors — unblocking all write screens.
- verify: `lib/api.ts` exports working mutation helpers that attach the bearer token; a smoke call (e.g. create buyer) succeeds against the live API.
- refs: [../done/plans/2026-06-07-inspect-status-and-next-steps.md](../done/plans/2026-06-07-inspect-status-and-next-steps.md) (Phase B) — **prerequisite for INS-023/024/026/027/029/030.**

### INS-023 · Populate screen fully static (no upload/tag/measure/submit)   [HIGH]
- status: done            # 2026-06-28: parameterized `/inspections/[id]/populate` wired — PLATFORM_ADMIN-gated server page loads inspection + defect catalog; `populate-workspace.tsx` client component drives loop sidebar, photo presign+register, defect tag (catalog + custom), measurement save, and submit-for-review via Server Actions; DB-side (presign metadata + defect + measurement) works without MinIO. 2026-07-11: the real photo BYTE path now has an e2e (test/integration/storage-bytes.e2e-spec.ts — presigned PUT of real bytes + register with their true sha256) that runs in CI against MinIO and self-skips where object storage is unreachable; local MinIO still needs Docker (docker-compose.dev.yml).
- area: Web console
- evidence: `apps/web/app/(console)/populate/page.tsx:57-58,104` — Save / Submit / Upload buttons have no handlers; all loop/shot/tag/measurement data is hardcoded.
- problem: The Platform-Admin populate flow — the one role that owns photo upload, defect tagging, measurements, and submit-for-review — does nothing on the web; the backend populate service is unreachable from the UI.
- fix: Wire the screen to presigned S3/MinIO upload, defect-tag POST, measurement save, and submit-for-review, using the new write helpers (INS-022) + the populate endpoints.
- verify: A real photo uploads to MinIO, a defect tag and measurement persist, and Submit transitions the inspection to SUBMITTED.
- refs: [../done/specs/2026-06-06-inspect-mvp-requirements-design.md](../done/specs/2026-06-06-inspect-mvp-requirements-design.md) (§6/§11)

### INS-024 · Loop-preset builder static (no persistence)   [HIGH]
- status: done    # 2026-06-28: Full builder client component wired — useState/useTransition, loop sidebar, +/− shot counter, togglable defect chips (grouped by severity from live catalog), measurement fields, custom defect creation, createPreset server action with redirect on success. /presets/new?from=:id seeds builder from existing preset (new-version flow). /presets/[id] detail page shows read-only step view. List page has search (client-side) + sort + MoreVertical menu (archive + duplicate).
- area: Web console
- evidence: `apps/web/app/(console)/presets/new/page.tsx:66-67,139,175,193` — Cancel/Save/Add buttons have no `onClick`; inputs are `defaultValue`; "Saved 2 min ago" is mock.
- problem: The preset builder cannot create/update presets or add loops/shots/defects/measurements, so the versioned loop-preset feature has no usable UI despite a working backend service.
- fix: Add client state and wire create/update preset + add-loop/shot/defect/measurement actions to the loop-presets endpoints.
- verify: Saving a new preset persists it; it appears (with version + step count) on the presets list when live.
- refs: [../done/specs/2026-06-06-inspect-mvp-requirements-design.md](../done/specs/2026-06-06-inspect-mvp-requirements-design.md) (§6/§11)

### INS-025 · Buyer guest portal fully static (no token auth, no real fetch/download)   [HIGH]
- status: done            # 2026-06-28: `/portal?token=TOKEN` wired — server component reads token, calls GET /guest/reports?token=… (unauthenticated via apiGetPublic), maps canonicalSnapshot+brandingSnapshot → BrandedReportData; PortalClient renders sidebar list + BrandedReport panel; error cards for missing/expired tokens; Verify link to /r/:verificationToken; Download PDF enabled when pdfStorageKey set.
- area: Guest portal
- evidence: `apps/web/app/portal/page.tsx:8-13,88` — `reports[]` hardcoded, Download PDF has no `onClick`, guest identity hardcoded, no token/searchParams.
- problem: The read-only buyer portal does not authenticate via magic-link token, does not fetch a buyer-scoped report list, and cannot download a real PDF, so the buyer-facing deliverable is non-functional.
- fix: Read the magic-link token from `searchParams`, exchange it via the guest endpoint, render the buyer-scoped live report list, and wire Download PDF to the signed report URL.
- verify: Visiting `/portal` with a valid guest token shows that buyer's real reports and downloads the actual signed PDF; an invalid token is rejected.
- refs: [../done/specs/2026-06-06-inspect-mvp-requirements-design.md](../done/specs/2026-06-06-inspect-mvp-requirements-design.md) (§10)

### INS-026 · Create-inspection screen static (no dropdown reads, no create)   [HIGH]
- status: done            # 2026-06-20: PO-driven create wired — selectors from /purchase-orders + /loop-presets + /users; lot size drives a live AQL plan via a new read-only GET /inspections/aql-preview (TDD, reuses computeSampling); a Server Action creates the inspection (snapshot + computedSampling) and redirects to its review page. A minimal inspections list was added too. Verified live (authed render shows seeded PO/preset + computed AQL panel).
- area: Web console
- evidence: `apps/web/app/(console)/inspections/new/page.tsx:31-32` buttons no handler; `:44-133` all selectors are static divs with hardcoded values; AQL plan from a static token.
- problem: The QA Manager cannot create or assign an inspection — buyer/supplier/product/preset/inspector selectors are hardcoded and Create & assign / Save draft do nothing — so the core loop cannot start from the UI.
- fix: Populate the selectors from `/buyers`, `/suppliers`, `/products`, `/loop-presets`, `/users`; compute the AQL plan from lot size; wire Save draft / Create & assign to the inspections create endpoint.
- verify: Selecting real entities and submitting creates an inspection with a snapshotted preset + computed sampling, visible in the inspections list.
- refs: [../done/specs/2026-06-06-inspect-mvp-requirements-design.md](../done/specs/2026-06-06-inspect-mvp-requirements-design.md) (§11)

### INS-027 · QA decision (Pass/Fail/Hold) never persisted   [HIGH]
- status: done            # 2026-06-20: id-routed /inspections/[id]/review wired — Submit-for-review (POST /:id/submit) + controlled Pass/Fail/Hold radios + required note -> POST /:id/decision via Server Actions; render is state-driven by inspection status (submittable / decidable / final). NOTE: the submit affordance lives in the QA console for this slice; it migrates to the admin populate screen when INS-023 lands.
- area: Web console
- evidence: `apps/web/app/(console)/review/page.tsx:129-154` — decision radios are `<label>` with no `onChange`, note is a `defaultValue` textarea, Submit decision has no `onClick`; `decision` is a hardcoded const "fail" (line 12).
- problem: The binding QA pass/fail/hold decision and decision note do not POST anywhere, so the human verdict — a required step in the loop — cannot be recorded from the web.
- fix: Make the decision radios + note controlled inputs and wire Submit decision to `POST /inspections/:id/decision`.
- verify: Submitting a decision records it on the inspection (status + decision + note) and reflects back on reload.
- refs: [../done/specs/2026-06-06-inspect-mvp-requirements-design.md](../done/specs/2026-06-06-inspect-mvp-requirements-design.md) (§8/§11)

---

## Medium

### INS-040 · supersedesInspectionId written unvalidated (cross-tenant link + billing manipulation)   [MEDIUM]
- status: done            # 2026-07-11 (security review): fixed. inspections.service.create() now validates supersedesInspectionId with findFirst({id, orgId}) before writing (mirroring poId/loopPresetId/assignedInspectorId), so a re-inspection can only supersede a same-org inspection and the RE_INSPECTION BillableEvent classification can't be forced from a foreign/unrelated id. type-check + tests green.
- area: Inspection lifecycle
- evidence: `apps/api/src/inspections/inspections.service.ts:120` (pre-fix) wrote `input.supersedesInspectionId` with no org check; the self-FK (`schema.prisma:533`) enforces existence only.
- problem: A QA_MANAGER could link a new inspection to another tenant's inspection (cross-tenant reference + onDelete:Restrict coupling) and, more readily, force any first inspection to be billed as a RE_INSPECTION (submit() derives the kind solely from this field).
- fix: Org-scope the supersedes id on create (optionally also assert a terminal prior status).
- verify: Creating an inspection with a foreign/nonexistent supersedesInspectionId is rejected (400).
- refs: security review 2026-07-11 (also relates to INS-010, INS-018)

### INS-041 · Buyer.defaultLoopPresetId accepts a cross-tenant preset   [MEDIUM]
- status: done            # 2026-07-11 (security review): fixed. buyers.service create()+update() now call assertPresetInOrg() (findFirst {id, orgId}) so only the caller's own presets can be referenced; null clears, undefined is a no-op. Regression spec: buyers.service.spec.ts. type-check + tests green.
- area: Workspace CRUD
- evidence: `apps/api/src/buyers/buyers.service.ts:49,64` (pre-fix) wrote the client-supplied `defaultLoopPresetId` verbatim; the single-column FK (`schema.prisma:261`) checks existence only.
- problem: A buyer in org A could hold an FK to org B's preset — a latent cross-tenant leak that activates the moment a read path resolves the preset (e.g. the buyer edit form's preset selector).
- fix: Re-validate a non-null preset id against the caller's org on create + update (mirroring PurchaseOrdersService.assertBelongsToOrg).
- verify: PATCH/POST /buyers with a foreign preset id is rejected (400). ✅ unit-tested.
- refs: security review 2026-07-11 (INS-010 class)

### INS-044 · DefectInstance has no clientRequestId/idempotency (contradicts a stated invariant)   [MEDIUM]
- status: todo            # NEW 2026-07-11 (security review): needs a schema migration (add `clientRequestId String?` + `@@unique([orgId, clientRequestId])`) + addDefect() dedupe — deferred because it alters the live schema.
- area: Defect catalog / Populate console
- evidence: `CLAUDE.md` states "DefectInstance … writes accept an optional clientRequestId and dedupe on @@unique([orgId, clientRequestId])", but `schema.prisma:641` DefectInstance has neither the column nor the constraint; `populate.service.addDefect()` always `create()`s.
- problem: A retried add-defect (double-click / offline-sync replay) duplicates the DefectInstance row; submit() groups defects by severity, so a phantom duplicate can flip a MAJOR class from PASS to FAIL — changing the binding QC outcome. Inspection + Photo are protected by exactly this constraint; DefectInstance is not.
- fix: Add `clientRequestId` + `@@unique([orgId, clientRequestId])` to DefectInstance (migration), and have addDefect() accept it and return the existing row on replay.
- verify: Replaying add-defect with the same clientRequestId returns the original row without inserting a duplicate; AQL counts are unaffected.
- refs: security review 2026-07-11 (schema piece INS-016 implies but never spelled out)

### INS-011 · Append-only audit log not protected by DB triggers   [MEDIUM]
- status: todo
- area: Tamper-proof & audit
- evidence: `AuditLog` comment `schema.prisma` "enforced at the application layer"; `migration.sql` has no triggers/rules blocking UPDATE/DELETE.
- problem: The DB permits UPDATE/DELETE of `audit_logs` rows, so the append-only tamper-evidence guarantee rests entirely on app discipline and is defeatable by any direct row mutation.
- fix: Add a Postgres rule/trigger rejecting UPDATE and DELETE on `audit_logs` (and restrict table grants), backing the app-layer guarantee at the DB level.
- verify: Direct UPDATE/DELETE against `audit_logs` is rejected by the database; inserts still succeed.
- refs: [../reference/inspect-schema.md](../reference/inspect-schema.md) (§9)

### INS-012 · Monotonic per-org audit sequence relies on caller-supplied tx   [MEDIUM]
- status: todo            # 2026-07-11 (security review): CONFIRMED — under Postgres default Read Committed, wrapping append() in the caller's tx does NOT serialize the read-max-then-write, so two concurrent same-org appends collide on @@unique([orgId,sequence]) → P2002 rolls back the loser's business mutation (no data corruption, but a spurious failure with no retry). The misleading "wrap … to avoid races" NOTE was corrected in audit.service.ts. Still open: Serializable+retry or an atomic per-org counter / advisory lock.
- area: Tamper-proof & audit
- evidence: `audit.service.ts:25-26` NOTE "caller MUST wrap in the audited write's transaction to avoid races"; `AuditLog.sequence` is a plain `Int`, `@@unique([orgId, sequence])` enforces uniqueness only.
- problem: Sequence assignment reads-latest-then-writes with no DB generation, so two concurrent writers can pick the same next sequence; correctness depends on every caller wrapping the append in the audited write's transaction and retrying on unique-violation.
- fix: Centralize audit appends behind a helper that always runs inside the audited write's transaction and retries on `(orgId, sequence)` unique violations; enforce the contract so no caller appends outside a tx.
- verify: A concurrency test issuing parallel mutations produces a gap-free, conflict-free per-org sequence with no duplicate-sequence failures surfacing to callers.
- refs: [../reference/inspect-schema.md](../reference/inspect-schema.md) (§7)

### INS-013 · audit.service.ts itself has no unit test   [MEDIUM]
- status: todo
- area: Tamper-proof & audit
- evidence: `audit` module `tested:true` but only `audit-chain.spec.ts` (7 tests) exists; `audit.service.ts` has no spec.
- problem: Only the pure audit-chain helper is tested; the service that assigns sequence, links `prevEntryHash`, and persists is untested, so its transaction/sequence logic is unverified.
- fix: Add `audit.service.spec` covering sequence assignment, `prevEntryHash` linkage to the prior row, and rejection/retry on out-of-order or duplicate sequences.
- verify: `audit.service.spec` passes with cases for first-entry, chained-entry, and concurrent-collision handling.
- refs: [../done/plans/2026-06-06-inspect-phase1-foundation-domain-core.md](../done/plans/2026-06-06-inspect-phase1-foundation-domain-core.md)

### INS-014 · Immutability of submitted inspections/reports is app-layer only   [MEDIUM]
- status: todo
- area: Inspection lifecycle
- evidence: enforced via in-memory status sets (populate LOCKED set, inspections SUBMITTABLE/DECIDABLE); `Report` has mutable columns the DB still allows updating ([inspect-schema.md](../reference/inspect-schema.md) §7).
- problem: Nothing prevents a direct row update of a submitted inspection or a signed report outside the guarded service methods, so the "original stays locked" guarantee is not DB-backed.
- fix: Enforce no-hard-delete and no-field-mutation of non-DRAFT inspections and of any `Report` at the DB level (triggers / restricted grants), in addition to the app status guards.
- verify: A direct UPDATE/DELETE of a SUBMITTED-or-beyond inspection or a `Report` row is rejected by the database; DRAFT inspections remain editable.
- refs: [../reference/inspect-schema.md](../reference/inspect-schema.md) (§6/§7)

### INS-015 · DefectInstance catalog-XOR-custom not DB-enforced   [MEDIUM]
- status: todo
- area: Defect catalog
- evidence: `defectCatalogId` and `customText` both nullable, `migration.sql` has no CHECK; app-side check at `populate.service.ts:130-135` only.
- problem: The DB allows `DefectInstance` rows with both fields null or both set; only the populate service rejects them, so any other write path could violate the rule.
- fix: Add a CHECK constraint `((defectCatalogId IS NULL) <> (customText IS NULL))` so exactly one is set at the DB layer, complementing the service guard.
- verify: Inserting a `DefectInstance` with both-null or both-set is rejected by the database; valid rows insert.
- refs: [../reference/inspect-schema.md](../reference/inspect-schema.md) (§7)

### INS-016 · Photo idempotency partial; verify dedupe semantics   [MEDIUM]
- status: todo            # 2026-07-11 (security review): registerPhoto dedups on (orgId, clientRequestId) only — a token reused across two inspections in the same org returns the FIRST inspection's photo and silently attaches nothing to the second. One reviewer rated this a real correctness defect (scope dedupe to inspectionId, 409 on cross-inspection collision); another judged it the intended org-scoped idempotency contract (matches @@unique([orgId, clientRequestId]) and the schema-doc semantics). Decide the contract here; the real web client already generates a fresh token per call, so it is not currently triggered in-product.
- area: Populate console
- evidence: `inspections.service.ts:71-76` + `populate.service.ts:92-97` dedupe on `(orgId, clientRequestId)`; `@@unique([orgId, clientRequestId])` on Inspection + Photo; dedupe-on-retry is app logic.
- problem: Idempotency exists on create and registerPhoto but not uniformly across all retryable writes; the unique constraint only errors on duplicates — returning the existing row instead of erroring is app behavior that must be consistent.
- fix: Audit every retryable write path, ensure each accepts `clientRequestId` and returns the existing row on replay rather than throwing.
- verify: Replaying any mutating request with the same `clientRequestId` returns the original row (2xx) without creating a duplicate or surfacing a unique-violation error.
- refs: [../reference/inspect-schema.md](../reference/inspect-schema.md) (§7)

### INS-017 · Public report verification page UI missing   [MEDIUM]
- status: done            # 2026-06-28: public `app/r/[token]/page.tsx` built outside `(console)` route group — no auth header, plain fetch to `/reports/verify/:token`; renders verification badge (all-green / red), sub-checks (record found, hash matches, signature valid), provenance block; error state for invalid tokens. `pnpm type-check` clean.
- area: Reports & verification
- evidence: `apps/web` has no `/reports/verify` route; `reports.service` signs but there is no public token-verify surface in the console (backend `/reports/verify/:token` exists).
- problem: A buyer is supposed to verify a report via a public token without trusting the portal, but there is no public page that re-hashes the PDF and checks the Ed25519 signature.
- fix: Build a public `/r/[token]` (or `/reports/verify/[token]`) page that fetches the report, recomputes the content hash, verifies the signature, and shows pass/fail + provenance (verified vs unverified photos).
- verify: Visiting the verify URL for a real report shows signature-valid + matching-hash; tampering with the PDF makes it show invalid.
- refs: [../done/specs/2026-06-06-inspect-mvp-requirements-design.md](../done/specs/2026-06-06-inspect-mvp-requirements-design.md) (§9, fast-follow)

### INS-018 · BillableEvent RE_INSPECTION linkage not constrained   [MEDIUM]
- status: todo
- area: Inspection lifecycle
- evidence: `BillableEvent.kind` and `Inspection.supersedesInspectionId` are unrelated columns; `migration.sql` has no constraint tying `kind` to the supersedes chain ([inspect-schema.md](../reference/inspect-schema.md) §7).
- problem: A RE_INSPECTION billable event can reference an inspection that is not actually a re-inspection (no `supersedesInspectionId`), so billing-vs-lineage can diverge with nothing to catch it.
- fix: Enforce in the create-re-inspection service path (and/or via a constraint) that a RE_INSPECTION `BillableEvent`'s inspection has `supersedesInspectionId` set.
- verify: Creating a RE_INSPECTION billable event against a non-superseding inspection is rejected; a genuine re-inspection chain succeeds.
- refs: [../reference/inspect-schema.md](../reference/inspect-schema.md) (§7)

### INS-019 · reports.service has no spec   [MEDIUM]
- status: todo
- area: Reports & verification
- evidence: `reports` module `tested:false`; generates signed report record + Ed25519 signature + `audit.append` with no service spec.
- problem: The signing path — canonicalSnapshot, content hash, Ed25519 signature, idempotent generation, audit append — is untested, so a regression could produce an invalid or non-verifiable signature silently.
- fix: Add `reports.service.spec` asserting the canonical-snapshot/hash/signature round-trip verifies, generation is idempotent (returns the existing report), and an audit row is appended.
- verify: `reports.service.spec` passes; a generated signature verifies against the report's content hash; re-generation returns the same report.
- refs: [../done/plans/2026-06-06-inspect-phase1-foundation-domain-core.md](../done/plans/2026-06-06-inspect-phase1-foundation-domain-core.md)

### INS-020 · Report delivery records exist but no send path   [MEDIUM]
- status: todo
- area: Reports & verification
- evidence: `reports.service` has a deliveries relation but no send path; `ReportDelivery`/`DeliveryChannel`/`ReportAccess` models exist.
- problem: The schema models report deliveries and access records, but no code path actually delivers a report (email/portal) or records the delivery/access, so the delivery half of the loop is inert.
- fix: Implement report delivery (depends on INS-004 email + INS-003 PDF): send the branded PDF link, write `ReportDelivery` rows, and record `ReportAccess` on portal/public views.
- verify: Generating + delivering a report writes a `ReportDelivery` row and emits the email/portal notification; opening it writes a `ReportAccess` row.
- refs: [../done/specs/2026-06-06-inspect-mvp-requirements-design.md](../done/specs/2026-06-06-inspect-mvp-requirements-design.md) (§10)

### INS-021 · inspections.service core lifecycle untested   [MEDIUM]
- status: todo
- area: Inspection lifecycle
- evidence: `inspections` module `tested:true` but only via `inspection-mapping.spec.ts` (pure mapping helpers); the service itself has no test.
- problem: Only pure mapping helpers are tested; `create(snapshot)`, `submit(evaluate→AqlResult+BillableEvent+lock)`, and `decision(pass/fail/hold)` status-guard logic are untested, leaving the central workflow unverified.
- fix: Add `inspections.service` integration tests for snapshot-on-create, submit producing an `AqlResult` + `BillableEvent` and locking the block, decision transitions, and rejection of out-of-status actions.
- verify: `inspections.service` spec passes covering create/submit/decision happy paths + guard rejections against a test DB.
- refs: [../done/specs/2026-06-06-inspect-mvp-requirements-design.md](../done/specs/2026-06-06-inspect-mvp-requirements-design.md) (§5/§8)

### INS-028 · Console shell user hardcoded; no session/sign-out   [MEDIUM]
- status: done            # 2026-06-20: the (console) layout reads auth() and passes the real {userName, role} into ConsoleShell (DEFAULT_USER kept only as offline fallback); sign-out wired via a Server Action calling NextAuth signOut. Verified live — authed shell renders the real Org-Owner identity, not "Riya Saraf".
- area: Web console
- evidence: `apps/web/components/inspect/shell.tsx:206,292-298` — `DEFAULT_USER = {name:'Riya Saraf', role:'owner'}` not from the NextAuth session; no `signOut` import/usage.
- problem: The logged-in identity and role are never reflected in the UI (always "Riya Saraf/owner") and there is no sign-out, so the app misrepresents the session and traps the user.
- fix: Derive the shell user/role from the NextAuth session (`auth()`/`useSession`) and add a working sign-out (`signOut`).
- verify: After login the shell shows the real user name/role; sign-out clears the session and redirects to `/login`.
- refs: [../done/plans/2026-06-07-inspect-status-and-next-steps.md](../done/plans/2026-06-07-inspect-status-and-next-steps.md)

### INS-029 · Invite-user and accept-invitation flows unwired on web   [MEDIUM]
- status: done            # 2026-06-28: Invite user button on /users opens inline form → POST /users/invite → shows copyable link (email delivery pending INS-004). /invite?token=...&email=...&role=... accept page reads params, AcceptForm client component POSTs to /invitations/accept via server action, redirects to /login?invited=1 with success banner.
- area: Tenancy & onboarding
- evidence: `apps/web/app/(console)/users/page.tsx:56` Invite user button no `onClick`; `apps/web/app/invite/page.tsx:45` Accept invitation raw button no `onClick`, no token from `searchParams`, inputs `defaultValue`.
- problem: Org Owners cannot invite users and invitees cannot accept (set name/password, activate account) from the web, so invite-only onboarding cannot complete through the UI.
- fix: Wire Invite user to the invitations create endpoint and the accept page to read the token from `searchParams` and POST account activation.
- verify: Inviting a user creates an invitation (+ email per INS-004); opening the invite link with the token and submitting activates the account and allows login.
- refs: [../done/plans/2026-06-06-inspect-phase2-auth-tenancy.md](../done/plans/2026-06-06-inspect-phase2-auth-tenancy.md) (Task 7)

### INS-030 · Change-user-role and Add/Import workspace actions unwired   [MEDIUM]
- status: done            # 2026-06-28: Per-row role <select> on /users live-patches via PATCH /users/:id/role. Deactivate action wired via MoreVertical menu. Add Buyer/Supplier now wired (done in workspace directory plan, 2026-06-28). CSV import remains out-of-scope for MVP.
- area: Web console
- evidence: `apps/web/app/(console)/users/page.tsx:116-121` role "dropdown" is a static div (no PATCH); `apps/web/app/(console)/dashboard/page.tsx:53-54,137` Add Buyer/Add Supplier/Import CSV buttons no `onClick`.
- problem: Per-row role changes and creating buyers/suppliers (and CSV import) do nothing, so the workspace cannot be administered from the UI even though the CRUD endpoints exist.
- fix: Replace the static role dropdown with a real select wired to a role-update PATCH; wire Add Buyer/Add Supplier (and Import CSV) to the create endpoints.
- verify: Changing a role persists and reloads correctly; adding a buyer/supplier creates the row and it appears in the live list.
- refs: [../done/specs/2026-06-06-inspect-mvp-requirements-design.md](../done/specs/2026-06-06-inspect-mvp-requirements-design.md)

---

## Low

### INS-042 · Login timing side-channel enables active-account enumeration   [LOW]
- status: done            # 2026-07-11 (security review): fixed. validateUser() now runs an equivalent scrypt (hashPassword, discarded) on the miss/inactive path so a failed login's latency no longer reveals whether the email maps to an active account. auth.service.spec still green.
- area: Auth & RBAC
- evidence: `apps/api/src/auth/auth.service.ts:37` short-circuited before scrypt for unknown/inactive emails.
- problem: Timing gap (fast for unknown/inactive vs ~scrypt for active) enabled account enumeration on the un-throttled public /auth/login.
- fix: Constant-work failure path (dummy scrypt).
- verify: Failed logins for existent-active vs nonexistent emails have comparable latency.
- refs: security review 2026-07-11 (see also INS-047 rate limiting)

### INS-043 · reports.generate() double-call throws 500 instead of idempotent return   [LOW]
- status: done            # 2026-07-11 (security review): fixed. generate() now catches Prisma P2002 on the Report.inspectionId unique and returns the existing report, so a concurrent double-generate converges idempotently instead of surfacing an opaque 500.
- area: Reports & verification
- evidence: `reports.service.ts` guard `if (inspection.report) return` and `tx.report.create` were not atomic; `Report.inspectionId` is `@unique`.
- problem: A double-click / proxy retry could race two generate() calls; the loser hit the unique constraint and surfaced an unhandled 500.
- fix: Catch P2002 → re-read + return the existing report.
- verify: Two concurrent generate() calls both return the same report; neither 500s.
- refs: security review 2026-07-11

### INS-045 · Web session exposes the raw API bearer JWT to the browser   [LOW]
- status: todo            # NEW 2026-07-11 (security review): deferred — needs a web-auth refactor (read the token via next-auth/jwt getToken server-side instead of placing it in the client-visible session), verified against the live login flow to avoid regressing apiToken().
- area: Web console
- evidence: `apps/web/lib/auth.ts:109` `s.accessToken = token.accessToken` — NextAuth serves this at `GET /api/auth/session`, so `fetch('/api/auth/session')` returns the API bearer JWT to client JS.
- problem: The access token is only ever consumed server-side (`lib/api.ts` apiToken()), yet it's exposed to the browser, so any XSS/extension/kiosk foothold can exfiltrate it and replay against the API for the token lifetime (contradicts the "server-side only" contract at lib/api.ts:18).
- fix: Keep the token only in the encrypted NextAuth JWT; have apiToken() read it via `getToken` server-side; leave only role/orgId in the session.
- verify: `GET /api/auth/session` no longer contains accessToken; server-side API calls still authenticate.
- refs: security review 2026-07-11

### INS-046 · Report.canonicalSnapshot is nullable while verification depends on it   [LOW]
- status: todo            # NEW 2026-07-11 (security review): needs a `SET NOT NULL` migration (or a CHECK that it's non-null whenever signature is set) — deferred as a live-schema change.
- area: Reports & verification
- evidence: `schema.prisma:724` `canonicalSnapshot Json?` while contentHash/signature/brandingSnapshot are NOT NULL and verifyByToken recomputes the hash from it.
- problem: A Report row with a signature but null canonicalSnapshot (backfill / future re-gen path) would make public verification return `valid:false` for a genuinely signed report — a silently unverifiable artifact.
- fix: Make canonicalSnapshot NOT NULL (migration), matching brandingSnapshot.
- verify: The DB rejects a Report with a signature and null canonicalSnapshot.
- refs: security review 2026-07-11

### INS-047 · No rate limiting on public auth / invitation-accept endpoints   [LOW]
- status: todo            # NEW 2026-07-11 (security review): add @nestjs/throttler (or edge rate limiting) to POST /auth/login, /auth/refresh, /invitations/accept, and /guest reads.
- area: Auth & RBAC / Infra
- evidence: no `@nestjs/throttler`/ThrottlerGuard anywhere in `apps/api`; the only global guards are JwtAuthGuard + RolesGuard.
- problem: Unauthenticated endpoints (login, token accept, guest fetch) are un-throttled, aggravating credential-stuffing, token-guessing (INS-037), and enumeration (INS-042).
- fix: Add per-IP rate limiting to the public routes.
- verify: Rapid repeated hits to /auth/login and /invitations/accept are throttled (429).
- refs: security review 2026-07-11

### INS-031 · Live list screens render lossy data (counts hardcoded to "—")   [LOW]
- status: todo
- area: Web console
- evidence: `apps/web/app/(console)/dashboard/page.tsx:40,43` loc/pos/products/reports/last hardcoded "—" even live; `presets/page.tsx:44-54` drops loops/industry/used/edited; API shapes omit counts.
- problem: Even on the three wired list screens, most columns show "—" because the consumed API response shapes omit counts/relations, making "live" mode look broken.
- fix: After INS-005 adds count/relation fields, update the dashboard/presets/users mappers to consume them instead of defaulting to "—"/[].
- verify: With live data, the list screens render real loc/PO/product/report/last and preset loop/industry/used/edited values.
- refs: [../done/plans/2026-06-07-inspect-status-and-next-steps.md](../done/plans/2026-06-07-inspect-status-and-next-steps.md) — depends on INS-005.

### INS-032 · Search inputs and filter chips inert across console   [LOW]
- status: in-progress     # 2026-06-28: `?status=` filter wired on inspections list; presets list now has live search+sort (client-side in PresetsList). Remaining: search on dashboard/users/portal pages.
- area: Web console
- evidence: `dashboard/page.tsx:74,77-78`; `presets/page.tsx:67,72`; `users/page.tsx:76`; `portal/page.tsx:58` — inputs/chips/sort dropdowns have no `value`/`onChange`.
- problem: Search boxes, All/Active chips, sort dropdowns, tabs, and pagination across the console have no handlers, so users cannot filter or navigate large lists.
- fix: Wire search/filter/sort/pagination to client state or query params with server-side filtering on the list endpoints.
- verify: Typing in search and toggling chips/sort filters the visible rows and (where applicable) updates the query.
- refs: [../done/plans/2026-06-07-inspect-status-and-next-steps.md](../done/plans/2026-06-07-inspect-status-and-next-steps.md)

### INS-033 · Branded-report console preview uses static data   [LOW]
- status: done            # 2026-06-28: `BrandedReport` refactored to accept `BrandedReportData` typed prop (hardcoded consts removed); `/inspections/[id]/report` page POSTs to generate (idempotent), maps live inspection+report to `BrandedReportData`, renders with real buyer/PO/AQL/tamper-proof fields. PDF download gated on INS-003. Old `/report` stub updated to pass inline static data prop. `pnpm type-check` clean.
- area: Reports & verification
- evidence: `apps/web/app/(console)/report/page.tsx:1-11` renders `<BrandedReport>` from static `reportData`, no API import, no inspection id.
- problem: The console report preview shows hardcoded content rather than a real inspection's data, so it cannot be used to review an actual report.
- fix: Parameterize the report preview by inspection/report id and feed it live report data (depends on INS-003 PDF/report generation).
- verify: Opening the report preview for a real inspection renders that inspection's actual report content.
- refs: [../done/specs/2026-06-06-inspect-mvp-requirements-design.md](../done/specs/2026-06-06-inspect-mvp-requirements-design.md)

### INS-034 · Workspace CRUD and onboarding modules untested   [LOW]
- status: todo            # 2026-07-11: partially reduced — users/orgs/buyer-guests/invitations/buyers now have unit specs (security review + INS-004), and the INS-009 integration suite exercises the CRUD create paths + tenant scoping live. Remaining: suppliers/products/purchase-orders/loop-presets/defect-catalog/guest specs.
- area: Workspace CRUD
- evidence: `buyers`/`suppliers`/`products`/`purchase-orders`/`users`/`loop-presets`/`defect-catalog`/`invitations`/`buyer-guests`/`guest`/`orgs` modules all `tested:false`.
- problem: A large band of controllers/services has no tests, so RBAC scoping, validation, and CRUD correctness are unverified once the DB is live.
- fix: Add controller/service specs (or integration tests) for the untested modules, prioritizing tenant-scoping + validation paths.
- verify: Each module has at least happy-path + RBAC-scoping tests passing against a test DB.
- refs: [../done/specs/2026-06-06-inspect-mvp-requirements-design.md](../done/specs/2026-06-06-inspect-mvp-requirements-design.md)

### INS-048 · Lint is broken repo-wide (ESLint 9 without flat config; `next lint` deprecated)   [LOW]
- status: todo            # found 2026-07-11 while scoping CI — lint is therefore NOT in the CI workflow yet (commented out).
- area: Infra & CI
- evidence: `pnpm lint` fails: `apps/api` has ESLint 9.x installed but only a legacy `.eslintrc`-style setup (no `eslint.config.js` flat config → "ESLint couldn't find an eslint.config.(js|mjs|cjs) file"); `apps/web` `next lint` prints the deprecation notice directing to the ESLint CLI codemod.
- problem: Neither app can lint, so style/correctness rules are unenforced and lint cannot gate CI.
- fix: Migrate `apps/api` to an ESLint 9 flat config (typescript-eslint + prettier); migrate `apps/web` off `next lint` via `next-lint-to-eslint-cli`; then enable the commented-out Lint step in `.github/workflows/ci.yml`.
- verify: `pnpm lint` passes at the repo root; the CI Lint step is enabled and green.
- refs: —
