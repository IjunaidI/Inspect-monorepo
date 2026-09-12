import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  CapturePointsService,
  normalizeCapturePointName,
} from './capture-points.service';
import { AuthUser } from '../auth/auth-user';

/**
 * INS-097 — the capture-point library, as a pure unit spec (Prisma + Audit
 * mocked, no DB). Mirrors defect-catalog.service.spec.ts because the model
 * mirrors DefectCatalog. What matters:
 *   1. the hybrid visibility rule (global + this org, never another org's) — a
 *      tenant boundary;
 *   2. find-or-create semantics: a name that already exists is RETURNED, not
 *      duplicated and not 409'd — that is what makes "custom becomes library"
 *      idempotent from the builder;
 *   3. the cross-tenant / global guard on archive;
 *   4. audit rows inside the business transaction (INS-006).
 */

const ORG = 'org-1';
const OTHER_ORG = 'org-2';

const ACTOR = {
  userId: 'u-qa',
  orgId: ORG,
  role: 'QA_MANAGER',
  actingAsOrgId: null,
} as AuthUser;

function makeService(
  opts: {
    existing?: Record<string, unknown> | null;
    createError?: Error | null;
  } = {},
) {
  const { existing = null, createError = null } = opts;

  const findMany = jest.fn(async (_args?: { where?: unknown }) => []);
  const create = jest.fn(
    async ({ data }: { data: Record<string, unknown> }) => {
      if (createError) throw createError;
      return { id: 'cp-new', ...data };
    },
  );
  const update = jest.fn(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'cp-1',
      ...data,
    }),
  );
  const findFirst = jest.fn(async () => existing);
  const append = jest.fn(async () => undefined);

  const tx = { capturePoint: { create, update } };
  const prisma = {
    capturePoint: { findMany, findFirst, create, update },
    $transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) =>
      fn(tx),
    ),
  } as unknown as ConstructorParameters<typeof CapturePointsService>[0];
  const audit = { append } as unknown as ConstructorParameters<
    typeof CapturePointsService
  >[1];

  return {
    service: new CapturePointsService(prisma, audit),
    findMany,
    findFirst,
    create,
    update,
    append,
  };
}

describe('normalizeCapturePointName', () => {
  it('trims and collapses whitespace; anything else is empty', () => {
    expect(normalizeCapturePointName('  Hem  tape   close-up ')).toBe(
      'Hem tape close-up',
    );
    expect(normalizeCapturePointName(undefined)).toBe('');
    expect(normalizeCapturePointName(42)).toBe('');
  });
});

describe('CapturePointsService.list', () => {
  it('returns the global library plus this org, nothing archived, in category order', () => {
    const h = makeService();
    h.service.list(ORG);

    const args = h.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      orderBy: unknown;
    };
    expect(args.where.OR).toEqual([{ orgId: ORG }, { orgId: null }]);
    expect(args.where.isArchived).toBe(false);
    expect(JSON.stringify(args.where)).not.toContain(OTHER_ORG);
    expect(args.orderBy).toEqual([
      { category: 'asc' },
      { scope: 'desc' },
      { name: 'asc' },
    ]);
  });

  it('filters by category and by a case-insensitive name query; includeArchived drops the archive filter', () => {
    const h = makeService();
    h.service.list(ORG, {
      category: 'TOP',
      q: 'sleeve',
      includeArchived: true,
    });

    const where = (
      h.findMany.mock.calls[0][0] as { where: Record<string, unknown> }
    ).where;
    expect(where.category).toBe('TOP');
    expect(where.name).toEqual({ contains: 'sleeve', mode: 'insensitive' });
    expect(where).not.toHaveProperty('isArchived');
  });
});

describe('CapturePointsService.findOrCreate', () => {
  it('rejects a blank name and an unknown category before touching the DB', async () => {
    const h = makeService();
    await expect(
      h.service.findOrCreate(ORG, ACTOR, { name: '   ', category: 'TOP' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      h.service.findOrCreate(ORG, ACTOR, {
        name: 'Hem tape',
        category: 'SHOES' as never,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.findFirst).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });

  it('returns an existing row (global or org) matched case- and space-insensitively, without creating', async () => {
    const existing = {
      id: 'cp-global-hem',
      scope: 'GLOBAL',
      orgId: null,
      name: 'Hem',
    };
    const h = makeService({ existing });

    const out = await h.service.findOrCreate(ORG, ACTOR, {
      name: '  hem ',
      category: 'TOP',
    });

    expect(out).toBe(existing);
    const where = (
      h.findFirst.mock.calls[0] as unknown as [
        { where: Record<string, unknown> },
      ]
    )[0].where;
    expect(where.name).toEqual({ equals: 'hem', mode: 'insensitive' });
    expect(where.OR).toEqual([{ orgId: ORG }, { orgId: null }]);
    expect(where.isArchived).toBe(false);
    expect(h.create).not.toHaveBeenCalled();
    expect(h.append).not.toHaveBeenCalled();
  });

  it('creates an ORG row with the normalised name and audits inside the transaction', async () => {
    const h = makeService();

    const out = await h.service.findOrCreate(ORG, ACTOR, {
      name: ' Hem  tape close-up ',
      category: 'TOP',
      description: '  Close-up of the hem tape stitching ',
      iconKey: 'hem',
    });

    expect(h.create).toHaveBeenCalledTimes(1);
    const data = (
      h.create.mock.calls[0][0] as { data: Record<string, unknown> }
    ).data;
    expect(data).toMatchObject({
      scope: 'ORG',
      orgId: ORG,
      name: 'Hem tape close-up',
      category: 'TOP',
      description: 'Close-up of the hem tape stitching',
      iconKey: 'hem',
      createdByUserId: ACTOR.userId,
    });
    expect(out).toMatchObject({ id: 'cp-new', name: 'Hem tape close-up' });

    expect(h.append).toHaveBeenCalledTimes(1);
    const [entry, tx] = h.append.mock.calls[0] as unknown as [
      Record<string, unknown>,
      unknown,
    ];
    expect(entry).toMatchObject({
      orgId: ORG,
      action: 'capturePoint.created',
      entityType: 'CapturePoint',
      entityId: 'cp-new',
      metadata: { name: 'Hem tape close-up', category: 'TOP' },
    });
    expect(tx).toBeDefined(); // the transaction client, not the root prisma
  });

  it('converges on the winner when the unique index races (P2002)', async () => {
    const err = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
    });
    const h = makeService({ createError: err });
    // First findFirst (pre-check) sees nothing; the post-race lookup finds the winner.
    const winner = {
      id: 'cp-winner',
      scope: 'ORG',
      orgId: ORG,
      name: 'Hem tape',
    };
    h.findFirst
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(winner as never);

    const out = await h.service.findOrCreate(ORG, ACTOR, {
      name: 'Hem tape',
      category: 'TOP',
    });

    expect(out).toBe(winner);
    expect(h.findFirst).toHaveBeenCalledTimes(2);
  });

  it('rethrows anything that is not a unique-constraint race', async () => {
    const h = makeService({ createError: new Error('connection reset') });
    await expect(
      h.service.findOrCreate(ORG, ACTOR, { name: 'Hem tape', category: 'TOP' }),
    ).rejects.toThrow('connection reset');
  });
});

describe('CapturePointsService.archive', () => {
  it('404s an unknown id', async () => {
    const h = makeService({ existing: null });
    await expect(h.service.archive(ORG, ACTOR, 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("refuses a GLOBAL row and another org's row alike", async () => {
    const global = makeService({
      existing: { id: 'cp-g', orgId: null, scope: 'GLOBAL', name: 'Hem' },
    });
    await expect(
      global.service.archive(ORG, ACTOR, 'cp-g'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const foreign = makeService({
      existing: {
        id: 'cp-f',
        orgId: OTHER_ORG,
        scope: 'ORG',
        name: 'Their point',
      },
    });
    await expect(
      foreign.service.archive(ORG, ACTOR, 'cp-f'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(global.update).not.toHaveBeenCalled();
    expect(foreign.update).not.toHaveBeenCalled();
  });

  it("soft-archives this org's row and audits inside the transaction", async () => {
    const h = makeService({
      existing: { id: 'cp-1', orgId: ORG, scope: 'ORG', name: 'Hem tape' },
    });
    const out = await h.service.archive(ORG, ACTOR, 'cp-1');

    expect(h.update).toHaveBeenCalledWith({
      where: { id: 'cp-1' },
      data: { isArchived: true },
    });
    expect(out).toMatchObject({ isArchived: true });
    expect(h.append).toHaveBeenCalledTimes(1);
    const [archiveEntry] = h.append.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(archiveEntry).toMatchObject({
      action: 'capturePoint.archived',
      entityType: 'CapturePoint',
      entityId: 'cp-1',
      metadata: { name: 'Hem tape' },
    });
  });
});
