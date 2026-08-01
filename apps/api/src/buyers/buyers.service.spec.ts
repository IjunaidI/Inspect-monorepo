import { BadRequestException } from '@nestjs/common';
import { BuyersService } from './buyers.service';
import { AuthUser } from '../auth/auth-user';

/** A plain org user acting in their own org. */
const ACTOR = { userId: 'u1', orgId: 'orgA', role: 'ORG_OWNER' } as unknown as AuthUser;

/**
 * Regression coverage for the tenant-isolation fix (security review, 2026-07-11):
 * a buyer's defaultLoopPresetId must reference a preset in the caller's own org.
 */
function makeService(presetInOrg: boolean) {
  const buyerCreate = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'b1', ...data }));
  const buyerUpdate = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'b1', ...data }));
  const prisma: Record<string, unknown> = {
    buyer: {
      findFirst: jest.fn(async () => ({ id: 'b1', orgId: 'orgA' })),
      create: buyerCreate,
      update: buyerUpdate,
    },
    loopPreset: {
      findFirst: jest.fn(async () => (presetInOrg ? { id: 'p1' } : null)),
    },
  };
  // INS-006: every write now runs inside a transaction that also appends the
  // audit row. Handing the same object back as `tx` keeps the delegate mocks
  // (buyerCreate/buyerUpdate) observable exactly as before.
  prisma.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  const audit = { append: jest.fn(async () => ({})) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new BuyersService(prisma as any, audit as any);
  return { service, buyerCreate, buyerUpdate, prisma: prisma as any, audit };
}

describe('BuyersService.list aggregates (INS-005)', () => {
  function makeListService() {
    const findMany = jest.fn(async (_args: { where: Record<string, unknown> }) => []);
    const audit = { append: jest.fn(async () => ({})) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new BuyersService({ buyer: { findMany } } as any, audit as any);
    return { service, findMany };
  }

  it('includes relation _count and defaults to active-only', async () => {
    const { service, findMany } = makeListService();
    await service.list('orgA');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: 'orgA', archivedAt: null },
        include: {
          _count: {
            select: { purchaseOrders: true, inspections: true, reports: true },
          },
        },
      }),
    );
  });

  it('includeArchived drops the archivedAt filter', async () => {
    const { service, findMany } = makeListService();
    await service.list('orgA', { includeArchived: true });
    const arg = findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ orgId: 'orgA' });
  });
});

describe('BuyersService preset tenant scoping', () => {
  it('create rejects a defaultLoopPresetId from another org', async () => {
    const { service, buyerCreate } = makeService(false);
    await expect(
      service.create('orgA', ACTOR, { name: 'ACME', defaultLoopPresetId: 'p-orgB' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(buyerCreate).not.toHaveBeenCalled();
  });

  it('create accepts a same-org preset', async () => {
    const { service, buyerCreate } = makeService(true);
    await service.create('orgA', ACTOR, { name: 'ACME', defaultLoopPresetId: 'p1' });
    expect(buyerCreate).toHaveBeenCalledTimes(1);
  });

  it('create with no preset skips the preset check', async () => {
    const { service, buyerCreate, prisma } = makeService(true);
    await service.create('orgA', ACTOR, { name: 'ACME' });
    expect(prisma.loopPreset.findFirst).not.toHaveBeenCalled();
    expect(buyerCreate).toHaveBeenCalledTimes(1);
  });

  it('update rejects a cross-org preset', async () => {
    const { service, buyerUpdate } = makeService(false);
    await expect(
      service.update('orgA', ACTOR, 'b1', { defaultLoopPresetId: 'p-orgB' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(buyerUpdate).not.toHaveBeenCalled();
  });

  it('update allows clearing the preset to null', async () => {
    const { service, buyerUpdate, prisma } = makeService(true);
    await service.update('orgA', ACTOR, 'b1', { defaultLoopPresetId: null });
    expect(prisma.loopPreset.findFirst).not.toHaveBeenCalled();
    expect(buyerUpdate).toHaveBeenCalledTimes(1);
  });
});

/**
 * INS-077: primaryColor freezes into the signed report's brandingSnapshot, so an
 * unvalidated value becomes permanent garbage in a tamper-proof artifact.
 */
describe('BuyersService primaryColor validation (INS-077)', () => {
  const dataOf = (mock: jest.Mock) => mock.mock.calls[0][0].data as Record<string, unknown>;

  it.each(['red', '#12345', '#GGGGGG', '#1457A3 ; drop', 'rgb(1,2,3)', '1457A3', '#1457A3AA'])(
    'create rejects %p with a 400 and writes nothing',
    async (bad) => {
      const { service, buyerCreate } = makeService(true);
      await expect(service.create('orgA', ACTOR, { name: 'ACME', primaryColor: bad })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(buyerCreate).not.toHaveBeenCalled();
    },
  );

  it('create rejects a non-string primaryColor', async () => {
    const { service, buyerCreate } = makeService(true);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      service.create('orgA', ACTOR, { name: 'ACME', primaryColor: 123 as any }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(buyerCreate).not.toHaveBeenCalled();
  });

  it('create accepts #RRGGBB and normalises the case', async () => {
    const { service, buyerCreate } = makeService(true);
    await service.create('orgA', ACTOR, { name: 'ACME', primaryColor: '#1457A3' });
    expect(dataOf(buyerCreate).primaryColor).toBe('#1457a3');
  });

  it('create with no primaryColor leaves the column untouched', async () => {
    const { service, buyerCreate } = makeService(true);
    await service.create('orgA', ACTOR, { name: 'ACME' });
    expect(dataOf(buyerCreate).primaryColor).toBeUndefined();
  });

  it('update rejects a bad hex before it reaches the DB', async () => {
    const { service, buyerUpdate } = makeService(true);
    await expect(service.update('orgA', ACTOR, 'b1', { primaryColor: 'red' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(buyerUpdate).not.toHaveBeenCalled();
  });

  it('update normalises a valid hex', async () => {
    const { service, buyerUpdate } = makeService(true);
    await service.update('orgA', ACTOR, 'b1', { primaryColor: '  #FF00aa  ' });
    expect(dataOf(buyerUpdate).primaryColor).toBe('#ff00aa');
  });

  it('update clears the colour on an empty string / null', async () => {
    const { service, buyerUpdate } = makeService(true);
    await service.update('orgA', ACTOR, 'b1', { primaryColor: '' });
    expect(dataOf(buyerUpdate).primaryColor).toBeNull();

    const second = makeService(true);
    await second.service.update('orgA', ACTOR, 'b1', { primaryColor: null });
    expect(dataOf(second.buyerUpdate).primaryColor).toBeNull();
  });

  it('update without the field is a no-change (undefined), not a clear', async () => {
    const { service, buyerUpdate } = makeService(true);
    await service.update('orgA', ACTOR, 'b1', { name: 'ACME Ltd' });
    expect(dataOf(buyerUpdate).primaryColor).toBeUndefined();
  });
});

/**
 * INS-006 — audit-on-write. Before this, buyers/suppliers/products audited only
 * archive+restore, so the create/update paths mutated tenant data with no entry
 * in the hash-chained trail at all. The row must be appended INSIDE the business
 * transaction, or the chain can record a write that later rolled back.
 */
describe('BuyersService create/update audit (INS-006)', () => {
  it('create appends exactly one audit row inside the write transaction', async () => {
    const { service, audit, prisma, buyerCreate } = makeService(true);
    await service.create('orgA', ACTOR, { name: 'ACME' });

    expect(buyerCreate).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(audit.append).toHaveBeenCalledTimes(1);
    const [entry, tx] = audit.append.mock.calls[0] as unknown as [Record<string, unknown>, unknown];
    expect(entry).toMatchObject({
      orgId: 'orgA',
      actorType: 'USER',
      actorUserId: 'u1',
      action: 'buyer.created',
      entityType: 'Buyer',
      entityId: 'b1',
    });
    // The second argument is the transaction client — that is what makes the
    // audit row atomic with the business write.
    expect(tx).toBeDefined();
  });

  it('update appends one audit row naming the supplied fields', async () => {
    const { service, audit } = makeService(true);
    await service.update('orgA', ACTOR, 'b1', { name: 'ACME Ltd', primaryColor: '#1457A3' });

    expect(audit.append).toHaveBeenCalledTimes(1);
    const [entry] = audit.append.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(entry).toMatchObject({
      action: 'buyer.updated',
      entityType: 'Buyer',
      entityId: 'b1',
      metadata: { fields: ['name', 'primaryColor'] },
    });
  });

  it('a rejected write appends nothing', async () => {
    const { service, audit } = makeService(false);
    await expect(
      service.create('orgA', ACTOR, { name: 'ACME', defaultLoopPresetId: 'p-orgB' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(audit.append).not.toHaveBeenCalled();
  });
});

describe('BuyersService archive/restore (INS-061)', () => {
  const ACTOR = { userId: 'u1', orgId: 'org1', role: 'ORG_OWNER' as const, actingAsOrgId: null };
  // INS-079: a Platform Admin operating inside an assumed org must be attributed
  // as PLATFORM_ADMIN in the audit chain, not as an ordinary org member.
  const PLATFORM_ADMIN_ACTOR = {
    userId: 'admin1',
    orgId: 'org1',
    role: 'PLATFORM_ADMIN' as const,
    actingAsOrgId: 'org1',
  };

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
      expect.objectContaining({
        action: 'buyer.restored',
        entityId: 'b1',
        actorType: 'USER',
        actorUserId: ACTOR.userId,
      }),
      expect.anything(),
    );
  });

  // INS-079: without actorTypeFor wired into the call site, this regresses
  // silently — the literal 'USER' still satisfies every other assertion above.
  it('restore attributes actorType PLATFORM_ADMIN when the actor is acting inside an assumed org', async () => {
    const { service, audit } = makeArchiveService({ id: 'b1', orgId: 'org1', archivedAt: new Date() });
    await service.restore('org1', PLATFORM_ADMIN_ACTOR, 'b1');
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'buyer.restored',
        actorType: 'PLATFORM_ADMIN',
        actorUserId: PLATFORM_ADMIN_ACTOR.userId,
      }),
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
