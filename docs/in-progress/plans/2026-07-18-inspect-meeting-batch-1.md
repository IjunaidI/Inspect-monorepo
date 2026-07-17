# Meeting Batch 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close INS-056/057/058/059/061/062/064/065/066/067/069/070 — the submit-evidence gate, inspector RBAC + start/reset, user-management server guards + direct add, archive restore, an org Reports section, status emails, and the web halves (contract fix, role-aware nav, action menu, archive view, users screen scrub).

**Architecture:** All app-layer — zero Prisma migrations, zero new dependencies. API changes are per-handler `@Roles` relaxations + service guards + new transitions, each appending an AuditLog row via the existing `audit.append(input, tx)` inside the same `$transaction` (AuditModule/MailModule/PrismaModule are `@Global` — no module wiring). Web changes are Server Components + Server Actions in the existing `components/inspect` vocabulary.

**Tech Stack:** NestJS 11 + Prisma 6 (`apps/api`), Next.js 15 App Router + React 19 (`apps/web`), Jest unit (`src/**/*.spec.ts`, no DB) + Jest integration (`apps/api/test/integration`, live `DATABASE_URL`/`REDIS_URL` from the repo-root `.env`).

## Global Constraints

- Design decisions D1–D14 in [../specs/2026-07-18-inspect-meeting-batch-1-design.md](../specs/2026-07-18-inspect-meeting-batch-1-design.md) are binding.
- Run everything from the repo root: `pnpm api test`, `pnpm api test:integration`, `pnpm type-check`, `pnpm web build`. (If `pnpm` is not on PATH: `npx -y pnpm@9.12.0 <cmd>`.)
- The integration suite needs the migrated+seeded live DB (repo-root `.env`). Single-file run: `pnpm api test:integration -- meeting-batch1`.
- No Prisma schema changes. No new npm packages. No change to signed-snapshot shapes or the AQL engine.
- API stays the RBAC authority — web gating is presentation only.
- Every NEW mutation path appends exactly one AuditLog row inside its transaction (D7).
- Stay inside the `components/inspect` token vocabulary; new UI color literals go into `tokens.ts`.
- Commit after each task with the given message; end each commit message with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Do NOT push.
- All work happens on branch `feat/2026-07-18-meeting-batch-1` (created in Task 1).

---

### Task 1: INS-064 — web loop payload contract fix (wire names)

**Files:**
- Modify: `apps/web/lib/api.ts:369-377` (ApiInspectionLoop)
- Modify: `apps/web/app/(console)/inspections/[id]/populate/populate-workspace.tsx:67,77,251,261,292,294`
- Modify: `apps/web/app/(console)/inspections/[id]/report/page.tsx:50,58`

**Interfaces:**
- Consumes: `GET /inspections/:id` wire shape — loops carry Prisma-native `zoneName: string`, `position: number`, `requiredShotCount: number` (see `apps/api/prisma/schema.prisma:556-576`; the controller spreads raw Prisma).
- Produces: `ApiInspectionLoop { id, zoneName, position, requiredShotCount, photos?, defects?, measurements? }` — Tasks 4 and 13 rely on these names.

- [ ] **Step 1: Create the branch**

```bash
git checkout -b feat/2026-07-18-meeting-batch-1
```

- [ ] **Step 2: Change the type first (this is the failing "test" — the compiler finds every stale consumer)**

In `apps/web/lib/api.ts` replace the `ApiInspectionLoop` interface:

```ts
export interface ApiInspectionLoop {
  id: string;
  /** Wire names are the Prisma-native columns (INS-064) — do NOT re-alias. */
  zoneName: string;
  position: number;
  requiredShotCount: number;
  photos?: ApiPhoto[];
  defects?: ApiDefectInstance[];
  measurements?: ApiMeasurement[];
}
```

- [ ] **Step 3: Run type-check to enumerate the breakages**

Run: `pnpm web type-check`
Expected: FAIL with errors in `populate-workspace.tsx` (orderIndex, requiredPhotoCount, name) and `inspections/[id]/report/page.tsx` (l.name).

- [ ] **Step 4: Fix every consumer to the wire names**

`populate-workspace.tsx`:
- line 67: `? [...inspection.loops].sort((a, b) => a.position - b.position)`
- line 77: `const totalRequired = loops.reduce((s, l) => s + l.requiredShotCount, 0);`
- line 251: `const req = l.requiredShotCount;`
- line 261: `...textOverflow: 'ellipsis' }}>{l.zoneName}</div>`
- line 292: `...marginTop: 4 }}>{activeLoop.zoneName}</div>`
- line 294: `<Mono>{activeLoop.photos?.length ?? 0}</Mono> of <Mono>{activeLoop.requiredShotCount}</Mono> required shots uploaded`

`report/page.tsx`:
- line 50 (photos map): `loop: l.zoneName,`
- line 58 (measurements map): `loop: l.zoneName,`

- [ ] **Step 5: Verify green**

Run: `pnpm web type-check`
Expected: PASS (0 errors).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/api.ts "apps/web/app/(console)/inspections/[id]/populate/populate-workspace.tsx" "apps/web/app/(console)/inspections/[id]/report/page.tsx"
git commit -m "fix(web): INS-064 loop payload contract drift - adopt wire names (zoneName/position/requiredShotCount)"
```

---

### Task 2: INS-057 — inspector access + start/reset transitions (API)

**Files:**
- Modify: `apps/api/src/inspections/inspections.controller.ts`
- Modify: `apps/api/src/inspections/inspections.service.ts`
- Create: `apps/api/test/integration/meeting-batch1.e2e-spec.ts`

**Interfaces:**
- Consumes: `RolesGuard.getAllAndOverride` (handler @Roles overrides class — `apps/api/src/auth/roles.guard.ts:20`), `AuditService.append(input, tx)` (`@Global` AuditModule), `AuthUser { userId, orgId, role }`.
- Produces: service signatures the rest of the plan uses — `list(orgId, actor: AuthUser, status?, opts)`, `get(orgId, actor, id)`, `submit(orgId, actor, id, tamper)`, `start(orgId, actor, id)`, `reset(orgId, actor, id)`. Routes `POST /inspections/:id/start`, `POST /inspections/:id/reset` (Task 13 web actions call these). Only `InspectionsController` injects `InspectionsService` — verify with `grep -r "InspectionsService" apps/api/src --include=*.ts -l` before changing signatures.

- [ ] **Step 1: Write the failing integration tests**

Create `apps/api/test/integration/meeting-batch1.e2e-spec.ts`:

```ts
/**
 * Meeting-batch-1 (2026-07-18): INS-056/057/058/059/061/062/065/066 live coverage.
 * One shared fixture: org A (owner + inspector + workspace) and control org B.
 */
import { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  ApiClient,
  apiClient,
  bootApp,
  createOrgWithOwner,
  createWorkspace,
  expect2xx,
  inviteAndActivate,
  loginAdmin,
  OrgFixture,
  runTag,
  WorkspaceFixture,
} from './support';

jest.setTimeout(180_000);

describe('meeting batch 1 (product-feedback 2026-07-17)', () => {
  let app: INestApplication;
  let client: ApiClient;
  let adminToken: string;
  let orgA: OrgFixture;
  let orgB: OrgFixture;
  let ws: WorkspaceFixture;
  let inspectorToken: string;
  let inspectorId: string;
  const tag = runTag('mb1');

  beforeAll(async () => {
    app = await bootApp();
    client = apiClient(app);
    adminToken = await loginAdmin(client);
    orgA = await createOrgWithOwner(client, adminToken, `${tag}-a`);
    orgB = await createOrgWithOwner(client, adminToken, `${tag}-b`);
    ws = await createWorkspace(client, orgA.ownerToken, tag);
    ({ token: inspectorToken, userId: inspectorId } = await inviteAndActivate(client, orgA.ownerToken, {
      email: `mb1-inspector+${tag}@e2e.local`,
      role: 'INSPECTOR',
      password: `E2eInspector!${tag}`,
    }));
  });

  afterAll(async () => {
    await app.close();
  });

  /** Org-A inspection from the shared PO/preset; returns its id + first loop id. */
  async function createInspection(assign: boolean): Promise<{ id: string; loopId: string }> {
    const created = expect2xx(
      await client.post('/inspections', {
        token: orgA.ownerToken,
        body: {
          poId: ws.poId,
          loopPresetId: ws.presetId,
          lotSize: 500,
          ...(assign ? { assignedInspectorId: inspectorId } : {}),
        },
      }),
      'POST /inspections (fixture)',
    );
    return { id: created.id, loopId: created.loops[0].id };
  }

  /** Register a fabricated photo directly onto a loop (Platform-Admin populate route). */
  async function registerPhoto(inspectionId: string, loopId: string, seed: string): Promise<string> {
    const contentHash = createHash('sha256').update(seed).digest('hex');
    const photo = expect2xx(
      await client.post(`/inspections/${inspectionId}/populate/photos`, {
        token: adminToken,
        body: {
          storageKey: `e2e/${seed}.jpg`,
          contentHash,
          inspectionLoopId: loopId,
          clientRequestId: seed,
        },
      }),
      'populate register photo (mb1)',
    );
    return photo.id as string;
  }

  describe('INS-057 — inspector scope + start/reset', () => {
    it('INSPECTOR lists only own-assigned inspections; QA_MANAGER+ stays org-wide', async () => {
      const other = await createInspection(false);
      const mine = await createInspection(true);

      const res = await client.get('/inspections', { token: inspectorToken });
      expect(res.status).toBe(200);
      const ids = res.body.map((i: { id: string }) => i.id);
      expect(ids).toContain(mine.id);
      expect(ids).not.toContain(other.id);
      for (const row of res.body) expect(row.assignedInspectorId).toBe(inspectorId);

      const ownerList = expect2xx(
        await client.get('/inspections', { token: orgA.ownerToken }),
        'owner GET /inspections',
      );
      expect(ownerList.map((i: { id: string }) => i.id)).toContain(other.id);
    });

    it('INSPECTOR opens an assigned inspection; an unassigned one 404s; create stays 403', async () => {
      const other = await createInspection(false);
      const mine = await createInspection(true);

      const ok = await client.get(`/inspections/${mine.id}`, { token: inspectorToken });
      expect(ok.status).toBe(200);

      const foreign = await client.get(`/inspections/${other.id}`, { token: inspectorToken });
      expect(foreign.status).toBe(404);

      const create = await client.post('/inspections', {
        token: inspectorToken,
        body: { poId: ws.poId, loopPresetId: ws.presetId, lotSize: 500 },
      });
      expect(create.status).toBe(403);
    });

    it('start: ASSIGNED -> IN_PROGRESS; reset returns to ASSIGNED; start on SUBMITTED 400', async () => {
      const mine = await createInspection(true);

      const started = expect2xx(
        await client.post(`/inspections/${mine.id}/start`, { token: inspectorToken }),
        'inspector POST /:id/start',
      );
      expect(started.status).toBe('IN_PROGRESS');

      const again = await client.post(`/inspections/${mine.id}/start`, { token: inspectorToken });
      expect(again.status).toBe(400);

      const reset = expect2xx(
        await client.post(`/inspections/${mine.id}/reset`, { token: inspectorToken }),
        'inspector POST /:id/reset',
      );
      expect(reset.status).toBe('ASSIGNED');

      await registerPhoto(mine.id, mine.loopId, `start-${tag}`);
      expect2xx(
        await client.post(`/inspections/${mine.id}/submit`, { token: inspectorToken, body: {} }),
        'inspector submit own inspection',
      );
      const afterSubmit = await client.post(`/inspections/${mine.id}/start`, { token: inspectorToken });
      expect(afterSubmit.status).toBe(400);
    });
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `pnpm api test:integration -- meeting-batch1`
Expected: FAIL — inspector list/get return 403 (class QA floor), `POST /:id/start` 404s (route missing).

NOTE: the `registerPhoto`/submit assertions in the third test also exercise Task 3's gate; before Task 3 lands, submit succeeds with or without the photo — the test is written forward-compatible (it registers the photo first) so it passes both before and after Task 3.

- [ ] **Step 3: Rewrite the controller with per-handler floors + start/reset**

Replace `apps/api/src/inspections/inspections.controller.ts` in full:

```ts
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  CreateInspectionInput,
  InspectionsService,
  QaDecisionInput,
  TamperProofInput,
} from './inspections.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { requireOrgId } from '../common/tenant';
import { parseListQuery, RawListQuery } from '../common/list-query';
import { StorageService } from '../storage/storage.service';

interface PhotoLike {
  storageKey: string;
}

/**
 * Class floor: QA_MANAGER. Read + inspector-workflow routes relax to INSPECTOR
 * per-handler (RolesGuard resolves handler-over-class, INS-057); the service
 * then scopes INSPECTOR access to their own assigned inspections.
 */
@Controller('inspections')
@Roles('QA_MANAGER')
export class InspectionsController {
  constructor(
    private readonly inspections: InspectionsService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Decorate photos with short-lived presigned GET URLs (INS-049) so evidence
   * is viewable. Must never fail the read — a presign problem degrades to
   * viewUrl:null and the UI falls back to its placeholder tile.
   */
  private withViewUrl<T extends PhotoLike>(photo: T): T & { viewUrl: string | null } {
    try {
      return { ...photo, viewUrl: this.storage.presignDownload(photo.storageKey) };
    } catch {
      return { ...photo, viewUrl: null };
    }
  }

  @Get()
  @Roles('INSPECTOR')
  list(@CurrentUser() user: AuthUser, @Query() query: RawListQuery & { status?: string }) {
    return this.inspections.list(requireOrgId(user), user, query.status, parseListQuery(query));
  }

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

  @Get(':id')
  @Roles('INSPECTOR')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const inspection = await this.inspections.get(requireOrgId(user), user, id);
    return {
      ...inspection,
      photos: inspection.photos?.map((p) => this.withViewUrl(p)),
      loops: inspection.loops?.map((loop) => ({
        ...loop,
        photos: loop.photos?.map((p) => this.withViewUrl(p)),
      })),
    };
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateInspectionInput) {
    return this.inspections.create(requireOrgId(user), user.userId, body);
  }

  @Post(':id/start')
  @Roles('INSPECTOR')
  start(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.inspections.start(requireOrgId(user), user, id);
  }

  @Post(':id/reset')
  @Roles('INSPECTOR')
  reset(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.inspections.reset(requireOrgId(user), user, id);
  }

  @Post(':id/submit')
  @Roles('INSPECTOR')
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: TamperProofInput,
  ) {
    return this.inspections.submit(requireOrgId(user), user, id, body ?? {});
  }

  @Post(':id/decision')
  decide(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: QaDecisionInput,
  ) {
    return this.inspections.decide(requireOrgId(user), user.userId, id, body);
  }
}
```

- [ ] **Step 4: Add scoping + transitions to the service**

In `apps/api/src/inspections/inspections.service.ts`:

(a) Extend the imports:

```ts
import { AuthUser } from '../auth/auth-user';
import { AuditService } from '../audit/audit.service';
```

(b) Extend the constructor:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}
```

(c) Add the scope helper right below the constructor:

```ts
  /**
   * INSPECTOR sees/acts only on inspections assigned to them (INS-057);
   * QA_MANAGER+ keeps org-wide access. Applied inside the org-scoped where, so
   * a foreign id resolves to 404 — no existence oracle.
   */
  private inspectorScope(actor: AuthUser): { assignedInspectorId?: string } {
    return actor.role === 'INSPECTOR' ? { assignedInspectorId: actor.userId } : {};
  }
```

(d) Change `list` to take the actor and apply the scope (the `where` gains one spread):

```ts
  list(
    orgId: string,
    actor: AuthUser,
    status?: string,
    opts: { q?: string; take?: number; skip?: number } = {},
  ) {
    return this.prisma.inspection.findMany({
      where: {
        orgId,
        ...this.inspectorScope(actor),
        ...(status ? { status: status as never } : {}),
        ...(opts.q
          ? {
              OR: [
                { purchaseOrder: { poNumber: { contains: opts.q, mode: 'insensitive' as const } } },
                { buyer: { name: { contains: opts.q, mode: 'insensitive' as const } } },
                { product: { styleNumber: { contains: opts.q, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: opts.take,
      skip: opts.skip,
      include: { buyer: true, supplier: true, product: true, purchaseOrder: true, aqlResult: true },
    });
  }
```

(e) Change `get`'s signature to `async get(orgId: string, actor: AuthUser, id: string)` and its `where` to `{ id, orgId, ...this.inspectorScope(actor) }`. Everything else in `get` stays byte-identical.

(f) Change `submit`'s signature to `async submit(orgId: string, actor: AuthUser, id: string, tamper: TamperProofInput)`; its opening lookup becomes:

```ts
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, orgId, ...this.inspectorScope(actor) },
    });
```

and the tamper block uses the actor:

```ts
    const tamperProof = {
      inspectorId: actor.userId,
      deviceId: tamper?.deviceId,
      submittedAt: submittedAt.toISOString(),
      gps: tamper?.gps,
    };
```

(g) Add the two transitions after `submit` (before `decide`):

```ts
  /** ASSIGNED -> IN_PROGRESS (INS-057). Allowed for the assigned inspector or QA_MANAGER+. */
  async start(orgId: string, actor: AuthUser, id: string) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, orgId, ...this.inspectorScope(actor) },
    });
    if (!inspection) throw new NotFoundException('Inspection not found');
    if (inspection.status !== 'ASSIGNED') {
      throw new BadRequestException(`Cannot start an inspection in status ${inspection.status} (only ASSIGNED)`);
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.inspection.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
      await this.audit.append(
        { orgId, actorType: 'USER', actorUserId: actor.userId, action: 'inspection.started', entityType: 'Inspection', entityId: id },
        tx,
      );
      return updated;
    });
  }

  /** IN_PROGRESS -> ASSIGNED (the "reset and restart" model — nothing submitted is touched). */
  async reset(orgId: string, actor: AuthUser, id: string) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, orgId, ...this.inspectorScope(actor) },
    });
    if (!inspection) throw new NotFoundException('Inspection not found');
    if (inspection.status !== 'IN_PROGRESS') {
      throw new BadRequestException(`Cannot reset an inspection in status ${inspection.status} (only IN_PROGRESS)`);
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.inspection.update({ where: { id }, data: { status: 'ASSIGNED' } });
      await this.audit.append(
        { orgId, actorType: 'USER', actorUserId: actor.userId, action: 'inspection.reset', entityType: 'Inspection', entityId: id },
        tx,
      );
      return updated;
    });
  }
```

- [ ] **Step 5: Verify**

Run: `pnpm api test` — Expected: PASS (existing 162; nothing constructs InspectionsService in unit tests yet).
Run: `pnpm api test:integration -- meeting-batch1` — Expected: PASS (3 tests).
Run: `pnpm api test:integration` — Expected: PASS (all suites — auth-rbac/core-loop unaffected: QA+ callers hit the same paths).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/inspections apps/api/test/integration/meeting-batch1.e2e-spec.ts
git commit -m "feat(api): INS-057 inspector assigned-scope on inspections + start/reset transitions with audit"
```

---

### Task 3: INS-056 — submit completeness gate (API)

**Files:**
- Modify: `apps/api/src/inspections/inspections.service.ts` (inside `submit`)
- Create: `apps/api/src/inspections/inspections.service.spec.ts`
- Modify: `apps/api/test/integration/meeting-batch1.e2e-spec.ts` (new describe)

**Interfaces:**
- Consumes: Task 2's `submit(orgId, actor, id, tamper)`; `InspectionLoop.requiredShotCount` + `photos` relation (photos attach via `inspectionLoopId`).
- Produces: submit throws `BadRequestException` whose message starts `Cannot submit: photo evidence incomplete —` listing each short loop as `zoneName (have/need)`. The spec file's `makeService()` helper (Task 10 extends it with a mail mock).

- [ ] **Step 1: Write the failing unit spec**

Create `apps/api/src/inspections/inspections.service.spec.ts`:

```ts
import { InspectionsService } from './inspections.service';
import { AuthUser } from '../auth/auth-user';

const QA: AuthUser = { userId: 'u-qa', orgId: 'org1', role: 'QA_MANAGER' };

interface MakeOpts {
  inspection?: Record<string, unknown>;
  loops?: Array<{ zoneName: string; requiredShotCount: number; _count: { photos: number } }>;
}

function makeService(opts: MakeOpts = {}) {
  const inspection = opts.inspection ?? {
    id: 'insp1',
    orgId: 'org1',
    status: 'ASSIGNED',
    lotSize: 500,
    aqlPlan: {},
    poId: 'po1',
    supersedesInspectionId: null,
    assignedInspectorId: null,
  };
  const tx = {
    inspection: {
      update: jest.fn(async () => ({})),
      findUnique: jest.fn(async () => ({ id: 'insp1', status: 'SUBMITTED', aqlResult: { systemRecommendation: 'PASS' } })),
    },
    aqlResult: { upsert: jest.fn(async () => ({})), update: jest.fn(async () => ({})) },
    billableEvent: { findUnique: jest.fn(async () => null), create: jest.fn(async () => ({})) },
  };
  const prisma = {
    inspection: { findFirst: jest.fn(async () => inspection) },
    inspectionLoop: { findMany: jest.fn(async () => opts.loops ?? []) },
    defectInstance: { groupBy: jest.fn(async () => []) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const audit = { append: jest.fn(async () => ({})) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new InspectionsService(prisma as any, audit as any);
  return { service, prisma, tx, audit };
}

describe('InspectionsService.submit — completeness gate (INS-056)', () => {
  it('rejects submit while a loop lacks its required photos, naming the short loops', async () => {
    const { service, prisma } = makeService({
      loops: [
        { zoneName: 'Front', requiredShotCount: 2, _count: { photos: 1 } },
        { zoneName: 'Collar', requiredShotCount: 1, _count: { photos: 1 } },
      ],
    });
    await expect(service.submit('org1', QA, 'insp1', {})).rejects.toThrow(
      /photo evidence incomplete.*Front \(1\/2\)/,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('submits when every loop meets its required shot count', async () => {
    const { service, prisma } = makeService({
      loops: [{ zoneName: 'Front', requiredShotCount: 1, _count: { photos: 1 } }],
    });
    await service.submit('org1', QA, 'insp1', {});
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('an inspection with no loops still submits (nothing to be short of)', async () => {
    const { service, prisma } = makeService({ loops: [] });
    await service.submit('org1', QA, 'insp1', {});
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm api test -- inspections.service.spec`
Expected: FAIL — first test: submit resolves instead of rejecting (no gate yet).

- [ ] **Step 3: Implement the gate**

In `inspections.service.ts` `submit()`, directly after the `lotSize == null` check and before `computeSampling`:

```ts
    // INS-056: a verdict must never be computed from missing evidence. The AQL
    // engine folds absent counts to zero, so an empty inspection would otherwise
    // mint a PASS — refuse to submit while any loop lacks its required photos.
    const loops = await this.prisma.inspectionLoop.findMany({
      where: { inspectionId: id },
      select: { zoneName: true, requiredShotCount: true, _count: { select: { photos: true } } },
      orderBy: { position: 'asc' },
    });
    const short = loops.filter((l) => l._count.photos < l.requiredShotCount);
    if (short.length > 0) {
      const detail = short.map((l) => `${l.zoneName} (${l._count.photos}/${l.requiredShotCount})`).join(', ');
      throw new BadRequestException(
        `Cannot submit: photo evidence incomplete — ${detail}. Upload the required shots first.`,
      );
    }
```

- [ ] **Step 4: Run unit green**

Run: `pnpm api test -- inspections.service.spec`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the integration describe**

Append inside the top-level describe of `meeting-batch1.e2e-spec.ts`:

```ts
  describe('INS-056 — submit completeness gate', () => {
    it('refuses submit while a loop lacks photos, then accepts once uploaded', async () => {
      const insp = await createInspection(false);

      const refused = await client.post(`/inspections/${insp.id}/submit`, {
        token: orgA.ownerToken,
        body: {},
      });
      expect(refused.status).toBe(400);
      expect(String(refused.body.message)).toContain('photo evidence incomplete');

      await registerPhoto(insp.id, insp.loopId, `gate-${tag}`);
      const ok = expect2xx(
        await client.post(`/inspections/${insp.id}/submit`, { token: orgA.ownerToken, body: {} }),
        'submit after required photo',
      );
      expect(ok.aqlResult.systemRecommendation).toBe('PASS');
    });
  });
```

- [ ] **Step 6: Verify integration — including that the EXISTING suites survive the gate**

Run: `pnpm api test:integration`
Expected: PASS everywhere. (`core-loop.e2e-spec.ts` registers + loop-assigns one photo against its 1-shot preset before submitting — verified compatible. If any other spec submits without photos, register one via the pattern above rather than weakening the gate.)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/inspections apps/api/test/integration/meeting-batch1.e2e-spec.ts
git commit -m "feat(api): INS-056 submit refuses incomplete photo evidence (per-loop requiredShotCount gate)"
```

---

### Task 4: INS-056 — report preview shows `pending`, never a fabricated REJECTED (web)

**Files:**
- Modify: `apps/web/components/inspect/branded-report.tsx:38,91-117`
- Modify: `apps/web/app/(console)/inspections/[id]/report/page.tsx:12-16`

**Interfaces:**
- Consumes: `BrandedReportData` (union at `branded-report.tsx:38`), conclusion banner block (`:91-117`).
- Produces: `BrandedReportData['conclusion']` = `'pass' | 'fail' | 'hold' | 'pending'`. Widening the union is backward-compatible for every other producer (portal, static stubs).

- [ ] **Step 1: Widen the type + rendering**

In `branded-report.tsx` line 38:

```ts
  conclusion: 'pass' | 'fail' | 'hold' | 'pending';
```

Add `Minus` to the existing lucide import, then replace lines 91-92 and the conclusion-constants block (112-117):

```ts
  const fail = data.conclusion === 'fail';
  const hold = data.conclusion === 'hold';
  const pending = data.conclusion === 'pending';
```

```ts
  const conclusionColor = pending ? ui.sub : fail ? severity.critical.fg : hold ? '#B5791A' : '#1F6B43';
  const conclusionBg = pending ? ui.fill : fail ? severity.critical.bg : hold ? '#FAF1E2' : '#EAF6F0';
  const conclusionBorder = pending ? ui.line : fail ? '#F1C9C5' : hold ? '#EBD9B4' : '#BEE3CD';
  const conclusionLabel = pending ? 'PENDING QA DECISION' : fail ? 'REJECTED' : hold ? 'HOLD' : 'ACCEPTED';
  const conclusionIcon = pending ? <Minus size={17} color="#fff" /> : fail || hold ? <X size={17} color="#fff" /> : <Check size={17} color="#fff" />;
  const conclusionDot = pending ? ui.faint : fail ? severity.critical.dot : hold ? '#B5791A' : '#1F8A4C';
```

- [ ] **Step 2: Stop defaulting to 'fail'**

In `report/page.tsx` replace `mapConclusion`:

```ts
function mapConclusion(decision?: string | null): 'pass' | 'fail' | 'hold' | 'pending' {
  if (decision === 'PASS') return 'pass';
  if (decision === 'FAIL') return 'fail';
  if (decision === 'HOLD') return 'hold';
  // No decision recorded yet — never fabricate a verdict (INS-056).
  return 'pending';
}
```

- [ ] **Step 3: Verify + commit**

Run: `pnpm web type-check` — Expected: PASS.

```bash
git add apps/web/components/inspect/branded-report.tsx "apps/web/app/(console)/inspections/[id]/report/page.tsx"
git commit -m "fix(web): INS-056 undecided inspections preview as PENDING, not REJECTED"
```

---

### Task 5: INS-061 — restore/unarchive for buyers, suppliers, products (API)

**Files:**
- Modify: `apps/api/src/buyers/buyers.service.ts`, `apps/api/src/buyers/buyers.controller.ts`
- Modify: `apps/api/src/suppliers/suppliers.service.ts`, `apps/api/src/suppliers/suppliers.controller.ts`
- Modify: `apps/api/src/products/products.service.ts`, `apps/api/src/products/products.controller.ts`
- Modify: `apps/api/src/buyers/buyers.service.spec.ts` (helper + 2 tests)
- Modify: `apps/api/test/integration/meeting-batch1.e2e-spec.ts` (new describe)

**Interfaces:**
- Consumes: each service's `get(orgId, id)` org guard; `AuditService.append(input, tx)`; controllers pass `@CurrentUser()` for the audit actor.
- Produces: `POST /buyers/:id/restore`, `POST /suppliers/:id/restore`, `POST /products/:id/restore` (Task 12's web actions call the first two); `archive(orgId, actor, id)` / `restore(orgId, actor, id)` signatures on all three services; archive is an idempotent no-op on an already-archived row.

- [ ] **Step 1: Write the failing tests**

(a) Unit — in `buyers.service.spec.ts`, update BOTH constructions (`buyers.service.spec.ts:22` and `:30`) to pass an audit mock — `new BuyersService(prisma as any, audit as any)` where `const audit = { append: jest.fn(async () => ({})) };` — then append:

```ts
describe('BuyersService archive/restore (INS-061)', () => {
  const ACTOR = { userId: 'u1', orgId: 'org1', role: 'ORG_OWNER' as const };

  function makeArchiveService(row: { id: string; orgId: string; archivedAt: Date | null }) {
    const update = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...row, ...data }));
    const tx = { buyer: { update } };
    const prisma = {
      buyer: { findFirst: jest.fn(async () => row), update },
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const audit = { append: jest.fn(async () => ({})) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new BuyersService(prisma as any, audit as any);
    return { service, prisma, audit, update };
  }

  it('restore clears archivedAt and appends an audit row', async () => {
    const { service, audit, update } = makeArchiveService({ id: 'b1', orgId: 'org1', archivedAt: new Date() });
    const out = await service.restore('org1', ACTOR, 'b1');
    expect(out.archivedAt).toBeNull();
    expect(update).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { archivedAt: null } });
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'buyer.restored', entityId: 'b1' }),
      expect.anything(),
    );
  });

  it('re-archiving an archived buyer is a no-op that preserves the original timestamp', async () => {
    const when = new Date('2026-07-01T00:00:00Z');
    const { service, update } = makeArchiveService({ id: 'b1', orgId: 'org1', archivedAt: when });
    const out = await service.archive('org1', ACTOR, 'b1');
    expect(out.archivedAt).toEqual(when);
    expect(update).not.toHaveBeenCalled();
  });
});
```

(b) Integration — append to `meeting-batch1.e2e-spec.ts`:

```ts
  describe('INS-061 — archive -> restore round-trip', () => {
    it('restores an archived buyer; cross-org restore 404s', async () => {
      const buyer = expect2xx(
        await client.post('/buyers', { token: orgA.ownerToken, body: { name: `Restore Buyer ${tag}` } }),
        'POST /buyers (restore fixture)',
      );
      expect2xx(await client.delete(`/buyers/${buyer.id}`, { token: orgA.ownerToken }), 'archive buyer');

      const active = expect2xx(await client.get('/buyers', { token: orgA.ownerToken }), 'GET /buyers');
      expect(active.some((b: { id: string }) => b.id === buyer.id)).toBe(false);
      const all = expect2xx(
        await client.get('/buyers?includeArchived=1', { token: orgA.ownerToken }),
        'GET /buyers?includeArchived=1',
      );
      expect(all.some((b: { id: string }) => b.id === buyer.id)).toBe(true);

      const foreign = await client.post(`/buyers/${buyer.id}/restore`, { token: orgB.ownerToken });
      expect(foreign.status).toBe(404);

      const restored = expect2xx(
        await client.post(`/buyers/${buyer.id}/restore`, { token: orgA.ownerToken }),
        'restore buyer',
      );
      expect(restored.archivedAt).toBeNull();
      const back = expect2xx(await client.get('/buyers', { token: orgA.ownerToken }), 'GET /buyers after restore');
      expect(back.some((b: { id: string }) => b.id === buyer.id)).toBe(true);
    });
  });
```

Run: `pnpm api test -- buyers.service.spec` → FAIL (`restore` not a function). `pnpm api test:integration -- meeting-batch1` → FAIL (restore 404).

- [ ] **Step 2: Implement on BuyersService**

In `buyers.service.ts` add imports + constructor dep:

```ts
import { AuthUser } from '../auth/auth-user';
import { AuditService } from '../audit/audit.service';
```

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}
```

Replace `archive` and add `restore`:

```ts
  async archive(orgId: string, actor: AuthUser, id: string) {
    const buyer = await this.get(orgId, id);
    // Idempotent: re-archiving must not overwrite the original timestamp (INS-061).
    if (buyer.archivedAt) return buyer;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.buyer.update({ where: { id }, data: { archivedAt: new Date() } });
      await this.audit.append(
        { orgId, actorType: 'USER', actorUserId: actor.userId, action: 'buyer.archived', entityType: 'Buyer', entityId: id },
        tx,
      );
      return updated;
    });
  }

  /** Archive is a reversible state, not a delete — restore clears it (INS-061). */
  async restore(orgId: string, actor: AuthUser, id: string) {
    const buyer = await this.get(orgId, id);
    if (!buyer.archivedAt) return buyer;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.buyer.update({ where: { id }, data: { archivedAt: null } });
      await this.audit.append(
        { orgId, actorType: 'USER', actorUserId: actor.userId, action: 'buyer.restored', entityType: 'Buyer', entityId: id },
        tx,
      );
      return updated;
    });
  }
```

In `buyers.controller.ts` change archive to pass the user and add restore:

```ts
  @Delete(':id')
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.buyers.archive(requireOrgId(user), user, id);
  }

  @Post(':id/restore')
  restore(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.buyers.restore(requireOrgId(user), user, id);
  }
```

- [ ] **Step 3: Mirror on SuppliersService and ProductsService**

Apply the identical pattern to `suppliers.service.ts`/`suppliers.controller.ts` (model `supplier`, actions `supplier.archived`/`supplier.restored`, entityType `Supplier`) and `products.service.ts`/`products.controller.ts` (model `product`, actions `product.archived`/`product.restored`, entityType `Product`). Same imports, same constructor extension, same `@Post(':id/restore')` route. Note suppliers/products `archive` currently has no actor param — both controllers' `@Delete(':id')` handlers gain `@CurrentUser() user: AuthUser` and pass `(requireOrgId(user), user, id)` exactly as buyers above.

- [ ] **Step 4: Verify + commit**

Run: `pnpm api test` → PASS (incl. the 2 new buyers tests). `pnpm api test:integration -- meeting-batch1` → PASS. `pnpm api test:integration` → PASS (full).

```bash
git add apps/api/src/buyers apps/api/src/suppliers apps/api/src/products apps/api/test/integration/meeting-batch1.e2e-spec.ts
git commit -m "feat(api): INS-061 restore endpoints for buyers/suppliers/products, idempotent archive, audit rows"
```

---

### Task 6: INS-066 — PATCH /inspections/:id (reassign + lotSize) (API)

**Files:**
- Modify: `apps/api/src/inspections/inspections.controller.ts` (add `Patch` import + handler)
- Modify: `apps/api/src/inspections/inspections.service.ts` (add `UpdateInspectionInput` + `update`)
- Modify: `apps/api/test/integration/meeting-batch1.e2e-spec.ts` (new describe)

**Interfaces:**
- Consumes: `SUBMITTABLE` set (frozen-after-submit invariant), `computeSampling` (recompute on lotSize change), the inspector-in-org guard pattern from `create()`.
- Produces: `PATCH /inspections/:id` body `{ assignedInspectorId?: string | null; lotSize?: number }`, QA_MANAGER floor (class default — no handler decorator). Task 13's `reassignInspection` action calls it.

- [ ] **Step 1: Write the failing integration test**

Append to `meeting-batch1.e2e-spec.ts`:

```ts
  describe('INS-066 — PATCH /inspections/:id', () => {
    it('reassigns pre-submission; SUBMITTED is frozen; foreign inspector 400', async () => {
      const insp = await createInspection(false);

      const bogus = await client.patch(`/inspections/${insp.id}`, {
        token: orgA.ownerToken,
        body: { assignedInspectorId: 'not-a-real-user' },
      });
      expect(bogus.status).toBe(400);

      const updated = expect2xx(
        await client.patch(`/inspections/${insp.id}`, {
          token: orgA.ownerToken,
          body: { assignedInspectorId: inspectorId },
        }),
        'PATCH reassign',
      );
      expect(updated.assignedInspectorId).toBe(inspectorId);
      expect(updated.status).toBe('ASSIGNED');

      const resized = expect2xx(
        await client.patch(`/inspections/${insp.id}`, { token: orgA.ownerToken, body: { lotSize: 1200 } }),
        'PATCH lotSize',
      );
      expect(resized.lotSize).toBe(1200);
      expect(resized.computedSampling.sampleSizeCodeLetter).toBe('K');

      await registerPhoto(insp.id, insp.loopId, `patch-${tag}`);
      expect2xx(await client.post(`/inspections/${insp.id}/submit`, { token: orgA.ownerToken, body: {} }), 'submit');
      const frozen = await client.patch(`/inspections/${insp.id}`, { token: orgA.ownerToken, body: { lotSize: 800 } });
      expect(frozen.status).toBe(400);
    });
  });
```

Run: `pnpm api test:integration -- meeting-batch1` → FAIL (PATCH 404).

- [ ] **Step 2: Implement**

Service — add the input type next to the others and the method after `create`:

```ts
export interface UpdateInspectionInput {
  assignedInspectorId?: string | null;
  lotSize?: number;
}
```

```ts
  /**
   * Pre-submission edits only (INS-066): reassign the inspector and/or adjust
   * lot size. SUBMITTED+ inspections are frozen by the immutability invariant.
   * aqlPlan editing is deliberately excluded (INS-063).
   */
  async update(orgId: string, actor: AuthUser, id: string, input: UpdateInspectionInput) {
    const inspection = await this.prisma.inspection.findFirst({ where: { id, orgId } });
    if (!inspection) throw new NotFoundException('Inspection not found');
    if (!SUBMITTABLE.has(inspection.status)) {
      throw new BadRequestException(
        `Cannot modify an inspection in status ${inspection.status} — submitted inspections are frozen`,
      );
    }

    const changes: Record<string, unknown> = {};
    if (input.assignedInspectorId !== undefined) {
      if (input.assignedInspectorId) {
        const inspector = await this.prisma.user.findFirst({
          where: { id: input.assignedInspectorId, orgId },
        });
        if (!inspector) throw new BadRequestException('assigned inspector not found in organization');
      }
      changes.assignedInspectorId = input.assignedInspectorId;
      if (inspection.status === 'DRAFT' && input.assignedInspectorId) changes.status = 'ASSIGNED';
      if (inspection.status === 'ASSIGNED' && input.assignedInspectorId === null) changes.status = 'DRAFT';
    }
    if (input.lotSize !== undefined) {
      if (!Number.isInteger(input.lotSize) || input.lotSize < 2) {
        throw new BadRequestException('lotSize must be an integer >= 2');
      }
      try {
        changes.computedSampling = computeSampling(
          input.lotSize,
          (inspection.aqlPlan ?? {}) as unknown as AqlPlanInput,
        ) as unknown as Prisma.InputJsonValue;
      } catch (e) {
        throw new BadRequestException(e instanceof Error ? e.message : 'AQL plan not available for this lot size');
      }
      changes.lotSize = input.lotSize;
    }
    if (Object.keys(changes).length === 0) return inspection;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.inspection.update({
        where: { id },
        data: changes as Prisma.InspectionUncheckedUpdateInput,
      });
      await this.audit.append(
        {
          orgId,
          actorType: 'USER',
          actorUserId: actor.userId,
          action: 'inspection.updated',
          entityType: 'Inspection',
          entityId: id,
          metadata: { fields: Object.keys(changes) },
        },
        tx,
      );
      return updated;
    });
  }
```

Controller — add `Patch` to the `@nestjs/common` import, `UpdateInspectionInput` to the service import, and the handler between `create` and `start` (class QA floor applies — no `@Roles`):

```ts
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateInspectionInput,
  ) {
    return this.inspections.update(requireOrgId(user), user, id, body ?? {});
  }
```

- [ ] **Step 3: Verify + commit**

Run: `pnpm api test:integration -- meeting-batch1` → PASS. `pnpm api test` → PASS.

```bash
git add apps/api/src/inspections apps/api/test/integration/meeting-batch1.e2e-spec.ts
git commit -m "feat(api): INS-066 PATCH /inspections/:id - pre-submission reassign + lotSize with sampling recompute"
```

---

### Task 7: INS-062 — org-scoped GET /reports list (API)

**Files:**
- Modify: `apps/api/src/reports/reports.controller.ts`
- Modify: `apps/api/src/reports/reports.service.ts` (add `list`)
- Modify: `apps/api/test/integration/meeting-batch1.e2e-spec.ts` (new describe)

**Interfaces:**
- Consumes: `parseListQuery`/`RawListQuery` (INS-050 conventions); `Report` relations `buyer`, `inspection` (`schema.prisma`).
- Produces: `GET /reports?q&take&skip` (QA floor) → newest-first rows `{ id, inspectionId, status, generatedAt, contentHash, pdfStorageKey, verificationToken, buyer: {id,name}, inspection: { status, purchaseOrder: {poNumber}, product: {styleNumber} } }` — NEVER `canonicalSnapshot`. Task 14's web page consumes this shape as `ApiReportListItem`.

- [ ] **Step 1: Write the failing integration test**

Append to `meeting-batch1.e2e-spec.ts`:

```ts
  describe('INS-062 — org-scoped reports list', () => {
    it('lists org A reports (no snapshot); org B sees none; INSPECTOR 403', async () => {
      const insp = await createInspection(false);
      await registerPhoto(insp.id, insp.loopId, `report-${tag}`);
      expect2xx(await client.post(`/inspections/${insp.id}/submit`, { token: orgA.ownerToken, body: {} }), 'submit');
      expect2xx(
        await client.post(`/inspections/${insp.id}/decision`, {
          token: orgA.ownerToken,
          body: { decision: 'PASS', remarks: 'mb1 report fixture' },
        }),
        'decision',
      );
      const report = expect2xx(
        await client.post(`/inspections/${insp.id}/report`, { token: orgA.ownerToken }),
        'generate report',
      );

      const listA = expect2xx(await client.get('/reports', { token: orgA.ownerToken }), 'GET /reports (A)');
      const row = listA.find((r: { id: string }) => r.id === report.id);
      expect(row).toBeTruthy();
      expect(row.canonicalSnapshot).toBeUndefined();
      expect(row.inspection.purchaseOrder.poNumber).toBe(`PO-${tag}`);
      expect(row.buyer.name).toBe(`E2E Buyer ${tag}`);

      const listB = expect2xx(await client.get('/reports', { token: orgB.ownerToken }), 'GET /reports (B)');
      expect(listB.some((r: { id: string }) => r.id === report.id)).toBe(false);

      const inspRes = await client.get('/reports', { token: inspectorToken });
      expect(inspRes.status).toBe(403);
    });
  });
```

Run: `pnpm api test:integration -- meeting-batch1` → FAIL (`GET /reports` 404).

- [ ] **Step 2: Implement**

`reports.service.ts` — add after `generate`:

```ts
  /**
   * Org-scoped report list (INS-062). Metadata + joins only — canonicalSnapshot
   * is large and stays out of list payloads by design.
   */
  list(orgId: string, opts: { q?: string; take?: number; skip?: number } = {}) {
    return this.prisma.report.findMany({
      where: {
        orgId,
        ...(opts.q
          ? {
              OR: [
                { buyer: { name: { contains: opts.q, mode: 'insensitive' as const } } },
                { inspection: { purchaseOrder: { poNumber: { contains: opts.q, mode: 'insensitive' as const } } } },
              ],
            }
          : {}),
      },
      orderBy: { generatedAt: 'desc' },
      take: opts.take,
      skip: opts.skip,
      select: {
        id: true,
        inspectionId: true,
        status: true,
        generatedAt: true,
        contentHash: true,
        pdfStorageKey: true,
        verificationToken: true,
        buyer: { select: { id: true, name: true } },
        inspection: {
          select: {
            status: true,
            purchaseOrder: { select: { poNumber: true } },
            product: { select: { styleNumber: true } },
          },
        },
      },
    });
  }
```

`reports.controller.ts` — add imports `Query` (from `@nestjs/common`) and `parseListQuery, RawListQuery` (from `../common/list-query`), then add ABOVE the `reports/:id` route:

```ts
  @Get('reports')
  @Roles('QA_MANAGER')
  list(@CurrentUser() user: AuthUser, @Query() query: RawListQuery) {
    return this.reports.list(requireOrgId(user), parseListQuery(query));
  }
```

- [ ] **Step 3: Verify + commit**

Run: `pnpm api test:integration -- meeting-batch1` → PASS. `pnpm api test` → PASS.

```bash
git add apps/api/src/reports apps/api/test/integration/meeting-batch1.e2e-spec.ts
git commit -m "feat(api): INS-062 org-scoped GET /reports list (q/take/skip, joins, no canonicalSnapshot)"
```

---

### Task 8: INS-058 — self-guards, last-owner protection, reactivate (API)

**Files:**
- Modify: `apps/api/src/users/users.service.ts`
- Modify: `apps/api/src/users/users.controller.ts`
- Modify: `apps/api/src/users/users.service.spec.ts`
- Modify: `apps/api/test/integration/meeting-batch1.e2e-spec.ts` (new describe)

**Interfaces:**
- Consumes: `AuthUser` actor already threaded into `updateRole`; `AuditService.append` (`@Global`).
- Produces: `deactivate(orgId, actor, userId)` + `reactivate(orgId, actor, userId)`; route `PATCH /users/:id/reactivate` (Task 16's web action calls it); guards — self role-change 403 `You cannot change your own role`, self deactivate 403 `You cannot deactivate your own account`, last-active-owner 400 `Cannot demote|deactivate the organization's only active owner`.

- [ ] **Step 1: Write the failing unit tests**

In `users.service.spec.ts`, first extend `makeService` (replace the whole helper) so it carries the new collaborators — existing tests keep passing because the added stubs are inert:

```ts
function makeService(
  mailResult: { sent: boolean; messageId?: string } = { sent: true },
  existingUser: { orgId: string | null } | null = null,
  targetUser: Record<string, unknown> | null = null,
  otherActiveOwners = 1,
) {
  const txUser = {
    update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'u-target', ...data })),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'u-new', ...data })),
  };
  const tx = { user: txUser };
  const prisma = {
    user: {
      findUnique: jest.fn(async () => existingUser),
      findFirst: jest.fn(async () => targetUser),
      count: jest.fn(async () => otherActiveOwners),
    },
    invitation: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'inv1',
        token: 'tok-abc',
        acceptedAt: null,
        createdAt: new Date('2026-07-11T00:00:00Z'),
        ...data,
      })),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const mail = { sendUserInvitation: jest.fn(async () => mailResult) };
  const audit = { append: jest.fn(async () => ({})) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new UsersService(prisma as any, mail as any, audit as any);
  return { service, prisma, mail, audit, txUser };
}
```

Then append:

```ts
describe('UsersService guards (INS-058)', () => {
  it('rejects changing your own role', async () => {
    const { service } = makeService();
    await expect(service.updateRole('org1', OWNER, OWNER.userId, 'QA_MANAGER')).rejects.toThrow(
      'You cannot change your own role',
    );
  });

  it('rejects deactivating your own account', async () => {
    const { service } = makeService();
    await expect(service.deactivate('org1', OWNER, OWNER.userId)).rejects.toThrow(
      'You cannot deactivate your own account',
    );
  });

  it("refuses to demote the organization's only active owner", async () => {
    const { service } = makeService(
      { sent: true },
      null,
      { id: 'u-target', orgId: 'org1', role: 'ORG_OWNER', status: 'ACTIVE' },
      0,
    );
    await expect(service.updateRole('org1', OWNER, 'u-target', 'QA_MANAGER')).rejects.toThrow(
      /only active owner/,
    );
  });

  it('deactivates a non-last owner inside a transaction with an audit row', async () => {
    const { service, audit } = makeService(
      { sent: true },
      null,
      { id: 'u-target', orgId: 'org1', role: 'ORG_OWNER', status: 'ACTIVE' },
      1,
    );
    const out = await service.deactivate('org1', OWNER, 'u-target');
    expect(out.status).toBe('DEACTIVATED');
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.deactivated', entityId: 'u-target' }),
      expect.anything(),
    );
  });

  it('reactivate flips DEACTIVATED back to ACTIVE; INVITED is refused', async () => {
    const deact = makeService({ sent: true }, null, { id: 'u-target', orgId: 'org1', role: 'INSPECTOR', status: 'DEACTIVATED' });
    const out = await deact.service.reactivate('org1', OWNER, 'u-target');
    expect(out.status).toBe('ACTIVE');

    const invited = makeService({ sent: true }, null, { id: 'u-target', orgId: 'org1', role: 'INSPECTOR', status: 'INVITED' });
    await expect(invited.service.reactivate('org1', OWNER, 'u-target')).rejects.toThrow(/pending invitation/);
  });
});
```

Run: `pnpm api test -- users.service.spec` → FAIL (constructor arity, then missing guards/methods).

- [ ] **Step 2: Implement**

`users.service.ts`:

(a) Imports + constructor:

```ts
import { AuditService } from '../audit/audit.service';
```

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}
```

(b) Add the shared guard helper:

```ts
  /**
   * An org must always retain >= 1 ACTIVE ORG_OWNER (INS-058). Reachable in
   * practice via a deactivated-but-token-alive owner (JwtAuthGuard is stateless),
   * so this is not dead defense.
   */
  private async assertNotLastActiveOwner(orgId: string, targetUserId: string, verb: string): Promise<void> {
    const otherActiveOwners = await this.prisma.user.count({
      where: { orgId, role: 'ORG_OWNER', status: 'ACTIVE', id: { not: targetUserId } },
    });
    if (otherActiveOwners === 0) {
      throw new BadRequestException(`Cannot ${verb} the organization's only active owner`);
    }
  }
```

(c) Replace `updateRole`:

```ts
  async updateRole(orgId: string, actor: AuthUser, userId: string, role: Role) {
    if (actor.userId === userId) {
      throw new ForbiddenException('You cannot change your own role');
    }
    if (role === 'PLATFORM_ADMIN') {
      throw new ForbiddenException('Cannot assign platform admin');
    }
    if (!hasAtLeast(actor.role, role)) {
      throw new ForbiddenException('Cannot assign a role above your own');
    }
    const user = await this.prisma.user.findFirst({ where: { id: userId, orgId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === 'ORG_OWNER' && role !== 'ORG_OWNER' && user.status === 'ACTIVE') {
      await this.assertNotLastActiveOwner(orgId, userId, 'demote');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: userId }, data: { role }, select: SAFE_SELECT });
      await this.audit.append(
        { orgId, actorType: 'USER', actorUserId: actor.userId, action: 'user.role_changed', entityType: 'User', entityId: userId, metadata: { role } },
        tx,
      );
      return updated;
    });
  }
```

(d) Replace `deactivate` and add `reactivate`:

```ts
  async deactivate(orgId: string, actor: AuthUser, userId: string) {
    if (actor.userId === userId) {
      throw new ForbiddenException('You cannot deactivate your own account');
    }
    const user = await this.prisma.user.findFirst({ where: { id: userId, orgId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === 'ORG_OWNER' && user.status === 'ACTIVE') {
      await this.assertNotLastActiveOwner(orgId, userId, 'deactivate');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: userId }, data: { status: 'DEACTIVATED' }, select: SAFE_SELECT });
      await this.audit.append(
        { orgId, actorType: 'USER', actorUserId: actor.userId, action: 'user.deactivated', entityType: 'User', entityId: userId },
        tx,
      );
      return updated;
    });
  }

  /** Deactivation is reversible (INS-058) — INVITED accounts must finish their invite instead. */
  async reactivate(orgId: string, actor: AuthUser, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, orgId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.status === 'ACTIVE') return this.prisma.user.findFirst({ where: { id: userId }, select: SAFE_SELECT });
    if (user.status === 'INVITED') {
      throw new BadRequestException('This account has a pending invitation — it activates by accepting the invite');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: userId }, data: { status: 'ACTIVE' }, select: SAFE_SELECT });
      await this.audit.append(
        { orgId, actorType: 'USER', actorUserId: actor.userId, action: 'user.reactivated', entityType: 'User', entityId: userId },
        tx,
      );
      return updated;
    });
  }
```

(e) `users.controller.ts` — update the two handlers and add reactivate:

```ts
  @Patch(':id/role')
  updateRole(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { role: Role },
  ) {
    return this.users.updateRole(requireOrgId(user), user, id, body?.role);
  }

  @Patch(':id/reactivate')
  reactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.reactivate(requireOrgId(user), user, id);
  }

  @Delete(':id')
  deactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.deactivate(requireOrgId(user), user, id);
  }
```

- [ ] **Step 3: Integration coverage**

Append to `meeting-batch1.e2e-spec.ts`:

```ts
  describe('INS-058 — self-guards, last-owner, reactivate', () => {
    it('owner cannot change own role or deactivate self', async () => {
      const selfRole = await client.patch(`/users/${orgA.ownerId}/role`, {
        token: orgA.ownerToken,
        body: { role: 'QA_MANAGER' },
      });
      expect(selfRole.status).toBe(403);
      const selfOff = await client.delete(`/users/${orgA.ownerId}`, { token: orgA.ownerToken });
      expect(selfOff.status).toBe(403);
    });

    it('last active owner is protected; reactivate restores login', async () => {
      const email = `second-owner+${tag}@e2e.local`;
      const password = `E2eOwner2!${tag}`;
      const { token: secondToken, userId: secondId } = await inviteAndActivate(client, orgA.ownerToken, {
        email,
        role: 'ORG_OWNER',
        password,
      });

      const off = expect2xx(await client.delete(`/users/${secondId}`, { token: orgA.ownerToken }), 'deactivate second owner');
      expect(off.status).toBe('DEACTIVATED');

      // Stateless-guard caveat: the deactivated owner's access token stays valid
      // until expiry — the last-owner guard is what stops the org lockout here.
      const lockout = await client.delete(`/users/${orgA.ownerId}`, { token: secondToken });
      expect(lockout.status).toBe(400);

      const back = expect2xx(await client.patch(`/users/${secondId}/reactivate`, { token: orgA.ownerToken }), 'reactivate');
      expect(back.status).toBe('ACTIVE');
      expect2xx(await client.post('/auth/login', { body: { email, password } }), 'second owner login after reactivate');
    });
  });
```

- [ ] **Step 4: Verify + commit**

Run: `pnpm api test` → PASS (existing invite tests green with the extended helper). `pnpm api test:integration` → PASS (full).

```bash
git add apps/api/src/users apps/api/test/integration/meeting-batch1.e2e-spec.ts
git commit -m "feat(api): INS-058 self-role/self-deactivate guards, last-active-owner protection, reactivate endpoint"
```

---

### Task 9: INS-059 — direct add-member endpoint (API)

**Files:**
- Modify: `apps/api/src/users/users.service.ts` (add `CreateMemberInput` + `createMember`)
- Modify: `apps/api/src/users/users.controller.ts` (add `@Post()`)
- Modify: `apps/api/src/users/users.service.spec.ts`
- Modify: `apps/api/test/integration/meeting-batch1.e2e-spec.ts` (new describe)

**Interfaces:**
- Consumes: `hashPassword` (`../auth/password`), the invite() guard set (PLATFORM_ADMIN block, `hasAtLeast` floor, global-email check), Task 8's audit dep.
- Produces: `POST /users` body `{ name?, email, password, role? }` → SAFE_SELECT user, status ACTIVE (Task 16's `addMember` action calls it). Duplicate email (any org) → generic 403 `An account already exists for this email`.

- [ ] **Step 1: Write the failing unit tests**

Append to `users.service.spec.ts`:

```ts
describe('UsersService.createMember (INS-059)', () => {
  it('creates an ACTIVE member with a scrypt hash and an audit row', async () => {
    const { service, txUser, audit } = makeService();
    const out = await service.createMember('org1', OWNER, {
      name: 'Direct Member',
      email: '  Direct@Example.COM ',
      password: 'longenough1',
      role: 'QA_MANAGER',
    });
    expect(out).toMatchObject({ email: 'direct@example.com', role: 'QA_MANAGER', status: 'ACTIVE' });
    const created = txUser.create.mock.calls[0][0].data as Record<string, string>;
    expect(created.passwordHash).toMatch(/^scrypt\$/);
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.member_added' }),
      expect.anything(),
    );
  });

  it('rejects short passwords, platform-admin role, above-own-role, and existing emails', async () => {
    const { service } = makeService();
    await expect(
      service.createMember('org1', OWNER, { email: 'a@b.com', password: 'short' }),
    ).rejects.toThrow(/min 8 characters/);
    await expect(
      service.createMember('org1', OWNER, { email: 'a@b.com', password: 'longenough1', role: 'PLATFORM_ADMIN' }),
    ).rejects.toThrow('Cannot create a platform admin');
    await expect(
      service.createMember('org1', QA, { email: 'a@b.com', password: 'longenough1', role: 'ORG_OWNER' }),
    ).rejects.toThrow('Cannot create a role above your own');

    const dup = makeService({ sent: true }, { orgId: 'org2' });
    await expect(
      dup.service.createMember('org1', OWNER, { email: 'a@b.com', password: 'longenough1' }),
    ).rejects.toThrow('An account already exists for this email');
  });
});
```

Run: `pnpm api test -- users.service.spec` → FAIL (`createMember` not a function).

NOTE: the SAFE_SELECT shape means `tx.user.create` must be called with `select: SAFE_SELECT`; the mock returns `{ id, ...data }`, so the `status`/`role`/`email` assertions read the data echo. The `passwordHash` assertion inspects the create args, not the return.

- [ ] **Step 2: Implement**

`users.service.ts` — add `import { hashPassword } from '../auth/password';`, the input type below `InviteUserInput`:

```ts
export interface CreateMemberInput {
  name?: string;
  email: string;
  password: string;
  role?: Role;
}
```

and the method after `invite`:

```ts
  /**
   * Direct add-member (INS-059): the owner sets name/email/password and the
   * account is ACTIVE immediately — no email round-trip. Reuses the invite()
   * guard set; a duplicate email (same or foreign org) gets one generic refusal
   * so this endpoint is not an account-existence oracle.
   */
  async createMember(orgId: string, actor: AuthUser, input: CreateMemberInput) {
    if (!input?.email?.trim()) throw new BadRequestException('email is required');
    if (!input?.password || input.password.length < 8) {
      throw new BadRequestException('password (min 8 characters) is required');
    }
    const email = input.email.trim().toLowerCase();
    const role = input.role ?? 'INSPECTOR';
    if (role === 'PLATFORM_ADMIN') throw new ForbiddenException('Cannot create a platform admin');
    if (!hasAtLeast(actor.role, role)) throw new ForbiddenException('Cannot create a role above your own');
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { orgId: true } });
    if (existing) throw new ForbiddenException('An account already exists for this email');

    const passwordHash = await hashPassword(input.password);
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { orgId, email, name: input.name?.trim() || email, role, status: 'ACTIVE', passwordHash },
        select: SAFE_SELECT,
      });
      await this.audit.append(
        { orgId, actorType: 'USER', actorUserId: actor.userId, action: 'user.member_added', entityType: 'User', entityId: user.id, metadata: { role } },
        tx,
      );
      return user;
    });
  }
```

`users.controller.ts` — import `CreateMemberInput` and add (class ORG_OWNER floor applies):

```ts
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateMemberInput) {
    return this.users.createMember(requireOrgId(user), user, body);
  }
```

- [ ] **Step 3: Integration**

Append to `meeting-batch1.e2e-spec.ts`:

```ts
  describe('INS-059 — direct add-member', () => {
    it('creates an ACTIVE member who logs in immediately; guards hold', async () => {
      const email = `direct+${tag}@e2e.local`;
      const password = `E2eDirect!${tag}`;
      const created = expect2xx(
        await client.post('/users', {
          token: orgA.ownerToken,
          body: { name: 'Direct Member', email, password, role: 'QA_MANAGER' },
        }),
        'POST /users (direct add)',
      );
      expect(created.status).toBe('ACTIVE');
      expect(created.passwordHash).toBeUndefined();
      expect2xx(await client.post('/auth/login', { body: { email, password } }), 'direct member login');

      const foreign = await client.post('/users', {
        token: orgB.ownerToken,
        body: { email, password: 'Whatever123!' },
      });
      expect(foreign.status).toBe(403);

      const admin = await client.post('/users', {
        token: orgA.ownerToken,
        body: { email: `x+${tag}@e2e.local`, password: 'Whatever123!', role: 'PLATFORM_ADMIN' },
      });
      expect(admin.status).toBe(403);
    });
  });
```

- [ ] **Step 4: Verify + commit**

Run: `pnpm api test` → PASS. `pnpm api test:integration` → PASS (full).

```bash
git add apps/api/src/users apps/api/test/integration/meeting-batch1.e2e-spec.ts
git commit -m "feat(api): INS-059 direct add-member (POST /users) - ACTIVE account, invite guards reused, audit row"
```

---

### Task 10: INS-069 — status-change notification emails

**Files:**
- Modify: `apps/api/src/mail/mail.service.ts` (2 methods + 2 input types)
- Create: `apps/api/src/mail/mail-inspection.spec.ts`
- Modify: `apps/api/src/inspections/inspections.service.ts` (mail dep + post-commit hooks)
- Modify: `apps/api/src/inspections/inspections.service.spec.ts` (helper + fan-out tests)

**Interfaces:**
- Consumes: MailService's private `send` (never-throws contract), `webBaseUrl`; Task 2/3 submit shape.
- Produces: `sendInspectionSubmitted({ to, poNumber, inspectionId })`, `sendInspectionDecided({ to, poNumber, inspectionId, decision, remarks? })` → `Promise<SendResult>`. InspectionsService constructor becomes `(prisma, audit, mail)`.

- [ ] **Step 1: Write the failing mail-template spec**

Create `apps/api/src/mail/mail-inspection.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import type { Transporter } from 'nodemailer';
import { MailService } from './mail.service';

function makeMail() {
  const sendMail = jest.fn(async () => ({ messageId: 'mid-1' }));
  const config = new ConfigService({ WEB_BASE_URL: 'https://console.example' });
  const service = new MailService(config, { sendMail } as unknown as Transporter);
  return { service, sendMail };
}

describe('MailService inspection notifications (INS-069)', () => {
  it('sendInspectionSubmitted links the review page and names the PO', async () => {
    const { service, sendMail } = makeMail();
    const res = await service.sendInspectionSubmitted({ to: 'qa@x.com', poNumber: 'PO-77', inspectionId: 'insp-9' });
    expect(res.sent).toBe(true);
    const msg = sendMail.mock.calls[0][0] as { to: string; subject: string; text: string };
    expect(msg.to).toBe('qa@x.com');
    expect(msg.subject).toContain('PO-77');
    expect(msg.text).toContain('https://console.example/inspections/insp-9/review');
  });

  it('sendInspectionDecided carries decision + remarks and never throws on transport failure', async () => {
    const { service, sendMail } = makeMail();
    const res = await service.sendInspectionDecided({
      to: 'insp@x.com',
      poNumber: null,
      inspectionId: 'insp-9',
      decision: 'FAIL',
      remarks: 'stitching',
    });
    expect(res.sent).toBe(true);
    const msg = sendMail.mock.calls[0][0] as { subject: string; text: string };
    expect(msg.subject).toContain('FAIL');
    expect(msg.text).toContain('stitching');

    sendMail.mockRejectedValueOnce(new Error('smtp down'));
    const failed = await service.sendInspectionDecided({ to: 'a@b.c', poNumber: 'P', inspectionId: 'i', decision: 'PASS' });
    expect(failed.sent).toBe(false);
  });
});
```

Run: `pnpm api test -- mail-inspection` → FAIL (methods missing).

- [ ] **Step 2: Implement the templates**

In `mail.service.ts` add below `BuyerGuestMagicLinkMail`:

```ts
export interface InspectionSubmittedMail {
  to: string;
  poNumber: string | null;
  inspectionId: string;
}

export interface InspectionDecidedMail {
  to: string;
  poNumber: string | null;
  inspectionId: string;
  decision: string;
  remarks?: string | null;
}
```

and the methods below `sendBuyerGuestMagicLink`:

```ts
  /** Internal notification: an inspection awaits QA review (INS-069). */
  async sendInspectionSubmitted(input: InspectionSubmittedMail): Promise<SendResult> {
    const link = `${this.webBaseUrl}/inspections/${encodeURIComponent(input.inspectionId)}/review`;
    const po = input.poNumber ?? input.inspectionId.slice(0, 8);
    const text = [
      `Inspection ${po} was submitted on Inspect and is awaiting QA review.`,
      '',
      'Review it here:',
      link,
    ].join('\n');
    return this.send({ to: input.to, subject: `Inspection ${po} awaits QA review`, text });
  }

  /** Internal notification: the binding QA decision was recorded (INS-069). */
  async sendInspectionDecided(input: InspectionDecidedMail): Promise<SendResult> {
    const link = `${this.webBaseUrl}/inspections/${encodeURIComponent(input.inspectionId)}/review`;
    const po = input.poNumber ?? input.inspectionId.slice(0, 8);
    const text = [
      `The QA decision for inspection ${po} on Inspect is: ${input.decision}.`,
      ...(input.remarks ? ['', `Remarks: ${input.remarks}`] : []),
      '',
      'View the inspection:',
      link,
    ].join('\n');
    return this.send({ to: input.to, subject: `Inspection ${po} decision: ${input.decision}`, text });
  }
```

Run: `pnpm api test -- mail-inspection` → PASS.

- [ ] **Step 3: Extend the inspections spec for the fan-out (failing)**

In `inspections.service.spec.ts` replace the helper's service construction with the three-arg form and add the `users`/`mail` plumbing — the full updated helper:

```ts
interface MakeOpts {
  inspection?: Record<string, unknown>;
  loops?: Array<{ zoneName: string; requiredShotCount: number; _count: { photos: number } }>;
  users?: Array<{ email: string }>;
}

function makeService(opts: MakeOpts = {}) {
  const inspection = opts.inspection ?? {
    id: 'insp1',
    orgId: 'org1',
    status: 'ASSIGNED',
    lotSize: 500,
    aqlPlan: {},
    poId: 'po1',
    supersedesInspectionId: null,
    assignedInspectorId: null,
    purchaseOrder: { poNumber: 'PO-1' },
    aqlResult: null,
  };
  const tx = {
    inspection: {
      update: jest.fn(async () => ({ id: 'insp1', status: 'SUBMITTED' })),
      findUnique: jest.fn(async () => ({ id: 'insp1', status: 'SUBMITTED', aqlResult: { systemRecommendation: 'PASS' } })),
    },
    aqlResult: { upsert: jest.fn(async () => ({})), update: jest.fn(async () => ({})) },
    billableEvent: { findUnique: jest.fn(async () => null), create: jest.fn(async () => ({})) },
  };
  const prisma = {
    inspection: { findFirst: jest.fn(async () => inspection) },
    inspectionLoop: { findMany: jest.fn(async () => opts.loops ?? []) },
    defectInstance: { groupBy: jest.fn(async () => []) },
    user: { findMany: jest.fn(async () => opts.users ?? []) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const audit = { append: jest.fn(async () => ({})) };
  const mail = {
    sendInspectionSubmitted: jest.fn(async () => ({ sent: true })),
    sendInspectionDecided: jest.fn(async () => ({ sent: true })),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new InspectionsService(prisma as any, audit as any, mail as any);
  return { service, prisma, tx, audit, mail };
}
```

Append the new tests:

```ts
describe('InspectionsService — status-change notifications (INS-069)', () => {
  it('submit mails every returned reviewer with the PO + inspection id', async () => {
    const { service, mail, prisma } = makeService({
      loops: [{ zoneName: 'Front', requiredShotCount: 1, _count: { photos: 1 } }],
      users: [{ email: 'qa1@x.com' }, { email: 'owner@x.com' }],
    });
    await service.submit('org1', QA, 'insp1', {});
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orgId: 'org1', status: 'ACTIVE', id: { not: QA.userId } }),
      }),
    );
    expect(mail.sendInspectionSubmitted).toHaveBeenCalledTimes(2);
    expect(mail.sendInspectionSubmitted).toHaveBeenCalledWith({ to: 'qa1@x.com', poNumber: 'PO-1', inspectionId: 'insp1' });
  });

  it('decide mails the recipients with the decision', async () => {
    const { service, mail } = makeService({
      inspection: {
        id: 'insp1',
        orgId: 'org1',
        status: 'SUBMITTED',
        assignedInspectorId: 'u-insp',
        purchaseOrder: { poNumber: 'PO-1' },
        aqlResult: { id: 'aql1' },
      },
      users: [{ email: 'insp@x.com' }],
    });
    await service.decide('org1', 'u-qa', 'insp1', { decision: 'FAIL', remarks: 'seams' });
    expect(mail.sendInspectionDecided).toHaveBeenCalledWith({
      to: 'insp@x.com',
      poNumber: 'PO-1',
      inspectionId: 'insp1',
      decision: 'FAIL',
      remarks: 'seams',
    });
  });
});
```

Run: `pnpm api test -- inspections.service.spec` → FAIL (constructor arity / no mail calls).

- [ ] **Step 4: Wire the hooks**

In `inspections.service.ts`:

(a) `import { MailService } from '../mail/mail.service';` and constructor:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}
```

(b) In `submit()`, change the opening lookup to also fetch the PO number:

```ts
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, orgId, ...this.inspectorScope(actor) },
      include: { purchaseOrder: { select: { poNumber: true } } },
    });
```

and replace the trailing `return this.prisma.$transaction(...)` with:

```ts
    const result = await this.prisma.$transaction(async (tx) => {
      // ... (transaction body unchanged) ...
    });

    // INS-069: notify reviewers AFTER the commit — never inside the tx, never
    // throwing (MailService resolves {sent:false} on failure). The submitter is excluded.
    const reviewers = await this.prisma.user.findMany({
      where: { orgId, status: 'ACTIVE', id: { not: actor.userId }, role: { in: ['QA_MANAGER', 'ORG_OWNER'] } },
      select: { email: true },
    });
    const poNumber = inspection.purchaseOrder?.poNumber ?? null;
    await Promise.all(
      [...new Set(reviewers.map((r) => r.email))].map((to) =>
        this.mail.sendInspectionSubmitted({ to, poNumber, inspectionId: id }),
      ),
    );
    return result;
```

(c) In `decide()`, extend the lookup include and add the post-commit hook:

```ts
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, orgId },
      include: { aqlResult: true, purchaseOrder: { select: { poNumber: true } } },
    });
```

```ts
    const decided = await this.prisma.$transaction(async (tx) => {
      // ... (transaction body unchanged) ...
    });

    // INS-069: assigned inspector + active owners learn the binding call (post-commit).
    const recipients = await this.prisma.user.findMany({
      where: {
        orgId,
        status: 'ACTIVE',
        id: { not: userId },
        OR: [
          { role: 'ORG_OWNER' },
          ...(inspection.assignedInspectorId ? [{ id: inspection.assignedInspectorId }] : []),
        ],
      },
      select: { email: true },
    });
    const poNumber = inspection.purchaseOrder?.poNumber ?? null;
    await Promise.all(
      [...new Set(recipients.map((r) => r.email))].map((to) =>
        this.mail.sendInspectionDecided({ to, poNumber, inspectionId: id, decision: input.decision, remarks: input.remarks }),
      ),
    );
    return decided;
```

- [ ] **Step 5: Verify + commit**

Run: `pnpm api test` → PASS (all suites). `pnpm api test:integration` → PASS (dev/json mail mode logs, nothing sent).

```bash
git add apps/api/src/mail apps/api/src/inspections
git commit -m "feat(api): INS-069 internal status-change emails on submit (QA+) and decision (inspector+owners)"
```

---

### Task 11: INS-065 (API half) — QA_MANAGER can read the users list

**Files:**
- Modify: `apps/api/src/users/users.controller.ts:15-18`
- Modify: `apps/api/test/integration/meeting-batch1.e2e-spec.ts` (new describe)

**Interfaces:**
- Produces: `GET /users` at QA_MANAGER floor (fixes the empty inspector dropdown on `/inspections/new`; Task 13 relies on it). Everything else on the controller stays ORG_OWNER. The existing matrix test `INSPECTOR cannot list users` pins INSPECTOR→403 and still holds.

- [ ] **Step 1: Failing test** — append to `meeting-batch1.e2e-spec.ts`:

```ts
  describe('INS-065 — QA_MANAGER reads the users list', () => {
    it('QA lists users (inspector assignment needs it); INSPECTOR still 403', async () => {
      const { token: qaToken } = await inviteAndActivate(client, orgA.ownerToken, {
        email: `mb1-qa+${tag}@e2e.local`,
        role: 'QA_MANAGER',
        password: `E2eQa!${tag}`,
      });
      const res = await client.get('/users', { token: qaToken });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const insp = await client.get('/users', { token: inspectorToken });
      expect(insp.status).toBe(403);
    });
  });
```

Run: `pnpm api test:integration -- meeting-batch1` → FAIL (QA gets 403).

- [ ] **Step 2: Implement** — in `users.controller.ts` add the handler-level floor on `list` only:

```ts
  /** Read-only listing relaxed to QA_MANAGER (INS-065): the create-inspection
   *  screen needs the inspector roster; all management stays ORG_OWNER. */
  @Get()
  @Roles('QA_MANAGER')
  list(@CurrentUser() user: AuthUser, @Query() query: RawListQuery) {
    return this.users.list(requireOrgId(user), parseListQuery(query));
  }
```

- [ ] **Step 3: Verify + commit**

Run: `pnpm api test:integration` → PASS (full — including the pinned `INSPECTOR cannot list users`).

```bash
git add apps/api/src/users apps/api/test/integration/meeting-batch1.e2e-spec.ts
git commit -m "feat(api): INS-065 relax GET /users to QA_MANAGER (fixes the empty inspector dropdown)"
```

---

### Task 12: INS-067 + INS-061 web — danger token, ConfirmDialog, archived view + restore

**Files:**
- Modify: `apps/web/components/inspect/tokens.ts` (add `danger`)
- Create: `apps/web/components/inspect/confirm-dialog.tsx`
- Modify: `apps/web/app/(console)/dashboard/actions.ts` (restore actions)
- Modify: `apps/web/app/(console)/dashboard/directory-client.tsx` (chips, badge, dim, RowMenu)

**Interfaces:**
- Consumes: Task 5's `POST /buyers/:id/restore` + `/suppliers/:id/restore`; existing `archiveBuyer`/`archiveSupplier` actions.
- Produces: `ui.danger` token; `<ConfirmDialog title body confirmLabel danger onConfirm onCancel />` client component (Task 13 reuses it); `restoreBuyer(id)` / `restoreSupplier(id)` server actions.

- [ ] **Step 1: Token + dialog**

`tokens.ts` — add to the `ui` const after `accentSoft`:

```ts
  /** Destructive-action red — same hue as severity.critical.fg; never hardcode #DC2626. */
  danger: '#B42318',
```

Create `confirm-dialog.tsx`:

```tsx
'use client';

import type { ReactNode } from 'react';
import { ui } from './tokens';

/** The design system's modal confirm (first consumer: archive + start-inspection). */
export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'rgba(11,18,32,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 12, padding: 24, width: 420, maxWidth: '90vw', border: `1px solid ${ui.line}`, fontFamily: ui.font }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, color: ui.ink }}>{title}</div>
        <div style={{ fontSize: 13, color: ui.sub, marginTop: 8, lineHeight: 1.5 }}>{body}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button
            onClick={onCancel}
            style={{ height: 34, padding: '0 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, fontFamily: 'inherit', background: '#fff', color: ui.ink, border: `1px solid ${ui.line}`, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{ height: 34, padding: '0 14px', borderRadius: 8, fontSize: 13, fontWeight: 550, fontFamily: 'inherit', background: danger ? ui.danger : ui.accent, color: '#fff', border: '1px solid transparent', cursor: 'pointer' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Restore server actions**

Append to `dashboard/actions.ts` (note: unlike archive, restore does NOT redirect — the row stays in view):

```ts
export async function restoreBuyer(id: string): Promise<{ error?: string }> {
  try {
    await apiPost(`/buyers/${id}/restore`);
  } catch (e) {
    return { error: msg(e, 'restore failed') };
  }
  revalidatePath('/dashboard');
  return {};
}

export async function restoreSupplier(id: string): Promise<{ error?: string }> {
  try {
    await apiPost(`/suppliers/${id}/restore`);
  } catch (e) {
    return { error: msg(e, 'restore failed') };
  }
  revalidatePath('/dashboard');
  return {};
}
```

(`apiPost` joins the existing import from `@/lib/api`.)

- [ ] **Step 3: Directory client — chips, badge, dim, RowMenu**

In `directory-client.tsx`:

(a) Imports: add `ConfirmDialog` (`@/components/inspect/confirm-dialog`) and `restoreBuyer, restoreSupplier` to the actions import.

(b) Replace `ArchivedBadge` (AA-passing severity.minor pair):

```tsx
function ArchivedBadge() {
  return (
    <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: '#EFF2F6', color: '#475467', textTransform: 'uppercase', letterSpacing: 0.4 }}>
      Archived
    </span>
  );
}
```

(c) Three-state view derived from the URL — replace the `showArchived` line:

```ts
  /** Server filter: ?includeArchived=1 widens the result set; ?view=archived narrows the display. */
  const showArchived = searchParams.get('includeArchived') === '1';
  const view: 'all' | 'active' | 'archived' =
    searchParams.get('view') === 'archived' ? 'archived' : showArchived ? 'all' : 'active';
```

and replace `pushListParams` with a view-aware version:

```ts
  function pushListParams(next: { q?: string; page?: number; view?: 'all' | 'active' | 'archived' }) {
    const sp = new URLSearchParams();
    const v = next.view ?? view;
    if (v !== 'active') sp.set('includeArchived', '1');
    if (v === 'archived') sp.set('view', 'archived');
    const q = next.q !== undefined ? next.q : serverQuery;
    if (q) sp.set('q', q);
    if (next.page && next.page > 1) sp.set('page', String(next.page));
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }
```

(d) Replace the two-chip block with three chips:

```tsx
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={chip(view === 'all')} onClick={() => pushListParams({ view: 'all' })}>All</button>
          <button style={chip(view === 'active')} onClick={() => pushListParams({ view: 'active' })}>Active</button>
          <button style={chip(view === 'archived')} onClick={() => pushListParams({ view: 'archived' })}>Archived</button>
        </div>
```

(e) Narrow the displayed rows below the `filteredBuyers`/`filteredSuppliers` definitions:

```ts
  const visibleBuyers = view === 'archived' ? filteredBuyers.filter((b) => b.archivedAt) : filteredBuyers;
  const visibleSuppliers = view === 'archived' ? filteredSuppliers.filter((s) => s.archivedAt) : filteredSuppliers;
```

and swap every `filteredBuyers`→`visibleBuyers` / `filteredSuppliers`→`visibleSuppliers` in the table bodies + "Showing N" footers.

(f) Dim archived rows — on both `<tr>` styles add:

```ts
  style={{ cursor: 'pointer', opacity: b.archivedAt ? 0.6 : 1 }}
```

(suppliers: `s.archivedAt`).

(g) RowMenu — accept `archived`, branch Archive/Restore, confirm the archive, tokenize the red. Replace the whole `RowMenu` with:

```tsx
function RowMenu({ id, type, archived, onClose }: { id: string; type: 'buyer' | 'supplier'; archived: boolean; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  const item = (color: string): React.CSSProperties => ({
    display: 'block', width: '100%', padding: '10px 14px', fontSize: 13, color,
    background: 'transparent', borderWidth: '1px 0 0 0', borderStyle: 'solid', borderColor: ui.lineSoft,
    fontFamily: 'inherit', textAlign: 'left', cursor: pending ? 'default' : 'pointer', opacity: pending ? 0.6 : 1,
  });

  function runArchiveOrRestore(fn: (id: string) => Promise<{ error?: string } | undefined>) {
    startTransition(async () => {
      const r = await fn(id);
      if (r?.error) alert(r.error);
      router.refresh();
      onClose();
    });
  }

  return (
    <div ref={ref} style={{ position: 'absolute', right: 0, top: 32, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.1)', zIndex: 50, minWidth: 180, overflow: 'hidden' }}>
      <button onClick={() => { router.push(`/${type === 'buyer' ? 'buyers' : 'suppliers'}/${id}`); onClose(); }} style={{ ...item(ui.ink), borderWidth: 0 }}>
        Edit
      </button>
      {type === 'buyer' && (
        <button onClick={() => { router.push(`/buyers/${id}/guests`); onClose(); }} style={item(ui.ink)}>
          Manage guests
        </button>
      )}
      {archived ? (
        <button disabled={pending} onClick={() => runArchiveOrRestore(type === 'buyer' ? restoreBuyer : restoreSupplier)} style={item(ui.accent)}>
          Restore
        </button>
      ) : (
        <button disabled={pending} onClick={() => setConfirming(true)} style={item(ui.danger)}>
          Archive
        </button>
      )}
      {confirming && (
        <ConfirmDialog
          title={`Archive this ${type}?`}
          body="Archived records leave the active views but stay recoverable from the Archived tab."
          confirmLabel="Archive"
          danger
          onConfirm={() => { setConfirming(false); runArchiveOrRestore(type === 'buyer' ? archiveBuyer : archiveSupplier); }}
          onCancel={() => { setConfirming(false); onClose(); }}
        />
      )}
    </div>
  );
}
```

Both call sites gain the flag: `<RowMenu id={b.id} type="buyer" archived={!!b.archivedAt} onClose={...} />` (suppliers: `!!s.archivedAt`).

(h) Tokenize the remaining reds in this file: replace the two InlineForm error literals `color: '#DC2626'` with `color: ui.danger`.

- [ ] **Step 4: Verify + commit**

Run: `pnpm web type-check` → PASS. `pnpm web build` → PASS. Grep check: `grep -n "DC2626" apps/web/app/\(console\)/dashboard/directory-client.tsx` → no matches.

```bash
git add apps/web/components/inspect "apps/web/app/(console)/dashboard"
git commit -m "feat(web): INS-067/061 archived view + restore, confirm-before-archive, AA badge, danger token"
```

---

### Task 13: INS-066/057/065 web — inspections row actions, start confirmation, create gating

**Files:**
- Modify: `apps/web/lib/roles.ts` (rank helper)
- Modify: `apps/web/lib/api.ts` (ApiInspection.assignedInspectorId)
- Modify: `apps/web/app/(console)/inspections/actions.ts` (start/reset/reassign)
- Create: `apps/web/app/(console)/inspections/row-actions.tsx`
- Modify: `apps/web/app/(console)/inspections/page.tsx`
- Modify: `apps/web/app/(console)/inspections/new/page.tsx` (server gate)

**Interfaces:**
- Consumes: Task 2's `POST /inspections/:id/start|reset`, Task 6's `PATCH /inspections/:id`, Task 11's QA-readable `GET /users`, Task 12's `ConfirmDialog`.
- Produces: `apiRoleAtLeast(role, min)` helper (Task 15 reuses it); `startInspection/resetInspection/reassignInspection` server actions.

- [ ] **Step 1: Rank helper + type**

Append to `lib/roles.ts`:

```ts
const API_ROLE_RANK: Record<string, number> = {
  INSPECTOR: 1,
  QA_MANAGER: 2,
  ORG_OWNER: 3,
  PLATFORM_ADMIN: 4,
};

/** Additive-hierarchy check on API role strings; unknown/missing role fails closed. */
export function apiRoleAtLeast(role: string | undefined, min: 'INSPECTOR' | 'QA_MANAGER' | 'ORG_OWNER'): boolean {
  return (API_ROLE_RANK[role ?? ''] ?? 0) >= API_ROLE_RANK[min];
}
```

In `lib/api.ts` `ApiInspection`, next to `inspectorId`:

```ts
  /** Scalar FK on list rows (INS-057) — assignedInspector object only on GET /:id. */
  assignedInspectorId?: string | null;
```

- [ ] **Step 2: Server actions** — append to `inspections/actions.ts` (`apiPatch` joins the existing `@/lib/api` import):

```ts
export async function startInspection(id: string): Promise<{ error?: string }> {
  try {
    await apiPost(`/inspections/${id}/start`);
  } catch (e) {
    return { error: msg(e, 'start failed') };
  }
  revalidatePath('/inspections');
  return {};
}

export async function resetInspection(id: string): Promise<{ error?: string }> {
  try {
    await apiPost(`/inspections/${id}/reset`);
  } catch (e) {
    return { error: msg(e, 'reset failed') };
  }
  revalidatePath('/inspections');
  return {};
}

export async function reassignInspection(id: string, inspectorId: string): Promise<{ error?: string }> {
  try {
    await apiPatch(`/inspections/${id}`, { assignedInspectorId: inspectorId });
  } catch (e) {
    return { error: msg(e, 'reassign failed') };
  }
  revalidatePath('/inspections');
  return {};
}
```

- [ ] **Step 3: Row actions client component**

Create `inspections/row-actions.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { MoreVertical } from 'lucide-react';
import { ConfirmDialog } from '@/components/inspect/confirm-dialog';
import { ui } from '@/components/inspect/tokens';
import { reassignInspection, resetInspection, startInspection } from './actions';

const PRE_SUBMISSION = new Set(['DRAFT', 'ASSIGNED', 'IN_PROGRESS']);

export function RowActions({
  id,
  status,
  assignedInspectorId,
  currentUserId,
  canManage,
  inspectors,
}: {
  id: string;
  status: string;
  assignedInspectorId?: string | null;
  currentUserId?: string;
  canManage: boolean;
  inspectors: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmingStart, setConfirmingStart] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setReassigning(false); }
    }
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const canAct = canManage || (!!currentUserId && assignedInspectorId === currentUserId);
  const item: React.CSSProperties = {
    display: 'block', width: '100%', padding: '10px 14px', fontSize: 13, color: ui.ink,
    background: 'transparent', borderWidth: '1px 0 0 0', borderStyle: 'solid', borderColor: ui.lineSoft,
    fontFamily: 'inherit', textAlign: 'left', cursor: pending ? 'default' : 'pointer', opacity: pending ? 0.6 : 1,
  };

  function run(fn: () => Promise<{ error?: string }>) {
    startTransition(async () => {
      const r = await fn();
      if (r.error) alert(r.error);
      router.refresh();
      setOpen(false);
    });
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(!open)}
        aria-label="Inspection actions"
        style={{ width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: ui.faint, background: 'transparent', border: 'none', cursor: 'pointer' }}
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: 32, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.1)', zIndex: 50, minWidth: 200, overflow: 'hidden' }}>
          <button onClick={() => { router.push(`/inspections/${id}/review`); setOpen(false); }} style={{ ...item, borderWidth: 0 }}>
            Open
          </button>
          <button
            onClick={async () => { await navigator.clipboard.writeText(`${window.location.origin}/inspections/${id}/review`); setOpen(false); }}
            style={item}
          >
            Copy link
          </button>
          {status === 'ASSIGNED' && canAct && (
            <button disabled={pending} onClick={() => setConfirmingStart(true)} style={item}>Start inspection</button>
          )}
          {status === 'IN_PROGRESS' && canAct && (
            <button disabled={pending} onClick={() => run(() => resetInspection(id))} style={item}>Reset to assigned</button>
          )}
          {canManage && PRE_SUBMISSION.has(status) && inspectors.length > 0 && (
            reassigning ? (
              <div style={{ padding: '10px 14px', borderTop: `1px solid ${ui.lineSoft}` }}>
                <select
                  autoFocus
                  defaultValue=""
                  disabled={pending}
                  onChange={(e) => { if (e.target.value) run(() => reassignInspection(id, e.target.value)); }}
                  style={{ width: '100%', height: 30, fontSize: 12.5, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 6 }}
                >
                  <option value="" disabled>Assign to…</option>
                  {inspectors.map((i) => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
                </select>
              </div>
            ) : (
              <button disabled={pending} onClick={() => setReassigning(true)} style={item}>Reassign…</button>
            )
          )}
        </div>
      )}
      {confirmingStart && (
        <ConfirmDialog
          title="Start this inspection?"
          body="Starting cannot be stopped — only reset and restarted. Photos and defects recorded while in progress stay attached."
          confirmLabel="Start"
          onConfirm={() => { setConfirmingStart(false); run(() => startInspection(id)); }}
          onCancel={() => setConfirmingStart(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire the list page + gate the create screen**

`inspections/page.tsx`:

(a) Imports:

```ts
import { auth } from '@/lib/auth';
import { apiGet, type ApiInspection, type ApiUser } from '@/lib/api';
import { apiRoleAtLeast } from '@/lib/roles';
import { RowActions } from './row-actions';
```

(b) At the top of the component body, after `searchParams`:

```ts
  const session = (await auth()) as unknown as { user?: { id?: string }; role?: string } | null;
  const role = session?.role;
  const canManage = apiRoleAtLeast(role, 'QA_MANAGER');
  const currentUserId = session?.user?.id;
  const inspectors = canManage
    ? (await apiGet<ApiUser[]>('/users?take=100').catch(() => []))
        .filter((u) => u.role === 'INSPECTOR')
        .map((u) => ({ id: u.id, name: u.name || u.email }))
    : [];
```

(c) Gate the primary button — replace the unconditional `<Btn kind="primary" href="/inspections/new">New inspection</Btn>` with:

```tsx
            {canManage && <Btn kind="primary" href="/inspections/new">New inspection</Btn>}
```

(d) Add the actions column — header row becomes 6 columns:

```tsx
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 1fr 1fr 1fr 48px', padding: '10px 20px', fontSize: 11, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.4, background: ui.fill, borderBottom: `1px solid ${ui.line}` }}>
            <span>PO</span><span>Buyer</span><span>Product</span><span>Status</span><span>System</span><span />
          </div>
```

and each row becomes a grid div whose first five cells stay one `Link` (via `display: 'contents'`) with the actions cell outside it:

```tsx
          {inspections.map((i) => (
            <div key={i.id} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 1fr 1fr 1fr 48px', alignItems: 'center', padding: '14px 20px', borderBottom: `1px solid ${ui.lineSoft}` }}>
              <Link href={`/inspections/${i.id}/review`} style={{ display: 'contents', textDecoration: 'none', color: ui.ink }}>
                <Mono style={{ fontWeight: 600 }}>{i.purchaseOrder?.poNumber ?? i.id.slice(0, 8)}</Mono>
                <span>{i.buyer?.name ?? '—'}</span>
                <span>{i.product?.styleNumber ?? '—'}</span>
                <span style={{ fontSize: 12.5, color: ui.sub }}>{i.status}</span>
                <span style={{ fontSize: 12.5, color: ui.sub }}>{i.aqlResult?.systemRecommendation ?? '—'}</span>
              </Link>
              <RowActions
                id={i.id}
                status={i.status}
                assignedInspectorId={i.assignedInspectorId}
                currentUserId={currentUserId}
                canManage={canManage}
                inspectors={inspectors}
              />
            </div>
          ))}
```

`inspections/new/page.tsx` — add the server gate at the top of the component:

```ts
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { apiRoleAtLeast } from '@/lib/roles';
```

```ts
  const session = (await auth()) as unknown as { role?: string } | null;
  // Web-side UX gate only (INS-065) — the API's QA floor on POST /inspections is the authority.
  if (!apiRoleAtLeast(session?.role, 'QA_MANAGER')) redirect('/inspections');
```

- [ ] **Step 5: Verify + commit**

Run: `pnpm web type-check` → PASS. `pnpm web build` → PASS.

```bash
git add apps/web/lib "apps/web/app/(console)/inspections"
git commit -m "feat(web): INS-066/057/065 inspections row actions (start/reset/reassign/copy), start confirmation, create gating"
```

---

### Task 14: INS-062 web — Reports console screen

**Files:**
- Modify: `apps/web/lib/api.ts` (ApiReportListItem)
- Create: `apps/web/app/(console)/reports/page.tsx`

**Interfaces:**
- Consumes: Task 7's `GET /reports` shape.
- Produces: `/reports` route (Task 15 adds its NAV entry); `ApiReportListItem` type.

- [ ] **Step 1: Type** — append to `lib/api.ts`:

```ts
/** GET /reports row (INS-062) — list metadata only, never canonicalSnapshot. */
export interface ApiReportListItem {
  id: string;
  inspectionId: string;
  status: string;
  generatedAt: string;
  contentHash?: string | null;
  pdfStorageKey?: string | null;
  verificationToken?: string | null;
  buyer?: { id: string; name: string } | null;
  inspection?: {
    status: string;
    purchaseOrder?: { poNumber: string } | null;
    product?: { styleNumber: string } | null;
  } | null;
}
```

- [ ] **Step 2: Page** — create `app/(console)/reports/page.tsx`:

```tsx
import Link from 'next/link';
import { FileCheck2, Search } from 'lucide-react';
import { apiGet, type ApiReportListItem } from '@/lib/api';
import { Mono, PageHead } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  params.set('take', '50');
  const reports = await apiGet<ApiReportListItem[]>(`/reports?${params.toString()}`).catch(() => []);

  const cols = '1fr 1fr 1.4fr 1fr 0.9fr 0.8fr 0.9fr';

  return (
    <div style={{ padding: '24px 32px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: ui.sub, fontSize: 13, marginBottom: 14 }}>
        <FileCheck2 size={15} color={ui.sub} />
        <span style={{ color: ui.ink, fontWeight: 550 }}>Reports</span>
      </div>
      <PageHead
        title="Reports"
        sub={`${reports.length} signed report${reports.length === 1 ? '' : 's'}${q ? ` matching “${q}”` : ''}`}
        actions={
          <form method="GET" action="/reports" style={{ position: 'relative' }}>
            <Search size={15} color={ui.faint} style={{ position: 'absolute', left: 12, top: 10.5 }} />
            <input
              name="q"
              defaultValue={q ?? ''}
              placeholder="Search PO or buyer…"
              style={{ width: 280, height: 36, padding: '0 12px 0 36px', fontSize: 13, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
            />
          </form>
        }
      />

      {reports.length === 0 ? (
        <div style={{ marginTop: 16, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: 22, color: ui.sub, fontSize: 13 }}>
          {q ? `No reports match “${q}”.` : 'No reports yet — approve an inspection and generate its report.'}
        </div>
      ) : (
        <div style={{ marginTop: 16, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: cols, padding: '10px 20px', fontSize: 11, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.4, background: ui.fill, borderBottom: `1px solid ${ui.line}` }}>
            <span>Report no.</span><span>PO</span><span>Buyer</span><span>Product</span><span>Generated</span><span>Verify</span><span>PDF</span>
          </div>
          {reports.map((r) => (
            <div key={r.id} style={{ display: 'grid', gridTemplateColumns: cols, alignItems: 'center', padding: '14px 20px', borderBottom: `1px solid ${ui.lineSoft}` }}>
              <Link href={`/inspections/${r.inspectionId}/report`} style={{ textDecoration: 'none' }}>
                <Mono style={{ fontWeight: 600, color: ui.accent }}>IR-{r.id.slice(0, 8).toUpperCase()}</Mono>
              </Link>
              <Mono>{r.inspection?.purchaseOrder?.poNumber ?? '—'}</Mono>
              <span>{r.buyer?.name ?? '—'}</span>
              <span>{r.inspection?.product?.styleNumber ?? '—'}</span>
              <Mono style={{ color: ui.sub, fontSize: 12 }}>{r.generatedAt ? new Date(r.generatedAt).toISOString().slice(0, 10) : '—'}</Mono>
              {r.verificationToken ? (
                <Link href={`/r/${r.verificationToken}`} style={{ fontSize: 12.5, color: ui.accent, textDecoration: 'none' }}>
                  Public verify
                </Link>
              ) : (
                <span style={{ fontSize: 12.5, color: ui.faint }}>—</span>
              )}
              <span style={{ fontSize: 12.5, color: ui.faint }}>
                {r.pdfStorageKey ? 'Available' : 'Pending (INS-003)'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify + commit**

Run: `pnpm web type-check` → PASS. `pnpm web build` → PASS.

```bash
git add apps/web/lib/api.ts "apps/web/app/(console)/reports"
git commit -m "feat(web): INS-062 org Reports screen listing signed reports with verify links"
```

---

### Task 15: INS-065 web — role-aware sidebar (incl. the Reports entry)

**Files:**
- Modify: `apps/web/components/inspect/shell.tsx:200-207,262`

**Interfaces:**
- Consumes: `RoleKey` + the `role` prop ConsoleShell already receives (`app/(console)/layout.tsx:24`); Task 14's `/reports` route.
- Produces: NAV entries carry `minRole: RoleKey`; Sidebar renders only entries at or below the session role (fail-closed: missing role ⇒ inspector — `ConsoleShell` already defaults `role ?? 'inspector'`).

- [ ] **Step 1: Replace NAV + filter**

Replace the NAV const (add `FileCheck2` to the lucide import):

```ts
const ROLE_FLOOR: Record<RoleKey, number> = { inspector: 1, qa: 2, owner: 3, platform: 4 };

const NAV: { key: string; label: string; icon: typeof Building2; href: string; minRole: RoleKey }[] = [
  { key: 'directory', label: 'Buyers & Suppliers', icon: Building2, href: '/dashboard', minRole: 'qa' },
  { key: 'inspections', label: 'Inspections', icon: ClipboardList, href: '/inspections', minRole: 'inspector' },
  { key: 'reports', label: 'Reports', icon: FileCheck2, href: '/reports', minRole: 'qa' },
  { key: 'presets', label: 'Loop Presets', icon: Repeat, href: '/presets', minRole: 'qa' },
  { key: 'products', label: 'Products', icon: Package, href: '/products', minRole: 'qa' },
  { key: 'purchase-orders', label: 'Purchase Orders', icon: FileText, href: '/purchase-orders', minRole: 'qa' },
  { key: 'users', label: 'Users & Roles', icon: Users, href: '/users', minRole: 'owner' },
];
```

In `Sidebar`, change the map to filter first (web gating is UX only — the API floors are the authority):

```tsx
      {NAV.filter((n) => ROLE_FLOOR[user.role] >= ROLE_FLOOR[n.minRole]).map((n) => {
```

- [ ] **Step 2: Verify + commit**

Run: `pnpm web type-check` → PASS. `pnpm web build` → PASS.

```bash
git add apps/web/components/inspect/shell.tsx
git commit -m "feat(web): INS-065 role-filtered sidebar nav + Reports entry"
```

---

### Task 16: INS-070 + INS-059 web — users screen scrub, badges, reactivate, direct add

**Files:**
- Modify: `apps/web/app/(console)/users/page.tsx:16-19,36-53`
- Modify: `apps/web/app/(console)/users/users-client.tsx`
- Modify: `apps/web/app/(console)/users/actions.ts`

**Interfaces:**
- Consumes: Task 8's `PATCH /users/:id/reactivate`, Task 9's `POST /users`.
- Produces: `addMember` + `reactivateUser` server actions; status badges for DEACTIVATED/SUSPENDED; no PLATFORM_ADMIN strings in the org-facing DOM.

- [ ] **Step 1: Server actions** — append to `users/actions.ts`:

```ts
export async function addMember(
  _prev: unknown,
  formData: FormData,
): Promise<{ error?: string; data?: { email: string } }> {
  const name = (formData.get('name') as string)?.trim();
  const email = (formData.get('email') as string)?.trim();
  const password = formData.get('password') as string;
  const role = (formData.get('role') as string) || 'INSPECTOR';
  if (!email) return { error: 'Email is required' };
  if (!password || password.length < 8) return { error: 'Password must be at least 8 characters' };
  try {
    await apiPost('/users', { name, email, password, role });
  } catch (e) {
    return { error: msg(e, 'Failed to add member') };
  }
  revalidatePath('/users');
  return { data: { email } };
}

export async function reactivateUser(userId: string): Promise<{ error?: string }> {
  try {
    await apiPatch(`/users/${userId}/reactivate`);
  } catch (e) {
    return { error: msg(e, 'Failed to reactivate user') };
  }
  revalidatePath('/users');
  return {};
}
```

- [ ] **Step 2: Page scrub** — in `users/page.tsx`:

(a) Subtitle (line 38): drop the invite-only claim:

```ts
        sub="Roles are additive — Org Owner includes QA Manager, which includes Inspector."
```

(b) Remove the `'platform'` entry from the legend array (lines 42-47 keep only inspector/qa/owner) and narrow the local type:

```ts
type RoleKey = 'inspector' | 'qa' | 'owner';
const ROLE_KEY: Record<string, RoleKey> = {
  INSPECTOR: 'inspector', QA_MANAGER: 'qa', ORG_OWNER: 'owner',
};
```

```tsx
        {([
          ['inspector', 'Populate & view their inspections'],
          ['qa', 'Inspector + make binding Pass / Fail / Hold'],
          ['owner', 'QA + manage users, buyers, suppliers'],
        ] as [RoleKey, string][]).map(([r, desc]) => (
```

- [ ] **Step 3: Client — badges, reactivate, direct-add form**

In `users-client.tsx`:

(a) Status vocabulary (replace `StatusKey`/`statusStyle` and the `mapUser` status line):

```ts
type StatusKey = 'active' | 'invited' | 'deactivated' | 'suspended';
const statusStyle: Record<StatusKey, { label: string; fg: string; bg: string; dot: string }> = {
  active: { label: 'Active', fg: '#1F6B43', bg: '#EAF6F0', dot: '#1F8A4C' },
  invited: { label: 'Invited', fg: severity.major.fg, bg: severity.major.bg, dot: severity.major.dot },
  deactivated: { label: 'Deactivated', fg: '#475467', bg: '#EFF2F6', dot: '#8A93A1' },
  suspended: { label: 'Suspended', fg: severity.major.fg, bg: severity.major.bg, dot: severity.major.dot },
};
```

```ts
    status:
      u.status === 'ACTIVE' ? 'active'
      : u.status === 'INVITED' ? 'invited'
      : u.status === 'SUSPENDED' ? 'suspended'
      : 'deactivated',
```

(b) Remove the dead platform paths: `ROLE_MAP` loses `PLATFORM_ADMIN` (org lists can never contain one — `users.service.ts:36` filters by orgId); delete the `locked` variable, the `Lock`-badge branch in the role cell (keep only the `<select>`), and drop `Lock` from the lucide import. The role `<select>` disables for self OR deactivated rows:

```tsx
            disabled={pending || row.you || row.status === 'deactivated'}
```

(c) Row menu: deactivated rows offer Reactivate instead of Deactivate — replace the menu's single button with:

```tsx
                {row.status === 'deactivated' ? (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      startDeactivate(async () => {
                        const r = await reactivateUser(row.id);
                        if (r.error) alert(r.error);
                      });
                    }}
                    disabled={deactivating}
                    style={{ display: 'block', width: '100%', padding: '10px 14px', fontSize: 13, color: ui.accent, background: 'transparent', borderWidth: 0, fontFamily: 'inherit', textAlign: 'left', cursor: deactivating ? 'default' : 'pointer', opacity: deactivating ? 0.6 : 1 }}
                  >
                    Reactivate
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      startDeactivate(async () => {
                        const r = await deactivateUser(row.id);
                        if (r.error) alert(r.error);
                      });
                    }}
                    disabled={deactivating}
                    style={{ display: 'block', width: '100%', padding: '10px 14px', fontSize: 13, color: ui.danger, background: 'transparent', borderWidth: 0, fontFamily: 'inherit', textAlign: 'left', cursor: deactivating ? 'default' : 'pointer', opacity: deactivating ? 0.6 : 1 }}
                  >
                    Deactivate
                  </button>
                )}
```

(imports gain `reactivateUser`; the menu now renders for `!row.you` — drop the `!locked` condition; the error-box `#DC2626` literals become `ui.danger`).

(d) Direct-add: give the panel a mode toggle. Add state + a second `useActionState`:

```ts
  const [mode, setMode] = useState<'direct' | 'invite'>('direct');
  const [addState, addAction, addPending] = useActionState(addMember, {} as { error?: string; data?: { email: string } });
```

Rename the button (`Add member`), and inside the panel render a two-tab header above the forms:

```tsx
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {(['direct', 'invite'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{ height: 30, padding: '0 14px', borderRadius: 999, fontSize: 12.5, fontWeight: mode === m ? 600 : 500, fontFamily: 'inherit', cursor: 'pointer', background: mode === m ? '#fff' : 'transparent', color: mode === m ? ui.accent : ui.sub, border: `1px solid ${mode === m ? ui.accent : ui.line}` }}
              >
                {m === 'direct' ? 'Add directly' : 'Invite by email'}
              </button>
            ))}
          </div>
```

When `mode === 'invite'` render the existing invite form/result block unchanged. When `mode === 'direct'` render:

```tsx
            addState.data ? (
              <div style={{ padding: '12px 16px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, fontSize: 13, color: '#16A34A' }}>
                {addState.data.email} was added and can sign in now with the password you set.
              </div>
            ) : (
              <form action={addAction}>
                {addState.error && (
                  <div style={{ marginBottom: 12, padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 12.5, color: ui.danger }}>
                    {addState.error}
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: ui.sub, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 0.4 }}>Name</label>
                    <input name="name" style={{ width: '100%', height: 36, padding: '0 10px', fontSize: 13, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 8, outline: 'none', boxSizing: 'border-box' as const }} placeholder="Full name" />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: ui.sub, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 0.4 }}>Email *</label>
                    <input name="email" type="email" required style={{ width: '100%', height: 36, padding: '0 10px', fontSize: 13, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 8, outline: 'none', boxSizing: 'border-box' as const }} placeholder="colleague@example.com" />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: ui.sub, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 0.4 }}>Password * (min 8)</label>
                    <input name="password" type="password" required minLength={8} style={{ width: '100%', height: 36, padding: '0 10px', fontSize: 13, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 8, outline: 'none', boxSizing: 'border-box' as const }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: ui.sub, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 0.4 }}>Role</label>
                    <select name="role" defaultValue="INSPECTOR" style={{ width: '100%', height: 36, padding: '0 8px', fontSize: 13, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 8 }}>
                      <option value="INSPECTOR">Inspector</option>
                      <option value="QA_MANAGER">QA Manager</option>
                      <option value="ORG_OWNER">Org Owner</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                  <button type="submit" disabled={addPending}
                    style={{ height: 36, padding: '0 16px', borderRadius: 8, fontSize: 13, fontWeight: 550, fontFamily: 'inherit', background: ui.accent, color: '#fff', borderWidth: 0, cursor: addPending ? 'default' : 'pointer', opacity: addPending ? 0.65 : 1 }}>
                    {addPending ? 'Adding…' : 'Add member'}
                  </button>
                </div>
              </form>
            )
```

- [ ] **Step 4: Verify + commit**

Run: `pnpm web type-check` → PASS. `pnpm web build` → PASS. Grep: `grep -rn "PLATFORM_ADMIN\|platform" "apps/web/app/(console)/users"` → only the API-enum string in type positions, nothing rendered.

```bash
git add "apps/web/app/(console)/users"
git commit -m "feat(web): INS-070/059 users screen - platform scrub, real status badges, reactivate, direct add-member"
```

---

### Task 17: Close-out — full verification + docs

**Files:**
- Modify: `docs/future/BACKLOG.md` (flip 12 statuses)
- Modify: `docs/STATUS.md` (Active work + pillar rows + Last verified)

- [ ] **Step 1: Full verification**

Run, in order, all green:

```bash
pnpm api test               # 162 pre-existing + ~15 new unit tests
pnpm api test:integration   # 44 pre-existing + ~10 new integration tests
pnpm type-check             # both apps
pnpm web build
```

- [ ] **Step 2: Flip the backlog**

In `docs/future/BACKLOG.md`, for each of INS-056, INS-057, INS-058, INS-059, INS-061, INS-062, INS-064, INS-065, INS-066, INS-067, INS-069, INS-070: set `- status: done` with a `# 2026-07-18: …` done-line that names what shipped and how it is verified (unit/integration/type-check), following the existing done-line style.

- [ ] **Step 3: Update STATUS.md**

- Add an Active-work entry ("✅ Meeting batch 1 (2026-07-18)") summarizing the 12 closed items + new test counts.
- Update the pillar table's Open-backlog cells (remove the closed ids added on 2026-07-18) and the header's Last-verified line.

- [ ] **Step 4: Commit**

```bash
git add docs
git commit -m "docs: close meeting batch 1 (INS-056/057/058/059/061/062/064/065/066/067/069/070)"
```

- [ ] **Step 5: Finish the branch**

Use superpowers:finishing-a-development-branch — present merge/PR options for `feat/2026-07-18-meeting-batch-1` (do not push or merge without the user's choice).

---

## Self-Review (performed at authoring time)

1. **Spec coverage:** D1→Task 3/4 · D2→Task 4 · D3→Task 2 · D4→Task 9/16 · E5→Task 8 · D6→Task 5 · D7→Tasks 2/5/6/8/9 · D8→Task 7 · D9→Task 1 · D10→Tasks 11/13/15 · D11→Tasks 6/13 · D12→Task 12 · D13→Task 10 · D14→Task 16. No gaps.
2. **Placeholder scan:** no TBD/TODO; the only "mirror the pattern" step (Task 5 Step 3) names every substitution (model, action strings, entityType, controller signature) against code shown in full in Step 2.
3. **Type consistency:** `submit(orgId, actor: AuthUser, id, tamper)` fixed in Task 2 and used identically in Tasks 3/10; `InspectionsService` constructor grows `(prisma) → (prisma, audit)` in Task 2 → `(prisma, audit, mail)` in Task 10, and the unit-spec helper is rewritten in full at each step; `ConfirmDialog` props match between Task 12 (definition) and Tasks 12/13 (consumers); `ApiReportListItem` matches Task 7's Prisma `select` exactly; `apiRoleAtLeast` defined in Task 13, reused nowhere earlier.
4. **Suite-compat checks baked in:** core-loop registers+assigns a photo before submit (gate-safe); the RBAC matrix pins INSPECTOR (not QA) on `/users`; `aql-preview` route order preserved ahead of `:id`.
