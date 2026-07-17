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
