import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CompaniesService,
  normalizeGps,
  normalizePrimaryColor,
} from './companies.service';
import { AuthUser } from '../auth/auth-user';

/**
 * INS-055 — `Company` replaces `Buyer` + `Supplier`, so this suite is the union
 * of `buyers.service.spec.ts` and `suppliers.service.spec.ts`, plus the two
 * behaviours that are new to the merged model: `kind` validation and the
 * `_count` flattening across BOTH role edges.
 *
 * The tenant-isolation, INS-077 colour and INS-071 GPS cases are carried over
 * deliberately unchanged in substance — they guard fields that freeze into a
 * signed report, and a port is exactly where that kind of guarantee gets lost.
 */

/** A plain org user acting in their own org. */
const ACTOR = {
  userId: 'u1',
  orgId: 'orgA',
  role: 'ORG_OWNER',
} as unknown as AuthUser;

function makeService(presetInOrg = true) {
  const create = jest.fn(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'c1',
      ...data,
    }),
  );
  const update = jest.fn(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'c1',
      ...data,
    }),
  );
  const prisma: Record<string, unknown> = {
    company: {
      findFirst: jest.fn(async () => ({ id: 'c1', orgId: 'orgA' })),
      create,
      update,
    },
    loopPreset: {
      findFirst: jest.fn(async () => (presetInOrg ? { id: 'p1' } : null)),
    },
  };
  // INS-006: every write runs inside a transaction that also appends the audit
  // row. Handing the same object back as `tx` keeps the delegate mocks
  // observable.
  prisma.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) =>
    fn(prisma),
  );
  const audit = { append: jest.fn(async () => ({})) };

  const service = new CompaniesService(prisma as any, audit as any);
  return { service, create, update, prisma: prisma as any, audit };
}

const dataOf = (mock: jest.Mock) =>
  mock.mock.calls[0][0].data as Record<string, unknown>;

// ── kind (new in INS-055) ────────────────────────────────────────────────────

describe('CompaniesService kind', () => {
  it('defaults to THIRD_PARTY when the caller omits it', async () => {
    const { service, create } = makeService();
    await service.create('orgA', ACTOR, { name: 'ACME' });
    expect(dataOf(create).kind).toBe('THIRD_PARTY');
  });

  it('persists an explicit INTERNAL kind', async () => {
    const { service, create } = makeService();
    await service.create('orgA', ACTOR, { name: 'Our Mill', kind: 'INTERNAL' });
    expect(dataOf(create).kind).toBe('INTERNAL');
  });

  it.each(['PARTNER', 'BUYER', 'internal', '', 'THIRD PARTY'])(
    'rejects the out-of-tuple kind %p with a 400 and writes nothing',
    async (bad) => {
      const { service, create } = makeService();
      await expect(
        service.create('orgA', ACTOR, { name: 'ACME', kind: bad as any }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it('update without kind is a no-change, not a reset to the default', async () => {
    const { service, update } = makeService();
    await service.update('orgA', ACTOR, 'c1', { name: 'ACME Ltd' });
    expect(dataOf(update).kind).toBeUndefined();
  });
});

// ── list aggregates (INS-005, re-shaped for two role edges) ──────────────────

describe('CompaniesService.list aggregates', () => {
  function makeListService(rows: unknown[] = []) {
    const findMany = jest.fn(
      async (_args: { where: Record<string, unknown> }) => rows,
    );
    const audit = { append: jest.fn(async () => ({})) };
    const service = new CompaniesService(
      { company: { findMany } } as any,
      audit as any,
    );
    return { service, findMany };
  }

  it('counts BOTH role edges and defaults to active-only', async () => {
    const { service, findMany } = makeListService();
    await service.list('orgA');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: 'orgA', archivedAt: null },
        include: {
          _count: {
            select: {
              poAsClient: true,
              poAsFactory: true,
              inspAsClient: true,
              inspAsFactory: true,
              reports: true,
            },
          },
        },
      }),
    );
  });

  it('includeArchived drops the archivedAt filter', async () => {
    const { service, findMany } = makeListService();
    await service.list('orgA', { includeArchived: true });
    expect(findMany.mock.calls[0][0].where).toEqual({ orgId: 'orgA' });
  });

  /**
   * The flattening is load-bearing: `Company` has four PO/inspection relations
   * but the wire DTO carries two numbers. Doing it server-side is what stops the
   * console and a future mobile client each inventing their own arithmetic.
   */
  it('flattens the four role-edge counts into the wire shape', async () => {
    const { service } = makeListService([
      {
        id: 'c1',
        name: 'ACME',
        _count: {
          poAsClient: 3,
          poAsFactory: 2,
          inspAsClient: 7,
          inspAsFactory: 1,
          reports: 4,
        },
      },
    ]);
    const [row] = (await service.list('orgA')) as any[];
    expect(row._count).toEqual({
      purchaseOrders: 5,
      inspections: 8,
      reports: 4,
    });
  });

  it('leaves a row without _count untouched', async () => {
    const { service } = makeListService([{ id: 'c1', name: 'ACME' }]);
    const [row] = (await service.list('orgA')) as any[];
    expect(row._count).toBeUndefined();
  });
});

// ── preset tenant scoping (carried over from BuyersService) ──────────────────

describe('CompaniesService preset tenant scoping', () => {
  it('create rejects a defaultLoopPresetId from another org', async () => {
    const { service, create } = makeService(false);
    await expect(
      service.create('orgA', ACTOR, {
        name: 'ACME',
        defaultLoopPresetId: 'p-orgB',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('scopes the preset lookup to the caller org', async () => {
    const { service, prisma } = makeService(true);
    await service.create('orgA', ACTOR, {
      name: 'ACME',
      defaultLoopPresetId: 'p1',
    });
    expect(prisma.loopPreset.findFirst).toHaveBeenCalledWith({
      where: { id: 'p1', orgId: 'orgA' },
      select: { id: true },
    });
  });

  it('create with no preset skips the preset check', async () => {
    const { service, create, prisma } = makeService(true);
    await service.create('orgA', ACTOR, { name: 'ACME' });
    expect(prisma.loopPreset.findFirst).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('update rejects a cross-org preset', async () => {
    const { service, update } = makeService(false);
    await expect(
      service.update('orgA', ACTOR, 'c1', { defaultLoopPresetId: 'p-orgB' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('update allows clearing the preset to null', async () => {
    const { service, update, prisma } = makeService(true);
    await service.update('orgA', ACTOR, 'c1', { defaultLoopPresetId: null });
    expect(prisma.loopPreset.findFirst).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });
});

// ── primaryColor (INS-077) ───────────────────────────────────────────────────

describe('normalizePrimaryColor (INS-077)', () => {
  it('passes through undefined (no change) and null (explicit clear)', () => {
    expect(normalizePrimaryColor(undefined)).toBeUndefined();
    expect(normalizePrimaryColor(null)).toBeNull();
  });

  it('normalises case and trims', () => {
    expect(normalizePrimaryColor('  #FF00aa  ')).toBe('#ff00aa');
  });

  it('treats an empty string as a clear', () => {
    expect(normalizePrimaryColor('')).toBeNull();
  });
});

describe('CompaniesService primaryColor validation (INS-077)', () => {
  it.each([
    'red',
    '#12345',
    '#GGGGGG',
    '#1457A3 ; drop',
    'rgb(1,2,3)',
    '1457A3',
    '#1457A3AA',
  ])('create rejects %p with a 400 and writes nothing', async (bad) => {
    const { service, create } = makeService();
    await expect(
      service.create('orgA', ACTOR, { name: 'ACME', primaryColor: bad }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('create rejects a non-string primaryColor', async () => {
    const { service, create } = makeService();
    await expect(
      service.create('orgA', ACTOR, { name: 'ACME', primaryColor: 123 as any }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('create accepts #RRGGBB and normalises the case', async () => {
    const { service, create } = makeService();
    await service.create('orgA', ACTOR, {
      name: 'ACME',
      primaryColor: '#1457A3',
    });
    expect(dataOf(create).primaryColor).toBe('#1457a3');
  });

  it('update rejects a bad hex before it reaches the DB', async () => {
    const { service, update } = makeService();
    await expect(
      service.update('orgA', ACTOR, 'c1', { primaryColor: 'red' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('update without the field is a no-change (undefined), not a clear', async () => {
    const { service, update } = makeService();
    await service.update('orgA', ACTOR, 'c1', { name: 'ACME Ltd' });
    expect(dataOf(update).primaryColor).toBeUndefined();
  });
});

// ── gps (INS-071) ────────────────────────────────────────────────────────────

describe('normalizeGps (INS-071)', () => {
  it('passes through undefined (no change) and null (explicit clear)', () => {
    expect(normalizeGps(undefined)).toBeUndefined();
    expect(normalizeGps(null)).toBeNull();
  });

  it('accepts valid coordinates and strips extra keys', () => {
    expect(normalizeGps({ lat: 23.8103, lng: 90.4125, note: 'x' })).toEqual({
      lat: 23.8103,
      lng: 90.4125,
    });
  });

  it('accepts the boundary values', () => {
    expect(normalizeGps({ lat: -90, lng: -180 })).toEqual({
      lat: -90,
      lng: -180,
    });
    expect(normalizeGps({ lat: 90, lng: 180 })).toEqual({ lat: 90, lng: 180 });
  });

  it('coerces unambiguous numeric strings (form inputs)', () => {
    expect(normalizeGps({ lat: '11.1085', lng: '77.3411' })).toEqual({
      lat: 11.1085,
      lng: 77.3411,
    });
  });

  it.each([
    ['a shapeless object', { foo: 1 }],
    ['a missing lng', { lat: 10 }],
    ['a missing lat', { lng: 10 }],
    ['a non-numeric string', { lat: 'north', lng: '5' }],
    ['an empty string', { lat: '', lng: '' }],
    ['NaN', { lat: NaN, lng: 0 }],
    ['Infinity', { lat: 0, lng: Infinity }],
    ['null members', { lat: null, lng: null }],
    ['a string body', 'lat=1,lng=2'],
    ['an array', [1, 2]],
    ['a number', 42],
  ])('rejects %s with a 400', (_label, value) => {
    expect(() => normalizeGps(value)).toThrow(BadRequestException);
  });

  it('rejects out-of-range coordinates', () => {
    expect(() => normalizeGps({ lat: 999, lng: 0 })).toThrow(
      BadRequestException,
    );
    expect(() => normalizeGps({ lat: -90.1, lng: 0 })).toThrow(
      BadRequestException,
    );
    expect(() => normalizeGps({ lat: 0, lng: 180.5 })).toThrow(
      BadRequestException,
    );
    expect(() => normalizeGps({ lat: 0, lng: -200 })).toThrow(
      BadRequestException,
    );
  });
});

describe('CompaniesService gps write path (INS-071)', () => {
  it('create persists canonical coordinates', async () => {
    const { service, create } = makeService();
    await service.create('orgA', ACTOR, {
      name: 'Mill',
      gps: { lat: 11.1085, lng: 77.3411 },
    });
    expect(dataOf(create).gps).toEqual({ lat: 11.1085, lng: 77.3411 });
  });

  it('create rejects bad input instead of silently dropping it', async () => {
    const { service, create } = makeService();
    await expect(
      service.create('orgA', ACTOR, { name: 'Mill', gps: { foo: 1 } as any }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('create without gps leaves the column unset', async () => {
    const { service, create } = makeService();
    await service.create('orgA', ACTOR, { name: 'Mill' });
    expect(dataOf(create).gps).toBeUndefined();
  });

  it('update rejects an out-of-range lat before touching the DB', async () => {
    const { service, update } = makeService();
    await expect(
      service.update('orgA', ACTOR, 'c1', { gps: { lat: 999, lng: 0 } }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('update with gps null clears the column via Prisma.DbNull', async () => {
    const { service, update } = makeService();
    await service.update('orgA', ACTOR, 'c1', { gps: null });
    expect(dataOf(update).gps).toBe(Prisma.DbNull);
  });

  it('update without gps is a no-change, not a clear', async () => {
    const { service, update } = makeService();
    await service.update('orgA', ACTOR, 'c1', { name: 'Mill 2' });
    expect(dataOf(update).gps).toBeUndefined();
  });
});

// ── audit-on-write (INS-006 / INS-079) ───────────────────────────────────────

describe('CompaniesService create/update audit (INS-006)', () => {
  it('create appends exactly one audit row inside the write transaction', async () => {
    const { service, audit, prisma, create } = makeService();
    await service.create('orgA', ACTOR, { name: 'ACME' });

    expect(create).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(audit.append).toHaveBeenCalledTimes(1);
    const [entry, tx] = audit.append.mock.calls[0] as unknown as [
      Record<string, unknown>,
      unknown,
    ];
    expect(entry).toMatchObject({
      orgId: 'orgA',
      actorType: 'USER',
      actorUserId: 'u1',
      action: 'company.created',
      entityType: 'Company',
      entityId: 'c1',
    });
    // The second argument is the transaction client — that is what makes the
    // audit row atomic with the business write.
    expect(tx).toBeDefined();
  });

  it('update appends one audit row naming the supplied fields', async () => {
    const { service, audit } = makeService();
    await service.update('orgA', ACTOR, 'c1', {
      name: 'ACME Ltd',
      primaryColor: '#1457A3',
    });

    expect(audit.append).toHaveBeenCalledTimes(1);
    const [entry] = audit.append.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(entry).toMatchObject({
      action: 'company.updated',
      entityType: 'Company',
      entityId: 'c1',
      metadata: { fields: ['name', 'primaryColor'] },
    });
  });

  it('a rejected write appends nothing', async () => {
    const { service, audit } = makeService(false);
    await expect(
      service.create('orgA', ACTOR, {
        name: 'ACME',
        defaultLoopPresetId: 'p-orgB',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(audit.append).not.toHaveBeenCalled();
  });
});

describe('CompaniesService archive/restore (INS-061)', () => {
  const OWNER = {
    userId: 'u1',
    orgId: 'org1',
    role: 'ORG_OWNER' as const,
    actingAsOrgId: null,
  };
  // INS-079: a Platform Admin operating inside an assumed org must be attributed
  // as PLATFORM_ADMIN in the audit chain, not as an ordinary org member.
  const PLATFORM_ADMIN_ACTOR = {
    userId: 'admin1',
    orgId: 'org1',
    role: 'PLATFORM_ADMIN' as const,
    actingAsOrgId: 'org1',
  };

  function makeArchiveService(row: {
    id: string;
    orgId: string;
    archivedAt: Date | null;
  }) {
    const update = jest.fn(
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...row,
        ...data,
      }),
    );
    const tx = { company: { update } };
    const prisma = {
      company: { findFirst: jest.fn(async () => row), update },
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
        fn(tx),
      ),
    };
    const audit = { append: jest.fn(async () => ({})) };
    const service = new CompaniesService(prisma as any, audit as any);
    return { service, prisma, audit, update };
  }

  it('restore clears archivedAt and appends an audit row', async () => {
    const { service, audit, update } = makeArchiveService({
      id: 'c1',
      orgId: 'org1',
      archivedAt: new Date(),
    });
    const out = await service.restore('org1', OWNER as any, 'c1');
    expect(out.archivedAt).toBeNull();
    expect(update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { archivedAt: null },
    });
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'company.restored',
        entityId: 'c1',
        actorType: 'USER',
        actorUserId: OWNER.userId,
      }),
      expect.anything(),
    );
  });

  // INS-079: without actorTypeFor wired into the call site this regresses
  // silently — a literal 'USER' still satisfies every other assertion above.
  it('restore attributes PLATFORM_ADMIN when the actor acts inside an assumed org', async () => {
    const { service, audit } = makeArchiveService({
      id: 'c1',
      orgId: 'org1',
      archivedAt: new Date(),
    });
    await service.restore('org1', PLATFORM_ADMIN_ACTOR as any, 'c1');
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'company.restored',
        actorType: 'PLATFORM_ADMIN',
        actorUserId: PLATFORM_ADMIN_ACTOR.userId,
      }),
      expect.anything(),
    );
  });

  it('re-archiving an archived company preserves the original timestamp', async () => {
    const when = new Date('2026-07-01T00:00:00Z');
    const { service, update } = makeArchiveService({
      id: 'c1',
      orgId: 'org1',
      archivedAt: when,
    });
    const out = await service.archive('org1', OWNER as any, 'c1');
    expect(out.archivedAt).toEqual(when);
    expect(update).not.toHaveBeenCalled();
  });
});
