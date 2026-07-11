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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new BuyersService(prisma as any);
  return { service, buyerCreate, buyerUpdate, prisma };
}

describe('BuyersService.list aggregates (INS-005)', () => {
  function makeListService() {
    const findMany = jest.fn(async (_args: { where: Record<string, unknown> }) => []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new BuyersService({ buyer: { findMany } } as any);
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
