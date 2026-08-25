# Inspect — React Native Migration — Design

> **Status:** design approved 2026-08-26. Executable scope of the approving session: **Phase 0 planning
> artifacts + the `.claude/` migration scaffolding (§4)**. Phases 1–4 are deliberately left to dedicated
> sessions, which is what §4 exists to make possible.
> Backlog epic: [INS-086](../../future/BACKLOG.md). Prerequisites filed as INS-082..INS-085.
> Depends on [INS-008](../../future/BACKLOG.md) and [INS-055](../../future/BACKLOG.md)
> ([spec](2026-08-01-inspect-company-model-design.md)).

---

## 0. Decisions taken

These were settled with the account owner before this document was written. They are the premises; changing
one invalidates the phases below.

| # | Question | Decision |
|---|---|---|
| **D1** | What is the RN app's scope? | **Full parity with the web console, minus Platform Admin, plus camera capture.** iOS + Android. The web console is demoted to a dashboard but is **not** retired. |
| **D2** | Does the app work offline? | **Offline photo queue.** Capture always works and uploads drain in the background. Every other action requires connectivity. Not full offline-first. |
| **D3** | What happens to the web console? | **Both platforms stay fully maintained, long-term.** Every feature ships to both. |
| **D4** | How much code is shared? | **Approach A — shared logic core, UI written per platform.** See §2. |
| **D5** | Does [INS-055](../../future/BACKLOG.md) (Company model) land before the shared contract is frozen? | **Yes, inside Phase 0.** See §3.9. |
| **D6** | INS-055's own product decisions P1–P8 | **All eight recommended defaults confirmed** as written in [the Company spec §0](2026-08-01-inspect-company-model-design.md). |

### What D1–D3 jointly imply

Three surfaces stay web-only **permanently**, and no phase below tries to port them:

- `/admin/orgs` — Platform Admin. Excluded by D1.
- `/portal` — the buyer guest portal. Buyers will not install an app to read a report.
- `/r/[token]` — public signature verification. Must be openable by anyone holding a link, including a
  buyer's own auditor who has no relationship with us at all.

D3 is the expensive decision. Maintaining two platforms only works if every migration **reduces** total
logic rather than duplicating it — which is why §4.4's re-point rule is non-negotiable rather than advisory.

---

## 1. Problem

`apps/web` is a Next.js 15 App Router console: Server Components for reads, Server Actions for writes,
NextAuth v5 with the API bearer token held server-side in an encrypted cookie (INS-045), Tailwind +
shadcn/Radix for UI. React Native has none of those primitives. There is no server component, no DOM, no
Tailwind class, and no httpOnly cookie on a phone.

So "migrate the web app to React Native" cannot mean porting files. What can actually cross the boundary:

| Asset | Ports? | Where it is today |
|---|---|---|
| Wire contract (`Api*` DTOs, enums) | **Yes** | Redeclared in `apps/web/lib/api.ts` (648 lines) and again in the API's service inputs |
| Design tokens (colors, severity, roles) | **Yes** — plain values | `apps/web/components/inspect/tokens.ts` |
| Domain rules (cycle completeness, role gates, status transitions) | **Yes** | Split between `apps/api/src/inspections/cycle-state.ts`, `apps/web/lib/roles.ts`, and inline in screens |
| HTTP call sites | **Yes**, with an injected token provider | `apps/web/lib/api.ts` |
| Auth mechanism | **No** | NextAuth JWE cookie; native uses Keychain/Keystore |
| Server Components / Server Actions | **No** | Every `page.tsx` and `actions.ts` |
| Tailwind / shadcn / Radix markup | **No** | `components/ui/`, every screen |

The migration is therefore an **extraction problem first and a UI problem second**. Phase 1 does the
extraction with zero mobile code in the tree; only then does a mobile app exist to consume it.

---

## 2. Approach A — shared logic core, UI per platform

### 2.1 The packages

| Package | Status | Contents |
|---|---|---|
| `@inspect/shared-types` | **exists, unused** | The wire contract: enums, DTOs, JSON-column contracts. Becomes the single source of truth for all three consumers. Finishing this is [INS-008](../../future/BACKLOG.md). |
| `@inspect/api-client` | **new** | One dependency-free `fetch` client covering every endpoint, parameterised by base URL and an **injected token provider**. Web injects the NextAuth-derived token, preserving the INS-045 server-side-only model; mobile injects a SecureStore-backed one. |
| `@inspect/domain` | **new** | Pure, platform-free rules both UIs need: cycle completeness, role gates, status transitions, AQL display helpers, severity formatting. No I/O, no React. |
| `@inspect/design-tokens` | **new** | `tokens.ts` lifted out. Tailwind's config consumes it on web; `StyleSheet` consumes it on native. |

Internal packages use **source-as-entry** (`main: ./src/index.ts`) and let Metro and Next transform them —
the 2026 Expo-platform-team default, and it removes the build-order trap where an app type-checks against a
stale `dist/`.

### 2.2 What is deliberately NOT shared

UI components. Web keeps Tailwind/shadcn and Server Components; mobile gets native components.

This is a decision, not a concession. `apps/web/app/(console)/inspections/[id]/populate/populate-workspace.tsx`
is 782 lines of desktop grid-and-panel; the phone equivalent is a full-screen camera showing one slot at a
time. Those are not the same screen, and a universal component serving both serves neither. Sharing belongs
where the platforms genuinely agree — the contract and the rules — not where they genuinely differ.

### 2.3 Alternatives rejected

- **Universal components (RN Web + Tamagui/NativeWind + Solito).** Maximum sharing on paper. Requires
  rewriting all 74 existing `.tsx` files into RN primitives and surrendering Server Components, Server
  Actions and the server-only token model — paid to unify a web surface that D1 demotes to a dashboard,
  which is precisely where desktop-specific UI earns its keep.
- **Standalone RN app sharing only types.** Fastest first build, but contradicts D3: every endpoint and
  every domain rule would be written, and fixed, twice forever.

---

## 3. Phase 0 — make the platform safe to refactor

Phase 0 is not general hygiene. Approach A does two specific things to this codebase, and Phase 0 is scoped
to exactly what those two things stress:

1. It **pulls code out of `apps/web`** into packages and re-points web at them.
2. It **adds a second writer** to an API whose invariants are largely upheld by one codebase's discipline.

### Tier 1 — blocking

| # | Item | Why the migration needs it | Backlog |
|---|---|---|---|
| **P0-1** | Give `apps/web` a test runner | Phase 1 extracts `lib/api.ts` (648 lines), `tokens.ts` and `roles.ts` into packages and re-points web at them. `tsc` cannot catch a behaviour change in `loadOrFallback`, a dropped `X-Org-Id` header, or a token-refresh regression — the types stay identical while the behaviour breaks. Web has **no** test runner today (no `test` script, no jest/vitest/testing-library in `apps/web/package.json`; STATUS.md: "Web: no unit-test runner"). Highest-risk item in the programme. | [INS-082](../../future/BACKLOG.md) |
| **P0-2** | Finish INS-008 — the import sweep | `shared-types` becoming the real contract is the foundation everything else stacks on. The dependency edge and the turbo build order exist; **zero real imports** do. The Company spec §8 independently reaches the same conclusion: INS-008 is a hard prerequisite for Company Phase 1, or the `Company` DTO and the canonical v1/v2 reader get written twice in files that have already drifted once. | [INS-008](../../future/BACKLOG.md) |
| **P0-3** | RBAC re-grade: populate → `INSPECTOR` | `PopulateController` is `@Roles('PLATFORM_ADMIN')` on the whole class — presign, register, retake, discard, defect, measurement. D1 says the app has no Platform Admin mode, so **the app cannot take a single photo** until this changes. `defect-catalog` at `QA_MANAGER` also blocks defect tagging. Follow the INS-057 precedent: scope to `assignedInspectorId`. | [INS-083](../../future/BACKLOG.md) |
| **P0-4** | Reseed the dev DB | Inspection creation is PO-driven, and INS-081's `TRUNCATE … CASCADE` emptied buyers, buyer_guests and purchase_orders. A capture flow cannot be hand-driven against a DB with no buyers or POs. | — (STATUS.md) |

### Tier 2 — strongly advised

| # | Item | Why the migration needs it | Backlog |
|---|---|---|---|
| **P0-5** | Apply the DB-level-invariants migration | Gets **strictly more valuable** the moment a second writer exists: seven invariants are app-layer-only, upheld by one codebase's care, and mobile means duplicating that care correctly. The database does not care which client is wrong. Already written, `prisma validate` passes, a live probe found **0 violating rows**, and `db-invariants.e2e-spec.ts` is written and self-skipping until it lands. Needs one `prisma migrate deploy`. | INS-010/011/014/015/018/046 |
| **P0-6** | Fix INS-048 (ESLint flat config) | Mobile is a third app with its own rules and no `next lint`. Fix once now and lint can finally become a CI gate for all three, instead of compounding. | [INS-048](../../future/BACKLOG.md) |
| **P0-7** | Specs for `defect-catalog` + `purchase-orders` | Both sit on the mobile critical path, and `defect-catalog` is about to get an RBAC change in P0-3. `guest` can wait — mobile never touches it. | [INS-034](../../future/BACKLOG.md) |
| **P0-8** | INS-002 credential rotation *(user-side)* | Mobile adds EAS build secrets and app-store credentials — a new distribution channel. Do not open it on credentials still present in git history. | [INS-002](../../future/BACKLOG.md) |

### Tier 3 — cheap, high leverage

| # | Item | Why | Backlog |
|---|---|---|---|
| **P0-9** | Generate an OpenAPI spec (`@nestjs/swagger`) | The contract is currently implicit across 17 controllers and hand-redeclared in web's `api.ts`. A generated spec makes it **derivable**: `api-client` can be verified against it, and a migration session reads one artifact instead of re-deriving the contract from controllers every time. Nothing in `apps/api` uses swagger today. | [INS-084](../../future/BACKLOG.md) |
| **P0-10** | Fix the Windows Jest exit-134 | `pnpm api test` exits 134 after all tests report green (parallel-worker teardown); `--runInBand` exits 0. Every verification step in this programme would otherwise read as a failure. | [INS-085](../../future/BACKLOG.md) |

### 3.9 INS-055 inside Phase 0

Confirmed by D5. The reasoning: Approach A freezes the Buyer/Supplier DTOs into `shared-types` and
`api-client`. If Company lands afterwards, three consumers migrate instead of two — and one of them ships
through app stores, so it **cannot be force-updated the way a web console is redeployed**. A version-skew
window where old builds still speak the Buyer/Supplier contract would need a compatibility shim in the API.
Landing Company first means the contract frozen in Phase 1 is the final one.

Ordering inside Phase 0 is fixed by the Company spec §8: **INS-008 (P0-2) → INS-055**.

### Excluded from Phase 0

- **INS-075** — superseded by INS-081.
- **INS-071's map picker** — optional, and would add `apps/web`'s first external runtime dependency.

---

## 4. The `.claude/` migration scaffolding

### 4.1 Goal

A session should open cold, take the next screen off a ledger, learn that screen's API contract and
behaviour without burning context on markup, write the RN version, and leave the ledger updated for the
next session.

### 4.2 Layout

```
CLAUDE.md                              # 3-app map, commands, DOMAIN INVARIANTS (stay here — see 4.3)
.claude/
  settings.json                        # Read denies + verification allowlist
  rules/
    wire-contract.md                   # paths: packages/{shared-types,api-client}/**, web lib/api.ts
    migration-discipline.md            # paths: apps/mobile/**, packages/{domain,design-tokens}/**
  skills/
    migrate-screen/SKILL.md            # the workhorse procedure
  agents/
    screen-cartographer.md             # read-only: large screen -> structured contract
apps/
  api/CLAUDE.md                        # NestJS conventions, how to find a route's contract
  web/CLAUDE.md                        # server components/actions — and what must NOT be copied to RN
  mobile/                              # created in Phase 2, not before
    CLAUDE.md
    .claude/{settings.json,skills/capture-flow/SKILL.md}
packages/*/CLAUDE.md
docs/reference/screen-migration-map.md # THE LEDGER
```

### 4.3 Why the domain invariants stay in the root `CLAUDE.md`

The instinct is to move them into a path-scoped rule. That is wrong, for a documented reason:

> Project-root CLAUDE.md survives compaction. Nested CLAUDE.md files in subdirectories and rules with
> `paths:` frontmatter are **not** re-injected automatically; they reload the next time Claude reads a file
> in that subdirectory or a file matching the rule's patterns.
> — *Claude Code docs, "How Claude remembers your project"*

A screen migration is a long session that will compact. If "one image per slot", "submitted inspections are
frozen" and "every tenant query is `orgId`-filtered" live only in a nested file, they can silently drop out
of context at exactly the moment a new write path is being authored. The invariants earn their permanent
context slot. What moves down to per-app files is **stack convention**, which is cheap to reload and
harmless to lose.

**The root file is trimmed in Phase 2, not now.** Its API/web detail is still load-bearing for Phase 0 and
Phase 1 work; it gets pared back when `apps/mobile/CLAUDE.md` exists to receive the mobile half.

### 4.4 The re-point rule

`migrate-screen`'s non-negotiable step:

> When a screen's logic turns out to be non-presentational, it moves to `@inspect/domain` **and `apps/web`
> is re-pointed at it in the same change.** Never fork a rule into mobile.

D3 chose two maintained platforms. That only survives if each migration reduces total logic. Without this
rule the outcome is not two platforms — it is two codebases that agree for about six weeks.

### 4.5 The ledger

`docs/reference/screen-migration-map.md`: one row per screen — web route, RN route, API endpoints, role
floor, status, `INS-NNN`. Same discipline as the STATUS/BACKLOG pairing. Without it, every session
re-derives "what is left" from scratch.

### 4.6 `screen-cartographer`

A read-only subagent. `populate-workspace.tsx` is 782 lines; reading it inline spends context on markup to
extract perhaps 40 lines of actual behaviour. The subagent returns the contract — data in, actions out,
states, edge cases — and the markup never enters the main conversation.

---

## 5. Mobile architecture

Recorded here so Phase 2+ sessions do not re-litigate it. Nothing in this section is built by the approving
session.

| Concern | Choice | Rationale |
|---|---|---|
| Framework | **Expo (SDK 55+)** | Metro has built-in pnpm-monorepo support; EAS builds iOS/Android without owning Xcode/Gradle pipelines |
| Routing | **Expo Router** | File-based, so App Router routes map ~1:1. Migration becomes route-by-route rather than re-architecture |
| Data | **TanStack Query** over `@inspect/api-client` | Caching, retry, and a mutation model that fits the photo queue |
| Styling | **`StyleSheet` + `@inspect/design-tokens`** | Tokens are already plain values; NativeWind adds build machinery for no gain here |
| Auth | `/auth/login` → `expo-secure-store` | Keychain/Keystore-backed. Differs from web's cookie model **by necessity**, not as a regression |
| Capture | `expo-camera`, `expo-file-system`, `expo-crypto` | Local sha256 at capture time keeps the content-hash chain intact |

### 5.1 The offline photo queue (D2)

Capture writes bytes to app-private storage, hashes them locally, and enqueues
`{inspectionId, loopItemId, cycleIndex, localUri, sha256, clientRequestId, state}`. The drain is the
existing three-step path — presign → PUT → register — and the existing `clientRequestId` dedupe already
makes retry safe.

Two rules follow from the domain invariants:

- **A 409 on a filled slot surfaces as a conflict for the inspector, never a silent drop.** If the slot
  filled while the device was offline, "one image per slot is the identity" means a human decides: keep
  mine as a retake, or discard. Dropping loses evidence; forcing overwrites someone else's.
- **Submit is blocked while the queue is non-empty.** `cycleState()` completeness is judged server-side
  against what the server actually holds. Submitting with photos still on the device asks the server to
  evaluate an inspection that does not exist yet.

---

## 6. Phases

| Phase | Deliverable | Acceptance |
|---|---|---|
| **0** | Platform hardening (§3) + INS-055 | Integration suite green with `db-invariants.e2e-spec.ts` no longer self-skipping; `apps/web` has tests; populate reachable by `INSPECTOR` |
| **1** | **Extraction only — no mobile code.** Create `api-client`, `domain`, `design-tokens`; re-point `apps/web` at all three | Web behaves **identically**, proven by the P0-1 tests. A pure refactor; it should be boring |
| **2** | Mobile skeleton: Expo app, auth, navigation, inspections list (read-only) | **One screen running on a real device via EAS.** Proves pnpm+Metro, api-client on native, tokens and the build pipeline |
| **3** | The capture loop: populate + camera + offline queue | An inspector completes a real multi-cycle inspection on a phone, offline for part of it, and submits |
| **4+** | Parity sweep, ledger-driven | One screen per `INS-NNN`; web re-pointed at shared logic each time (§4.4) |

Phase 2's acceptance is deliberately small and deliberately on-device. The toolchain is where RN monorepo
projects actually die, and that is worth discovering with one screen at risk rather than twenty.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Phase 1 silently changes web behaviour | P0-1 exists specifically for this. Phase 1 does not start until web has tests. |
| Duplicate React / React Native versions in the workspace | Expo's documented monorepo footgun. Pin React once at the root; CI asserts a single resolved version. |
| Metro cannot resolve workspace symlinks under pnpm | Use `expo/metro-config`'s built-in monorepo support rather than hand-rolled `watchFolders`. Phase 2's on-device acceptance surfaces this immediately. |
| App-store release cadence vs. API changes | The reason D5 puts INS-055 in Phase 0. Post-Phase-3, any breaking contract change needs an API compatibility window — a shipped build cannot be force-updated. |
| Two platforms drift despite D3 | §4.4's re-point rule, enforced by `migrate-screen` and checked at review. |
| `.claude/settings.json` does not load | Project settings load **only from the starting directory**. A session started in `apps/mobile/` reads `apps/mobile/.claude/settings.json`, not the root's. Both exist for this reason. |

---

## 8. Testing

- **Phase 0** — existing API unit + integration suites stay green and grow (INS-034 items); `apps/web`
  gains its first suite (P0-1); `db-invariants.e2e-spec.ts` stops self-skipping (P0-5).
- **Phase 1** — the acceptance is *no behavioural change*. Web's suite is the instrument; extraction
  without it is unverifiable.
- **Phase 2+** — `@inspect/domain` is pure and unit-tested with no DB, in the same style as `src/aql/` and
  `src/inspections/cycle-state.ts`. Mobile screens are verified on-device per phase; a mobile unit runner is
  a Phase 3 decision, not a Phase 2 blocker.

---

## 9. Open questions

- **Mobile test strategy** (Jest + React Native Testing Library vs. Maestro/Detox for the capture flow) —
  deferred to Phase 3, when there is a flow worth testing.
- **Push notifications** for inspection assignment and QA decisions — plausibly valuable given the API
  already emits status-change emails (INS-069), but out of scope until parity is real.
- **Whether `@inspect/domain` absorbs `apps/api/src/inspections/cycle-state.ts`** or the API keeps its own
  copy. Sharing it is attractive (one definition of completeness) but makes the API depend on a workspace
  package it currently does not need. Decide in Phase 1 with the code in front of you.
