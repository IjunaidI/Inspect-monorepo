# Screen migration ledger — web console → React Native

> **The resumable state of the RN migration.** A screen is not migrated until its row here reflects
> reality. Start every mobile session by reading this file.
> Design: [../in-progress/specs/2026-08-26-inspect-react-native-migration-design.md](../in-progress/specs/2026-08-26-inspect-react-native-migration-design.md) ·
> Epic: [INS-086](../future/BACKLOG.md) · Procedure: the `migrate-screen` skill.
>
> **Last updated: 2026-08-26** — ledger created. Nothing migrated yet; `apps/mobile` does not exist until
> Phase 2.

## Status values

`not-started` · `in-progress` · `done` · `web-only` (never ports, by design) · `n/a` (stub/redirect)

## Role floors

The mobile app carries `INSPECTOR`, `QA_MANAGER` and `ORG_OWNER`. It has **no `PLATFORM_ADMIN`**. Any row
whose floor reads `PLATFORM_ADMIN` is blocked until the API is re-graded.

---

## Console screens

| Web route | RN route | Key API | Role floor | Phase | Status | Item |
|---|---|---|---|---|---|---|
| `/login` | `/login` | `POST /auth/login`, `GET /auth/me` | public | 2 | not-started | INS-086 |
| `/inspections` | `/inspections` | `GET /inspections` | `INSPECTOR` | 2 | not-started | INS-086 |
| `/inspections/[id]/populate` | `/inspections/[id]/capture` | `GET/POST /inspections/:id/populate/*` | ⚠ `PLATFORM_ADMIN` → `INSPECTOR` | 3 | **blocked** | [INS-083](../future/BACKLOG.md) |
| `/dashboard` | `/dashboard` | `GET /dashboard/summary`, `GET /buyers`, `GET /suppliers` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/inspections/new` | `/inspections/new` | `POST /inspections`, `GET /inspections/aql-preview` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/inspections/[id]/review` | `/inspections/[id]/review` | `POST /inspections/:id/decision` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/inspections/[id]/report` | `/inspections/[id]/report` | `GET /reports/:id` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/reports` | `/reports` | `GET /reports` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/presets` | `/presets` | `GET /loop-presets` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/presets/[id]` | `/presets/[id]` | `GET /loop-presets/:id` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/presets/new` | `/presets/new` | `POST /loop-presets`, `GET /defect-catalog` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/buyers/[id]` | `/buyers/[id]` | `GET/PATCH /buyers/:id` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/buyers/[id]/guests` | `/buyers/[id]/guests` | `GET/POST /buyer-guests` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/suppliers/[id]` | `/suppliers/[id]` | `GET/PATCH /suppliers/:id` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/products` `/products/new` `/products/[id]` | same | `GET/POST/PATCH /products` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/purchase-orders` `…/new` `…/[id]` | same | `GET/POST/PATCH /purchase-orders` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/users` | `/users` | `GET /users` (QA), `PATCH /users/:id/role` (owner) | `QA_MANAGER` / `ORG_OWNER` | 4 | not-started | INS-086 |
| `/invite` | `/invite` | `GET/POST /invitations` | public | 4 | not-started | INS-086 |

**Note on `/dashboard`:** the buyers and suppliers *directory* lives here as tabs (`directory-client.tsx`),
not at `/buyers` or `/suppliers` — there are no list routes for those. On a phone this is very likely two
separate screens rather than a tabbed desktop directory. Decide from the behaviour contract, not the URL.

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
