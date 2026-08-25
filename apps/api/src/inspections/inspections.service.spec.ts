import { BadRequestException } from '@nestjs/common';
import { InspectionsService } from './inspections.service';
import { AuthUser } from '../auth/auth-user';

const QA: AuthUser = {
  userId: 'u-qa',
  orgId: 'org1',
  role: 'QA_MANAGER',
  actingAsOrgId: null,
};
// INS-079: a Platform Admin operating inside an assumed org must be attributed
// as PLATFORM_ADMIN in the audit chain, not as an ordinary org member.
const PLATFORM_ADMIN_ACTOR: AuthUser = {
  userId: 'u-admin',
  orgId: 'org1',
  role: 'PLATFORM_ADMIN',
  actingAsOrgId: 'org1',
};

/** INS-081 default: a single-item loop with one complete cycle, so tests that
 *  are not about the completeness gate can submit without restating evidence. */
const DEFAULT_ITEMS = [{ id: 'i1', position: 1, itemName: 'Front' }];
const DEFAULT_PHOTOS = [{ inspectionLoopItemId: 'i1', cycleIndex: 0 }];

interface MakeOpts {
  inspection?: Record<string, unknown>;
  items?: Array<{ id: string; position: number; itemName: string }>;
  photos?: Array<{ inspectionLoopItemId: string; cycleIndex: number }>;
  users?: Array<{ email: string }>;
  /** Defect rows as prisma.defectInstance.groupBy returns them (drives the AQL verdict). */
  defects?: Array<{ severity: string; _count: { _all: number } }>;
  /** A BillableEvent already on the inspection (INS-018 linkage guard). */
  billableEvent?: { kind: string } | null;
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
      findUnique: jest.fn(async () => ({
        id: 'insp1',
        status: 'SUBMITTED',
        aqlResult: { systemRecommendation: 'PASS' },
      })),
    },
    aqlResult: {
      upsert: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
    },
    billableEvent: {
      findUnique: jest.fn(async () => opts.billableEvent ?? null),
      create: jest.fn(async () => ({})),
    },
  };
  const prisma = {
    inspection: { findFirst: jest.fn(async () => inspection) },
    inspectionLoopItem: {
      findMany: jest.fn(async () => opts.items ?? DEFAULT_ITEMS),
    },
    photo: { findMany: jest.fn(async () => opts.photos ?? DEFAULT_PHOTOS) },
    defectInstance: { groupBy: jest.fn(async () => opts.defects ?? []) },
    user: { findMany: jest.fn(async () => opts.users ?? []) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const audit = { append: jest.fn(async () => ({})) };
  const mail = {
    sendInspectionSubmitted: jest.fn(async () => ({ sent: true })),
    sendInspectionDecided: jest.fn(async () => ({ sent: true })),
  };

  const service = new InspectionsService(
    prisma as any,
    audit as any,
    mail as any,
  );
  return { service, prisma, tx, audit, mail };
}

describe('InspectionsService.submit — cycle gate (INS-056 / INS-081)', () => {
  const ITEMS = [
    { id: 'a', position: 1, itemName: 'Right sleeve' },
    { id: 'b', position: 2, itemName: 'Neck hole' },
  ];

  it('refuses an inspection with no complete unit', async () => {
    const { service, prisma } = makeService({ items: ITEMS, photos: [] });
    await expect(service.submit('org1', QA, 'insp1', {})).rejects.toThrow(
      'Cannot submit: no complete unit has been photographed',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a partial unit and names the unit and its missing items', async () => {
    const { service, prisma } = makeService({
      items: ITEMS,
      photos: [
        { inspectionLoopItemId: 'a', cycleIndex: 0 },
        { inspectionLoopItemId: 'b', cycleIndex: 0 },
        { inspectionLoopItemId: 'a', cycleIndex: 1 },
      ],
    });
    await expect(service.submit('org1', QA, 'insp1', {})).rejects.toThrow(
      'unit 2 (missing Neck hole)',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('submits when every started unit is complete', async () => {
    const { service, prisma } = makeService({
      items: ITEMS,
      photos: [
        { inspectionLoopItemId: 'a', cycleIndex: 0 },
        { inspectionLoopItemId: 'b', cycleIndex: 0 },
      ],
    });
    await service.submit('org1', QA, 'insp1', {});
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('under-shooting the AQL sample size is allowed — n is a target, not a gate', async () => {
    // lotSize 500 -> sample size 50; one complete unit still submits.
    const { service, prisma } = makeService({
      items: ITEMS,
      photos: [
        { inspectionLoopItemId: 'a', cycleIndex: 0 },
        { inspectionLoopItemId: 'b', cycleIndex: 0 },
      ],
    });
    await service.submit('org1', QA, 'insp1', {});
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('an inspection with no loop items can no longer submit (INS-081 strengthens INS-056)', async () => {
    const { service, prisma } = makeService({ items: [], photos: [] });
    await expect(service.submit('org1', QA, 'insp1', {})).rejects.toThrow(
      'no complete unit has been photographed',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('InspectionsService — status-change notifications (INS-069)', () => {
  it('submit mails every returned reviewer with the PO + inspection id', async () => {
    const { service, mail, prisma } = makeService({
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
    expect(mail.sendInspectionSubmitted).toHaveBeenCalledWith({
      to: 'qa1@x.com',
      poNumber: 'PO-1',
      inspectionId: 'insp1',
    });
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
    await service.decide('org1', QA, 'insp1', {
      decision: 'FAIL',
      remarks: 'seams',
    });
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
    await service.decide('org1', QA, 'insp1', {
      decision: 'PASS',
      remarks: 'ok',
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: [{ role: 'ORG_OWNER' }] }),
      }),
    );
  });
});

describe('InspectionsService.submit — audit attribution (INS-079)', () => {
  it('appends actorType USER for an ordinary org actor', async () => {
    const { service, audit } = makeService({});
    await service.submit('org1', QA, 'insp1', {});
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inspection.submitted',
        actorType: 'USER',
        actorUserId: QA.userId,
      }),
      expect.anything(),
    );
  });

  // Without actorTypeFor wired into the call site, this regresses silently —
  // the literal 'USER' still satisfies every other assertion in this file.
  it('attributes actorType PLATFORM_ADMIN when the actor is acting inside an assumed org', async () => {
    const { service, audit } = makeService({});
    await service.submit('org1', PLATFORM_ADMIN_ACTOR, 'insp1', {});
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inspection.submitted',
        actorType: 'PLATFORM_ADMIN',
        actorUserId: PLATFORM_ADMIN_ACTOR.userId,
      }),
      expect.anything(),
    );
  });
});

describe('InspectionsService.decide — audit attribution (INS-079)', () => {
  const decidableInspection = {
    id: 'insp1',
    orgId: 'org1',
    status: 'SUBMITTED',
    assignedInspectorId: null,
    purchaseOrder: { poNumber: 'PO-1' },
    aqlResult: { id: 'aql1' },
  };

  it('appends actorType USER for an ordinary QA actor', async () => {
    const { service, audit } = makeService({ inspection: decidableInspection });
    await service.decide('org1', QA, 'insp1', { decision: 'PASS' });
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inspection.decided',
        actorType: 'USER',
        actorUserId: QA.userId,
      }),
      expect.anything(),
    );
  });

  // Without actorTypeFor wired into the call site, this regresses silently —
  // the literal 'USER' still satisfies every other assertion in this file.
  it('attributes actorType PLATFORM_ADMIN when the actor is acting inside an assumed org', async () => {
    const { service, audit } = makeService({ inspection: decidableInspection });
    await service.decide('org1', PLATFORM_ADMIN_ACTOR, 'insp1', {
      decision: 'PASS',
    });
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inspection.decided',
        actorType: 'PLATFORM_ADMIN',
        actorUserId: PLATFORM_ADMIN_ACTOR.userId,
      }),
      expect.anything(),
    );
  });
});

// ── create(): snapshot + frozen AQL plan (INS-021 / INS-063) ──

const PO = {
  id: 'po1',
  orgId: 'org1',
  buyerId: 'b1',
  supplierId: 's1',
  productId: 'p1',
};
const PRESET = {
  id: 'preset1',
  version: 3,
  items: [
    {
      position: 1,
      itemName: 'Front',
      description: null,
      referenceImageUrl: 'ref1',
    },
    {
      position: 2,
      itemName: 'Back',
      description: null,
      referenceImageUrl: null,
    },
  ],
  measurementFields: [{ label: 'Length', unit: 'cm' }],
  allowedDefects: [
    {
      defectCatalogId: 'd1',
      defectCatalog: { name: 'Broken stitch', defaultSeverity: 'MAJOR' },
    },
  ],
};

interface CreateOpts {
  /** Row returned by inspection.findFirst — the clientRequestId replay AND the supersedes lookup. */
  existingInspection?: Record<string, unknown> | null;
  po?: Record<string, unknown> | null;
  preset?: Record<string, unknown> | null;
  inspector?: Record<string, unknown> | null;
}

function makeCreateService(opts: CreateOpts = {}) {
  const prisma = {
    inspection: {
      findFirst: jest.fn(async () => opts.existingInspection ?? null),
      create: jest.fn(async () => ({ id: 'insp-new', items: [] })),
    },
    purchaseOrder: {
      findFirst: jest.fn(async () => (opts.po === undefined ? PO : opts.po)),
    },
    loopPreset: {
      findFirst: jest.fn(async () =>
        opts.preset === undefined ? PRESET : opts.preset,
      ),
    },
    user: {
      findFirst: jest.fn(async () =>
        opts.inspector === undefined
          ? { id: 'u-insp', orgId: 'org1' }
          : opts.inspector,
      ),
    },
  };

  const service = new InspectionsService(
    prisma as any,
    { append: jest.fn() } as any,
    {} as any,
  );
  return { service, prisma };
}

/**
 * First argument of a mock call. `jest.fn(async () => …)` infers a zero-length
 * parameter tuple, so `mock.calls[0][0]` is a type error under strict TS even
 * though the value is there at runtime — this is the one place we cast.
 */

function firstArg(mock: jest.Mock): any {
  return (mock.mock.calls as unknown as any[][])[0][0];
}

/** The `data` argument the service handed to prisma.inspection.create. */

function createdData(prisma: { inspection: { create: jest.Mock } }): any {
  return firstArg(prisma.inspection.create).data;
}

const baseInput = { poId: 'po1', loopPresetId: 'preset1', lotSize: 1000 };

describe('InspectionsService.create — snapshot + computed sampling (INS-021)', () => {
  it('freezes the resolved preset snapshot (names + severities, not just FKs) and mirrors it into items', async () => {
    const { service, prisma } = makeCreateService();
    await service.create('org1', 'u-qa', baseInput);
    const data = createdData(prisma);
    expect(data.loopPresetSnapshot.presetId).toBe('preset1');
    expect(data.loopPresetSnapshot.version).toBe(3);
    // INS-081: defects are loop-global on the snapshot, not nested per item.
    expect(data.loopPresetSnapshot.allowedDefects[0]).toEqual({
      defectCatalogId: 'd1',
      name: 'Broken stitch',
      severity: 'MAJOR',
    });
    // orgId rides through the relation, not as a scalar — Prisma rejects the
    // bare column when two relations claim it (see the service comment).
    expect(data.items.create).toEqual([
      expect.objectContaining({
        position: 1,
        itemName: 'Front',
        organization: { connect: { id: 'org1' } },
      }),
      expect.objectContaining({
        position: 2,
        itemName: 'Back',
        organization: { connect: { id: 'org1' } },
      }),
    ]);
  });

  /*
   * Regression guard (carried over from main, re-pointed at the INS-081 shape):
   * InspectionLoopItem.orgId is claimed by TWO relations after INS-010 — the
   * composite FK to Inspection(id, orgId) and the FK to Organization — so Prisma
   * rejects a raw `orgId` scalar in the nested create ("Unknown argument
   * `orgId`"), which is a 500 on every single inspection create. It must ride
   * through the relation instead. Only a live DB caught this the first time.
   */
  it('never passes a bare orgId scalar in the nested item create', async () => {
    const { service, prisma } = makeCreateService();
    await service.create('org1', 'u-qa', baseInput);
    const created = createdData(prisma).items.create as Array<
      Record<string, unknown>
    >;
    for (const item of created) {
      expect(item).not.toHaveProperty('orgId');
      expect(item.organization).toEqual({ connect: { id: 'org1' } });
    }
  });

  it('computes the sampling from the lot size and locks the level to II (lot 1000 -> code J, n 80)', async () => {
    const { service, prisma } = makeCreateService();
    await service.create('org1', 'u-qa', baseInput);
    const data = createdData(prisma);
    expect(data.aqlLevel).toBe('II');
    expect(data.computedSampling.sampleSizeCodeLetter).toBe('J');
    expect(data.computedSampling.sampleSize).toBe(80);
  });

  it('is DRAFT unassigned and ASSIGNED once an inspector is given', async () => {
    const a = makeCreateService();
    await a.service.create('org1', 'u-qa', baseInput);
    expect(createdData(a.prisma).status).toBe('DRAFT');

    const b = makeCreateService();
    await b.service.create('org1', 'u-qa', {
      ...baseInput,
      assignedInspectorId: 'u-insp',
    });
    expect(createdData(b.prisma).status).toBe('ASSIGNED');
  });

  it('replays a clientRequestId to the original row without creating a second inspection', async () => {
    const { service, prisma } = makeCreateService({
      existingInspection: { id: 'insp-original' },
    });
    const out = await service.create('org1', 'u-qa', {
      ...baseInput,
      clientRequestId: 'crid-1',
    });
    expect((out as { id: string }).id).toBe('insp-original');
    expect(prisma.inspection.create).not.toHaveBeenCalled();
  });

  it('rejects a create with no poId', async () => {
    const { service, prisma } = makeCreateService();
    await expect(
      service.create('org1', 'u-qa', { ...baseInput, poId: '' }),
    ).rejects.toThrow(/poId is required/);
    expect(prisma.inspection.create).not.toHaveBeenCalled();
  });

  it('rejects a create with no loopPresetId', async () => {
    const { service, prisma } = makeCreateService();
    await expect(
      service.create('org1', 'u-qa', { ...baseInput, loopPresetId: '' }),
    ).rejects.toThrow(/loopPresetId is required/);
    expect(prisma.inspection.create).not.toHaveBeenCalled();
  });

  it('rejects a PO, preset, inspector or superseded inspection outside the org (tenant isolation)', async () => {
    await expect(
      makeCreateService({ po: null }).service.create('org1', 'u-qa', baseInput),
    ).rejects.toThrow(/purchase order not found in organization/);
    await expect(
      makeCreateService({ preset: null }).service.create(
        'org1',
        'u-qa',
        baseInput,
      ),
    ).rejects.toThrow(/loop preset not found in organization/);
    await expect(
      makeCreateService({ inspector: null }).service.create('org1', 'u-qa', {
        ...baseInput,
        assignedInspectorId: 'u-foreign',
      }),
    ).rejects.toThrow(/assigned inspector not found in organization/);
    await expect(
      makeCreateService({ existingInspection: null }).service.create(
        'org1',
        'u-qa',
        {
          ...baseInput,
          supersedesInspectionId: 'insp-foreign',
        },
      ),
    ).rejects.toThrow(/superseded inspection not found in organization/);
  });
});

describe('InspectionsService.create — per-class AQL configuration (INS-063)', () => {
  it('freezes the caller plan and computes it: major 1.5 at lot 1000 -> ac 3 / re 4', async () => {
    const { service, prisma } = makeCreateService();
    await service.create('org1', 'u-qa', {
      ...baseInput,
      aqlPlan: { major: 1.5 },
    });
    const data = createdData(prisma);
    expect(data.aqlPlan).toEqual({ critical: 0, major: 1.5, minor: 4.0 });
    expect(data.computedSampling.perClass.major).toEqual({
      aql: 1.5,
      ac: 3,
      re: 4,
    });
  });

  it('an omitted plan still freezes the spec defaults (critical 0 / major 2.5 / minor 4.0)', async () => {
    const { service, prisma } = makeCreateService();
    await service.create('org1', 'u-qa', baseInput);
    const data = createdData(prisma);
    expect(data.aqlPlan).toEqual({ critical: 0, major: 2.5, minor: 4.0 });
    expect(data.computedSampling.perClass).toEqual({
      critical: { aql: 0, ac: 0, re: 1 },
      major: { aql: 2.5, ac: 5, re: 6 },
      minor: { aql: 4, ac: 7, re: 8 },
    });
  });

  it('rejects an AQL outside the verified band with a 400 naming the allowed values (not a 500)', async () => {
    const { service, prisma } = makeCreateService();
    const call = service.create('org1', 'u-qa', {
      ...baseInput,
      aqlPlan: { major: 3.0 },
    });
    await expect(call).rejects.toThrow(BadRequestException);
    await expect(
      service.create('org1', 'u-qa', { ...baseInput, aqlPlan: { major: 3.0 } }),
    ).rejects.toThrow(
      /aqlPlan\.major must be one of 0, 1\.0, 1\.5, 2\.5, 4\.0, 6\.5/,
    );
    expect(prisma.inspection.create).not.toHaveBeenCalled();
  });

  it('rejects a hole in the grid with a 400: lot 100 (code letter F) has no non-zero column', async () => {
    const { service, prisma } = makeCreateService();
    await expect(
      service.create('org1', 'u-qa', {
        ...baseInput,
        lotSize: 100,
        aqlPlan: { major: 2.5 },
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.create('org1', 'u-qa', {
        ...baseInput,
        lotSize: 100,
        aqlPlan: { major: 2.5 },
      }),
    ).rejects.toThrow(/AQL plan not available for code letter F/);
    expect(prisma.inspection.create).not.toHaveBeenCalled();
  });

  it('rejects an unusable lot size with a 400 rather than an unhandled engine throw', async () => {
    const { service } = makeCreateService();
    await expect(
      service.create('org1', 'u-qa', { ...baseInput, lotSize: 1 }),
    ).rejects.toThrow(BadRequestException);
  });
});

// ── submit(): evaluate -> AqlResult + BillableEvent + lock (INS-021 / INS-018) ──

describe('InspectionsService.submit — lifecycle (INS-021)', () => {
  const ready = {};

  it('locks the inspection: SUBMITTED + submittedAt + tamperProof + the re-derived sampling', async () => {
    const { service, tx } = makeService(ready);
    await service.submit('org1', QA, 'insp1', {
      deviceId: 'dev-1',
      gps: { lat: 1, lng: 2 },
    });
    const data = firstArg(tx.inspection.update).data;
    expect(data.status).toBe('SUBMITTED');
    expect(data.submittedAt).toBeInstanceOf(Date);
    expect(data.tamperProof).toEqual(
      expect.objectContaining({
        inspectorId: 'u-qa',
        deviceId: 'dev-1',
        gps: { lat: 1, lng: 2 },
      }),
    );
    // lot 500 -> code letter H, n 50 (re-derived from the FROZEN plan, not the live defaults).
    expect(data.computedSampling).toEqual(
      expect.objectContaining({ sampleSizeCodeLetter: 'H', sampleSize: 50 }),
    );
  });

  it('writes the AQL verdict: no defects -> PASS', async () => {
    const { service, tx } = makeService(ready);
    await service.submit('org1', QA, 'insp1', {});
    const upsert = firstArg(tx.aqlResult.upsert);
    expect(upsert.create.systemRecommendation).toBe('PASS');
    expect(upsert.create.perClass.major).toEqual({
      found: 0,
      ac: 3,
      re: 4,
      outcome: 'PASS',
    });
  });

  it('writes the AQL verdict: majors at the rejection number -> FAIL', async () => {
    // lot 500 -> H; the frozen plan below is major 1.5 -> ac 2 / re 3, so 3 majors reject.
    const { service, tx } = makeService({
      ...ready,
      inspection: {
        id: 'insp1',
        orgId: 'org1',
        status: 'IN_PROGRESS',
        lotSize: 500,
        aqlPlan: { critical: 0, major: 1.5, minor: 4.0 },
        supersedesInspectionId: null,
        assignedInspectorId: null,
        purchaseOrder: { poNumber: 'PO-1' },
      },
      defects: [{ severity: 'MAJOR', _count: { _all: 3 } }],
    });
    await service.submit('org1', QA, 'insp1', {});
    const upsert = firstArg(tx.aqlResult.upsert);
    expect(upsert.create.perClass.major).toEqual({
      found: 3,
      ac: 2,
      re: 3,
      outcome: 'FAIL',
    });
    expect(upsert.create.systemRecommendation).toBe('FAIL');
  });

  it.each(['SUBMITTED', 'APPROVED', 'REJECTED', 'HOLD'])(
    'refuses to submit an inspection already in status %s',
    async (status) => {
      const { service, prisma } = makeService({
        ...ready,
        inspection: {
          id: 'insp1',
          orgId: 'org1',
          status,
          lotSize: 500,
          aqlPlan: {},
        },
      });
      await expect(service.submit('org1', QA, 'insp1', {})).rejects.toThrow(
        new RegExp(`Cannot submit an inspection in status ${status}`),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('refuses to submit without a lot size (no lot size, no sampling plan)', async () => {
    const { service, prisma } = makeService({
      ...ready,
      inspection: {
        id: 'insp1',
        orgId: 'org1',
        status: 'ASSIGNED',
        lotSize: null,
        aqlPlan: {},
      },
    });
    await expect(service.submit('org1', QA, 'insp1', {})).rejects.toThrow(
      /lotSize must be set/,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('InspectionsService.submit — billable linkage (INS-018)', () => {
  const ready = {};
  const supersedingInspection = {
    id: 'insp1',
    orgId: 'org1',
    status: 'ASSIGNED',
    lotSize: 500,
    aqlPlan: {},
    supersedesInspectionId: 'insp-original',
    assignedInspectorId: null,
    purchaseOrder: { poNumber: 'PO-1' },
  };

  it('bills a plain inspection as INSPECTION', async () => {
    const { service, tx } = makeService(ready);
    await service.submit('org1', QA, 'insp1', {});
    expect(tx.billableEvent.create).toHaveBeenCalledWith({
      data: { orgId: 'org1', inspectionId: 'insp1', kind: 'INSPECTION' },
    });
  });

  it('bills a genuine re-inspection chain as RE_INSPECTION', async () => {
    const { service, tx } = makeService({
      ...ready,
      inspection: supersedingInspection,
    });
    await service.submit('org1', QA, 'insp1', {});
    expect(tx.billableEvent.create).toHaveBeenCalledWith({
      data: { orgId: 'org1', inspectionId: 'insp1', kind: 'RE_INSPECTION' },
    });
  });

  it('rejects a RE_INSPECTION event sitting on an inspection that supersedes nothing', async () => {
    const { service, tx } = makeService({
      ...ready,
      billableEvent: { kind: 'RE_INSPECTION' },
    });
    await expect(service.submit('org1', QA, 'insp1', {})).rejects.toThrow(
      /Billing integrity: existing BillableEvent kind RE_INSPECTION contradicts/,
    );
    expect(tx.billableEvent.create).not.toHaveBeenCalled();
  });

  it('rejects an INSPECTION event sitting on a genuine re-inspection', async () => {
    const { service } = makeService({
      ...ready,
      inspection: supersedingInspection,
      billableEvent: { kind: 'INSPECTION' },
    });
    await expect(service.submit('org1', QA, 'insp1', {})).rejects.toThrow(
      /contradicts the inspection's re-inspection linkage \(expected RE_INSPECTION\)/,
    );
  });

  it('does not double-bill a matching pre-existing event', async () => {
    const { service, tx } = makeService({
      ...ready,
      billableEvent: { kind: 'INSPECTION' },
    });
    await service.submit('org1', QA, 'insp1', {});
    expect(tx.billableEvent.create).not.toHaveBeenCalled();
  });
});

// ── decide(): the binding QA call + its status guards (INS-021) ──

describe('InspectionsService.decide — status transitions (INS-021)', () => {
  const decidable = (status: string) => ({
    id: 'insp1',
    orgId: 'org1',
    status,
    assignedInspectorId: null,
    purchaseOrder: { poNumber: 'PO-1' },
    aqlResult: { id: 'aql1' },
  });

  it.each([
    ['PASS', 'APPROVED'],
    ['FAIL', 'REJECTED'],
    ['HOLD', 'HOLD'],
  ] as const)(
    '%s -> %s, recorded on both the inspection and the AQL result',
    async (decision, status) => {
      const { service, tx } = makeService({
        inspection: decidable('SUBMITTED'),
      });
      await service.decide('org1', QA, 'insp1', { decision, remarks: 'note' });
      expect(tx.inspection.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status } }),
      );
      expect(tx.aqlResult.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            qaDecision: decision,
            qaRemarks: 'note',
            decidedByUserId: 'u-qa',
          }),
        }),
      );
    },
  );

  it.each(['SUBMITTED', 'UNDER_REVIEW', 'HOLD'])(
    'accepts a decision from status %s',
    async (status) => {
      const { service, prisma } = makeService({
        inspection: decidable(status),
      });
      await service.decide('org1', QA, 'insp1', { decision: 'PASS' });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['DRAFT', 'ASSIGNED', 'IN_PROGRESS', 'APPROVED', 'REJECTED'])(
    'refuses a decision from status %s',
    async (status) => {
      const { service, prisma } = makeService({
        inspection: decidable(status),
      });
      await expect(
        service.decide('org1', QA, 'insp1', { decision: 'PASS' }),
      ).rejects.toThrow(
        new RegExp(`Cannot decide an inspection in status ${status}`),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('refuses to decide before submit (no AQL result to decide on)', async () => {
    const { service, prisma } = makeService({
      inspection: { ...decidable('SUBMITTED'), aqlResult: null },
    });
    await expect(
      service.decide('org1', QA, 'insp1', { decision: 'PASS' }),
    ).rejects.toThrow(/no AQL result \(submit first\)/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires a decision value', async () => {
    const { service } = makeService({ inspection: decidable('SUBMITTED') });
    await expect(
      service.decide('org1', QA, 'insp1', {} as { decision: 'PASS' }),
    ).rejects.toThrow(/decision is required/);
  });
});

describe('InspectionsService.start / reset — status guards (INS-021)', () => {
  it('starts an ASSIGNED inspection into IN_PROGRESS', async () => {
    const { service, tx } = makeService();
    await service.start('org1', QA, 'insp1');
    expect(tx.inspection.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'IN_PROGRESS' } }),
    );
  });

  it('refuses to start anything that is not ASSIGNED', async () => {
    const { service, prisma } = makeService({
      inspection: { id: 'insp1', orgId: 'org1', status: 'IN_PROGRESS' },
    });
    await expect(service.start('org1', QA, 'insp1')).rejects.toThrow(
      /Cannot start an inspection in status IN_PROGRESS/,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('resets an IN_PROGRESS inspection back to ASSIGNED', async () => {
    const { service, tx } = makeService({
      inspection: { id: 'insp1', orgId: 'org1', status: 'IN_PROGRESS' },
    });
    await service.reset('org1', QA, 'insp1');
    expect(tx.inspection.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'ASSIGNED' } }),
    );
  });

  it('refuses to reset anything that is not IN_PROGRESS', async () => {
    const { service, prisma } = makeService();
    await expect(service.reset('org1', QA, 'insp1')).rejects.toThrow(
      /Cannot reset an inspection in status ASSIGNED/,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('InspectionsService.start — audit attribution (INS-079)', () => {
  it('appends actorType USER for an ordinary org actor', async () => {
    const { service, audit } = makeService();
    await service.start('org1', QA, 'insp1');
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inspection.started',
        actorType: 'USER',
        actorUserId: QA.userId,
      }),
      expect.anything(),
    );
  });

  // Without actorTypeFor wired into the call site, this regresses silently —
  // the literal 'USER' still satisfies every other assertion in this file.
  it('attributes actorType PLATFORM_ADMIN when the actor is acting inside an assumed org', async () => {
    const { service, audit } = makeService();
    await service.start('org1', PLATFORM_ADMIN_ACTOR, 'insp1');
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inspection.started',
        actorType: 'PLATFORM_ADMIN',
        actorUserId: PLATFORM_ADMIN_ACTOR.userId,
      }),
      expect.anything(),
    );
  });
});
