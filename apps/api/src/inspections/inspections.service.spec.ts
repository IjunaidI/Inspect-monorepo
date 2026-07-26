import { InspectionsService } from './inspections.service';
import { AuthUser } from '../auth/auth-user';

const QA: AuthUser = { userId: 'u-qa', orgId: 'org1', role: 'QA_MANAGER', actingAsOrgId: null };

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

describe('InspectionsService — status-change notifications (INS-069)', () => {
  it('submit mails every returned reviewer with the PO + inspection id', async () => {
    const { service, mail, prisma } = makeService({
      loops: [{ zoneName: 'Front', requiredShotCount: 1, _count: { photos: 1 } }],
      users: [{ email: 'qa1@x.com' }, { email: 'owner@x.com' }],
    });
    await service.submit('org1', QA, 'insp1', {});
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId: 'org1',
          status: 'ACTIVE',
          id: { not: QA.userId },
          role: { in: ['QA_MANAGER', 'ORG_OWNER'] },
        }),
      }),
    );
    expect(mail.sendInspectionSubmitted).toHaveBeenCalledTimes(2);
    expect(mail.sendInspectionSubmitted).toHaveBeenCalledWith({ to: 'qa1@x.com', poNumber: 'PO-1', inspectionId: 'insp1' });
  });

  it('decide mails the recipients with the decision', async () => {
    const { service, mail, prisma } = makeService({
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
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId: 'org1',
          status: 'ACTIVE',
          id: { not: 'u-qa' },
          OR: [{ role: 'ORG_OWNER' }, { id: 'u-insp' }],
        }),
      }),
    );
    expect(mail.sendInspectionDecided).toHaveBeenCalledWith({
      to: 'insp@x.com',
      poNumber: 'PO-1',
      inspectionId: 'insp1',
      decision: 'FAIL',
      remarks: 'seams',
    });
  });

  it('decide with no assigned inspector notifies owners only', async () => {
    const { service, prisma } = makeService({
      inspection: {
        id: 'insp1',
        orgId: 'org1',
        status: 'SUBMITTED',
        assignedInspectorId: null,
        purchaseOrder: { poNumber: 'PO-1' },
        aqlResult: { id: 'aql1' },
      },
      users: [{ email: 'owner@x.com' }],
    });
    await service.decide('org1', 'u-qa', 'insp1', { decision: 'PASS', remarks: 'ok' });
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ OR: [{ role: 'ORG_OWNER' }] }) }),
    );
  });
});
