# Platform-Admin Org Assumption (INS-079) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax
> for tracking.

**Goal:** give the Platform Admin a working console — org onboarding plus the ability to assume an
organization and operate inside it with full authority — while every action taken that way is honestly
attributed in the tamper-evident audit chain.

**Architecture:** a single `X-Org-Id` request header is resolved in `JwtAuthGuard` — the one place
`orgId` enters a request — honored **only** for a verified `PLATFORM_ADMIN` and ignored outright for
every other role. Because `req.user.orgId` is then the assumed org, all 14 `requireOrgId` call sites and
every tenant filter keep working untouched. The web console stores the assumed org in an httpOnly cookie
and attaches the header in its two central API helpers.

**Tech Stack:** NestJS 11 + Prisma 6 (API, port 3000), Next.js 15 App Router + NextAuth v5 (web, port
3001), Jest (unit + DB-backed integration), pnpm 9.12.0 workspaces + Turborepo.

**Spec:** [../specs/2026-07-25-inspect-platform-admin-org-assumption-design.md](../specs/2026-07-25-inspect-platform-admin-org-assumption-design.md)
**Backlog:** INS-079; closes INS-078 as a consequence.

## Global Constraints

- **The header is honored only when the verified token's role is `PLATFORM_ADMIN`.** For every other
  role it is **ignored — never rejected**. A 400/403 would confirm the header is meaningful; silence
  must not.
- **Trust comes from the verified JWT claim only.** Never from a body field, query param, or a second
  header.
- **Do not add `X-Org-Id` to the CORS allowlist.** The web calls the API server-side only; the header
  never originates in a browser. Adding it would widen the browser-facing surface for no reason.
- **`apiGetPublic` / `apiPostPublic` must never send the header** — they are unauthenticated by contract.
- **The assumption banner is not dismissible** and lives in the shell, so it renders on every console
  screen.
- **No new runtime dependencies.** Everything here uses what is already in the workspace.
- Node ≥ 20, pnpm 9.12.0. On Windows, if `pnpm` is not on PATH use `npx -y pnpm@9.12.0 <cmd>`.
- Baseline before starting: **183 unit tests / 24 suites green** (`pnpm api test`).

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/src/auth/auth-user.ts` (modify) | `AuthUser` gains `actingAsOrgId: string \| null` |
| `apps/api/src/auth/jwt-auth.guard.ts` (modify) | Resolve the assumed org; the tenant boundary |
| `apps/api/src/auth/jwt-auth.guard.spec.ts` (create) | The isolation tests — the most important file here |
| `apps/api/src/audit/actor-type.ts` (create) | `actorTypeFor(actor)` — pure, one job |
| `apps/api/src/audit/actor-type.spec.ts` (create) | Its contract |
| 6 service files + `reports.controller.ts` (modify) | Replace 15 hardcoded `actorType: 'USER'` |
| `apps/web/lib/admin-org.ts` (create) | Assumed-org cookie read/write, server-only |
| `apps/web/lib/api.ts` (modify) | Attach the header in `apiGet` + `apiSend`; org types; comment fix |
| `apps/web/app/(console)/admin/actions.ts` (create) | `createOrg`, `enterOrg`, `exitOrg` server actions |
| `apps/web/app/(console)/admin/orgs/page.tsx` (create) | Org list + create form (server component) |
| `apps/web/app/(console)/admin/orgs/orgs-client.tsx` (create) | Interactive list/form (client component) |
| `apps/web/components/inspect/shell.tsx` (modify) | NAV `scope`, assumption banner, shell props |
| `apps/web/app/(console)/layout.tsx` (modify) | Read the cookie; pass assumption state down |
| `apps/web/middleware.ts` (modify) | Role-aware routing |
| `apps/web/app/(console)/error.tsx` (create) | 403 safety net |
| `apps/api/test/integration/support.ts` (modify) | `CallOpts.orgId` → sets the header |
| `apps/api/test/integration/admin-org-assumption.e2e-spec.ts` (create) | DB-backed isolation + audit proof |

---

### Task 1: Assumed-org resolution in JwtAuthGuard

The tenant boundary. Test-driven, and nothing else starts until this is green.

**Files:**
- Create: `apps/api/src/auth/jwt-auth.guard.spec.ts`
- Modify: `apps/api/src/auth/auth-user.ts`
- Modify: `apps/api/src/auth/jwt-auth.guard.ts:53-57`

**Interfaces:**
- Consumes: `signJwt(payload, secret, expiresInSeconds)` from `./jwt`; `Role` from `./rbac`.
- Produces: `AuthUser.actingAsOrgId: string | null` — Task 2 and every later API task read this.

- [ ] **Step 1: Add the field to `AuthUser`**

Replace the interface in `apps/api/src/auth/auth-user.ts`:

```ts
import { Role } from './rbac';

/** The authenticated principal attached to each request by JwtAuthGuard. */
export interface AuthUser {
  userId: string;
  orgId: string | null; // null for the cross-tenant Platform Admin
  role: Role;
  /**
   * Set ONLY when a Platform Admin is operating inside an assumed org (INS-079).
   * `orgId` then holds that org; this field is what distinguishes "admin acting
   * inside org X" from "a real member of org X" — audit attribution depends on it.
   */
  actingAsOrgId: string | null;
}

export type TokenType = 'access' | 'refresh';
```

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/auth/jwt-auth.guard.spec.ts`:

```ts
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from './jwt-auth.guard';
import { signJwt } from './jwt';
import { Role } from './rbac';

const SECRET = 'test-access-secret-not-a-placeholder';

/** Minimal ExecutionContext double — only what JwtAuthGuard actually touches. */
function contextFor(headers: Record<string, string>) {
  const req: { headers: Record<string, string>; user?: any } = { headers };
  const ctx = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

function guard(): JwtAuthGuard {
  const reflector = { getAllAndOverride: () => false } as unknown as Reflector;
  const config = {
    get: (key: string) => (key === 'JWT_ACCESS_SECRET' ? SECRET : undefined),
  } as unknown as ConfigService;
  return new JwtAuthGuard(reflector, config);
}

function tokenFor(role: Role, orgId: string | null): string {
  return signJwt({ sub: 'user-1', orgId, role, type: 'access' }, SECRET, 900);
}

/** Express lowercases incoming header names, so the double must too. */
function headers(role: Role, orgId: string | null, assumed?: string) {
  const h: Record<string, string> = { authorization: `Bearer ${tokenFor(role, orgId)}` };
  if (assumed !== undefined) h['x-org-id'] = assumed;
  return h;
}

describe('JwtAuthGuard — assumed org resolution (INS-079)', () => {
  it('honors X-Org-Id for a verified PLATFORM_ADMIN', () => {
    const { ctx, req } = contextFor(headers('PLATFORM_ADMIN', null, 'org-target'));
    expect(guard().canActivate(ctx)).toBe(true);
    expect(req.user).toEqual({
      userId: 'user-1',
      orgId: 'org-target',
      role: 'PLATFORM_ADMIN',
      actingAsOrgId: 'org-target',
    });
  });

  // The tenant boundary: a non-admin must be completely unaffected by the header.
  it.each(['ORG_OWNER', 'QA_MANAGER', 'INSPECTOR'] as Role[])(
    'ignores X-Org-Id for %s — orgId stays the token\'s own',
    (role) => {
      const { ctx, req } = contextFor(headers(role, 'org-own', 'org-someone-else'));
      expect(guard().canActivate(ctx)).toBe(true);
      expect(req.user.orgId).toBe('org-own');
      expect(req.user.actingAsOrgId).toBeNull();
    },
  );

  it('ignores the header silently — it must not throw for a non-admin', () => {
    const { ctx } = contextFor(headers('INSPECTOR', 'org-own', 'org-other'));
    expect(() => guard().canActivate(ctx)).not.toThrow();
  });

  it('leaves an admin with no header at orgId null', () => {
    const { ctx, req } = contextFor(headers('PLATFORM_ADMIN', null));
    expect(guard().canActivate(ctx)).toBe(true);
    expect(req.user.orgId).toBeNull();
    expect(req.user.actingAsOrgId).toBeNull();
  });

  it.each(['', '   '])('treats a blank header (%p) as no assumption', (blank) => {
    const { ctx, req } = contextFor(headers('PLATFORM_ADMIN', null, blank));
    expect(guard().canActivate(ctx)).toBe(true);
    expect(req.user.orgId).toBeNull();
    expect(req.user.actingAsOrgId).toBeNull();
  });

  it('trims surrounding whitespace on an assumed org id', () => {
    const { ctx, req } = contextFor(headers('PLATFORM_ADMIN', null, '  org-target  '));
    expect(guard().canActivate(ctx)).toBe(true);
    expect(req.user.orgId).toBe('org-target');
  });

  it('sets actingAsOrgId null for an ordinary org principal', () => {
    const { ctx, req } = contextFor(headers('QA_MANAGER', 'org-own'));
    expect(guard().canActivate(ctx)).toBe(true);
    expect(req.user.actingAsOrgId).toBeNull();
  });

  // INS-036 regression: a token signed with the wrong secret is rejected before
  // any of the above matters, even when it claims PLATFORM_ADMIN.
  it('rejects a forged PLATFORM_ADMIN token regardless of the header', () => {
    const forged = signJwt(
      { sub: 'attacker', orgId: null, role: 'PLATFORM_ADMIN', type: 'access' },
      'wrong-secret',
      900,
    );
    const { ctx } = contextFor({ authorization: `Bearer ${forged}`, 'x-org-id': 'org-target' });
    expect(() => guard().canActivate(ctx)).toThrow('Invalid or expired token');
  });
});
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `pnpm api test -- jwt-auth.guard`
Expected: FAIL — `req.user` has no `actingAsOrgId` and `orgId` is `null` rather than `'org-target'`.

- [ ] **Step 4: Implement the resolution**

In `apps/api/src/auth/jwt-auth.guard.ts`, replace the `req.user = {...}` assignment (currently lines
53-57) with:

```ts
    // INS-079: a Platform Admin may name an org to operate inside via X-Org-Id.
    // Honored ONLY for a verified PLATFORM_ADMIN claim, and silently IGNORED for
    // every other role — rejecting it would confirm the header is meaningful.
    // This is not escalation: the admin is already the cross-tenant principal;
    // the header only selects a scope it already has.
    const role = claims.role as Role;
    const rawAssumed = req.headers?.['x-org-id'];
    const assumed = typeof rawAssumed === 'string' ? rawAssumed.trim() : '';
    const actingAsOrgId = role === 'PLATFORM_ADMIN' && assumed !== '' ? assumed : null;

    req.user = {
      userId: String(claims.sub),
      orgId: actingAsOrgId ?? ((claims.orgId ?? null) as string | null),
      role,
      actingAsOrgId,
    };
    return true;
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `pnpm api test -- jwt-auth.guard`
Expected: PASS, **11** tests (the two `it.each` blocks expand to 3 and 2 cases).

- [ ] **Step 6: Run the whole unit suite for regressions**

Run: `pnpm api test`
Expected: PASS. Was 183; now **194** (183 + 11). If anything else fails, a call site was relying on
`AuthUser` being a 3-field object — fix it before continuing.

- [ ] **Step 7: Type-check and commit**

```bash
pnpm type-check
git add apps/api/src/auth/auth-user.ts apps/api/src/auth/jwt-auth.guard.ts apps/api/src/auth/jwt-auth.guard.spec.ts
git commit -m "feat(api): resolve assumed org from X-Org-Id for PLATFORM_ADMIN only (INS-079)"
```

---

### Task 2: Honest audit attribution for assumed-org actions

Without this, every admin action inside a tenant is recorded as an ordinary org user — the INS-039
forged-attribution hole, reopened. Task 1 is useless-and-dangerous until this lands.

**Files:**
- Create: `apps/api/src/audit/actor-type.ts`, `apps/api/src/audit/actor-type.spec.ts`
- Modify: `buyers.service.ts:115,129` · `suppliers.service.ts:83,97` · `products.service.ts:86,100` ·
  `users.service.ts:133,172,191,209` · `inspections.service.ts:270,428,447` ·
  `reports.service.ts:27,150` · `reports.controller.ts:16-18`

**Interfaces:**
- Consumes: `AuthUser.actingAsOrgId` (Task 1); `AuditActorType` from `./audit.service`.
- Produces: `actorTypeFor(actor: Pick<AuthUser, 'actingAsOrgId'>): AuditActorType`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/audit/actor-type.spec.ts`:

```ts
import { actorTypeFor } from './actor-type';

describe('actorTypeFor (INS-079)', () => {
  it('reports PLATFORM_ADMIN when acting inside an assumed org', () => {
    expect(actorTypeFor({ actingAsOrgId: 'org-1' })).toBe('PLATFORM_ADMIN');
  });

  it('reports USER for an ordinary org principal', () => {
    expect(actorTypeFor({ actingAsOrgId: null })).toBe('USER');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm api test -- actor-type`
Expected: FAIL — `Cannot find module './actor-type'`.

- [ ] **Step 3: Implement the helper**

Create `apps/api/src/audit/actor-type.ts`:

```ts
import { AuthUser } from '../auth/auth-user';
import { AuditActorType } from './audit.service';

/**
 * Who is really acting (INS-079). A Platform Admin operating inside an assumed
 * org must never be recorded as an ordinary member of that org — AuditService
 * folds actorType into payloadHash, so getting this right is what makes an
 * admin's in-tenant action tamper-evident rather than disguised.
 */
export function actorTypeFor(actor: Pick<AuthUser, 'actingAsOrgId'>): AuditActorType {
  return actor.actingAsOrgId ? 'PLATFORM_ADMIN' : 'USER';
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `pnpm api test -- actor-type`
Expected: PASS, 2 tests.

- [ ] **Step 5: Replace the 13 straightforward call sites**

In each file below, add the import and swap the literal. Every one of these already has `actor: AuthUser`
in scope, so the change is exactly `actorType: 'USER',` → `actorType: actorTypeFor(actor),`.

Add to each file's imports (path is `../audit/actor-type` from every one of these directories):

```ts
import { actorTypeFor } from '../audit/actor-type';
```

Then swap the literal at:

| File | Lines |
|---|---|
| `apps/api/src/buyers/buyers.service.ts` | 115, 129 |
| `apps/api/src/suppliers/suppliers.service.ts` | 83, 97 |
| `apps/api/src/products/products.service.ts` | 86, 100 |
| `apps/api/src/users/users.service.ts` | 133, 172, 191, 209 |
| `apps/api/src/inspections/inspections.service.ts` | 270, 428, 447 |

For example, `buyers.service.ts:115` becomes:

```ts
        { orgId, actorType: actorTypeFor(actor), actorUserId: actor.userId, action: 'buyer.archived', entityType: 'Buyer', entityId: id },
```

**Do not touch `orgs/orgs.service.ts:63`** — it already correctly passes `'PLATFORM_ADMIN'`.

- [ ] **Step 6: Verify no hardcoded literals remain**

Run: `grep -rn "actorType: 'USER'" apps/api/src`
Expected: exactly **one** hit left — `reports.service.ts:150` — which Step 7 handles because it has no
actor in scope at all.

- [ ] **Step 7: Thread the actor through report generation**

`ReportsService.generate(orgId, inspectionId)` takes **no actor**, so its audit row currently has no
`actorUserId` whatsoever — report generation is the act that mints the signed artifact, so leaving it
unattributed defeats the purpose of this task.

In `apps/api/src/reports/reports.service.ts`, change the signature at line 27:

```ts
  async generate(orgId: string, actor: AuthUser, inspectionId: string) {
```

Add the imports:

```ts
import { AuthUser } from '../auth/auth-user';
import { actorTypeFor } from '../audit/actor-type';
```

And at line 150, replace `actorType: 'USER',` with both fields:

```ts
            actorType: actorTypeFor(actor),
            actorUserId: actor.userId,
```

In `apps/api/src/reports/reports.controller.ts:16-18`, pass the actor through (`user` is already in
scope):

```ts
  @Post('inspections/:id/report')
  @Roles('QA_MANAGER')
  generate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.reports.generate(requireOrgId(user), user, id);
  }
```

- [ ] **Step 8: Run the full unit suite**

Run: `pnpm api test`
Expected: PASS, **196** tests (194 + 2). Existing service specs construct `AuthUser` fixtures; if any
fail to compile, add `actingAsOrgId: null` to that fixture — do not weaken the type.

- [ ] **Step 9: Type-check and commit**

```bash
pnpm type-check
git add apps/api/src
git commit -m "fix(api): attribute assumed-org actions to PLATFORM_ADMIN in the audit chain (INS-079)"
```

---

### Task 3: Web — assumed-org cookie and the API header

**Files:**
- Create: `apps/web/lib/admin-org.ts`
- Modify: `apps/web/lib/api.ts:73-89` (`apiGet`), `:116-143` (`apiSend`)

**Interfaces:**
- Consumes: `AuthUser.actingAsOrgId` semantics from Task 1 (the header name `X-Org-Id`).
- Produces: `ADMIN_ORG_COOKIE`, `getAssumedOrgId(): Promise<string | null>`,
  `setAssumedOrgId(orgId)`, `clearAssumedOrgId()` — Tasks 4, 5 and 6 all import these.

- [ ] **Step 1: Create the cookie helper**

Create `apps/web/lib/admin-org.ts`:

```ts
import { cookies } from 'next/headers';

/** Cookie holding the org a Platform Admin is currently operating inside (INS-079). */
export const ADMIN_ORG_COOKIE = 'inspect_admin_org';

/** Server-only: the assumed org id, or null when the admin is un-assumed. */
export async function getAssumedOrgId(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(ADMIN_ORG_COOKIE)?.value?.trim();
  return value ? value : null;
}

/**
 * httpOnly so the browser can never read or forge it; the API is the real
 * authority regardless (it ignores the header for any non-PLATFORM_ADMIN token).
 */
export async function setAssumedOrgId(orgId: string): Promise<void> {
  const store = await cookies();
  store.set(ADMIN_ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
}

export async function clearAssumedOrgId(): Promise<void> {
  const store = await cookies();
  store.delete(ADMIN_ORG_COOKIE);
}
```

- [ ] **Step 2: Attach the header in the two authenticated helpers**

In `apps/web/lib/api.ts`, add the import:

```ts
import { getAssumedOrgId } from './admin-org';
```

Add this helper just below `apiToken`:

```ts
/**
 * Headers carrying the session token plus, for a Platform Admin operating inside
 * an assumed org, the X-Org-Id selector (INS-079). Deliberately NOT used by
 * apiGetPublic/apiPostPublic — those are unauthenticated by contract.
 */
async function authHeaders(): Promise<Record<string, string>> {
  const token = await apiToken();
  const orgId = await getAssumedOrgId();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(orgId ? { 'X-Org-Id': orgId } : {}),
  };
}
```

In `apiGet`, replace the token lookup and `headers` option:

```ts
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: await authHeaders(),
    cache: 'no-store'
  });
```

In `apiSend`, replace the token lookup and merge:

```ts
async function apiSend<T>(method: WriteMethod, path: string, body?: unknown): Promise<T> {
  const hasBody = body !== undefined;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(await authHeaders()),
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    },
    body: hasBody ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
```

- [ ] **Step 3: Confirm the public helpers were not touched**

Run: `grep -n "authHeaders\|apiToken()" apps/web/lib/api.ts`
Expected: `authHeaders` appears in its own definition, in `apiGet`, and in `apiSend` — and **nowhere**
inside `apiGetPublic` or `apiPostPublic`.

- [ ] **Step 4: Type-check and commit**

```bash
pnpm type-check
git add apps/web/lib/admin-org.ts apps/web/lib/api.ts
git commit -m "feat(web): send X-Org-Id from the assumed-org cookie on authenticated API calls (INS-079)"
```

---

### Task 4: Web — the `/admin/orgs` screen

**Files:**
- Create: `apps/web/app/(console)/admin/actions.ts`
- Create: `apps/web/app/(console)/admin/orgs/page.tsx`
- Create: `apps/web/app/(console)/admin/orgs/orgs-client.tsx`
- Modify: `apps/web/lib/api.ts` (add `ApiOrganization`, `ApiCreatedOrg`)

**Interfaces:**
- Consumes: `setAssumedOrgId`, `clearAssumedOrgId` (Task 3); `apiGet`, `apiPost`, `ApiError`.
- Produces: `createOrg(prevState, formData)`, `enterOrg(orgId)`, `exitOrg()` — Task 5's banner calls
  `exitOrg`.

- [ ] **Step 1: Add the response types**

In `apps/web/lib/api.ts`, beside the other response shapes:

```ts
/** GET /admin/orgs row (PLATFORM_ADMIN only). */
export interface ApiOrganization {
  id: string;
  name: string;
  type: 'INSPECTION_COMPANY' | 'MANUFACTURER';
  createdAt: string;
}

/** POST /admin/orgs — the org plus its first ORG_OWNER invitation. */
export interface ApiCreatedOrg {
  org: ApiOrganization;
  invitation: { token: string; email: string; role: string; expiresAt: string };
  emailSent: boolean;
}
```

- [ ] **Step 2: Write the server actions**

Create `apps/web/app/(console)/admin/actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { apiGet, apiPost, ApiError, type ApiCreatedOrg, type ApiOrganization } from '@/lib/api';
import { setAssumedOrgId, clearAssumedOrgId } from '@/lib/admin-org';

async function requirePlatformAdmin(): Promise<void> {
  const session = (await auth()) as unknown as { role?: string } | null;
  if (session?.role !== 'PLATFORM_ADMIN') {
    throw new Error('Platform Admin only');
  }
}

export type CreateOrgState = {
  ok: boolean;
  error?: string;
  created?: { orgName: string; email: string; token: string; emailSent: boolean };
};

export async function createOrg(
  _prev: CreateOrgState,
  formData: FormData,
): Promise<CreateOrgState> {
  await requirePlatformAdmin();
  const name = String(formData.get('name') ?? '').trim();
  const type = String(formData.get('type') ?? 'INSPECTION_COMPANY');
  const ownerEmail = String(formData.get('ownerEmail') ?? '').trim();
  if (!name || !ownerEmail) {
    return { ok: false, error: 'Organization name and owner email are both required.' };
  }
  try {
    const res = await apiPost<ApiCreatedOrg>('/admin/orgs', { name, type, ownerEmail });
    revalidatePath('/admin/orgs');
    return {
      ok: true,
      created: {
        orgName: res.org.name,
        email: res.invitation.email,
        token: res.invitation.token,
        emailSent: res.emailSent,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'Could not create the organization.' };
  }
}

/** Enter an org's workspace. Validates the id once, here — the guard trusts it per request. */
export async function enterOrg(orgId: string): Promise<void> {
  await requirePlatformAdmin();
  const orgs = await apiGet<ApiOrganization[]>('/admin/orgs');
  if (!orgs.some((o) => o.id === orgId)) {
    throw new Error('Unknown organization');
  }
  await setAssumedOrgId(orgId);
  redirect('/dashboard');
}

export async function exitOrg(): Promise<void> {
  await clearAssumedOrgId();
  redirect('/admin/orgs');
}
```

- [ ] **Step 3: Write the server component page**

Create `apps/web/app/(console)/admin/orgs/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { apiGet, type ApiOrganization } from '@/lib/api';
import { PageHead } from '@/components/inspect/shell';
import { OrgsClient } from './orgs-client';

export const dynamic = 'force-dynamic';

export default async function AdminOrgsPage() {
  const session = (await auth()) as unknown as { role?: string } | null;
  // Middleware already routes non-admins away; this is the server-side backstop.
  if (session?.role !== 'PLATFORM_ADMIN') redirect('/dashboard');

  const orgs = await apiGet<ApiOrganization[]>('/admin/orgs').catch(() => [] as ApiOrganization[]);

  return (
    <div style={{ padding: '28px 32px' }}>
      <PageHead
        title="Organizations"
        sub="Every tenant on the platform. Create one to onboard its first Org Owner, or enter a workspace to operate inside it."
      />
      <OrgsClient orgs={orgs} />
    </div>
  );
}
```

- [ ] **Step 4: Write the client component**

Create `apps/web/app/(console)/admin/orgs/orgs-client.tsx`:

```tsx
'use client';

import { useActionState, useState } from 'react';
import { ui } from '@/components/inspect/tokens';
import { Mono } from '@/components/inspect/shell';
import { createOrg, enterOrg, type CreateOrgState } from '../actions';
import type { ApiOrganization } from '@/lib/api';

const INITIAL: CreateOrgState = { ok: false };

export function OrgsClient({ orgs }: { orgs: ApiOrganization[] }) {
  const [state, formAction, pending] = useActionState(createOrg, INITIAL);
  const [copied, setCopied] = useState(false);

  const inviteUrl = state.created
    ? `${typeof window === 'undefined' ? '' : window.location.origin}/invite?token=${state.created.token}`
    : '';

  return (
    <>
      <form
        action={formAction}
        style={{
          marginTop: 20, padding: 16, background: '#fff',
          border: `1px solid ${ui.line}`, borderRadius: 10,
          display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end',
        }}
      >
        <label style={{ flex: '1 1 220px', fontSize: 11.5, color: ui.sub }}>
          Organization name
          <input name="name" required style={inputStyle} />
        </label>
        <label style={{ flex: '1 1 180px', fontSize: 11.5, color: ui.sub }}>
          Type
          <select name="type" defaultValue="INSPECTION_COMPANY" style={inputStyle}>
            <option value="INSPECTION_COMPANY">Inspection company</option>
            <option value="MANUFACTURER">Manufacturer</option>
          </select>
        </label>
        <label style={{ flex: '1 1 240px', fontSize: 11.5, color: ui.sub }}>
          First Org Owner email
          <input name="ownerEmail" type="email" required style={inputStyle} />
        </label>
        <button type="submit" disabled={pending} style={buttonStyle}>
          {pending ? 'Creating…' : 'Create organization'}
        </button>
      </form>

      {state.error && (
        <p style={{ marginTop: 10, fontSize: 12, color: ui.danger }}>{state.error}</p>
      )}

      {state.created && (
        <div style={{ marginTop: 12, padding: 14, background: '#F0F7FF', border: `1px solid ${ui.line}`, borderRadius: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>
            {state.created.orgName} created.{' '}
            {state.created.emailSent
              ? `Invitation emailed to ${state.created.email}.`
              : `Email could not be sent — share this link with ${state.created.email} manually.`}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <Mono style={{ fontSize: 11, wordBreak: 'break-all', flex: 1 }}>{inviteUrl}</Mono>
            <button
              type="button"
              onClick={() => { void navigator.clipboard.writeText(inviteUrl); setCopied(true); }}
              style={buttonStyle}
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 20, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 10 }}>
        {orgs.length === 0 && (
          <div style={{ padding: 20, fontSize: 12.5, color: ui.sub }}>
            No organizations yet — create the first one above.
          </div>
        )}
        {orgs.map((o, i) => (
          <div
            key={o.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
              borderTop: i === 0 ? 'none' : `1px solid ${ui.line}`,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 550 }}>{o.name}</div>
              <div style={{ fontSize: 11, color: ui.faint }}>
                {o.type === 'INSPECTION_COMPANY' ? 'Inspection company' : 'Manufacturer'}
              </div>
            </div>
            <form action={enterOrg.bind(null, o.id)}>
              <button type="submit" style={buttonStyle}>Enter workspace</button>
            </form>
          </div>
        ))}
      </div>
    </>
  );
}

const inputStyle: React.CSSProperties = {
  display: 'block', width: '100%', marginTop: 4, padding: '7px 9px',
  border: `1px solid ${ui.line}`, borderRadius: 7, fontSize: 13, fontFamily: 'inherit',
};

const buttonStyle: React.CSSProperties = {
  padding: '7px 12px', borderRadius: 7, border: `1px solid ${ui.line}`,
  background: '#fff', fontSize: 12.5, fontWeight: 550, cursor: 'pointer',
};
```

- [ ] **Step 5: Confirm `ui.danger` exists**

Run: `grep -n "danger" apps/web/components/inspect/tokens.ts`
Expected: a `danger` token (added by INS-067). If it is absent, use `#B42318` inline and note it.

- [ ] **Step 6: Type-check, build, commit**

```bash
pnpm type-check && pnpm web build
git add apps/web/app/\(console\)/admin apps/web/lib/api.ts
git commit -m "feat(web): /admin/orgs — organization list, create-with-owner-invite, enter workspace (INS-079)"
```

---

### Task 5: Web — nav scoping and the assumption banner

**Files:**
- Modify: `apps/web/components/inspect/shell.tsx:203-211` (NAV), `:216` (Sidebar), `:350-386` (ConsoleShell)
- Modify: `apps/web/app/(console)/layout.tsx`

**Interfaces:**
- Consumes: `getAssumedOrgId` (Task 3); `exitOrg` (Task 4).
- Produces: `ConsoleShell` props `assumedOrgName?: string | null`.

- [ ] **Step 1: Add `scope` to every NAV entry**

Replace the `NAV` array in `apps/web/components/inspect/shell.tsx`:

```ts
const NAV: {
  key: string; label: string; icon: typeof Building2; href: string;
  minRole: RoleKey; scope: 'org' | 'admin';
}[] = [
  { key: 'orgs', label: 'Organizations', icon: Building2, href: '/admin/orgs', minRole: 'platform', scope: 'admin' },
  { key: 'directory', label: 'Buyers & Suppliers', icon: Building2, href: '/dashboard', minRole: 'qa', scope: 'org' },
  { key: 'inspections', label: 'Inspections', icon: ClipboardList, href: '/inspections', minRole: 'inspector', scope: 'org' },
  { key: 'reports', label: 'Reports', icon: FileCheck2, href: '/reports', minRole: 'qa', scope: 'org' },
  { key: 'presets', label: 'Loop Presets', icon: Repeat, href: '/presets', minRole: 'qa', scope: 'org' },
  { key: 'products', label: 'Products', icon: Package, href: '/products', minRole: 'qa', scope: 'org' },
  { key: 'purchase-orders', label: 'Purchase Orders', icon: FileText, href: '/purchase-orders', minRole: 'qa', scope: 'org' },
  { key: 'users', label: 'Users & Roles', icon: Users, href: '/users', minRole: 'owner', scope: 'org' },
];
```

- [ ] **Step 2: Make the filter scope-aware**

`Sidebar` takes a new `isAssuming` prop, and the filter at line 266 becomes:

```tsx
function Sidebar({ org, user, isAssuming }: { org: string; user: typeof DEFAULT_USER; isAssuming: boolean }) {
```

```tsx
      {NAV.filter((n) => {
        const isPlatform = user.role === 'platform';
        // Org screens all run through requireOrgId, so an un-assumed admin must
        // not see links that would 403. Admin screens are admin-only, and stay
        // visible while assuming so the admin can switch orgs without exiting.
        if (n.scope === 'admin') return isPlatform;
        const canSeeOrgNav = !isPlatform || isAssuming;
        return canSeeOrgNav && ROLE_FLOOR[user.role] >= ROLE_FLOOR[n.minRole];
      }).map((n) => {
```

- [ ] **Step 3: Add the banner and thread the props**

Add above `ConsoleShell`:

```tsx
/**
 * Non-dismissible reminder that a Platform Admin is acting inside someone else's
 * tenant (INS-079). Binding QA decisions are possible from here — the operator
 * must never be unsure whose data they are looking at.
 */
function AssumptionBanner({ orgName }: { orgName: string }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '8px 16px', background: '#7C2D12', color: '#fff', fontSize: 12.5,
      }}
    >
      <span style={{ fontWeight: 600 }}>Platform Admin</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        You are operating inside <strong>{orgName}</strong>. Actions are recorded against your admin account.
      </span>
      <form action={exitOrg}>
        <button
          type="submit"
          style={{
            padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.45)',
            background: 'transparent', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          Exit
        </button>
      </form>
    </div>
  );
}
```

Import it at the top of `shell.tsx`:

```ts
import { exitOrg } from '@/app/(console)/admin/actions';
```

Then change `ConsoleShell` to accept and render it:

```tsx
export function ConsoleShell({
  children,
  org = DEFAULT_ORG,
  search = 'Search inspections, buyers, suppliers, POs…',
  userName,
  role,
  assumedOrgName = null,
}: {
  children: ReactNode;
  org?: string;
  search?: string;
  userName?: string;
  role?: RoleKey;
  assumedOrgName?: string | null;
}) {
  const user = userName
    ? { name: userName, initials: initialsFrom(userName), role: role ?? 'inspector' as RoleKey }
    : DEFAULT_USER;
  const isAssuming = Boolean(assumedOrgName);
  return (
    <div
      style={{
        height: '100vh',
        background: ui.bg,
        fontFamily: ui.font,
        fontSize: 13,
        color: ui.ink,
        display: 'flex',
        flexDirection: 'column',
        fontFeatureSettings: '"cv11", "ss01"',
      }}
    >
      {isAssuming && <AssumptionBanner orgName={assumedOrgName as string} />}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Sidebar org={org} user={user} isAssuming={isAssuming} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Topbar org={org} search={search} user={user} />
          <div style={{ flex: 1, overflow: 'auto' }}>{children}</div>
        </div>
      </div>
    </div>
  );
}
```

Note the outer `div` gains `flexDirection: 'column'` and the sidebar/content pair moves into a nested
flex row, so the banner spans the full width above both.

- [ ] **Step 4: Resolve the assumed org name in the layout**

Replace `apps/web/app/(console)/layout.tsx` with:

```tsx
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { ConsoleShell } from '@/components/inspect/shell';
import { apiRoleToRoleKey } from '@/lib/roles';
import { getAssumedOrgId } from '@/lib/admin-org';
import { apiGet, type ApiOrganization } from '@/lib/api';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = (await auth()) as unknown as {
    user?: { email?: string | null; name?: string | null };
    role?: string;
    error?: string;
  } | null;

  if (!session) redirect('/login');

  // jwt callback sets this when the access token has expired and the refresh token
  // is also invalid. Redirect to /logout so a Client Component can call signOut()
  // (cookie mutation requires client or Server Action context, not a layout render).
  if (session.error === 'RefreshAccessTokenError') {
    redirect('/logout?expired=1');
  }

  // INS-079: resolve the assumed org's NAME for the banner. Never fail the whole
  // console over it — an unresolvable id still renders the banner (with the id),
  // because hiding the fact that an org is assumed is the dangerous failure.
  let assumedOrgName: string | null = null;
  if (session.role === 'PLATFORM_ADMIN') {
    const assumedId = await getAssumedOrgId();
    if (assumedId) {
      const orgs = await apiGet<ApiOrganization[]>('/admin/orgs').catch(() => [] as ApiOrganization[]);
      assumedOrgName = orgs.find((o) => o.id === assumedId)?.name ?? assumedId;
    }
  }

  const userName = session.user?.name || session.user?.email || 'User';
  return (
    <ConsoleShell
      userName={userName}
      role={apiRoleToRoleKey(session.role)}
      org={assumedOrgName ?? (session.role === 'PLATFORM_ADMIN' ? 'Platform administration' : undefined)}
      assumedOrgName={assumedOrgName}
    >
      {children}
    </ConsoleShell>
  );
}
```

- [ ] **Step 5: Type-check, build, commit**

```bash
pnpm type-check && pnpm web build
git add apps/web/components/inspect/shell.tsx apps/web/app/\(console\)/layout.tsx
git commit -m "feat(web): scope nav by org/admin and add the non-dismissible assumption banner (INS-079)"
```

---

### Task 6: Web — role routing and the 403 safety net

**Files:**
- Modify: `apps/web/middleware.ts`
- Create: `apps/web/app/(console)/error.tsx`
- Modify: `apps/web/lib/api.ts:91-97` (the stale comment)

**Interfaces:**
- Consumes: the cookie name from Task 3 — but **as a string literal, not an import**. `lib/admin-org.ts`
  imports `next/headers`, which is unavailable in the Edge middleware runtime; importing it there breaks
  the build. Duplicating the one literal is the correct trade. Keep the two in sync.

- [ ] **Step 1: Make the middleware role-aware**

Replace `apps/web/middleware.ts`:

```ts
import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';

/**
 * Role-aware routing (INS-079). An un-assumed Platform Admin has no working
 * org screen — every one runs through requireOrgId and would 403 — so send it
 * to /admin/orgs. Doing this here (rather than per page) covers post-login
 * landing, typed URLs and stale bookmarks with one rule.
 */
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const role = (req.auth as unknown as { role?: string } | null)?.role;
  if (!role) return NextResponse.next();

  const isAdminRoute = pathname.startsWith('/admin');
  const isPlatformAdmin = role === 'PLATFORM_ADMIN';

  if (!isPlatformAdmin && isAdminRoute) {
    return NextResponse.redirect(new URL('/dashboard', req.nextUrl));
  }

  if (isPlatformAdmin && !isAdminRoute) {
    const assuming = Boolean(req.cookies.get('inspect_admin_org')?.value);
    const isConsoleRoute = ['/dashboard', '/inspections', '/reports', '/presets', '/products', '/purchase-orders', '/users']
      .some((p) => pathname === p || pathname.startsWith(`${p}/`));
    if (!assuming && isConsoleRoute) {
      return NextResponse.redirect(new URL('/admin/orgs', req.nextUrl));
    }
  }

  return NextResponse.next();
});

// Don't invoke Middleware on some paths
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)']
};
```

- [ ] **Step 2: Add the error boundary**

Create `apps/web/app/(console)/error.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { ui } from '@/components/inspect/tokens';

/**
 * Console-wide safety net (INS-079). Org-scoped API reads throw on 401/403 by
 * design (lib/api.ts loadOrFallback); before this existed a no-org Platform
 * Admin hitting an org screen produced an unhandled render error.
 */
export default function ConsoleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const noOrgContext = /organization context/i.test(error.message);

  return (
    <div style={{ padding: '48px 32px', maxWidth: 560 }}>
      <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>
        {noOrgContext ? 'No organization context' : 'Something went wrong'}
      </h2>
      <p style={{ fontSize: 13, color: ui.sub, lineHeight: 1.5 }}>
        {noOrgContext
          ? 'This screen belongs to an organization workspace, and your account is not currently operating inside one. Choose an organization to enter.'
          : 'This screen could not be loaded.'}
      </p>
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        {noOrgContext && (
          <Link
            href="/admin/orgs"
            style={{
              padding: '7px 12px', borderRadius: 7, border: `1px solid ${ui.line}`,
              background: '#fff', fontSize: 12.5, fontWeight: 550, textDecoration: 'none', color: ui.ink,
            }}
          >
            Go to Organizations
          </Link>
        )}
        <button
          type="button"
          onClick={reset}
          style={{
            padding: '7px 12px', borderRadius: 7, border: `1px solid ${ui.line}`,
            background: '#fff', fontSize: 12.5, fontWeight: 550, cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Correct the stale comment**

In `apps/web/lib/api.ts`, the `loadOrFallback` docblock currently claims "the layout intercepts these
before any page renders (see ConsoleLayout)" — which was never true. Replace those two lines with:

```
 * Re-throws 401/403 — those are auth failures, not "API offline". Middleware
 * routes an un-assumed Platform Admin away from org screens before they render;
 * anything that still escapes is caught by app/(console)/error.tsx (INS-079).
```

- [ ] **Step 4: Type-check, build, commit**

```bash
pnpm type-check && pnpm web build
git add apps/web/middleware.ts apps/web/app/\(console\)/error.tsx apps/web/lib/api.ts
git commit -m "feat(web): role-aware middleware routing + console 403 safety net (INS-079)"
```

---

### Task 7: DB-backed integration proof

**Files:**
- Modify: `apps/api/test/integration/support.ts:22-33,44-63`
- Create: `apps/api/test/integration/admin-org-assumption.e2e-spec.ts`

**Interfaces:**
- Consumes: `bootApp`, `apiClient`, `expect2xx`, `loginAdmin`, `createOrgWithOwner`, `runTag`.
- Produces: `CallOpts.orgId` — sets the `X-Org-Id` header.

**Prerequisite:** a migrated + seeded `DATABASE_URL` + `REDIS_URL` (repo-root `.env` locally).

- [ ] **Step 1: Teach the harness to send the header**

In `apps/api/test/integration/support.ts`, extend `CallOpts` and the `call` implementation:

```ts
interface CallOpts {
  token?: string;
  body?: unknown;
  /** INS-079: assume an org as a Platform Admin (sets X-Org-Id). */
  orgId?: string;
}
```

```ts
    let req = request(app.getHttpServer())[method](path);
    if (opts.token) req = req.set('authorization', `Bearer ${opts.token}`);
    if (opts.orgId) req = req.set('x-org-id', opts.orgId);
    if (opts.body !== undefined) req = req.send(opts.body as object);
```

- [ ] **Step 2: Write the failing spec**

Create `apps/api/test/integration/admin-org-assumption.e2e-spec.ts`:

```ts
/**
 * INS-079: a Platform Admin may assume an org and operate inside it. These tests
 * are the tenant boundary and the audit-honesty proof — the two things that make
 * the feature safe.
 */
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  ApiClient, apiClient, bootApp, createOrgWithOwner, expect2xx, loginAdmin, runTag,
} from './support';

describe('Platform-Admin org assumption (INS-079)', () => {
  let app: INestApplication;
  let client: ApiClient;
  let adminToken: string;
  let orgA: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let orgB: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let buyerAName: string;

  beforeAll(async () => {
    app = await bootApp();
    client = apiClient(app);
    adminToken = await loginAdmin(client);
    orgA = await createOrgWithOwner(client, adminToken, runTag('assume-a'));
    orgB = await createOrgWithOwner(client, adminToken, runTag('assume-b'));

    buyerAName = `Assume Buyer ${runTag('a')}`;
    expect2xx(
      await client.post('/buyers', { token: orgA.ownerToken, body: { name: buyerAName } }),
      'POST /buyers (org A)',
    );
    expect2xx(
      await client.post('/buyers', { token: orgB.ownerToken, body: { name: `Assume Buyer ${runTag('b')}` } }),
      'POST /buyers (org B)',
    );
  }, 120_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  it('still 403s an admin with no assumed org', async () => {
    const res = await client.get('/buyers', { token: adminToken });
    expect(res.status).toBe(403);
  });

  it('reads the assumed org and only the assumed org', async () => {
    const a = expect2xx(
      await client.get('/buyers', { token: adminToken, orgId: orgA.orgId }),
      'GET /buyers (assuming org A)',
    ) as { name: string }[];
    expect(a.some((b) => b.name === buyerAName)).toBe(true);

    const b = expect2xx(
      await client.get('/buyers', { token: adminToken, orgId: orgB.orgId }),
      'GET /buyers (assuming org B)',
    ) as { name: string }[];
    expect(b.some((x) => x.name === buyerAName)).toBe(false);
  });

  // The tenant boundary: the header must do nothing at all for a non-admin.
  it('ignores X-Org-Id from an ORG_OWNER — no leak, no error', async () => {
    const res = await client.get('/buyers', { token: orgB.ownerToken, orgId: orgA.orgId });
    const rows = expect2xx(res, 'GET /buyers (owner B spoofing org A)') as { name: string }[];
    expect(rows.some((x) => x.name === buyerAName)).toBe(false);
  });

  it('attributes an assumed-org write to PLATFORM_ADMIN with the real admin id', async () => {
    const created = expect2xx(
      await client.post('/buyers', {
        token: adminToken,
        orgId: orgA.orgId,
        body: { name: `Admin-made Buyer ${runTag('adm')}` },
      }),
      'POST /buyers (assuming org A)',
    );
    expect2xx(
      await client.post(`/buyers/${created.id}/archive`, { token: adminToken, orgId: orgA.orgId }),
      'POST /buyers/:id/archive (assuming org A)',
    );

    const me = expect2xx(await client.get('/auth/me', { token: adminToken }), 'GET /auth/me');

    // There is no audit read endpoint (verified: no @Controller('audit') exists),
    // so assert against the row directly. This is the whole point of the task —
    // an admin's in-tenant write must not look like an org member's.
    const prisma = new PrismaClient();
    try {
      const row = await prisma.auditLog.findFirst({
        where: { orgId: orgA.orgId, action: 'buyer.archived', entityId: created.id },
      });
      expect(row).toBeTruthy();
      expect(row!.actorType).toBe('PLATFORM_ADMIN');
      expect(row!.actorUserId).toBe(me.userId);
    } finally {
      await prisma.$disconnect();
    }
  });

  it('does not let an assumed admin mint another PLATFORM_ADMIN', async () => {
    const res = await client.post('/users', {
      token: adminToken,
      orgId: orgA.orgId,
      body: {
        name: 'Escalation Attempt',
        email: `escalate+${runTag('x')}@e2e.local`,
        password: 'NotAllowed!12345',
        role: 'PLATFORM_ADMIN',
      },
    });
    expect(res.status).toBe(403);
  });

  it('403s an ORG_OWNER on POST /admin/orgs', async () => {
    const res = await client.post('/admin/orgs', {
      token: orgA.ownerToken,
      body: { name: 'Should Not Exist', type: 'INSPECTION_COMPANY', ownerEmail: `no+${runTag('n')}@e2e.local` },
    });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 3: Confirm the chain still verifies after an admin write**

The attribution only matters if the chain it lands in is still intact. Add this test to the same
`describe`, after the attribution test:

```ts
  it('leaves org A\'s audit chain verifiable after an assumed-org write', async () => {
    const prisma = new PrismaClient();
    try {
      const rows = await prisma.auditLog.findMany({
        where: { orgId: orgA.orgId },
        orderBy: { sequence: 'asc' },
      });
      expect(rows.length).toBeGreaterThan(0);
      // Sequence is monotonic and gap-free for this org — an admin write must not
      // fork or skip the chain it joins.
      rows.forEach((row, i) => expect(row.sequence).toBe(i + 1));
      expect(rows.some((r) => r.actorType === 'PLATFORM_ADMIN')).toBe(true);
    } finally {
      await prisma.$disconnect();
    }
  });
```

- [ ] **Step 4: Run the integration suite**

Run: `pnpm api test:integration`
Expected: the existing 60 tests still pass, plus 7 new ones = **67**. If the count differs, report the
actual number — do not adjust the assertion to match a wrong result.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/integration
git commit -m "test(api): integration proof for org assumption isolation + audit attribution (INS-079)"
```

---

### Task 8: Manual verification and documentation close-out

**Files:**
- Modify: `docs/STATUS.md`, `docs/future/BACKLOG.md`
- Move: `docs/in-progress/specs/2026-07-25-*.md` → `docs/done/specs/`,
  `docs/in-progress/plans/2026-07-25-*.md` → `docs/done/plans/`

- [ ] **Step 1: Run the full verification set**

```bash
pnpm api test && pnpm api test:integration && pnpm type-check && pnpm web build
```

Expected: 196 unit / 67 integration / type-check clean / build clean. Record the real numbers — if they
differ from these, report the actual output rather than these expectations.

- [ ] **Step 2: Drive the console by hand**

With `pnpm dev` running, log in as the `BOOTSTRAP_ADMIN_EMAIL` account and confirm each of:

1. Landing is `/admin/orgs`, **not** a crash on `/dashboard`.
2. The sidebar shows **only** Organizations.
3. Creating an org shows the copyable invite link with honest emailed/not-emailed copy.
4. "Enter workspace" lands on `/dashboard` with live tiles, and the full org nav appears.
5. The banner is visible on every console screen and names the right org.
6. Exit returns to `/admin/orgs` and the org nav disappears.
7. Logging in as an ORG_OWNER is completely unchanged, and `/admin/orgs` redirects them to `/dashboard`.

- [ ] **Step 3: Update the backlog**

In `docs/future/BACKLOG.md`: flip **INS-079** to `status: done` with a dated `done:` line recording the
real test counts, and flip **INS-078** to `status: done` noting it was resolved as a consequence of
INS-079 rather than implemented directly.

- [ ] **Step 4: Update STATUS.md**

Bump the **"Last verified"** date to the completion date, add an **Active work** entry summarizing
INS-079, and update the "Web console" and "Auth & RBAC"-relevant pillar rows to reflect that the
Platform Admin now has a working console.

- [ ] **Step 5: Move the spec and plan to `done/`**

```bash
git mv docs/in-progress/specs/2026-07-25-inspect-platform-admin-org-assumption-design.md docs/done/specs/
git mv docs/in-progress/plans/2026-07-25-inspect-platform-admin-org-assumption.md docs/done/plans/
```

Then fix the relative links inside both files (`../specs/` ↔ `../plans/` still resolve after the move;
the `../../../apps/...` code links still resolve; the `../../future/BACKLOG.md` links still resolve —
verify each rather than assuming).

- [ ] **Step 6: Commit**

```bash
git add docs
git commit -m "docs: close INS-079 (+INS-078 as a consequence); move spec + plan to done"
```

---

## Notes for the implementer

- **If a test in Task 1 or Task 7 fails, stop.** Those two tasks are the tenant boundary. A failure
  there is not a flaky test to route around.
- **Never make the header's rejection observable.** If you find yourself adding a 400/403 for a
  non-admin sending `X-Org-Id`, re-read the Global Constraints.
- **Out of scope, found while planning:** `ApiReport.generatedBy` (`apps/web/lib/api.ts:390`) is a
  phantom field — `grep -rn "generatedBy" apps/api` returns nothing, so neither the schema nor the
  service has it. Do not fix it here; report it so it can be filed separately.
