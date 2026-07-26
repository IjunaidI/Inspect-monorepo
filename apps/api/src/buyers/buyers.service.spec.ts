import { BadRequestException } from '@nestjs/common';
import { BuyersService } from './buyers.service';

/**
 * Regression coverage for the tenant-isolation fix (security review, 2026-07-11):
 * a buyer's defaultLoopPresetId must reference a preset in the caller's own org.
 */
function makeService(presetInOrg: boolean) {
  const buyerCreate = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'b1', ...data }));
  const buyerUpdate = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'b1', ...data }));
  const prisma = {
    buyer: {
      findFirst: jest.fn(async () => ({ id: 'b1', orgId: 'orgA' })),
      create: buyerCreate,
      update: buyerUpdate,
    },
    loopPreset: {
      findFirst: jest.fn(async () => (presetInOrg ? { id: 'p1' } : null)),
    },
  };
  const audit = { append: jest.fn(async () => ({})) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new BuyersService(prisma as any, audit as any);
  return { service, buyerCreate, buyerUpdate, prisma };
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
      service.create('orgA', 'u1', { name: 'ACME', defaultLoopPresetId: 'p-orgB' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(buyerCreate).not.toHaveBeenCalled();
  });

  it('create accepts a same-org preset', async () => {
    const { service, buyerCreate } = makeService(true);
    await service.create('orgA', 'u1', { name: 'ACME', defaultLoopPresetId: 'p1' });
    expect(buyerCreate).toHaveBeenCalledTimes(1);
  });

  it('create with no preset skips the preset check', async () => {
    const { service, buyerCreate, prisma } = makeService(true);
    await service.create('orgA', 'u1', { name: 'ACME' });
    expect(prisma.loopPreset.findFirst).not.toHaveBeenCalled();
    expect(buyerCreate).toHaveBeenCalledTimes(1);
  });

  it('update rejects a cross-org preset', async () => {
    const { service, buyerUpdate } = makeService(false);
    await expect(
      service.update('orgA', 'b1', { defaultLoopPresetId: 'p-orgB' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(buyerUpdate).not.toHaveBeenCalled();
  });

  it('update allows clearing the preset to null', async () => {
    const { service, buyerUpdate, prisma } = makeService(true);
    await service.update('orgA', 'b1', { defaultLoopPresetId: null });
    expect(prisma.loopPreset.findFirst).not.toHaveBeenCalled();
    expect(buyerUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('BuyersService archive/restore (INS-061)', () => {
  const ACTOR = { userId: 'u1', orgId: 'org1', role: 'ORG_OWNER' as const, actingAsOrgId: null };

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
