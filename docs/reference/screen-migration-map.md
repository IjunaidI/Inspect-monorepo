# Screen migration ledger — web console → React Native

> **The resumable state of the RN migration.** A screen is not migrated until its row here reflects
> reality. Start every mobile session by reading this file.
> Design: [../in-progress/specs/2026-08-26-inspect-react-native-migration-design.md](../in-progress/specs/2026-08-26-inspect-react-native-migration-design.md) ·
> Epic: [INS-086](../future/BACKLOG.md) · Procedure: the `migrate-screen` skill.
>
> **Last updated: 2026-08-31** — **`apps/mobile` exists** (Phase 2 scaffold: Expo SDK 57, expo-router,
> `@inspect/mobile` in the workspace). `/login` and `/inspections` are written and verified by
> type-check + lint + a green `expo export` bundle — but **not on a device**, so their rows stay
> `in-progress` until the EAS acceptance runs against a reachable API ([INS-090](../future/BACKLOG.md)).
> The auth provider is `apps/mobile/src/lib/session.ts` (SecureStore; the exchange itself stays in
> `@inspect/api-client`). Prior update 2026-08-27: routes corrected for [INS-055](../future/BACKLOG.md)
> (`/companies/[id]`, `/companies/[id]/guests`, `GET /company-guests`).
> **Phase 1 is done** — `@inspect/{api-client,domain,design-tokens}` exist, so every row below now has a
> shared client, shared tokens and a shared role gate to build against rather than reinventing them.
> The capture row is **not blocked**: [INS-083](../future/BACKLOG.md) dropped populate to an `INSPECTOR`
> floor with row-level scoping, so the app's headline screen is reachable by the role that will use it.
> ✅ [INS-088](../future/BACKLOG.md) is **closed**, so the `/login` row is unblocked: `client.login()`,
> `client.me(token)` and `client.refresh()` live in `@inspect/api-client` and `decodeJwtExp` is `Buffer`-free,
> so it runs in a React Native bundle. Mobile supplies a SecureStore-backed `AuthProvider`, **not** the
> exchange itself.
>
> ⚠️ Every row below is still blocked on [INS-090](../future/BACKLOG.md) for its *on-device* acceptance: the
> API has no reachable origin yet, so a physical device cannot talk to it.

## Status values

`not-started` · `in-progress` · `done` · `web-only` (never ports, by design) · `n/a` (stub/redirect)

## Role floors

The mobile app carries `INSPECTOR`, `QA_MANAGER` and `ORG_OWNER`. It has **no `PLATFORM_ADMIN`**. Any row
whose floor reads `PLATFORM_ADMIN` is blocked until the API is re-graded.

---

## Console screens

| Web route | RN route | Key API | Role floor | Phase | Status | Item |
|---|---|---|---|---|---|---|
| `/login` | `/login` | `POST /auth/login`, `GET /auth/me` | public | 2 | in-progress (built 2026-08-31; device acceptance blocked on INS-090) | INS-086 |
| `/inspections` | `/inspections` | `GET /inspections` | `INSPECTOR` | 2 | in-progress (built 2026-08-31; device acceptance blocked on INS-090) | INS-086 |
| `/inspections/[id]/populate` | `/inspections/[id]/capture` | `GET/POST /inspections/:id/populate/*` | `INSPECTOR` ✅ | 3 | not-started | INS-086 |
| `/dashboard` | `/dashboard` | `GET /dashboard/summary`, `GET /companies` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/inspections/new` | `/inspections/new` | `POST /inspections`, `GET /inspections/aql-preview` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/inspections/[id]/review` | `/inspections/[id]/review` | `POST /inspections/:id/decision` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/inspections/[id]/report` | `/inspections/[id]/report` | `GET /reports/:id` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/reports` | `/reports` | `GET /reports` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/presets` | `/presets` | `GET /loop-presets` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/presets/[id]` | `/presets/[id]` | `GET /loop-presets/:id` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/presets/new` | `/presets/new` | `POST /loop-presets`, `GET /defect-catalog` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/companies/[id]` | `/companies/[id]` | `GET/PATCH /companies/:id` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/companies/[id]/guests` | `/companies/[id]/guests` | `GET/POST /company-guests` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/products` `/products/new` `/products/[id]` | same | `GET/POST/PATCH /products` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/purchase-orders` `…/new` `…/[id]` | same | `GET/POST/PATCH /purchase-orders` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/users` | `/users` | `GET /users` (QA), `PATCH /users/:id/role` (owner) | `QA_MANAGER` / `ORG_OWNER` | 4 | not-started | INS-086 |
| `/invite` | `/invite` | `GET/POST /invitations` | public | 4 | not-started | INS-086 |

**Note on `/dashboard`:** the *company directory* lives here (`directory-client.tsx`), not at `/companies` —
there is no list route. Since [INS-055](../future/BACKLOG.md) it is ONE list with a `kind` filter, not the
old Buyers/Suppliers tab pair, because a company can be the client on one PO and the factory on another.
On a phone this is very likely its own screen rather than a panel on the dashboard. Decide from the
behaviour contract, not the URL.

**Note on the guests screen:** guests attach to a company acting in its **client** role only — there is no
factory-side portal. Report visibility keys on `clientCompanyId` AND `orgId`; a party-agnostic predicate
would hand a factory's guest the client's signed report. That is a security boundary, not a filter.

**Note on `/presets/new`:** the preset builder is the console's most complex authoring surface
(loop items, severity-grouped defect chips, measurement fields, custom defect creation). Expect it to be the
hardest Phase 4 screen. Consider it last.

## Permanently web-only

| Web route | Why it never ports |
|---|---|
| `/admin/orgs` | Platform Admin. Excluded from the app by decision D1. |
| `/portal` | Buyer guest portal. Buyers will not install an app to read a report. |
| `/r/[token]` | Public signature verification. Must open for anyone holding the link, including a buyer's own auditor. |

## Not applicable

| Web route | Why |
|---|---|
| `/populate` | Bare `redirect('/inspections')` stub. |
| `/report` | Bare `redirect('/inspections')` stub. |
| `/logout` | Web session mechanics; native clears SecureStore instead. |
| `/api/*` | Next.js route handlers (NextAuth, guest proxy, search). No native equivalent. |
