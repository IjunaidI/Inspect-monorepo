import { BadRequestException } from '@nestjs/common';
import { LoopPresetsService } from './loop-presets.service';
import { AuthUser } from '../auth/auth-user';

/**
 * INS-097 — `capturePointId` on a preset item is a LINEAGE to the library, and
 * like `allowedDefectCatalogIds` it must resolve to a row this org can see (a
 * global entry or its own). It is persisted on the item and joined back on
 * GET /loop-presets/:id, but never reaches the inspection snapshot — that half
 * is pinned in inspection-mapping.spec.ts.
 */

const ACTOR = {
  userId: 'u1',
  orgId: 'orgA',
  role: 'QA_MANAGER',
} as unknown as AuthUser;

function makeService(accessiblePoints: Array<{ id: string }>) {
  const create = jest.fn(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'p1',
      items: [],
      ...data,
    }),
  );
  const capturePointFindMany = jest.fn(async () => accessiblePoints);
  const loopPresetFindFirst = jest.fn(async () => null);
  const prisma: Record<string, unknown> = {
    defectCatalog: { findMany: jest.fn(async () => []) },
    capturePoint: { findMany: capturePointFindMany },
    loopPreset: { findFirst: loopPresetFindFirst, create },
  };
  prisma.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) =>
    fn(prisma),
  );
  const audit = { append: jest.fn(async () => ({})) };
  const service = new LoopPresetsService(prisma as any, audit as any);
  return { service, create, capturePointFindMany, loopPresetFindFirst };
}

describe('LoopPresetsService.create — capture-point lineage (INS-097)', () => {
  it('rejects an id the org cannot see (another org, or nonexistent)', async () => {
    const h = makeService([]); // the accessibility query finds nothing
    await expect(
      h.service.create('orgA', ACTOR, {
        name: 'P',
        items: [{ itemName: 'Right sleeve', capturePointId: 'cp-foreign' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.create).not.toHaveBeenCalled();

    const where = (
      h.capturePointFindMany.mock.calls[0] as unknown as [
        { where: Record<string, unknown> },
      ]
    )[0].where;
    expect(where.OR).toEqual([{ orgId: 'orgA' }, { orgId: null }]);
    expect(where.id).toEqual({ in: ['cp-foreign'] });
  });

  it('persists the lineage on the item and nulls it when absent', async () => {
    const h = makeService([{ id: 'cp-sleeve' }]);
    await h.service.create('orgA', ACTOR, {
      name: 'P',
      items: [
        { itemName: 'Right sleeve', capturePointId: 'cp-sleeve' },
        { itemName: 'Custom free text' },
      ],
    });
    const data = (
      h.create.mock.calls[0][0] as {
        data: { items: { create: Array<Record<string, unknown>> } };
      }
    ).data;
    expect(data.items.create).toEqual([
      expect.objectContaining({
        position: 1,
        itemName: 'Right sleeve',
        capturePointId: 'cp-sleeve',
      }),
      expect.objectContaining({
        position: 2,
        itemName: 'Custom free text',
        capturePointId: null,
      }),
    ]);
  });

  it('does not query the library at all when no item carries a lineage', async () => {
    const h = makeService([]);
    await h.service.create('orgA', ACTOR, {
      name: 'P',
      items: [{ itemName: 'Front' }],
    });
    expect(h.capturePointFindMany).not.toHaveBeenCalled();
    expect(h.create).toHaveBeenCalledTimes(1);
  });

  it('dedupes repeated ids before checking accessibility', async () => {
    const h = makeService([{ id: 'cp-sleeve' }]);
    await h.service.create('orgA', ACTOR, {
      name: 'P',
      items: [
        { itemName: 'Left sleeve', capturePointId: 'cp-sleeve' },
        { itemName: 'Right sleeve', capturePointId: 'cp-sleeve' },
      ],
    });
    const where = (
      h.capturePointFindMany.mock.calls[0] as unknown as [
        { where: Record<string, unknown> },
      ]
    )[0].where;
    expect(where.id).toEqual({ in: ['cp-sleeve'] });
    expect(h.create).toHaveBeenCalledTimes(1);
  });
});
