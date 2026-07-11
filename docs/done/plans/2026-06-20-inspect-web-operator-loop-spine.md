# Inspect Web — Operator-Loop Spine — Implementation Plan

> **Status: ✅ DONE — shipped + verified live 2026-06-20; moved to `done/` 2026-07-11.** Closes INS-026/027/028
> (create-inspection wired, QA decision persisted, real session/sign-out). See [STATUS.md](../../STATUS.md).
> (Checkboxes below were not ticked during execution; completion is tracked in STATUS/BACKLOG + the shipped code.)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the QA operator loop (session → create inspection → submit → QA decision) into the Next.js console against the verified API.

**Architecture:** Server Components read via `apiGet`; mutations go through `'use server'` Server Actions calling the server-only write helpers (`apiPost`/`apiPatch`), keeping the JWT server-side. One read-only backend endpoint (`GET /inspections/aql-preview`) reuses the verified `computeSampling` engine for a live plan preview. Buyer/supplier/product are derived from the selected Purchase Order.

**Tech Stack:** NestJS 11 + Prisma 6 (API), Next.js 15 App Router + React 19 + NextAuth v5 (web), Jest (API unit tests). No new runtime dependencies.

**Spec:** [docs/done/specs/2026-06-20-inspect-web-operator-loop-spine-design.md](../specs/2026-06-20-inspect-web-operator-loop-spine-design.md)

## Global Constraints

- Node ≥ 20, pnpm 9.12.0. Run all commands from the repo root unless noted.
- **No new runtime dependencies** in either app.
- **Server Actions for all writes**; never expose the access token to client components. Reads in Server Components via `apiGet`; client→server data via Server Actions only.
- Tenancy + RBAC are enforced **server-side** by the API (orgId derived from the JWT). The web does not re-implement them.
- **Keep green:** `pnpm --filter @inspect/api test` (97 unit tests) and `pnpm type-check` (both apps) must pass after every task.
- Reuse the existing design system (`components/inspect/shell.tsx` primitives + `tokens.ts`). Do **not** introduce a second component vocabulary.
- API role → web `RoleKey`: `INSPECTOR→inspector`, `QA_MANAGER→qa`, `ORG_OWNER→owner`, `PLATFORM_ADMIN→platform`.
- The AQL engine lives only in `apps/api`; the web must not duplicate its tables — it calls the preview endpoint.

## Prerequisites for manual web verification

The org-scoped screens require an **ORG_OWNER** (or QA_MANAGER) login — the bootstrap admin is `PLATFORM_ADMIN` with `orgId=null` and will be 403'd by `requireOrgId`. Before verifying web tasks:

1. Ensure the API runs on `:3000` against the DB (`pnpm --filter @inspect/api exec nest start`; `GET /health` → db+redis up) and the web on `:3001` (`pnpm web dev`).
2. Mint a known org-owner once (idempotent-ish; uses a fresh org each run):

```bash
node -e '
const B="http://localhost:3000";
const admin={email:process.env.BOOTSTRAP_ADMIN_EMAIL||"admin@inspect.local",password:process.env.BOOTSTRAP_ADMIN_PASSWORD};
(async()=>{
  // read admin password from root .env if not in env
  if(!admin.password){const fs=require("fs");for(const l of fs.readFileSync(".env","utf8").split(/\r?\n/)){const m=l.match(/^BOOTSTRAP_ADMIN_PASSWORD="?([^"]*)"?/);if(m)admin.password=m[1];}}
  const j=async(p,o)=>{const r=await fetch(B+p,o);if(!r.ok)throw new Error(p+" "+r.status+" "+await r.text());return r.json();};
  const a=await j("/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(admin)});
  const org=await j("/admin/orgs",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+a.accessToken},body:JSON.stringify({name:"Dev Org "+Date.now(),type:"INSPECTION_COMPANY",ownerEmail:"devowner@inspect.local"})});
  await j("/invitations/accept",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:org.invitation.token,password:"Devowner!123",name:"Dev Owner"})});
  // seed one PO so the create screen has data: buyer+supplier+product+PO
  const o=await j("/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:"devowner@inspect.local",password:"Devowner!123"})});
  const H={authorization:"Bearer "+o.accessToken,"content-type":"application/json"};
  const b=await j("/buyers",{method:"POST",headers:H,body:JSON.stringify({name:"Dev Buyer"})});
  const s=await j("/suppliers",{method:"POST",headers:H,body:JSON.stringify({name:"Dev Supplier"})});
  const p=await j("/products",{method:"POST",headers:H,body:JSON.stringify({styleNumber:"DEV-001"})});
  await j("/purchase-orders",{method:"POST",headers:H,body:JSON.stringify({poNumber:"PO-DEV-"+Date.now(),buyerId:b.id,supplierId:s.id,productId:p.id,totalQuantity:1000})});
  // a minimal preset
  await j("/loop-presets",{method:"POST",headers:H,body:JSON.stringify({name:"Dev Loop",aqlLevel:"II",steps:[{zoneName:"Front",requiredShotCount:1}]})});
  console.log("READY — login devowner@inspect.local / Devowner!123 (org has 1 PO + 1 preset)");
})().catch(e=>{console.error(e);process.exit(1);});
'
```

Log into the web console at `http://localhost:3001/login` as `devowner@inspect.local` / `Devowner!123`.

---

## Task 1: AQL preview endpoint (backend, TDD)

**Files:**
- Modify: `apps/api/src/inspections/inspections.service.ts`
- Modify: `apps/api/src/inspections/inspections.controller.ts`
- Test: `apps/api/src/inspections/aql-preview.spec.ts` (create)

**Interfaces:**
- Produces: `InspectionsService.aqlPreview(lotSize: number, plan: { critical?: number; major?: number; minor?: number }): ComputedSampling` (throws `BadRequestException` for out-of-band/invalid input); HTTP `GET /inspections/aql-preview?lotSize=&critical=&major=&minor=` returning `ComputedSampling`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/inspections/aql-preview.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { InspectionsService } from './inspections.service';

describe('InspectionsService.aqlPreview', () => {
  // aqlPreview is pure (no Prisma access) — pass a null client.
  const svc = new InspectionsService(null as never);

  it('returns the computed plan for an in-band lot (1000 -> code J, n 80)', () => {
    const out = svc.aqlPreview(1000, {});
    expect(out.sampleSizeCodeLetter).toBe('J');
    expect(out.sampleSize).toBe(80);
    expect(out.perClass.major).toEqual({ aql: 2.5, ac: 5, re: 6 });
    expect(out.perClass.minor).toEqual({ aql: 4, ac: 7, re: 8 });
    expect(out.perClass.critical).toEqual({ aql: 0, ac: 0, re: 1 });
  });

  it('throws BadRequestException for an AQL outside the verified band', () => {
    expect(() => svc.aqlPreview(1000, { major: 3 })).toThrow(BadRequestException);
  });

  it('throws BadRequestException for a lot size below 2', () => {
    expect(() => svc.aqlPreview(1, {})).toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @inspect/api exec jest src/inspections/aql-preview.spec.ts`
Expected: FAIL — `aqlPreview is not a function`.

- [ ] **Step 3: Implement `aqlPreview` in the service**

In `apps/api/src/inspections/inspections.service.ts`, add this method to the `InspectionsService` class (after `create`):

```ts
  /** Read-only AQL plan preview for the create screen (spec §8). Reuses computeSampling. */
  aqlPreview(lotSize: number, plan: { critical?: number; major?: number; minor?: number }) {
    if (!Number.isInteger(lotSize) || lotSize < 2) {
      throw new BadRequestException('lotSize must be an integer >= 2');
    }
    try {
      return computeSampling(lotSize, plan as AqlPlanInput);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'AQL plan not available');
    }
  }
```

(`computeSampling`, `AqlPlanInput`, and `BadRequestException` are already imported in this file.)

- [ ] **Step 4: Add the controller route**

In `apps/api/src/inspections/inspections.controller.ts`, add a `Query` import (it is already imported) and this route to `InspectionsController` (above `@Get(':id')` so the literal path is matched first):

```ts
  @Get('aql-preview')
  preview(
    @Query('lotSize') lotSize?: string,
    @Query('critical') critical?: string,
    @Query('major') major?: string,
    @Query('minor') minor?: string,
  ) {
    const num = (v?: string) => (v === undefined || v === '' ? undefined : Number(v));
    return this.inspections.aqlPreview(Number(lotSize), {
      critical: num(critical),
      major: num(major),
      minor: num(minor),
    });
  }
```

Note: the controller is `@Roles('QA_MANAGER')`, so this route is QA_MANAGER+ and org-guarded by the global guards.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @inspect/api exec jest src/inspections/aql-preview.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Verify the full suite + type-check still green**

Run: `pnpm --filter @inspect/api test` → Expected: 100 passed (97 + 3).
Run: `pnpm --filter @inspect/api type-check` → Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/inspections/inspections.service.ts apps/api/src/inspections/inspections.controller.ts apps/api/src/inspections/aql-preview.spec.ts
git commit -m "feat(api): read-only AQL plan preview endpoint (INS-026)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Session & shell wiring (INS-028)

**Files:**
- Create: `apps/web/lib/roles.ts`
- Create: `apps/web/app/(console)/actions.ts`
- Modify: `apps/web/app/(console)/layout.tsx`
- Modify: `apps/web/components/inspect/shell.tsx`

**Interfaces:**
- Produces: `apiRoleToRoleKey(role?: string): RoleKey`, `initialsFrom(label: string): string` (in `lib/roles.ts`); `signOutAction(): Promise<void>` (in `(console)/actions.ts`); `ConsoleShell` accepts `userName?: string; role?: RoleKey`.

- [ ] **Step 1: Create the role helper**

Create `apps/web/lib/roles.ts`:

```ts
import type { RoleKey } from '@/components/inspect/tokens';

export function apiRoleToRoleKey(role?: string): RoleKey {
  switch (role) {
    case 'PLATFORM_ADMIN':
      return 'platform';
    case 'ORG_OWNER':
      return 'owner';
    case 'QA_MANAGER':
      return 'qa';
    default:
      return 'inspector';
  }
}

/** Two-letter initials from a name or email local-part. */
export function initialsFrom(label: string): string {
  const base = label.replace(/@.*/, '');
  const parts = base.split(/[.\s_-]+/).filter(Boolean);
  const a = parts[0]?.[0] ?? base[0] ?? '?';
  const b = parts[1]?.[0] ?? '';
  return (a + b).toUpperCase();
}
```

- [ ] **Step 2: Create the sign-out server action**

Create `apps/web/app/(console)/actions.ts`:

```ts
'use server';

import { signOut } from '@/lib/auth';

export async function signOutAction() {
  await signOut({ redirectTo: '/login' });
}
```

- [ ] **Step 3: Wire the layout to the session**

Replace `apps/web/app/(console)/layout.tsx` with:

```tsx
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { ConsoleShell } from '@/components/inspect/shell';
import { apiRoleToRoleKey } from '@/lib/roles';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = (await auth()) as unknown as {
    user?: { email?: string | null; name?: string | null };
    role?: string;
  } | null;
  if (!session) redirect('/login');
  const userName = session.user?.name || session.user?.email || 'User';
  return (
    <ConsoleShell userName={userName} role={apiRoleToRoleKey(session.role)}>
      {children}
    </ConsoleShell>
  );
}
```

- [ ] **Step 4: Thread props through `ConsoleShell`**

In `apps/web/components/inspect/shell.tsx`:

(a) Import the helper and the sign-out action at the top (after the existing imports):

```tsx
import { initialsFrom } from '@/lib/roles';
import { signOutAction } from '@/app/(console)/actions';
```

(b) Change the `ConsoleShell` signature and pass a `user` object down. Replace the `ConsoleShell` function's params and body header:

```tsx
export function ConsoleShell({
  children,
  org = DEFAULT_ORG,
  search = 'Search inspections, buyers, suppliers, POs…',
  userName,
  role,
}: {
  children: ReactNode;
  org?: string;
  search?: string;
  userName?: string;
  role?: RoleKey;
}) {
  const user = userName
    ? { name: userName, initials: initialsFrom(userName), role: role ?? 'inspector' }
    : DEFAULT_USER;
```

Then pass `user` into `Sidebar` and `Topbar`:

```tsx
      <Sidebar org={org} user={user} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Topbar org={org} search={search} user={user} />
```

(c) Update `Sidebar` to accept and render `user` (replace its signature + the footer block that uses `DEFAULT_USER`):

```tsx
function Sidebar({ org, user }: { org: string; user: typeof DEFAULT_USER }) {
```

and in its footer replace the three `DEFAULT_USER.*` references with `user.*`:

```tsx
        <Avatar initials={user.initials} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 550, lineHeight: 1.3 }}>{user.name}</div>
          <div style={{ marginTop: 2 }}>
            <RoleBadge role={user.role} />
          </div>
        </div>
```

(d) Update `Topbar` to accept `user`, render it, and add a sign-out button (replace its signature + the user block):

```tsx
function Topbar({ org, search, user }: { org: string; search: string; user: typeof DEFAULT_USER }) {
```

and replace the user cluster at the end of the topbar (`<Avatar ... /> … <ChevronDown />`) with:

```tsx
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <Avatar initials={user.initials} size={30} />
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{user.name}</div>
            <div style={{ fontSize: 10.5, color: ui.faint, marginTop: 1 }}>
              {roles[user.role].label} · {org.split(' ')[0]}
            </div>
          </div>
          <form action={signOutAction}>
            <button
              type="submit"
              title="Sign out"
              style={{ display: 'flex', alignItems: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, color: ui.sub }}
            >
              <LogOut size={16} />
            </button>
          </form>
        </div>
```

(e) Add `LogOut` to the `lucide-react` import list at the top of the file.

- [ ] **Step 5: Type-check**

Run: `pnpm --filter @inspect/web type-check`
Expected: exit 0.

- [ ] **Step 6: Manual verification**

With the API (:3000) + web (:3001) running and the dev owner minted (Prerequisites):
- Visit `http://localhost:3001/login`, log in as `devowner@inspect.local` / `Devowner!123`.
- Expected: the sidebar + topbar show **Dev Owner** with the **Org Owner** role badge (not "Riya Saraf").
- Click the sign-out icon in the topbar → redirected to `/login`; revisiting a console route redirects to `/login`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/roles.ts "apps/web/app/(console)/actions.ts" "apps/web/app/(console)/layout.tsx" apps/web/components/inspect/shell.tsx
git commit -m "feat(web): wire console shell to the real session + sign-out (INS-028)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Review + submit + decide screen (INS-027)

**Files:**
- Create: `apps/web/app/(console)/inspections/actions.ts`
- Create: `apps/web/app/(console)/inspections/[id]/review/page.tsx`
- Create: `apps/web/app/(console)/inspections/[id]/review/decision-panel.tsx`
- Modify: `apps/web/lib/api.ts` (add response shapes)
- Delete: `apps/web/app/(console)/review/page.tsx`

**Interfaces:**
- Consumes: `apiGet`, `apiPost`, `ApiError` (from `lib/api.ts`).
- Produces: all four Server Actions in `inspections/actions.ts` — `submitInspection(id: string): Promise<{ error?: string }>`, `decideInspection(prev, formData): Promise<{ error?: string }>`, `previewAql(input): Promise<{ data?: AqlPreview; error?: string }>`, `createInspection(prev, formData): Promise<{ error?: string }>` (Task 4 only *consumes* the latter two); response shapes `ApiInspection`, `ApiAqlResult`, `ApiPurchaseOrder`, `AqlPreview`.

- [ ] **Step 1: Add API response shapes**

In `apps/web/lib/api.ts`, append to the response-shapes block at the bottom:

```ts
export interface ApiAqlResult {
  systemRecommendation: 'PASS' | 'FAIL';
  perClass: Record<'critical' | 'major' | 'minor', { found: number; ac: number; re: number; outcome: 'PASS' | 'FAIL' }>;
  qaDecision?: 'PASS' | 'FAIL' | 'HOLD' | null;
  qaRemarks?: string | null;
}
export interface ApiInspection {
  id: string;
  status: string;
  lotSize?: number | null;
  computedSampling?: { sampleSizeCodeLetter: string; sampleSize: number; perClass: Record<string, { aql: number; ac: number; re: number }> } | null;
  aqlResult?: ApiAqlResult | null;
  buyer?: { id: string; name: string } | null;
  supplier?: { id: string; name: string } | null;
  product?: { id: string; styleNumber: string } | null;
  purchaseOrder?: { id: string; poNumber: string } | null;
  createdAt?: string;
}
export interface ApiPurchaseOrder {
  id: string;
  poNumber: string;
  buyer?: { id: string; name: string } | null;
  supplier?: { id: string; name: string } | null;
  product?: { id: string; styleNumber: string } | null;
}
export interface AqlPreview {
  sampleSizeCodeLetter: string;
  sampleSize: number;
  perClass: Record<'critical' | 'major' | 'minor', { aql: number; ac: number; re: number }>;
}
```

- [ ] **Step 2: Create the inspections server actions**

Create `apps/web/app/(console)/inspections/actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { apiGet, apiPost, ApiError, type AqlPreview } from '@/lib/api';

const msg = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

export async function previewAql(input: { lotSize: number; critical?: number; major?: number; minor?: number }): Promise<{ data?: AqlPreview; error?: string }> {
  if (!Number.isFinite(input.lotSize) || input.lotSize < 2) return { error: 'Enter a lot size of 2 or more' };
  const q = new URLSearchParams({ lotSize: String(Math.trunc(input.lotSize)) });
  if (input.critical != null) q.set('critical', String(input.critical));
  if (input.major != null) q.set('major', String(input.major));
  if (input.minor != null) q.set('minor', String(input.minor));
  try {
    return { data: await apiGet<AqlPreview>(`/inspections/aql-preview?${q.toString()}`) };
  } catch (e) {
    return { error: msg(e, 'preview failed') };
  }
}

export async function createInspection(_prev: unknown, formData: FormData): Promise<{ error?: string }> {
  const poId = String(formData.get('poId') ?? '');
  const loopPresetId = String(formData.get('loopPresetId') ?? '');
  const lotSize = Number(formData.get('lotSize'));
  const assignedInspectorId = (formData.get('assignedInspectorId') as string) || undefined;
  const clientRequestId = (formData.get('clientRequestId') as string) || undefined;
  if (!poId) return { error: 'Select a purchase order' };
  if (!loopPresetId) return { error: 'Select a loop preset' };
  if (!Number.isFinite(lotSize) || lotSize < 2) return { error: 'Enter a lot size of 2 or more' };
  let id: string;
  try {
    const insp = await apiPost<{ id: string }>('/inspections', { poId, loopPresetId, lotSize, assignedInspectorId, clientRequestId });
    id = insp.id;
  } catch (e) {
    return { error: msg(e, 'create failed') };
  }
  redirect(`/inspections/${id}/review`);
}

export async function submitInspection(id: string): Promise<{ error?: string }> {
  try {
    await apiPost(`/inspections/${id}/submit`, { deviceId: 'web-console' });
    revalidatePath(`/inspections/${id}/review`);
    return {};
  } catch (e) {
    return { error: msg(e, 'submit failed') };
  }
}

export async function decideInspection(_prev: unknown, formData: FormData): Promise<{ error?: string }> {
  const id = String(formData.get('id') ?? '');
  const decision = String(formData.get('decision') ?? '') as 'PASS' | 'FAIL' | 'HOLD';
  const remarks = String(formData.get('remarks') ?? '');
  if (!decision) return { error: 'Select a decision' };
  if (!remarks.trim()) return { error: 'A decision note is required' };
  try {
    await apiPost(`/inspections/${id}/decision`, { decision, remarks });
    revalidatePath(`/inspections/${id}/review`);
    return {};
  } catch (e) {
    return { error: msg(e, 'decision failed') };
  }
}
```

Note: `redirect()` throws to perform the navigation, so it is placed **after** the try/catch in `createInspection` (never inside it).

- [ ] **Step 3: Create the decision panel (client component)**

Create `apps/web/app/(console)/inspections/[id]/review/decision-panel.tsx`:

```tsx
'use client';

import { useActionState, useState, useTransition } from 'react';
import { Lock } from 'lucide-react';
import { severity, ui } from '@/components/inspect/tokens';
import { decideInspection, submitInspection } from '../../actions';

const options = [
  { k: 'PASS', label: 'Pass', desc: 'Release the lot. Overrides the system flag.', color: '#1F8A4C', bg: '#EAF6F0', bd: '#BEE3CD' },
  { k: 'FAIL', label: 'Fail', desc: 'Reject the lot. Matches a system FAIL.', color: severity.critical.fg, bg: severity.critical.bg, bd: '#F1C9C5' },
  { k: 'HOLD', label: 'Hold', desc: 'Pause for clarification or re-inspection.', color: severity.major.fg, bg: severity.major.bg, bd: '#EBD9B4' },
] as const;

export function SubmitForReview({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 13, color: ui.sub }}>
        This inspection has not been submitted. Submitting locks the audit block and computes the AQL result.
      </div>
      {error && <div style={{ fontSize: 12.5, color: severity.critical.fg }}>{error}</div>}
      <button
        disabled={pending}
        onClick={() => start(async () => { const r = await submitInspection(id); if (r.error) setError(r.error); })}
        style={{ height: 44, background: ui.accent, color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: pending ? 'default' : 'pointer', opacity: pending ? 0.7 : 1 }}
      >
        {pending ? 'Submitting…' : 'Submit for review'}
      </button>
    </div>
  );
}

export function DecisionForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(decideInspection, {} as { error?: string });
  const [decision, setDecision] = useState<string>('');
  return (
    <form action={action} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="decision" value={decision} />
      {options.map((o) => {
        const sel = o.k === decision;
        return (
          <label key={o.k} onClick={() => setDecision(o.k)} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: 14, borderRadius: 10, cursor: 'pointer', background: sel ? o.bg : '#fff', border: `1px solid ${sel ? o.bd : ui.line}` }}>
            <span style={{ width: 18, height: 18, borderRadius: 999, marginTop: 1, border: `1.5px solid ${sel ? o.color : '#C8D0DA'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {sel && <span style={{ width: 8, height: 8, borderRadius: 999, background: o.color }} />}
            </span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: sel ? o.color : ui.ink }}>{o.label}</div>
              <div style={{ fontSize: 12, color: ui.sub, marginTop: 2, lineHeight: 1.45 }}>{o.desc}</div>
            </div>
          </label>
        );
      })}
      <div style={{ marginTop: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 550, marginBottom: 6 }}>Decision note <span style={{ color: severity.critical.fg }}>*</span></div>
        <textarea name="remarks" required style={{ width: '100%', height: 76, padding: 12, fontSize: 13, lineHeight: 1.5, resize: 'none', boxSizing: 'border-box', background: ui.fill, border: `1px solid ${ui.line}`, borderRadius: 8, fontFamily: 'inherit', color: ui.ink, outline: 'none' }} />
      </div>
      {state?.error && <div style={{ fontSize: 12.5, color: severity.critical.fg }}>{state.error}</div>}
      <button type="submit" disabled={pending} style={{ height: 44, background: ui.accent, color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, marginTop: 4, cursor: pending ? 'default' : 'pointer', opacity: pending ? 0.7 : 1 }}>
        {pending ? 'Submitting…' : 'Submit decision'}
      </button>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 11.5, color: ui.faint, lineHeight: 1.45 }}>
        <Lock size={13} color={ui.faint} style={{ marginTop: 1, flexShrink: 0 }} />
        Submitting locks the report. Corrections require a new linked re-inspection.
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Create the review page (server component)**

Create `apps/web/app/(console)/inspections/[id]/review/page.tsx`:

```tsx
import { ChevronRight, ClipboardList } from 'lucide-react';
import { apiGet, type ApiInspection } from '@/lib/api';
import { Mono, PageHead, SeverityTag } from '@/components/inspect/shell';
import { severity, ui, type SeverityKey } from '@/components/inspect/tokens';
import { DecisionForm, SubmitForReview } from './decision-panel';

const SUBMITTABLE = new Set(['DRAFT', 'ASSIGNED', 'IN_PROGRESS']);
const DECIDABLE = new Set(['SUBMITTED', 'UNDER_REVIEW', 'HOLD']);
const CLASSES: SeverityKey[] = ['critical', 'major', 'minor'];

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let inspection: ApiInspection | null = null;
  try {
    inspection = await apiGet<ApiInspection>(`/inspections/${id}`);
  } catch {
    inspection = null;
  }
  if (!inspection) {
    return <div style={{ padding: '24px 32px' }}>Inspection not found, or you are not signed in.</div>;
  }
  const r = inspection.aqlResult;
  const fail = r?.systemRecommendation === 'FAIL';

  return (
    <div style={{ padding: '24px 32px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: ui.sub, fontSize: 13, marginBottom: 14 }}>
        <ClipboardList size={15} color={ui.sub} />
        <span>Inspections</span>
        <ChevronRight size={14} color={ui.faint} />
        <Mono style={{ color: ui.ink, fontWeight: 600 }}>{inspection.purchaseOrder?.poNumber ?? id.slice(0, 8)}</Mono>
        <ChevronRight size={14} color={ui.faint} />
        <span style={{ color: ui.ink, fontWeight: 550 }}>Review</span>
      </div>

      <PageHead
        title="Report review"
        sub={`${inspection.buyer?.name ?? '—'} · ${inspection.product?.styleNumber ?? '—'} · status ${inspection.status}`}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: 24, marginTop: 24, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {r ? (
            <>
              <div style={{ borderRadius: 12, padding: 20, background: fail ? severity.critical.bg : '#EAF6F0', border: `1px solid ${fail ? '#F1C9C5' : '#BEE3CD'}` }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: fail ? severity.critical.fg : '#1F6B43', textTransform: 'uppercase', letterSpacing: 0.6 }}>System recommendation</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: fail ? severity.critical.fg : '#1F6B43', marginTop: 2 }}>{r.systemRecommendation}</div>
                <div style={{ fontSize: 12.5, color: ui.sub, marginTop: 4 }}>
                  Sample n <Mono style={{ fontWeight: 600 }}>{inspection.computedSampling?.sampleSize ?? '—'}</Mono> · code {inspection.computedSampling?.sampleSizeCodeLetter ?? '—'} · lot <Mono>{inspection.lotSize ?? '—'}</Mono>
                </div>
              </div>
              <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1.1fr', padding: '8px 20px', fontSize: 11, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.4, background: ui.fill, borderBottom: `1px solid ${ui.line}` }}>
                  <span>Class</span><span style={{ textAlign: 'right' }}>Found</span><span style={{ textAlign: 'right' }}>Accept</span><span style={{ textAlign: 'right' }}>Reject</span><span style={{ textAlign: 'right' }}>Result</span>
                </div>
                {CLASSES.map((sev) => {
                  const c = r.perClass[sev];
                  const rej = c.outcome === 'FAIL';
                  return (
                    <div key={sev} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1.1fr', alignItems: 'center', padding: '14px 20px', borderBottom: `1px solid ${ui.lineSoft}` }}>
                      <SeverityTag sev={sev} />
                      <Mono style={{ textAlign: 'right', fontSize: 15, fontWeight: 700, color: rej ? severity.critical.fg : ui.ink }}>{c.found}</Mono>
                      <Mono style={{ textAlign: 'right', fontSize: 13, color: ui.sub }}>{c.ac}</Mono>
                      <Mono style={{ textAlign: 'right', fontSize: 13, color: ui.sub }}>{c.re}</Mono>
                      <span style={{ textAlign: 'right', justifySelf: 'end', fontSize: 11.5, fontWeight: 600, color: rej ? severity.critical.fg : '#1F8A4C' }}>{rej ? 'Reject' : 'Accept'}</span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: 22, color: ui.sub, fontSize: 13 }}>
              No AQL result yet — submit the inspection to compute the sampling evaluation.
            </div>
          )}
        </div>

        <div style={{ position: 'sticky', top: 0, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '18px 20px', borderBottom: `1px solid ${ui.line}`, fontSize: 14, fontWeight: 600 }}>QA decision</div>
          {SUBMITTABLE.has(inspection.status) && <SubmitForReview id={id} />}
          {DECIDABLE.has(inspection.status) && <DecisionForm id={id} />}
          {!SUBMITTABLE.has(inspection.status) && !DECIDABLE.has(inspection.status) && (
            <div style={{ padding: 20, fontSize: 13, color: ui.sub }}>
              Final decision: <strong>{r?.qaDecision ?? inspection.status}</strong>
              {r?.qaRemarks ? <div style={{ marginTop: 8, color: ui.ink }}>{r.qaRemarks}</div> : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Delete the old static review route**

```bash
git rm "apps/web/app/(console)/review/page.tsx"
```

- [ ] **Step 6: Type-check**

Run: `pnpm --filter @inspect/web type-check`
Expected: exit 0.

- [ ] **Step 7: Manual verification**

With both servers running and logged in as the dev owner:
- Create an inspection via the API helper, or reuse one from the smoke run. To get an id quickly: in the dev-owner shell, `POST /inspections` with the seeded PO + preset (or run `pnpm api smoke` and copy the printed `inspection=` id — but that inspection is already REPORT_ISSUED, so use a fresh DRAFT).
- Visit `http://localhost:3001/inspections/<id>/review`.
- Expected (DRAFT): "Submit for review" button → click → page shows the AQL evaluation table + the Pass/Fail/Hold panel.
- Pick a decision, type a note, Submit → status becomes APPROVED/REJECTED/HOLD and the panel shows the final verdict. Submitting with no note shows "A decision note is required".

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/api.ts "apps/web/app/(console)/inspections/actions.ts" "apps/web/app/(console)/inspections/[id]"
git rm --cached "apps/web/app/(console)/review/page.tsx" 2>/dev/null; true
git commit -m "feat(web): id-routed review with submit + QA decision (INS-027)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Create inspection screen (INS-026)

**Files:**
- Modify: `apps/web/app/(console)/inspections/new/page.tsx`
- Create: `apps/web/app/(console)/inspections/new/create-form.tsx`

**Interfaces:**
- Consumes: `apiGet`, `ApiPurchaseOrder`, `ApiLoopPreset`, `ApiUser` (lib/api.ts); `createInspection`, `previewAql` (Task 3 actions).
- Produces: the `/inspections/new` route.

- [ ] **Step 1: Create the client form**

Create `apps/web/app/(console)/inspections/new/create-form.tsx`:

```tsx
'use client';

import { useActionState, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { ui, mono } from '@/components/inspect/tokens';
import type { ApiPurchaseOrder, ApiLoopPreset, ApiUser, AqlPreview } from '@/lib/api';
import { createInspection, previewAql } from '../actions';

const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const lbl: CSSProperties = { fontSize: 12, fontWeight: 550, color: ui.ink };
const input: CSSProperties = { height: 40, padding: '0 12px', fontSize: 13.5, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 8, fontFamily: 'inherit', color: ui.ink, outline: 'none', boxSizing: 'border-box' };
const card: CSSProperties = { background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: 22 };

export function CreateInspectionForm({ pos, presets, inspectors }: { pos: ApiPurchaseOrder[]; presets: ApiLoopPreset[]; inspectors: ApiUser[] }) {
  const [state, action, pending] = useActionState(createInspection, {} as { error?: string });
  const [poId, setPoId] = useState(pos[0]?.id ?? '');
  const [lotSize, setLotSize] = useState(1000);
  const [preview, setPreview] = useState<AqlPreview>();
  const [previewError, setPreviewError] = useState<string>();
  const [crid] = useState(() => `web-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  const po = pos.find((p) => p.id === poId);

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const r = await previewAql({ lotSize });
      if (!live) return;
      setPreview(r.data);
      setPreviewError(r.error);
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [lotSize]);

  if (pos.length === 0) {
    return <div style={card}>No purchase orders yet. Create a buyer, supplier, product and PO first, then return here.</div>;
  }

  return (
    <form action={action} style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 24, alignItems: 'start' }}>
      <input type="hidden" name="poId" value={poId} />
      <input type="hidden" name="lotSize" value={lotSize} />
      <input type="hidden" name="clientRequestId" value={crid} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={card}>
          <div style={{ fontSize: 11, fontWeight: 600, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.5 }}>Purchase order</div>
          <div style={{ ...field, marginTop: 14 }}>
            <span style={lbl}>PO</span>
            <select value={poId} onChange={(e) => setPoId(e.target.value)} style={{ ...input, cursor: 'pointer' }}>
              {pos.map((p) => <option key={p.id} value={p.id}>{p.poNumber}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 18, marginTop: 14, fontSize: 13, color: ui.sub }}>
            <span>Buyer: <strong style={{ color: ui.ink }}>{po?.buyer?.name ?? '—'}</strong></span>
            <span>Supplier: <strong style={{ color: ui.ink }}>{po?.supplier?.name ?? '—'}</strong></span>
            <span>Product: <strong style={{ color: ui.ink }}>{po?.product?.styleNumber ?? '—'}</strong></span>
          </div>
        </div>

        <div style={card}>
          <div style={{ fontSize: 11, fontWeight: 600, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.5 }}>Procedure & lot</div>
          <div style={{ ...field, marginTop: 14 }}>
            <span style={lbl}>Loop preset</span>
            <select name="loopPresetId" defaultValue={presets[0]?.id ?? ''} style={{ ...input, cursor: 'pointer' }}>
              {presets.map((p) => <option key={p.id} value={p.id}>{p.name} (v{p.version})</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
            <div style={field}>
              <span style={lbl}>Lot size (pcs)</span>
              <input type="number" min={2} value={lotSize} onChange={(e) => setLotSize(Number(e.target.value))} style={{ ...input, ...mono }} />
            </div>
            <div style={field}>
              <span style={lbl}>Assigned inspector <span style={{ color: ui.faint, fontWeight: 400 }}>· optional</span></span>
              <select name="assignedInspectorId" defaultValue="" style={{ ...input, cursor: 'pointer' }}>
                <option value="">Unassigned (draft)</option>
                {inspectors.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
              </select>
            </div>
          </div>
        </div>

        {state?.error && <div style={{ color: '#B42318', fontSize: 13 }}>{state.error}</div>}
        <div>
          <button type="submit" disabled={pending} style={{ height: 40, padding: '0 16px', background: ui.accent, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: pending ? 'default' : 'pointer', opacity: pending ? 0.7 : 1 }}>
            {pending ? 'Creating…' : 'Create inspection'}
          </button>
        </div>
      </div>

      <div style={{ background: ui.ink, borderRadius: 12, padding: '18px 20px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Computed AQL plan</div>
        {previewError ? (
          <div style={{ color: '#F49A9A', fontSize: 12.5, marginTop: 12 }}>{previewError}</div>
        ) : preview ? (
          <>
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              {[['Code', preview.sampleSizeCodeLetter], ['Sample n', preview.sampleSize]].map(([k, v]) => (
                <div key={k} style={{ flex: 1, background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>{k}</div>
                  <div style={{ ...mono, fontSize: 20, fontWeight: 600, color: '#fff', marginTop: 3 }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14 }}>
              {(['critical', 'major', 'minor'] as const).map((sev) => {
                const c = preview.perClass[sev];
                return (
                  <div key={sev} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', padding: '8px 0', fontSize: 12.5, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <span style={{ textTransform: 'capitalize' }}>{sev}</span>
                    <span style={{ ...mono, width: 52, textAlign: 'right', color: 'rgba(255,255,255,0.7)' }}>{c.aql}</span>
                    <span style={{ ...mono, width: 44, textAlign: 'right', color: '#6FE39A' }}>{c.ac}</span>
                    <span style={{ ...mono, width: 44, textAlign: 'right', color: '#F49A9A' }}>{c.re}</span>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12.5, marginTop: 12 }}>Enter a lot size…</div>
        )}
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Rewrite the create page (server component)**

Replace `apps/web/app/(console)/inspections/new/page.tsx` with:

```tsx
import { ChevronRight, ClipboardList } from 'lucide-react';
import { apiGet, type ApiPurchaseOrder, type ApiLoopPreset, type ApiUser } from '@/lib/api';
import { PageHead } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';
import { CreateInspectionForm } from './create-form';

export default async function CreateInspectionPage() {
  const [pos, presets, users] = await Promise.all([
    apiGet<ApiPurchaseOrder[]>('/purchase-orders').catch(() => []),
    apiGet<ApiLoopPreset[]>('/loop-presets').catch(() => []),
    apiGet<ApiUser[]>('/users').catch(() => []),
  ]);
  const inspectors = users.filter((u) => u.role === 'INSPECTOR');

  return (
    <div style={{ padding: '24px 32px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: ui.sub, fontSize: 13, marginBottom: 14 }}>
        <ClipboardList size={15} color={ui.sub} />
        <span>Inspections</span>
        <ChevronRight size={14} color={ui.faint} />
        <span style={{ color: ui.ink, fontWeight: 550 }}>New inspection</span>
      </div>
      <PageHead title="Create inspection" sub="The AQL sampling plan is computed automatically from lot size." />
      <div style={{ marginTop: 24 }}>
        <CreateInspectionForm pos={pos} presets={presets} inspectors={inspectors} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter @inspect/web type-check`
Expected: exit 0.

- [ ] **Step 4: Manual verification**

Logged in as the dev owner at `http://localhost:3001/inspections/new`:
- Expected: the PO select shows `PO-DEV-…` with buyer/supplier/product filled in; the loop-preset select shows `Dev Loop (v1)`.
- Change the lot size → the right "Computed AQL plan" panel updates (e.g. 1000 → code **J**, n **80**, major 2.5 → Ac 5 / Re 6). Enter an in-band value; try a tiny value like 1 → shows the validation message.
- Click "Create inspection" → redirected to `/inspections/<id>/review` showing the new DRAFT inspection with a "Submit for review" button.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(console)/inspections/new"
git commit -m "feat(web): wire create-inspection screen with live AQL preview (INS-026)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Inspections list + nav repoint

**Files:**
- Create: `apps/web/app/(console)/inspections/page.tsx`
- Modify: `apps/web/components/inspect/shell.tsx` (nav href)

**Interfaces:**
- Consumes: `apiGet`, `ApiInspection` (lib/api.ts).
- Produces: the `/inspections` list route.

- [ ] **Step 1: Create the list page**

Create `apps/web/app/(console)/inspections/page.tsx`:

```tsx
import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { apiGet, type ApiInspection } from '@/lib/api';
import { Btn, Mono, PageHead } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';

export default async function InspectionsListPage() {
  const inspections = await apiGet<ApiInspection[]>('/inspections').catch(() => []);
  return (
    <div style={{ padding: '24px 32px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: ui.sub, fontSize: 13, marginBottom: 14 }}>
        <ClipboardList size={15} color={ui.sub} />
        <span style={{ color: ui.ink, fontWeight: 550 }}>Inspections</span>
      </div>
      <PageHead title="Inspections" sub={`${inspections.length} total`} actions={<Btn kind="primary" href="/inspections/new">New inspection</Btn>} />
      {inspections.length === 0 ? (
        <div style={{ marginTop: 24, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: 22, color: ui.sub, fontSize: 13 }}>
          No inspections yet — create one.
        </div>
      ) : (
        <div style={{ marginTop: 24, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 1fr 1fr 1fr', padding: '10px 20px', fontSize: 11, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.4, background: ui.fill, borderBottom: `1px solid ${ui.line}` }}>
            <span>PO</span><span>Buyer</span><span>Product</span><span>Status</span><span>System</span>
          </div>
          {inspections.map((i) => (
            <Link key={i.id} href={`/inspections/${i.id}/review`} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 1fr 1fr 1fr', alignItems: 'center', padding: '14px 20px', borderBottom: `1px solid ${ui.lineSoft}`, textDecoration: 'none', color: ui.ink }}>
              <Mono style={{ fontWeight: 600 }}>{i.purchaseOrder?.poNumber ?? i.id.slice(0, 8)}</Mono>
              <span>{i.buyer?.name ?? '—'}</span>
              <span>{i.product?.styleNumber ?? '—'}</span>
              <span style={{ fontSize: 12.5, color: ui.sub }}>{i.status}</span>
              <span style={{ fontSize: 12.5, color: ui.sub }}>{i.aqlResult?.systemRecommendation ?? '—'}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Repoint the sidebar nav**

In `apps/web/components/inspect/shell.tsx`, in the `NAV` array change the inspections entry href:

```tsx
  { key: 'inspections', label: 'Inspections', icon: ClipboardList, href: '/inspections' },
```

- [ ] **Step 3: Type-check + full API suite**

Run: `pnpm --filter @inspect/web type-check` → exit 0.
Run: `pnpm --filter @inspect/api test` → 100 passed.

- [ ] **Step 4: Manual verification**

Logged in as the dev owner:
- Click "Inspections" in the sidebar → `/inspections` lists the inspections (PO, buyer, product, status, system recommendation). Create one if empty.
- Click a row → opens its `/inspections/<id>/review` page.
- End-to-end: from the list → New inspection → create → submit → decide → the row's status reflects the decision on return.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(console)/inspections/page.tsx" apps/web/components/inspect/shell.tsx
git commit -m "feat(web): inspections list + nav repoint to the list (INS-026)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-review (completed during planning)

- **Spec coverage:** §1 session/shell → Task 2 (INS-028). §2 AQL preview endpoint → Task 1. §3 create → Task 4 (INS-026). §4 list → Task 5. §5 review/submit/decide → Task 3 (INS-027). Server-Actions module → Tasks 2 ((console)/actions.ts) + 3 (inspections/actions.ts). All in-scope items mapped.
- **Type consistency:** `ApiInspection`/`ApiAqlResult`/`ApiPurchaseOrder`/`AqlPreview` defined in Task 3 Step 1 and consumed unchanged in Tasks 3–5; `createInspection`/`previewAql`/`submitInspection`/`decideInspection` signatures match between `actions.ts` and the components that import them; `apiRoleToRoleKey`/`initialsFrom` defined in Task 2 and used by the layout/shell. `ApiLoopPreset`/`ApiUser` already exist in `lib/api.ts`.
- **No placeholders:** every code step contains complete code; modification steps quote the exact replacement lines.
- **Out-of-scope** items (populate/PDF/portal/onboarding/counts/email/shared-types) are intentionally excluded per the spec.

## Post-implementation (after all tasks pass)

- Run `pnpm type-check` (both apps) and `pnpm --filter @inspect/api test` once more — all green.
- Update [docs/STATUS.md](../../STATUS.md) (Web console pillar: create/decision/list/session now live) and flip [INS-028](../../future/BACKLOG.md) → done, [INS-026](../../future/BACKLOG.md)/[INS-027](../../future/BACKLOG.md) → done (or note residual: populate-driven submit migrates with INS-023).
- Use superpowers:finishing-a-development-branch to merge.
