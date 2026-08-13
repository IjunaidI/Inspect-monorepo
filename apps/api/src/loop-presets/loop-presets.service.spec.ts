import { BadRequestException } from '@nestjs/common';
import { LoopPresetsService } from './loop-presets.service';
import { AuthUser } from '../auth/auth-user';

const ACTOR = { userId: 'u1', orgId: 'orgA', role: 'ORG_OWNER' } as unknown as AuthUser;

/**
 * INS-052 honesty guard: the AQL engine implements ISO 2859-1 General Level II
 * only — a preset must not store a level the sampling computation ignores.
 * INS-081: a preset is ONE loop of single-image items; defects and measurement
 * fields are loop-global, not per item.
 */
function makeService(catalog: Array<{ id: string }> = []) {
  const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'p1',
    items: [],
    ...data,
  }));
  const prisma: Record<string, unknown> = {
    defectCatalog: { findMany: jest.fn(async () => catalog) },
    loopPreset: {
      findFirst: jest.fn(async () => null),
      create,
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'p1', ...data })),
    },
  };
  // INS-006: create/archive append their audit row in the same transaction.
  prisma.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  const audit = { append: jest.fn(async () => ({})) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new LoopPresetsService(prisma as any, audit as any);
  return { service, create, audit };
}

const ITEM = { itemName: 'Front' };

describe('LoopPresetsService.create AQL level guard', () => {
  it.each(['I', 'III', 'S1', 'S2', 'S3', 'S4'] as const)(
    'rejects unsupported level %s',
    async (level) => {
      const { service, create } = makeService();
      await expect(
        service.create('orgA', ACTOR, { name: 'P', aqlLevel: level, items: [ITEM] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it('accepts level II', async () => {
    const { service, create } = makeService();
    const preset = await service.create('orgA', ACTOR, {
      name: 'P',
      aqlLevel: 'II',
      items: [ITEM],
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(preset.aqlLevel).toBe('II');
  });

  it('accepts an omitted level (defaults handled downstream)', async () => {
    const { service, create } = makeService();
    await service.create('orgA', ACTOR, { name: 'P', items: [ITEM] });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('LoopPresetsService.create reference-image tenant scoping (security review)', () => {
  it('rejects a referenceImageUrl key outside the org namespace', async () => {
    const { service, create } = makeService();
    await expect(
      service.create('orgA', ACTOR, {
        name: 'P',
        items: [{ ...ITEM, referenceImageUrl: 'orgs/orgB/presets/leaked.jpg' }],
      }),
    ).rejects.toThrow('item 1: referenceImageUrl must be a key under orgs/orgA/presets/');
    expect(create).not.toHaveBeenCalled();
  });

  it('accepts a key under the caller org namespace', async () => {
    const { service, create } = makeService();
    await service.create('orgA', ACTOR, {
      name: 'P',
      items: [{ ...ITEM, referenceImageUrl: 'orgs/orgA/presets/mine.jpg' }],
    });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('create — INS-081 loop-item shape', () => {
  it('rejects a preset with no items', async () => {
    const { service } = makeService();
    await expect(service.create('orgA', ACTOR, { name: 'Tee', items: [] })).rejects.toThrow(
      'at least one loop item is required',
    );
  });

  it('rejects an item with a blank name', async () => {
    const { service } = makeService();
    await expect(
      service.create('orgA', ACTOR, { name: 'Tee', items: [{ itemName: '  ' }] }),
    ).rejects.toThrow('item 1: itemName is required');
  });

  it('rejects a defect id the org cannot reach', async () => {
    const { service } = makeService([]);
    await expect(
      service.create('orgA', ACTOR, {
        name: 'Tee',
        items: [ITEM],
        allowedDefectCatalogIds: ['dc_missing'],
      }),
    ).rejects.toThrow('one or more allowedDefectCatalogIds are not accessible');
  });

  it('numbers items from 1 in submitted order and stores defects loop-global', async () => {
    const { service, create } = makeService([{ id: 'dc_1' }]);
    await service.create('orgA', ACTOR, {
      name: 'Tee',
      items: [{ itemName: 'Right sleeve' }, { itemName: 'Neck hole' }],
      allowedDefectCatalogIds: ['dc_1'],
      measurementFields: [{ label: 'Chest', unit: 'cm' }],
    });
    const data = create.mock.calls[0][0].data as Record<string, any>;
    expect(data.items.create).toEqual([
      expect.objectContaining({ position: 1, itemName: 'Right sleeve' }),
      expect.objectContaining({ position: 2, itemName: 'Neck hole' }),
    ]);
    expect(data.allowedDefects.create).toEqual([{ defectCatalogId: 'dc_1' }]);
    expect(data.measurementFields.create).toEqual([
      expect.objectContaining({ position: 1, label: 'Chest', unit: 'cm' }),
    ]);
  });
});
