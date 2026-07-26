# Inspect — Platform-Admin Org Assumption — Design

> **Status:** 🟡 In progress (designed + approved 2026-07-25; implementation not started).
> Backlog: adds **INS-079** (this effort) and closes **[INS-078](../../future/BACKLOG.md)** as a
> consequence (see §6). Plan: `../plans/2026-07-25-inspect-platform-admin-org-assumption.md`.
> Requirements context: spec §3 (org onboarding), §4 (populate), §13 (RBAC authority).

**Goal:** the Platform Admin gets a console that works. Today it has none — every `(console)` screen
403s for it, so logging in as the bootstrap admin produces an unhandled render error. This spec gives
the Platform Admin (a) an org onboarding console and (b) the ability to **assume an organization** and
operate inside it with full authority, while every action taken that way is honestly attributed in the
tamper-evident audit chain.

**Non-goals:** a separate "super admin" tier above `PLATFORM_ADMIN` (none exists and none is being
added — see §1); cross-tenant *aggregate* reporting or platform analytics; billing surfaces;
time-boxed or approval-gated impersonation sessions; changing the role hierarchy itself.

---

## 1. Problem

The bootstrap admin is seeded as `role: PLATFORM_ADMIN, orgId: null`
([`prisma/seed.ts:54-86`](../../../apps/api/prisma/seed.ts)). There is no tier above it: the hierarchy is
`INSPECTOR ≤ QA_MANAGER ≤ ORG_OWNER ≤ PLATFORM_ADMIN`, and `PLATFORM_ADMIN` is both the top and the only
cross-tenant principal. The user's "super admin" **is** this account.

That `orgId: null` is load-bearing and correct — it is what keeps the admin out of tenant data by
default. But 14 controllers call `requireOrgId(user)`
([`apps/api/src/common/tenant.ts:9-14`](../../../apps/api/src/common/tenant.ts)), which throws
`403 "This action requires an organization context"` for a null `orgId`. An integration test asserts
this ([`test/integration/auth-rbac.e2e-spec.ts:328-331`](../../../apps/api/test/integration/auth-rbac.e2e-spec.ts)),
so the API behavior is intentional and stays.

What was never built is the other half. `apps/api/src/common/tenant.ts:6` says the admin "must operate
via admin/impersonation routes" — those routes do not exist. The consequences today:

- The only admin-reachable endpoints are `GET|POST /admin/orgs`
  ([`orgs.controller.ts:7-8`](../../../apps/api/src/orgs/orgs.controller.ts)) and the populate writes.
  **`/admin/orgs` has no web screen at all** (no reference to it anywhere in `apps/web`).
- `login/page.tsx:26` hardcodes `redirectTo: '/dashboard'`, landing the admin on an org-scoped screen.
- The nav filter is purely additive — `ROLE_FLOOR[user.role] >= ROLE_FLOOR[n.minRole]`
  ([`shell.tsx:266`](../../../apps/web/components/inspect/shell.tsx)) — so `platform` (floor 4) sees
  **every** nav item, and all 7 lead to screens that 403.
- `loadOrFallback` deliberately re-throws 401/403 ([`lib/api.ts:98-106`](../../../apps/web/lib/api.ts))
  on the documented assumption that "the layout intercepts these before any page renders (see
  ConsoleLayout)". **`ConsoleLayout` does no such interception**
  ([`app/(console)/layout.tsx:6-28`](../../../apps/web/app/(console)/layout.tsx)) — it only checks for a
  missing session and a stale refresh token. The comment is stale; the 403 escapes as a crash.

---

## 2. Workstream A — Assumed-org resolution (API)

### A.1 The injection point

Exactly one place puts `orgId` on a request: `JwtAuthGuard`
([`jwt-auth.guard.ts:53-57`](../../../apps/api/src/auth/jwt-auth.guard.ts)). Resolving the assumed org
there means `requireOrgId` and every downstream tenant filter keep working **with no changes to any of
the 14 call sites** and no duplicated routes. This is the entire reason to prefer it.

The admin sends an `X-Org-Id: <orgId>` request header. The guard, after verifying the token:

```ts
const assumed = req.headers?.['x-org-id'];
const isPlatformAdmin = claims.role === 'PLATFORM_ADMIN';
const actingAsOrgId = isPlatformAdmin && typeof assumed === 'string' && assumed.trim()
  ? assumed.trim()
  : null;

req.user = {
  userId: String(claims.sub),
  orgId: actingAsOrgId ?? ((claims.orgId ?? null) as string | null),
  role: claims.role as Role,
  actingAsOrgId,
};
```

`AuthUser` ([`auth-user.ts`](../../../apps/api/src/auth/auth-user.ts)) gains
`actingAsOrgId: string | null`. It is `null` for every ordinary principal.

### A.2 Rules (these are the isolation story)

1. The header is honored **only** when the verified token's role is `PLATFORM_ADMIN`.
2. For every other role the header is **ignored outright — not rejected**. Their `orgId` always comes
   from their own token, so a probing org user observes no behavior change whatsoever. Failing silently
   here is deliberate: a 400/403 would confirm the header is meaningful.
3. Trust is derived from the **verified token claim**, never from anything else in the request.
4. An absent/blank header leaves the admin at `orgId: null` — the current, correct default.
5. `@Public()` routes are unaffected (the guard returns before any of this).

### A.3 Why this is not privilege escalation

A verified `PLATFORM_ADMIN` is already the cross-tenant principal by definition — it can already reach
any org's data via `/admin/*` and the populate controller. Naming an org **selects a scope**; it confers
no authority the principal did not already hold. The threat model is unchanged; what changes is only how
conveniently that existing authority is expressed.

### A.4 Why a header and not a re-minted token claim

The considered alternative was `POST /admin/orgs/:id/assume` returning a token carrying an `orgId`
claim. Rejected: the existing refresh flow ([`lib/auth.ts:16-35`](../../../apps/web/lib/auth.ts)) mints
a fresh access token from `/auth/refresh` and would **silently drop the assumed-org claim** on every
refresh, producing a confusing mid-session scope reset. Teaching `/auth/refresh` about impersonation
state is more moving parts than the header, for no gain. The header is stateless and refresh-immune.

### A.5 Org validation

Validated **once, on entry** (see C.2) — not per request — so the guard stays DB-free on the hot path.
A stale or bogus org id degrades safely: every query filters on it and simply matches nothing. It cannot
widen access.

### A.6 CORS

No impact. The web console calls the API **server-side only** (the JWT never reaches the browser by
design), so `X-Org-Id` is never sent by a browser and the INS-053 allowlist is not involved. The one
browser-side network call in the product is the presigned byte PUT, which goes browser → storage, not
browser → API. No `allowedHeaders` change is required; the implementation must not add one speculatively.

---

## 3. Workstream B — Audit attribution (API, correctness-critical)

**This is the part that makes the feature safe to ship, and it is not optional.**

All 15 audit call sites hardcode `actorType: 'USER'`:

| File | Lines |
|---|---|
| `buyers/buyers.service.ts` | 115, 129 |
| `suppliers/suppliers.service.ts` | 83, 97 |
| `products/products.service.ts` | 86, 100 |
| `users/users.service.ts` | 133, 172, 191, 209 |
| `inspections/inspections.service.ts` | 270, 428, 447 |
| `reports/reports.service.ts` | 150 |

(`orgs/orgs.service.ts:63` already correctly passes `'PLATFORM_ADMIN'` and is left alone.)

Ship org assumption without touching these and **every admin action inside a tenant is permanently
recorded as an ordinary org user** — reintroducing precisely the forged-attribution hole INS-039 closed.

**Fix:** a helper beside the audit service, `src/audit/actor-type.ts`:

```ts
/** PLATFORM_ADMIN when the actor is operating inside an assumed org; otherwise a plain org USER. */
export function actorTypeFor(actor: Pick<AuthUser, 'actingAsOrgId'>): AuditActorType {
  return actor.actingAsOrgId ? 'PLATFORM_ADMIN' : 'USER';
}
```

Replace the 15 literals with `actorTypeFor(actor)`. Every listed call site already has the `actor`
(`AuthUser`) in scope, so this is mechanical.

`AuditService.append` already folds `actorType` **and** `actorUserId` into `payloadHash`
([`audit.service.ts:50-67`](../../../apps/api/src/audit/audit.service.ts)), so once attributed correctly
the record is tamper-evident: the chain shows a Platform Admin acted inside that org, under the real
admin's user id, and any later row edit breaks `verifyChain`.

**Note:** `orgId` on the audit row is the *assumed* org — correct, because the entry belongs to that
org's chain and its monotonic `sequence`. The "who" is carried by `actorType` + `actorUserId`, not by
`orgId`.

---

## 4. Workstream C — Web console

### C.1 `/admin/orgs`

`app/(console)/admin/orgs/page.tsx` — server component, `PLATFORM_ADMIN`-gated, listing organizations
from `GET /admin/orgs` with a create form (name, type, owner email) posting to `POST /admin/orgs`.

The create response mints the first `ORG_OWNER` invitation. Reuse the established users-screen pattern:
show the copyable invite link and branch the success message on `emailSent` — "Invitation emailed to X"
vs "Email could not be sent — share this link manually". Never claim an email was sent that wasn't.

Each row carries an **Enter workspace** action (C.2).

### C.2 Entering and exiting an org

- `enterOrg(orgId)` server action: validates the id against `GET /admin/orgs` (the once-only check from
  A.5), sets an **httpOnly** cookie `inspect_admin_org`, redirects to `/dashboard`.
- `exitOrg()` server action: clears the cookie, redirects to `/admin/orgs`.
- Both refuse unless the session role is `PLATFORM_ADMIN` (defense in depth; the API ignores the header
  for anyone else regardless).

`lib/api.ts` attaches the header in **`apiGet` and `apiSend` only** — every read and write in the console
already funnels through those two functions, so two edits cover all screens. `apiGetPublic` and
`apiPostPublic` must **not** send it (they are unauthenticated by contract).

### C.3 Nav and the assumption banner

`NAV` ([`shell.tsx:203-211`](../../../apps/web/components/inspect/shell.tsx)) gains
`scope: 'org' | 'admin'` per entry, and the filter stops being purely additive:

```ts
const canSeeOrgNav = !isPlatformAdmin || isAssuming;

NAV.filter((n) =>
  n.scope === 'admin'
    ? isPlatformAdmin
    : canSeeOrgNav && ROLE_FLOOR[user.role] >= ROLE_FLOOR[n.minRole],
)
```

- Un-assumed admin: Organizations only — nothing that would 403.
- Assumed admin: the full org nav (they hold genuine org authority) **plus** Organizations, which stays
  visible so they can switch orgs without exiting first.
- Org users: unchanged.

`ConsoleShell` is a client component (it uses `usePathname`), so `isAssuming` and the assumed org's name
are read from the cookie by the **server** `ConsoleLayout` and passed down as props. The role
discriminator is the existing `user.role === 'platform'` — no new role prop.

**A persistent banner renders whenever an org is assumed:** *"Operating inside «Org» as Platform Admin"*
with an Exit control. This is a hard requirement, not decoration — an admin must never make a binding QA
call without knowing whose data they are in. It must be visible on every console screen (it lives in the
shell, not per page) and must not be dismissible.

The sidebar org label reads the assumed org's name while assuming, and "Platform administration"
otherwise.

---

## 5. Workstream D — Routing and the 403 safety net

- **[`middleware.ts`](../../../apps/web/middleware.ts)** already re-exports NextAuth's `auth` across all
  app paths, and the session JWT already carries `role` and `orgId`
  ([`lib/auth.ts:112`](../../../apps/web/lib/auth.ts)). Extend it: a `PLATFORM_ADMIN` with **no** assumed
  org visiting an org route → `/admin/orgs`; a non-admin visiting `/admin/*` → `/dashboard`. It reads the
  assumed org from `req.cookies` (`inspect_admin_org`) — the same cookie C.2 sets. One rule fixes
  post-login landing, typed URLs, and stale bookmarks together, so the hardcoded
  `redirectTo: '/dashboard'` at `login/page.tsx:26` resolves correctly for both roles **without touching
  the login form**.
- **`app/(console)/error.tsx`** (new): the safety net. Any 403 that still escapes renders a clear
  "this account has no organization context" state with a link to `/admin/orgs`, instead of the current
  unhandled crash. Next.js error boundaries are client components, so it carries `'use client'` and
  branches on the `ApiError` status carried in the error `digest`/message.
- Correct the stale comment at [`lib/api.ts:95-96`](../../../apps/web/lib/api.ts) to describe what
  actually intercepts a 403 (middleware + the error boundary), rather than a ConsoleLayout behavior that
  was never implemented.

---

## 6. What this closes, and what it removes from the earlier plan

Because the admin gains real org context, most of **[INS-078](../../future/BACKLOG.md)** dissolves rather
than needing code:

| INS-078 item | Resolution |
|---|---|
| Populate console unnavigable | Enter the org, use `/inspections` → the existing review-screen link works |
| `GET /defect-catalog` renders empty | Resolves normally under the assumed org |
| `POST /inspections/:id/submit` always 403s | Succeeds — the admin has genuine org authority |
| Needs an admin entry point | The normal inspections list is the entry point |

Consequently INS-078 closes as a consequence of INS-079, and three things scoped earlier are **not
built**: a `GET /admin/inspections` cross-tenant queue, folding the defect catalog into the populate
payload, and hiding the submit control from the admin. The populate controller keeps
`@Roles('PLATFORM_ADMIN')` and its inspection-derived `orgId` — an assumed admin still passes that
guard, since the role claim is unchanged.

---

## 7. Testing

### Unit (`pnpm api test`) — the isolation story lives here

`JwtAuthGuard`, test-driven:

- `X-Org-Id` **honored** for `PLATFORM_ADMIN` → `orgId` = assumed, `actingAsOrgId` set.
- `X-Org-Id` **ignored** for `ORG_OWNER`, `QA_MANAGER`, `INSPECTOR` → `orgId` stays the token's,
  `actingAsOrgId` null. One test per role; this is the tenant boundary.
- Absent/blank/whitespace header + `PLATFORM_ADMIN` → `orgId` null, `actingAsOrgId` null.
- A forged/expired token carrying `role: PLATFORM_ADMIN` still fails verification first (guards the
  INS-036 regression).

`actorTypeFor`: returns `'PLATFORM_ADMIN'` iff `actingAsOrgId` is set.

### Integration (`pnpm api test:integration`)

- Admin assuming org A reads org A's buyers and **not** org B's.
- A write while assuming lands an `AuditLog` row with `actorType: 'PLATFORM_ADMIN'` and the **real
  admin's** `actorUserId`; `verifyChain` still passes for that org.
- An `ORG_OWNER` sending `X-Org-Id` for another org sees exactly their own org's data (no leak, no error).
- An assumed admin still **cannot** mint another `PLATFORM_ADMIN` via `POST /users` — the existing
  `users.service` guard is keyed on the requested role, not the actor, and must hold.
- `POST /admin/orgs` → 403 for `ORG_OWNER` (guard coverage the current suite lacks).

### Web

No test runner exists on the web side. Verified by `pnpm type-check` + `pnpm web build`, plus a manual
pass: log in as the bootstrap admin → land on `/admin/orgs` → create an org → enter it → banner shows →
dashboard renders live data → exit → back to `/admin/orgs`.

---

## 8. Accepted risks

1. **An assumed admin can make binding QA pass/fail decisions inside a tenant.** This is inherent to the
   approved "full access" model. The mitigation is attribution, not prevention: the audit chain records
   `actorType: 'PLATFORM_ADMIN'` with the real admin's user id, hashed into `payloadHash` and therefore
   tamper-evident. Accepted deliberately (2026-07-25).
2. **Blast radius.** This touches `JwtAuthGuard` and all 15 audit call sites — the two most
   correctness-critical areas in the codebase. Mitigated by test-driving the guard (§7) before any web
   work, and by the fact that `actorTypeFor` is a pure function with a trivial contract.
3. **Cookie-scoped session state.** The assumed org lives in an httpOnly cookie, so it survives
   navigation and reloads but is per-browser. An admin with two tabs shares one assumed org — acceptable
   for MVP, and the always-visible banner makes the current scope unambiguous.
