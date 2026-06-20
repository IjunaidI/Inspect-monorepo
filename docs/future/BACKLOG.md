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
- status: in-progress    # 2026-06-20: stack now runs end-to-end against the Railway server DB+Redis — migrate+seed applied (25 tables, 14 defects, bootstrap admin); API boots, /health green (db+redis up), login/me/tenant-guard verified live. Remaining: full create→submit→AQL→report loop (needs an Org Owner + MinIO for photos) + a CI integration test (INS-009). See runbook.
- area: Infra & CI
- evidence: `prisma/migrations/` has only `00000000000000_init` (never applied); API testCount is "compiles, type-checks; logic unit-tested"; only `apps/api/test/app.e2e-spec.ts` (1 test) exists.
- problem: The entire DB-bound surface (auth login/me, guards, onboarding, all CRUD, inspection lifecycle, populate, reports, audit) is coded but has **never executed against a real database**. Correctness, migrations, FK policies, and the seven app-layer invariants are all unproven.
- fix: Bring up `docker-compose.dev.yml` (Postgres 16 + Redis 7 + MinIO), run `prisma migrate deploy` + `db seed`, generate an Ed25519 keypair, boot the API, and drive the core loop (login → create inspection → populate → submit → AQL evaluate → sign report → verify token) manually and via a smoke e2e (testcontainers).
- verify: `prisma migrate status` shows the init migration applied; the API boots clean; a scripted login→create→submit→decision→report flow returns 2xx end-to-end against a containerized Postgres.
- refs: [../in-progress/plans/2026-06-20-ins-001-stand-up-and-verify.md](../in-progress/plans/2026-06-20-ins-001-stand-up-and-verify.md) (runbook) · [../done/plans/2026-06-07-inspect-status-and-next-steps.md](../done/plans/2026-06-07-inspect-status-and-next-steps.md) (Phase A)

### INS-002 · Committed real-looking secrets in `.env.example`   [BLOCKER]
- status: in-progress    # 2026-06-20: .env.example scrubbed to placeholders (working tree clean, verified). PENDING (user-side): rotate the live Railway creds + decide on git-history scrub.
- area: Infra & CI
- evidence: `.env.example:22` `POSTGRES_PASSWORD="gIqPI…"`, `:31` `REDIS_PASSWORD="uuDWR…"`, `:10-11` live-shaped `DATABASE_URL`/`DATABASE_PUBLIC_URL` — real-looking Railway credentials, not placeholders. `.gitignore` correctly ignores `.env*` but `.env.example` is (intentionally) tracked, so the values ship in git.
- problem: Real-looking DB/Redis passwords (and other secret-shaped values) are committed in the tracked `.env.example`. Anything live must be rotated and scrubbed before a public/Railway deploy, or tenant isolation + the tamper-proof signing guarantee are compromised.
- fix: Replace every value in `.env.example` with obvious placeholders (`<postgres-password>`); rotate any credential that was ever real in Railway; confirm no other secret is committed (scan history); regenerate the Ed25519 report-signing keypair.
- verify: `.env.example` contains only placeholders; a secret scan of tracked files + history finds no live credential; the signing keypair used in any prior commit is rotated/revoked.
- refs: [../in-progress/plans/2026-06-20-ins-001-stand-up-and-verify.md](../in-progress/plans/2026-06-20-ins-001-stand-up-and-verify.md)

---

## High

### INS-003 · PDF binary is never rendered   [HIGH]
- status: todo
- area: Reports & verification
- evidence: `apps/api/src/reports/reports.service.ts:97` — comment "pdfStorageKey is set when the PDF binary is rendered (pdf-lib, follow-up)"; no `pdf-lib`/`pdfkit`/`puppeteer` in `apps/api/package.json`.
- problem: `reports.service` creates the signed report record + Ed25519 signature but never produces a PDF; `pdfStorageKey` stays null, so there is no per-buyer-branded artifact to deliver, download, or verify — a core MVP deliverable is absent.
- fix: Add `pdf-lib`; render the `canonicalSnapshot` into a per-buyer-branded PDF matching `BrandedReport`; hash the bytes consistently with the signed content; upload to S3/MinIO; set `report.pdfStorageKey` and embed hash+signature in the footer.
- verify: Generating a report writes a non-null `pdfStorageKey` pointing to a downloadable PDF whose content hash matches the signed hash.
- refs: [../done/specs/2026-06-06-inspect-mvp-requirements-design.md](../done/specs/2026-06-06-inspect-mvp-requirements-design.md) (§9/§10)

### INS-004 · Email / magic-link delivery not implemented   [HIGH]
- status: todo
- area: Tenancy & onboarding
- evidence: `apps/api/src/buyer-guests/buyer-guests.service.ts:33` comment calls the token "the credential to send them" but `invite()` just returns it to the caller; no `nodemailer`/SMTP in `apps/api/package.json`.
- problem: Invitations, buyer-guest magic links, and report deliveries generate tokens but nothing emails them, so onboarding and report delivery cannot complete without manually copying tokens.
- fix: Add an email provider (`nodemailer`/SMTP, dev stream transport); send invitation, buyer-guest magic-link, and report-delivery emails; write `ReportDelivery`/`DeliveryChannel` rows on send.
- verify: Inviting a user / buyer guest / delivering a report sends an email with the correct tokenized link and writes a delivery record; no token is returned to the API caller as the only credential.
- refs: [../in-progress/plans/2026-06-06-inspect-phase2-auth-tenancy.md](../in-progress/plans/2026-06-06-inspect-phase2-auth-tenancy.md) (Task 7)

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
- status: todo
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
- status: in-progress    # 2026-06-20: apiPost/Put/Patch/Delete + ApiError (surfaces NestJS messages) added to apps/web/lib/api.ts; type-checks clean. Live smoke (e.g. create buyer) pending the API/DB (INS-001).
- area: Web console
- evidence: `apps/web/lib/api.ts:15-39` exposes only `apiGet` + `loadOrFallback`; the only POST in the whole app is `lib/auth.ts:26` (login).
- problem: No screen can perform any mutation through the client because the API client exposes only reads, so every primary action button across the console is structurally inert.
- fix: Add authenticated `apiPost/apiPut/apiPatch/apiDelete` helpers in `lib/api.ts` that attach the session JWT and surface API errors — unblocking all write screens.
- verify: `lib/api.ts` exports working mutation helpers that attach the bearer token; a smoke call (e.g. create buyer) succeeds against the live API.
- refs: [../done/plans/2026-06-07-inspect-status-and-next-steps.md](../done/plans/2026-06-07-inspect-status-and-next-steps.md) (Phase B) — **prerequisite for INS-023/024/026/027/029/030.**

### INS-023 · Populate screen fully static (no upload/tag/measure/submit)   [HIGH]
- status: todo
- area: Web console
- evidence: `apps/web/app/(console)/populate/page.tsx:57-58,104` — Save / Submit / Upload buttons have no handlers; all loop/shot/tag/measurement data is hardcoded.
- problem: The Platform-Admin populate flow — the one role that owns photo upload, defect tagging, measurements, and submit-for-review — does nothing on the web; the backend populate service is unreachable from the UI.
- fix: Wire the screen to presigned S3/MinIO upload, defect-tag POST, measurement save, and submit-for-review, using the new write helpers (INS-022) + the populate endpoints.
- verify: A real photo uploads to MinIO, a defect tag and measurement persist, and Submit transitions the inspection to SUBMITTED.
- refs: [../done/specs/2026-06-06-inspect-mvp-requirements-design.md](../done/specs/2026-06-06-inspect-mvp-requirements-design.md) (§6/§11)

### INS-024 · Loop-preset builder static (no persistence)   [HIGH]
- status: todo
- area: Web console
- evidence: `apps/web/app/(console)/presets/new/page.tsx:66-67,139,175,193` — Cancel/Save/Add buttons have no `onClick`; inputs are `defaultValue`; "Saved 2 min ago" is mock.
- problem: The preset builder cannot create/update presets or add loops/shots/defects/measurements, so the versioned loop-preset feature has no usable UI despite a working backend service.
- fix: Add client state and wire create/update preset + add-loop/shot/defect/measurement actions to the loop-presets endpoints.
- verify: Saving a new preset persists it; it appears (with version + step count) on the presets list when live.
- refs: [../done/specs/2026-06-06-inspect-mvp-requirements-design.md](../done/specs/2026-06-06-inspect-mvp-requirements-design.md) (§6/§11)

### INS-025 · Buyer guest portal fully static (no token auth, no real fetch/download)   [HIGH]
- status: todo
- area: Guest portal
- evidence: `apps/web/app/portal/page.tsx:8-13,88` — `reports[]` hardcoded, Download PDF has no `onClick`, guest identity hardcoded, no token/searchParams.
- problem: The read-only buyer portal does not authenticate via magic-link token, does not fetch a buyer-scoped report list, and cannot download a real PDF, so the buyer-facing deliverable is non-functional.
- fix: Read the magic-link token from `searchParams`, exchange it via the guest endpoint, render the buyer-scoped live report list, and wire Download PDF to the signed report URL.
- verify: Visiting `/portal` with a valid guest token shows that buyer's real reports and downloads the actual signed PDF; an invalid token is rejected.
- refs: [../done/specs/2026-06-06-inspect-mvp-requirements-design.md](../done/specs/2026-06-06-inspect-mvp-requirements-design.md) (§10)

### INS-026 · Create-inspection screen static (no dropdown reads, no create)   [HIGH]
- status: todo
- area: Web console
- evidence: `apps/web/app/(console)/inspections/new/page.tsx:31-32` buttons no handler; `:44-133` all selectors are static divs with hardcoded values; AQL plan from a static token.
- problem: The QA Manager cannot create or assign an inspection — buyer/supplier/product/preset/inspector selectors are hardcoded and Create & assign / Save draft do nothing — so the core loop cannot start from the UI.
- fix: Populate the selectors from `/buyers`, `/suppliers`, `/products`, `/loop-presets`, `/users`; compute the AQL plan from lot size; wire Save draft / Create & assign to the inspections create endpoint.
- verify: Selecting real entities and submitting creates an inspection with a snapshotted preset + computed sampling, visible in the inspections list.
- refs: [../done/specs/2026-06-06-inspect-mvp-requirements-design.md](../done/specs/2026-06-06-inspect-mvp-requirements-design.md) (§11)

### INS-027 · QA decision (Pass/Fail/Hold) never persisted   [HIGH]
- status: todo
- area: Web console
- evidence: `apps/web/app/(console)/review/page.tsx:129-154` — decision radios are `<label>` with no `onChange`, note is a `defaultValue` textarea, Submit decision has no `onClick`; `decision` is a hardcoded const "fail" (line 12).
- problem: The binding QA pass/fail/hold decision and decision note do not POST anywhere, so the human verdict — a required step in the loop — cannot be recorded from the web.
- fix: Make the decision radios + note controlled inputs and wire Submit decision to `POST /inspections/:id/decision`.
- verify: Submitting a decision records it on the inspection (status + decision + note) and reflects back on reload.
- refs: [../done/specs/2026-06-06-inspect-mvp-requirements-design.md](../done/specs/2026-06-06-inspect-mvp-requirements-design.md) (§8/§11)

---

## Medium

### INS-011 · Append-only audit log not protected by DB triggers   [MEDIUM]
- status: todo
- area: Tamper-proof & audit
- evidence: `AuditLog` comment `schema.prisma` "enforced at the application layer"; `migration.sql` has no triggers/rules blocking UPDATE/DELETE.
- problem: The DB permits UPDATE/DELETE of `audit_logs` rows, so the append-only tamper-evidence guarantee rests entirely on app discipline and is defeatable by any direct row mutation.
- fix: Add a Postgres rule/trigger rejecting UPDATE and DELETE on `audit_logs` (and restrict table grants), backing the app-layer guarantee at the DB level.
- verify: Direct UPDATE/DELETE against `audit_logs` is rejected by the database; inserts still succeed.
- refs: [../reference/inspect-schema.md](../reference/inspect-schema.md) (§9)

### INS-012 · Monotonic per-org audit sequence relies on caller-supplied tx   [MEDIUM]
- status: todo
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
- status: todo
- area: Populate console
- evidence: `inspections.service.ts:71-76` + `populate.service.ts:92-97` dedupe on `(orgId, clientRequestId)`; `@@unique([orgId, clientRequestId])` on Inspection + Photo; dedupe-on-retry is app logic.
- problem: Idempotency exists on create and registerPhoto but not uniformly across all retryable writes; the unique constraint only errors on duplicates — returning the existing row instead of erroring is app behavior that must be consistent.
- fix: Audit every retryable write path, ensure each accepts `clientRequestId` and returns the existing row on replay rather than throwing.
- verify: Replaying any mutating request with the same `clientRequestId` returns the original row (2xx) without creating a duplicate or surfacing a unique-violation error.
- refs: [../reference/inspect-schema.md](../reference/inspect-schema.md) (§7)

### INS-017 · Public report verification page UI missing   [MEDIUM]
- status: todo
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
- status: todo
- area: Web console
- evidence: `apps/web/components/inspect/shell.tsx:206,292-298` — `DEFAULT_USER = {name:'Riya Saraf', role:'owner'}` not from the NextAuth session; no `signOut` import/usage.
- problem: The logged-in identity and role are never reflected in the UI (always "Riya Saraf/owner") and there is no sign-out, so the app misrepresents the session and traps the user.
- fix: Derive the shell user/role from the NextAuth session (`auth()`/`useSession`) and add a working sign-out (`signOut`).
- verify: After login the shell shows the real user name/role; sign-out clears the session and redirects to `/login`.
- refs: [../done/plans/2026-06-07-inspect-status-and-next-steps.md](../done/plans/2026-06-07-inspect-status-and-next-steps.md)

### INS-029 · Invite-user and accept-invitation flows unwired on web   [MEDIUM]
- status: todo
- area: Tenancy & onboarding
- evidence: `apps/web/app/(console)/users/page.tsx:56` Invite user button no `onClick`; `apps/web/app/invite/page.tsx:45` Accept invitation raw button no `onClick`, no token from `searchParams`, inputs `defaultValue`.
- problem: Org Owners cannot invite users and invitees cannot accept (set name/password, activate account) from the web, so invite-only onboarding cannot complete through the UI.
- fix: Wire Invite user to the invitations create endpoint and the accept page to read the token from `searchParams` and POST account activation.
- verify: Inviting a user creates an invitation (+ email per INS-004); opening the invite link with the token and submitting activates the account and allows login.
- refs: [../in-progress/plans/2026-06-06-inspect-phase2-auth-tenancy.md](../in-progress/plans/2026-06-06-inspect-phase2-auth-tenancy.md) (Task 7)

### INS-030 · Change-user-role and Add/Import workspace actions unwired   [MEDIUM]
- status: todo
- area: Web console
- evidence: `apps/web/app/(console)/users/page.tsx:116-121` role "dropdown" is a static div (no PATCH); `apps/web/app/(console)/dashboard/page.tsx:53-54,137` Add Buyer/Add Supplier/Import CSV buttons no `onClick`.
- problem: Per-row role changes and creating buyers/suppliers (and CSV import) do nothing, so the workspace cannot be administered from the UI even though the CRUD endpoints exist.
- fix: Replace the static role dropdown with a real select wired to a role-update PATCH; wire Add Buyer/Add Supplier (and Import CSV) to the create endpoints.
- verify: Changing a role persists and reloads correctly; adding a buyer/supplier creates the row and it appears in the live list.
- refs: [../done/specs/2026-06-06-inspect-mvp-requirements-design.md](../done/specs/2026-06-06-inspect-mvp-requirements-design.md)

---

## Low

### INS-031 · Live list screens render lossy data (counts hardcoded to "—")   [LOW]
- status: todo
- area: Web console
- evidence: `apps/web/app/(console)/dashboard/page.tsx:40,43` loc/pos/products/reports/last hardcoded "—" even live; `presets/page.tsx:44-54` drops loops/industry/used/edited; API shapes omit counts.
- problem: Even on the three wired list screens, most columns show "—" because the consumed API response shapes omit counts/relations, making "live" mode look broken.
- fix: After INS-005 adds count/relation fields, update the dashboard/presets/users mappers to consume them instead of defaulting to "—"/[].
- verify: With live data, the list screens render real loc/PO/product/report/last and preset loop/industry/used/edited values.
- refs: [../done/plans/2026-06-07-inspect-status-and-next-steps.md](../done/plans/2026-06-07-inspect-status-and-next-steps.md) — depends on INS-005.

### INS-032 · Search inputs and filter chips inert across console   [LOW]
- status: todo
- area: Web console
- evidence: `dashboard/page.tsx:74,77-78`; `presets/page.tsx:67,72`; `users/page.tsx:76`; `portal/page.tsx:58` — inputs/chips/sort dropdowns have no `value`/`onChange`.
- problem: Search boxes, All/Active chips, sort dropdowns, tabs, and pagination across the console have no handlers, so users cannot filter or navigate large lists.
- fix: Wire search/filter/sort/pagination to client state or query params with server-side filtering on the list endpoints.
- verify: Typing in search and toggling chips/sort filters the visible rows and (where applicable) updates the query.
- refs: [../done/plans/2026-06-07-inspect-status-and-next-steps.md](../done/plans/2026-06-07-inspect-status-and-next-steps.md)

### INS-033 · Branded-report console preview uses static data   [LOW]
- status: todo
- area: Reports & verification
- evidence: `apps/web/app/(console)/report/page.tsx:1-11` renders `<BrandedReport>` from static `reportData`, no API import, no inspection id.
- problem: The console report preview shows hardcoded content rather than a real inspection's data, so it cannot be used to review an actual report.
- fix: Parameterize the report preview by inspection/report id and feed it live report data (depends on INS-003 PDF/report generation).
- verify: Opening the report preview for a real inspection renders that inspection's actual report content.
- refs: [../done/specs/2026-06-06-inspect-mvp-requirements-design.md](../done/specs/2026-06-06-inspect-mvp-requirements-design.md)

### INS-034 · Workspace CRUD and onboarding modules untested   [LOW]
- status: todo
- area: Workspace CRUD
- evidence: `buyers`/`suppliers`/`products`/`purchase-orders`/`users`/`loop-presets`/`defect-catalog`/`invitations`/`buyer-guests`/`guest`/`orgs` modules all `tested:false`.
- problem: A large band of controllers/services has no tests, so RBAC scoping, validation, and CRUD correctness are unverified once the DB is live.
- fix: Add controller/service specs (or integration tests) for the untested modules, prioritizing tenant-scoping + validation paths.
- verify: Each module has at least happy-path + RBAC-scoping tests passing against a test DB.
- refs: [../done/specs/2026-06-06-inspect-mvp-requirements-design.md](../done/specs/2026-06-06-inspect-mvp-requirements-design.md)
