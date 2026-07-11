# Plan: Guest Portal + Invite Flow (INS-025 · INS-029 · INS-030)

**Date:** 2026-06-28  
**Status:** ✅ done (shipped 2026-06-28; moved to `done/` 2026-07-11 — verified against the live code)  
**Closes:** INS-025 (portal), INS-029 (invite accept + invite user), INS-030 (role change)

## Context

The guest portal (`/portal`) is fully static — it shows hardcoded reports for a fictional buyer with no token auth.  
The invite accept page (`/invite`) has no `onClick` handlers — guests cannot activate their account.  
The "Invite user" button on `/users` is inert — org owners cannot onboard new members from the UI.  
The role dropdown per row on `/users` is a static `div` — role changes cannot be persisted.

## API endpoints consumed

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /guest/reports?token=TOKEN` | Public (token) | List buyer-scoped reports |
| `GET /guest/reports/:id?token=TOKEN` | Public (token) | Get single report + record access |
| `POST /invitations/accept` | Public | Accept invite: set name + password, activate account |
| `POST /users/invite` | ORG_OWNER JWT | Create invitation, returns token |
| `PATCH /users/:id/role` | ORG_OWNER JWT | Update user role |

## Phases

### A — lib/api.ts
- Add `apiGetPublic<T>(path): Promise<T>` — unauthenticated fetch (guest + public endpoints)
- Add `ApiGuestReport` shape (id, reportNo, generatedAt, canonicalSnapshot, brandingSnapshot, contentHash, pdfStorageKey, verificationToken)
- Add `ApiInvitation` shape (id, token, email, role, expiresAt)

### B — Guest portal wired (INS-025)
- `app/portal/page.tsx`: Server Component reads `searchParams.token`; calls `apiGetPublic('/guest/reports?token=...')`;  renders error card on missing/invalid token, otherwise passes data to `PortalClient`
- `app/portal/portal-client.tsx`: `'use client'`; state `selectedId`; maps `canonicalSnapshot` + `brandingSnapshot` → `BrandedReportData`; sidebar report list + main `BrandedReport` panel; "Download PDF" (gated on `pdfStorageKey`); "Verify independently" link → `/r/:verificationToken`

### C — Accept invitation wired (INS-029)
- `app/invite/actions.ts`: `acceptInvitation(_prev, formData)` → public `POST /invitations/accept { token, name, password }` → `redirect('/login?invited=1')` outside try/catch
- `app/invite/page.tsx`: reads `?token` + `?email` + `?role` from searchParams; becomes `'use client'` form wired to `acceptInvitation` via `useActionState`; shows email + role from URL params; redirects to login on success

### D — Invite user + role update (INS-029 + INS-030)
- `app/(console)/users/actions.ts`: `inviteUser(_prev, formData)` → `POST /users/invite`; `updateUserRole(userId, role)` → `PATCH /users/:id/role`; `deactivateUser(userId)` → `DELETE /users/:id`
- `app/(console)/users/users-client.tsx`: `'use client'`; search state; inline invite form (`useActionState(inviteUser)`) showing copyable invite link on success; per-row role `<select>` wired via `useTransition`; per-row MoreVertical with Deactivate
- `app/(console)/users/page.tsx`: delegates to `<UsersClient users={rows} live={live} />`

## Invariants
- Guest token is passed as a query parameter to public API endpoints — no session JWT involved
- `acceptInvitation` uses a plain `fetch` (no `auth()`) — it's a public endpoint
- `redirect()` OUTSIDE try/catch in all server actions
- No new dependencies
