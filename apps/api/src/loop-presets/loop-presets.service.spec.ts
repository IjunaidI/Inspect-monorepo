import { BadRequestException } from '@nestjs/common';
import { LoopPresetsService } from './loop-presets.service';
import { AuthUser } from '../auth/auth-user';

const ACTOR = { userId: 'u1', orgId: 'orgA', role: 'ORG_OWNER' } as unknown as AuthUser;

/**
 * INS-052 honesty guard: the AQL engine implements ISO 2859-1 General Level II
 * only — a preset must not store a level the sampling computation ignores.
 */
function makeService() {
  const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'p1',
    steps: [],
    ...data,
  }));
  const prisma: Record<string, unknown> = {
    defectCatalog: { findMany: jest.fn(async () => []) },
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

const STEP = { zoneName: 'Front', requiredShotCount: 1 };

describe('LoopPresetsService.create AQL level guard', () => {
  it.each(['I', 'III', 'S1', 'S2', 'S3', 'S4'] as const)(
    'rejects unsupported level %s',
    async (level) => {
      const { service, create } = makeService();
      await expect(
        service.create('orgA', ACTOR, { name: 'P', aqlLevel: level, steps: [STEP] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it('accepts level II', async () => {
    const { service, create } = makeService();
    const preset = await service.create('orgA', ACTOR, {
      name: 'P',
      aqlLevel: 'II',
      steps: [STEP],
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(preset.aqlLevel).toBe('II');
  });

  it('accepts an omitted level (defaults handled downstream)', async () => {
    const { service, create } = makeService();
    await service.create('orgA', ACTOR, { name: 'P', steps: [STEP] });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('LoopPresetsService.create reference-image tenant scoping (security review)', () => {
  it('rejects a referenceImageUrls key outside the org namespace', async () => {
    const { service, create } = makeService();
    await expect(
      service.create('orgA', ACTOR, {
        name: 'P',
        steps: [{ ...STEP, referenceImageUrls: ['orgs/orgB/presets/leaked.jpg'] }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('accepts a key under the caller org namespace', async () => {
    const { service, create } = makeService();
    await service.create('orgA', ACTOR, {
      name: 'P',
      steps: [{ ...STEP, referenceImageUrls: ['orgs/orgA/presets/mine.jpg'] }],
    });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
