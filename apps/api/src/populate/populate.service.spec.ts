import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PopulateService } from './populate.service';
import { AuthUser } from '../auth/auth-user';

/**
 * INS-007 — PopulateService is the ONLY enforcement point for three product
 * invariants, and had no spec at all:
 *   1. immutability — no populate write once the inspection status is LOCKED
 *      (corrections require a linked re-inspection, spec §9);
 *   2. DefectInstance = catalog XOR custom;
 *   3. clientRequestId idempotency on the retryable writes.
 * Plus the cross-tenant Platform-Admin path: orgId is derived from the target
 * inspection, never from the caller (the Platform Admin has orgId=null), so a
 * regression here is a tenant-isolation bug, not a cosmetic one.
 *
 * INS-016 — pins the decided idempotency contract: same clientRequestId + same
 * inspection replays (2xx, no duplicate); same clientRequestId + a DIFFERENT
 * inspection is a 409, not a silently-foreign row.
 *
 * Pure unit test: Prisma + Storage are mocked, no DB.
 */

const TENANT_ORG = 'org-tenant';
const OTHER_INSPECTION = 'insp-other';
const INSPECTION_ID = 'insp-1';
/**
 * The populate console is Platform-Admin-only in the MVP: the actor is
 * cross-tenant (orgId null) and the org is derived from the INSPECTION, never
 * from the caller. INS-006 needs the whole principal (not just an id) so audit
 * rows are attributed `actorType: PLATFORM_ADMIN` rather than laundered as an
 * ordinary org user.
 */
const ADMIN_USER = {
  userId: 'u-platform-admin',
  orgId: null,
  role: 'PLATFORM_ADMIN',
} as unknown as AuthUser;

type Row = Record<string, unknown>;

interface HarnessOpts {
  status?: string;
  inspectionExists?: boolean;
  itemExists?: boolean;
  /** Whether the (item, cycle) slot already holds a photo — INS-081 defect gate. */
  slotPhoto?: Row | null;
  existingPhoto?: Row | null;
  existingDefect?: Row | null;
  catalog?: Row | null;
  photoCount?: number;
  /** Make photo.create / defectInstance.create throw this on first call. */
  createThrows?: unknown;
}

function p2002(target?: string[]): Prisma.PrismaClientKnownRequestError {
  const e = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
  if (target) Object.assign(e, { meta: { target } });
  return e;
}

function makeService(opts: HarnessOpts = {}) {
  const {
    status = 'IN_PROGRESS',
    inspectionExists = true,
    itemExists = true,
    slotPhoto = { id: 'photo-in-slot' },
    existingPhoto = null,
    existingDefect = null,
    catalog = null,
    photoCount = 0,
    createThrows,
  } = opts;

  let firstCreate = true;
  const throwOnce = () => {
    if (createThrows !== undefined && firstCreate) {
      firstCreate = false;
      throw createThrows;
    }
  };

  const photoCreate = jest.fn(async ({ data }: { data: Row }) => {
    throwOnce();
    return { id: 'photo-new', ...data };
  });
  const defectCreate = jest.fn(async ({ data }: { data: Row }) => {
    throwOnce();
    return { id: 'defect-new', ...data };
  });
  const measurementUpsert = jest.fn(async ({ create }: { create: Row }) => ({
    id: 'm-new',
    ...create,
  }));
  const photoUpdate = jest.fn(async ({ data }: { data: Row }) => ({ id: 'photo-1', ...data }));

  /**
   * INS-081: photo.findFirst serves two distinct lookups — the clientRequestId
   * replay (keyed by orgId) and the slot-occupancy check (keyed by
   * inspectionLoopItemId). Route by the shape of the where clause so both paths
   * stay independently controllable.
   */
  const photoFindFirst = jest.fn(async (args?: { where?: Row }) => {
    const where = args?.where ?? {};
    if ('inspectionLoopItemId' in where) return slotPhoto;
    return existingPhoto;
  });

  const prisma = {
    inspection: {
      // INS-083: the service now resolves the inspection through a SCOPED
      // findFirst. Both are stubbed to the same row so these tests keep
      // exercising the cross-tenant Platform-Admin path they were written for
      // (scopeFor returns {} for PLATFORM_ADMIN, so the where is id-only).
      findUnique: jest.fn(async () =>
        inspectionExists ? { id: INSPECTION_ID, orgId: TENANT_ORG, status } : null,
      ),
      findFirst: jest.fn(async () =>
        inspectionExists ? { id: INSPECTION_ID, orgId: TENANT_ORG, status } : null,
      ),
    },
    inspectionLoopItem: {
      findFirst: jest.fn(async () => (itemExists ? { id: 'item-1' } : null)),
    },
    photo: {
      findFirst: photoFindFirst,
      count: jest.fn(async () => photoCount),
      create: photoCreate,
      update: photoUpdate,
      deleteMany: jest.fn(async () => ({ count: 2 })),
    },
    defectInstance: {
      findFirst: jest.fn(async () => existingDefect),
      create: defectCreate,
      deleteMany: jest.fn(async () => ({ count: 1 })),
    },
    defectCatalog: {
      findFirst: jest.fn(async () => catalog),
    },
    inspectionMeasurement: {
      upsert: measurementUpsert,
      deleteMany: jest.fn(async () => ({ count: 3 })),
    },
    // INS-006: each populate write now appends its audit row in the same
    // transaction. Yielding the same object as `tx` keeps every delegate mock
    // above observable exactly as before.
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };

  const storage = {
    keyForPhoto: jest.fn(() => 'orgs/x/inspections/y/photos/z.jpg'),
    presignUpload: jest.fn(() => 'https://s3.example/put'),
    presignDownload: jest.fn(() => 'https://s3.example/get'),
  };
  const audit = { append: jest.fn(async () => ({})) };

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const service = new PopulateService(prisma as any, storage as any, audit as any);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return {
    service,
    prisma,
    storage,
    audit,
    photoCreate,
    defectCreate,
    measurementUpsert,
    photoUpdate,
  };
}

/** INS-081: every upload names its slot — (loop item, cycle). */
const VALID_PHOTO = {
  storageKey: 'k/1.jpg',
  contentHash: 'a'.repeat(64),
  inspectionLoopItemId: 'item-1',
  cycleIndex: 0,
};
/** A defect always names the slot it was seen on. */
const SLOT = { inspectionLoopItemId: 'item-1', cycleIndex: 0 };

/**
 * INS-006 — the populate writes are the evidence-capture path for a signed
 * report, and audited none of it before this. The org on the audit row must be
 * the INSPECTION's tenant, while the actor stays the real Platform Admin.
 */
describe('PopulateService audit-on-write (INS-006)', () => {
  it('registerPhoto audits under the inspection org, attributed to PLATFORM_ADMIN', async () => {
    const h = makeService();
    await h.service.registerPhoto(INSPECTION_ID, ADMIN_USER, VALID_PHOTO);

    expect(h.audit.append).toHaveBeenCalledTimes(1);
    const [entry, tx] = h.audit.append.mock.calls[0] as unknown as [Record<string, unknown>, unknown];
    expect(entry).toMatchObject({
      orgId: TENANT_ORG, // the tenant, NOT the admin's null org
      actorType: 'PLATFORM_ADMIN',
      actorUserId: 'u-platform-admin',
      action: 'populate.photoRegistered',
      entityType: 'Photo',
    });
    expect(tx).toBeDefined();
  });

  it('addDefect audits the severity that will drive the AQL verdict', async () => {
    const h = makeService();
    await h.service.addDefect(INSPECTION_ID, ADMIN_USER, {
      ...SLOT,
      customText: 'Loose thread',
      severity: 'MAJOR',
    });

    expect(h.audit.append).toHaveBeenCalledTimes(1);
    const [entry] = h.audit.append.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(entry).toMatchObject({
      orgId: TENANT_ORG,
      action: 'populate.defectAdded',
      entityType: 'DefectInstance',
      metadata: expect.objectContaining({ severity: 'MAJOR', inspectionId: INSPECTION_ID }),
    });
  });

  it('a write refused by the LOCKED guard audits nothing', async () => {
    const h = makeService({ status: 'APPROVED' });
    await expect(
      h.service.registerPhoto(INSPECTION_ID, ADMIN_USER, VALID_PHOTO),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.audit.append).not.toHaveBeenCalled();
  });

  it('an idempotent replay returns the original row without a second audit entry', async () => {
    const h = makeService({
      existingPhoto: { id: 'photo-existing', inspectionId: INSPECTION_ID },
    });
    const out = await h.service.registerPhoto(INSPECTION_ID, ADMIN_USER, {
      ...VALID_PHOTO,
      clientRequestId: 'tok-1',
    });
    expect(out).toMatchObject({ id: 'photo-existing' });
    expect(h.photoCreate).not.toHaveBeenCalled();
    expect(h.audit.append).not.toHaveBeenCalled();
  });
});

describe('PopulateService immutability guard (INS-007)', () => {
  const LOCKED_STATUSES = [
    'SUBMITTED',
    'UNDER_REVIEW',
    'APPROVED',
    'REPORT_ISSUED',
    'REJECTED',
    'HOLD',
  ];
  const OPEN_STATUSES = ['DRAFT', 'ASSIGNED', 'IN_PROGRESS'];

  it.each(LOCKED_STATUSES)('refuses every populate write when status is %s', async (status) => {
    const h = makeService({ status });

    await expect(h.service.presignPhotoUpload(INSPECTION_ID, ADMIN_USER, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      h.service.registerPhoto(INSPECTION_ID, ADMIN_USER, VALID_PHOTO),
    ).rejects.toBeInstanceOf(BadRequestException);
    // INS-081: retake and cycle-discard are populate writes too, and destroy or
    // replace evidence — the LOCKED guard must cover them.
    await expect(
      h.service.retakePhoto(INSPECTION_ID, ADMIN_USER, 'photo-1', {
        storageKey: 'k/2.jpg',
        contentHash: 'b'.repeat(64),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.discardCycle(INSPECTION_ID, ADMIN_USER, 0)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      h.service.addDefect(INSPECTION_ID, ADMIN_USER, { ...SLOT, customText: 'x', severity: 'MINOR' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      h.service.addMeasurement(INSPECTION_ID, ADMIN_USER, { cycleIndex: 0, label: 'Length' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Nothing was written, and no presigned upload URL was minted.
    expect(h.photoCreate).not.toHaveBeenCalled();
    expect(h.defectCreate).not.toHaveBeenCalled();
    expect(h.measurementUpsert).not.toHaveBeenCalled();
    expect(h.photoUpdate).not.toHaveBeenCalled();
    expect(h.prisma.photo.deleteMany).not.toHaveBeenCalled();
    expect(h.storage.presignUpload).not.toHaveBeenCalled();
  });

  it('names the blocking status and points at re-inspection', async () => {
    const { service } = makeService({ status: 'APPROVED' });
    await expect(service.registerPhoto(INSPECTION_ID, ADMIN_USER, VALID_PHOTO)).rejects.toThrow(
      /locked \(status APPROVED\).*re-inspection/,
    );
  });

  it.each(OPEN_STATUSES)('still allows writes while status is %s', async (status) => {
    const h = makeService({ status });
    const photo = await h.service.registerPhoto(INSPECTION_ID, ADMIN_USER, VALID_PHOTO);
    expect(photo).toMatchObject({ id: 'photo-new', inspectionId: INSPECTION_ID });
    expect(h.photoCreate).toHaveBeenCalledTimes(1);
  });

  it('404s on an unknown inspection instead of writing', async () => {
    const h = makeService({ inspectionExists: false });
    await expect(
      h.service.registerPhoto(INSPECTION_ID, ADMIN_USER, VALID_PHOTO),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(h.photoCreate).not.toHaveBeenCalled();
  });

  it('loadForPopulate deliberately still reads a LOCKED inspection (read-only view)', async () => {
    const h = makeService({ status: 'REPORT_ISSUED' });
    // Prisma include shape returns undefined relations from the bare mock row;
    // the point is that it resolves rather than throwing the LOCKED guard.
    await expect(h.service.loadForPopulate(INSPECTION_ID, ADMIN_USER)).resolves.toMatchObject({
      id: INSPECTION_ID,
    });
  });
});

describe('PopulateService.addDefect catalog XOR custom (INS-007)', () => {
  it('rejects when NEITHER defectCatalogId nor customText is provided', async () => {
    const h = makeService();
    await expect(h.service.addDefect(INSPECTION_ID, ADMIN_USER, { ...SLOT } as never)).rejects.toThrow(
      /either defectCatalogId or customText is required/,
    );
    expect(h.defectCreate).not.toHaveBeenCalled();
  });

  it('rejects whitespace-only customText as absent', async () => {
    const h = makeService();
    await expect(
      h.service.addDefect(INSPECTION_ID, ADMIN_USER, { ...SLOT, customText: '   ', severity: 'MINOR' }),
    ).rejects.toThrow(/either defectCatalogId or customText is required/);
    expect(h.defectCreate).not.toHaveBeenCalled();
  });

  it('rejects when BOTH defectCatalogId and customText are provided', async () => {
    const h = makeService({ catalog: { id: 'cat-1', defaultSeverity: 'MAJOR' } });
    await expect(
      h.service.addDefect(INSPECTION_ID, ADMIN_USER, {
        ...SLOT,
        defectCatalogId: 'cat-1',
        customText: 'also custom',
      }),
    ).rejects.toThrow(/not both/);
    expect(h.defectCreate).not.toHaveBeenCalled();
  });

  it('still enforces the XOR when a clientRequestId is present but unseen', async () => {
    const h = makeService({ existingDefect: null });
    await expect(
      h.service.addDefect(INSPECTION_ID, ADMIN_USER, { ...SLOT, clientRequestId: 'req-fresh' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.defectCreate).not.toHaveBeenCalled();
  });

  it('inherits severity from the catalog entry for a catalog defect', async () => {
    const h = makeService({ catalog: { id: 'cat-1', defaultSeverity: 'CRITICAL' } });
    const out = await h.service.addDefect(INSPECTION_ID, ADMIN_USER, { ...SLOT, defectCatalogId: 'cat-1' });
    expect(out).toMatchObject({ severity: 'CRITICAL', defectCatalogId: 'cat-1' });
  });

  it('rejects a catalog id that is neither this org’s nor global', async () => {
    const h = makeService({ catalog: null });
    await expect(
      h.service.addDefect(INSPECTION_ID, ADMIN_USER, { ...SLOT, defectCatalogId: 'cat-foreign' }),
    ).rejects.toThrow(/not accessible/);
    expect(h.defectCreate).not.toHaveBeenCalled();
  });

  it('requires an explicit severity for a custom defect', async () => {
    const h = makeService();
    await expect(
      h.service.addDefect(INSPECTION_ID, ADMIN_USER, { ...SLOT, customText: 'Loose thread' }),
    ).rejects.toThrow(/severity is required for a custom defect/);
    expect(h.defectCreate).not.toHaveBeenCalled();
  });

  it('rejects photoIds that are not on this inspection', async () => {
    const h = makeService({ photoCount: 1 });
    await expect(
      h.service.addDefect(INSPECTION_ID, ADMIN_USER, {
        ...SLOT,
        customText: 'Stain',
        severity: 'MAJOR',
        photoIds: ['p1', 'p2'],
      }),
    ).rejects.toThrow(/not on this inspection/);
    expect(h.defectCreate).not.toHaveBeenCalled();
    expect(h.prisma.photo.count).toHaveBeenCalledWith({
      where: { id: { in: ['p1', 'p2'] }, inspectionId: INSPECTION_ID },
    });
  });
});

describe('PopulateService.registerPhoto idempotency (INS-016)', () => {
  it('returns the ORIGINAL row on replay within the same inspection, creating nothing', async () => {
    const existing = { id: 'photo-1', inspectionId: INSPECTION_ID, orgId: TENANT_ORG };
    const h = makeService({ existingPhoto: existing });
    const out = await h.service.registerPhoto(INSPECTION_ID, ADMIN_USER, {
      ...VALID_PHOTO,
      clientRequestId: 'req-1',
    });
    expect(out).toBe(existing);
    expect(h.photoCreate).not.toHaveBeenCalled();
  });

  it('409s when the same clientRequestId is reused on a DIFFERENT inspection', async () => {
    const h = makeService({
      existingPhoto: { id: 'photo-1', inspectionId: OTHER_INSPECTION, orgId: TENANT_ORG },
    });
    await expect(
      h.service.registerPhoto(INSPECTION_ID, ADMIN_USER, {
        ...VALID_PHOTO,
        clientRequestId: 'req-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    // The old behaviour returned the foreign row and attached nothing here.
    expect(h.photoCreate).not.toHaveBeenCalled();
  });

  it('names the offending token and the other inspection in the 409', async () => {
    const h = makeService({
      existingPhoto: { id: 'photo-1', inspectionId: OTHER_INSPECTION, orgId: TENANT_ORG },
    });
    await expect(
      h.service.registerPhoto(INSPECTION_ID, ADMIN_USER, {
        ...VALID_PHOTO,
        clientRequestId: 'req-1',
      }),
    ).rejects.toThrow(new RegExp(`req-1.*different inspection \\(${OTHER_INSPECTION}\\)`));
  });

  it('converges on the winner row when a concurrent replay loses the unique race', async () => {
    const winner = { id: 'photo-winner', inspectionId: INSPECTION_ID, orgId: TENANT_ORG };
    const h = makeService({ createThrows: p2002() });
    // First lookup (pre-insert) sees nothing; the post-P2002 lookup sees the winner.
    h.prisma.photo.findFirst
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(winner as never);

    const out = await h.service.registerPhoto(INSPECTION_ID, ADMIN_USER, {
      ...VALID_PHOTO,
      clientRequestId: 'req-race',
    });
    expect(out).toBe(winner);
    expect(h.photoCreate).toHaveBeenCalledTimes(1);
  });

  it('still 409s if the unique-race winner belongs to another inspection', async () => {
    const h = makeService({ createThrows: p2002() });
    h.prisma.photo.findFirst
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: 'photo-x', inspectionId: OTHER_INSPECTION } as never);
    await expect(
      h.service.registerPhoto(INSPECTION_ID, ADMIN_USER, {
        ...VALID_PHOTO,
        clientRequestId: 'req-race',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rethrows a non-P2002 create failure untouched', async () => {
    const boom = new Error('connection reset');
    const h = makeService({ createThrows: boom });
    await expect(
      h.service.registerPhoto(INSPECTION_ID, ADMIN_USER, {
        ...VALID_PHOTO,
        clientRequestId: 'req-1',
      }),
    ).rejects.toBe(boom);
  });

  it('skips the dedupe lookup entirely when no clientRequestId is supplied', async () => {
    const h = makeService();
    await h.service.registerPhoto(INSPECTION_ID, ADMIN_USER, VALID_PHOTO);
    expect(h.prisma.photo.findFirst).not.toHaveBeenCalled();
    expect(h.photoCreate).toHaveBeenCalledTimes(1);
  });

  it('validates storageKey/contentHash and the slot before writing', async () => {
    const missingHash = makeService();
    await expect(
      missingHash.service.registerPhoto(INSPECTION_ID, ADMIN_USER, {
        storageKey: 'k',
      } as never),
    ).rejects.toThrow(/contentHash is required/);

    const missingKey = makeService();
    await expect(
      missingKey.service.registerPhoto(INSPECTION_ID, ADMIN_USER, {
        contentHash: 'h',
      } as never),
    ).rejects.toThrow(/storageKey is required/);

    const missingItem = makeService();
    await expect(
      missingItem.service.registerPhoto(INSPECTION_ID, ADMIN_USER, {
        storageKey: 'k',
        contentHash: 'h',
      } as never),
    ).rejects.toThrow(/inspectionLoopItemId is required/);

    const foreignItem = makeService({ itemExists: false });
    await expect(
      foreignItem.service.registerPhoto(INSPECTION_ID, ADMIN_USER, {
        ...VALID_PHOTO,
        inspectionLoopItemId: 'item-of-another-inspection',
      }),
    ).rejects.toThrow(/inspectionLoopItemId not found on this inspection/);
    expect(foreignItem.photoCreate).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5, NaN, undefined])('rejects a cycleIndex of %p', async (cycleIndex) => {
    const h = makeService();
    await expect(
      h.service.registerPhoto(INSPECTION_ID, ADMIN_USER, {
        ...VALID_PHOTO,
        cycleIndex: cycleIndex as number,
      }),
    ).rejects.toThrow(/cycleIndex must be a non-negative integer/);
    expect(h.photoCreate).not.toHaveBeenCalled();
  });

  it('turns a taken slot into a 409 that points at retake, not an idempotent replay', async () => {
    const h = makeService({ createThrows: p2002(['inspectionLoopItemId', 'cycleIndex']) });
    await expect(
      h.service.registerPhoto(INSPECTION_ID, ADMIN_USER, {
        ...VALID_PHOTO,
        cycleIndex: 6,
        clientRequestId: 'req-1',
      }),
    ).rejects.toThrow(/Unit 7 already has a photo for that loop item.*retake/);
  });
});

describe('PopulateService.addDefect idempotency (INS-044 / INS-016)', () => {
  it('returns the ORIGINAL row on replay within the same inspection, creating nothing', async () => {
    const existing = { id: 'defect-1', inspectionId: INSPECTION_ID, orgId: TENANT_ORG };
    const h = makeService({ existingDefect: existing });
    const out = await h.service.addDefect(INSPECTION_ID, ADMIN_USER, {
      ...SLOT,
      customText: 'Loose thread',
      severity: 'MINOR',
      clientRequestId: 'req-d1',
    });
    expect(out).toBe(existing);
    expect(h.defectCreate).not.toHaveBeenCalled();
  });

  it('409s when the same clientRequestId is reused on a DIFFERENT inspection', async () => {
    const h = makeService({
      existingDefect: { id: 'defect-1', inspectionId: OTHER_INSPECTION, orgId: TENANT_ORG },
    });
    await expect(
      h.service.addDefect(INSPECTION_ID, ADMIN_USER, {
        ...SLOT,
        customText: 'Loose thread',
        severity: 'MINOR',
        clientRequestId: 'req-d1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(h.defectCreate).not.toHaveBeenCalled();
  });

  it('converges on the winner row when a concurrent replay loses the unique race', async () => {
    const winner = { id: 'defect-winner', inspectionId: INSPECTION_ID, orgId: TENANT_ORG };
    const h = makeService({ createThrows: p2002() });
    h.prisma.defectInstance.findFirst
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(winner as never);

    const out = await h.service.addDefect(INSPECTION_ID, ADMIN_USER, {
      ...SLOT,
      customText: 'Loose thread',
      severity: 'MINOR',
      clientRequestId: 'req-race',
    });
    expect(out).toBe(winner);
  });

  it('still 409s if the unique-race winner belongs to another inspection', async () => {
    const h = makeService({ createThrows: p2002() });
    h.prisma.defectInstance.findFirst
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: 'defect-x', inspectionId: OTHER_INSPECTION } as never);
    await expect(
      h.service.addDefect(INSPECTION_ID, ADMIN_USER, {
        ...SLOT,
        customText: 'Loose thread',
        severity: 'MINOR',
        clientRequestId: 'req-race',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('skips the dedupe lookup entirely when no clientRequestId is supplied', async () => {
    const h = makeService();
    await h.service.addDefect(INSPECTION_ID, ADMIN_USER, {
      ...SLOT,
      customText: 'Loose thread',
      severity: 'MINOR',
    });
    expect(h.prisma.defectInstance.findFirst).not.toHaveBeenCalled();
    expect(h.defectCreate).toHaveBeenCalledTimes(1);
  });
});

describe('PopulateService cross-tenant Platform-Admin scoping (INS-007)', () => {
  it('stamps the INSPECTION’s orgId on a new photo, not the caller’s', async () => {
    const h = makeService();
    await h.service.registerPhoto(INSPECTION_ID, ADMIN_USER, VALID_PHOTO);
    const data = h.photoCreate.mock.calls[0][0].data as Row;
    expect(data.orgId).toBe(TENANT_ORG);
    expect(data.inspectionId).toBe(INSPECTION_ID);
    expect(data.uploaderUserId).toBe(ADMIN_USER.userId);
    expect(data.source).toBe('MANUAL_UPLOAD');
  });

  it('scopes the photo dedupe lookup to the inspection’s org', async () => {
    const h = makeService();
    await h.service.registerPhoto(INSPECTION_ID, ADMIN_USER, {
      ...VALID_PHOTO,
      clientRequestId: 'req-1',
    });
    expect(h.prisma.photo.findFirst).toHaveBeenCalledWith({
      where: { orgId: TENANT_ORG, clientRequestId: 'req-1' },
    });
  });

  it('stamps the INSPECTION’s orgId on a new defect and scopes the catalog lookup', async () => {
    const h = makeService({ catalog: { id: 'cat-1', defaultSeverity: 'MINOR' } });
    await h.service.addDefect(INSPECTION_ID, ADMIN_USER, { ...SLOT, defectCatalogId: 'cat-1' });
    const data = h.defectCreate.mock.calls[0][0].data as Row;
    expect(data.orgId).toBe(TENANT_ORG);
    expect(data.createdByUserId).toBe(ADMIN_USER.userId);
    expect(h.prisma.defectCatalog.findFirst).toHaveBeenCalledWith({
      where: { id: 'cat-1', OR: [{ orgId: TENANT_ORG }, { orgId: null }] },
    });
  });

  it('derives the presigned upload key from the inspection’s org', async () => {
    const h = makeService();
    const out = await h.service.presignPhotoUpload(INSPECTION_ID, ADMIN_USER, { ext: 'png' });
    expect(h.storage.keyForPhoto).toHaveBeenCalledWith(TENANT_ORG, INSPECTION_ID, 'png');
    expect(out.method).toBe('PUT');
    expect(out.uploadUrl).toBe('https://s3.example/put');
  });
});

describe('PopulateService.addDefect slot gate (INS-081)', () => {
  it('requires a loop item', async () => {
    const h = makeService();
    await expect(
      h.service.addDefect(INSPECTION_ID, ADMIN_USER, {
        cycleIndex: 0,
        customText: 'Stain',
        severity: 'MINOR',
      } as never),
    ).rejects.toThrow(/inspectionLoopItemId is required/);
    expect(h.defectCreate).not.toHaveBeenCalled();
  });

  it('refuses a defect on a slot that holds no photo yet', async () => {
    const h = makeService({ slotPhoto: null });
    await expect(
      h.service.addDefect(INSPECTION_ID, ADMIN_USER, {
        ...SLOT,
        cycleIndex: 6,
        customText: 'Stain',
        severity: 'MINOR',
      }),
    ).rejects.toThrow(/no photo has been uploaded for unit 7/);
    expect(h.defectCreate).not.toHaveBeenCalled();
  });

  it('records the slot on the row so the report can say "Unit N · item"', async () => {
    const h = makeService();
    await h.service.addDefect(INSPECTION_ID, ADMIN_USER, {
      inspectionLoopItemId: 'item-1',
      cycleIndex: 3,
      customText: 'Stain',
      severity: 'MINOR',
    });
    const data = h.defectCreate.mock.calls[0][0].data as Row;
    expect(data.inspectionLoopItemId).toBe('item-1');
    expect(data.cycleIndex).toBe(3);
  });
});

describe('PopulateService.retakePhoto (INS-081)', () => {
  it('404s on a photo that is not on this inspection', async () => {
    const h = makeService({ existingPhoto: null });
    await expect(
      h.service.retakePhoto(INSPECTION_ID, ADMIN_USER, 'photo-elsewhere', {
        storageKey: 'k/2.jpg',
        contentHash: 'b'.repeat(64),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(h.photoUpdate).not.toHaveBeenCalled();
  });

  it('validates the replacement bytes before touching the row', async () => {
    const h = makeService({ existingPhoto: { id: 'photo-1', inspectionId: INSPECTION_ID } });
    await expect(
      h.service.retakePhoto(INSPECTION_ID, ADMIN_USER, 'photo-1', {
        contentHash: 'b'.repeat(64),
      } as never),
    ).rejects.toThrow(/storageKey is required/);
    await expect(
      h.service.retakePhoto(INSPECTION_ID, ADMIN_USER, 'photo-1', {
        storageKey: 'k/2.jpg',
      } as never),
    ).rejects.toThrow(/contentHash is required/);
    expect(h.photoUpdate).not.toHaveBeenCalled();
  });

  it('updates in place, keeping the slot, and audits BOTH content hashes', async () => {
    const h = makeService({
      existingPhoto: {
        id: 'photo-1',
        inspectionId: INSPECTION_ID,
        inspectionLoopItemId: 'item-1',
        cycleIndex: 2,
        contentHash: 'a'.repeat(64),
      },
    });
    await h.service.retakePhoto(INSPECTION_ID, ADMIN_USER, 'photo-1', {
      storageKey: 'k/2.jpg',
      contentHash: 'b'.repeat(64),
    });
    // The slot columns are NOT in the update payload — the slot is the identity.
    const data = h.photoUpdate.mock.calls[0][0].data as Row;
    expect(data).not.toHaveProperty('inspectionLoopItemId');
    expect(data).not.toHaveProperty('cycleIndex');
    expect(data.contentHash).toBe('b'.repeat(64));

    const [entry] = h.audit.append.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(entry).toMatchObject({
      orgId: TENANT_ORG,
      action: 'populate.photoRetaken',
      entityType: 'Photo',
      metadata: expect.objectContaining({
        inspectionLoopItemId: 'item-1',
        cycleIndex: 2,
        fromContentHash: 'a'.repeat(64),
        toContentHash: 'b'.repeat(64),
      }),
    });
  });
});

describe('PopulateService.discardCycle (INS-081)', () => {
  it("deletes the unit's defects, photos and measurements and audits the counts", async () => {
    const h = makeService();
    const result = await h.service.discardCycle(INSPECTION_ID, ADMIN_USER, 2);
    expect(h.prisma.defectInstance.deleteMany).toHaveBeenCalledWith({
      where: { inspectionId: INSPECTION_ID, cycleIndex: 2 },
    });
    expect(h.prisma.photo.deleteMany).toHaveBeenCalledWith({
      where: { inspectionId: INSPECTION_ID, cycleIndex: 2 },
    });
    expect(h.prisma.inspectionMeasurement.deleteMany).toHaveBeenCalledWith({
      where: { inspectionId: INSPECTION_ID, cycleIndex: 2 },
    });
    expect(result).toEqual({
      cycleIndex: 2,
      deleted: { photos: 2, defects: 1, measurements: 3 },
    });
    const [entry] = h.audit.append.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(entry).toMatchObject({
      orgId: TENANT_ORG,
      action: 'populate.cycleDiscarded',
      metadata: expect.objectContaining({ cycleIndex: 2, photos: 2 }),
    });
  });

  it('rejects a nonsense cycleIndex without deleting anything', async () => {
    const h = makeService();
    await expect(h.service.discardCycle(INSPECTION_ID, ADMIN_USER, -1)).rejects.toThrow(
      /cycleIndex must be a non-negative integer/,
    );
    expect(h.prisma.photo.deleteMany).not.toHaveBeenCalled();
  });
});

describe('PopulateService.addMeasurement — per-cycle sheet (INS-081)', () => {
  it('requires a valid cycleIndex and a non-blank label, and trims the label', async () => {
    const h = makeService();
    await expect(
      h.service.addMeasurement(INSPECTION_ID, ADMIN_USER, { label: 'Length' } as never),
    ).rejects.toThrow(/cycleIndex must be a non-negative integer/);
    await expect(
      h.service.addMeasurement(INSPECTION_ID, ADMIN_USER, { cycleIndex: 0, label: '  ' }),
    ).rejects.toThrow(/label is required/);
    expect(h.measurementUpsert).not.toHaveBeenCalled();

    await h.service.addMeasurement(INSPECTION_ID, ADMIN_USER, {
      cycleIndex: 4,
      label: '  Length  ',
      recordedValue: '42.0',
      unit: 'cm',
    });
    const args = h.measurementUpsert.mock.calls[0][0] as unknown as {
      where: Row;
      create: Row;
      update: Row;
    };
    expect(args.create.label).toBe('Length');
    expect(args.create.cycleIndex).toBe(4);
    expect(args.create.orgId).toBe(TENANT_ORG);
  });

  it('is idempotent on (inspection, cycle, label) — re-entering a value updates it', async () => {
    const h = makeService();
    await h.service.addMeasurement(INSPECTION_ID, ADMIN_USER, {
      cycleIndex: 1,
      label: 'Chest',
      recordedValue: '53',
    });
    const args = h.measurementUpsert.mock.calls[0][0] as unknown as { where: Row; update: Row };
    expect(args.where).toEqual({
      inspectionId_cycleIndex_label: {
        inspectionId: INSPECTION_ID,
        cycleIndex: 1,
        label: 'Chest',
      },
    });
    expect(args.update).toMatchObject({ recordedValue: '53' });
  });
});

/**
 * INS-083 — row-level scoping now that populate is no longer Platform-Admin-only.
 *
 * The mobile app (INS-086) has no PLATFORM_ADMIN mode, so the role that actually
 * performs an inspection has to be able to capture evidence. Widening the
 * controller's role floor is the easy half; the load-bearing half is that
 * `loadOpenInspection` used a bare `findUnique(id)` with NO tenant filter — safe
 * only because the single allowed caller was cross-tenant by design. Letting an
 * org role through that lookup unscoped would be a cross-tenant read/write hole.
 *
 * These tests drive the lookup through a fake that really evaluates the `where`
 * against a fixture row, so they assert on the outcome (found / not found) rather
 * than on what was passed to a mock.
 */
describe('PopulateService — actor scoping (INS-083)', () => {
  const ORG_A = 'org-a';
  const ORG_B = 'org-b';
  const ASSIGNEE = 'u-inspector-assigned';
  const INSP = 'insp-scoped';

  /** The one inspection that exists: org A, assigned to ASSIGNEE, still open. */
  const ROW = {
    id: INSP,
    orgId: ORG_A,
    status: 'IN_PROGRESS',
    assignedInspectorId: ASSIGNEE,
    items: [],
    measurements: [],
  };

  /** Evaluates a Prisma-style equality `where` against ROW, like the database would. */
  function matches(where: Record<string, unknown> = {}): boolean {
    return Object.entries(where).every(([k, v]) => (ROW as Record<string, unknown>)[k] === v);
  }

  function scopedService() {
    const findFirst = jest.fn(async (args?: { where?: Record<string, unknown> }) =>
      matches(args?.where) ? ROW : null,
    );
    const prisma = {
      inspection: { findFirst, findUnique: findFirst },
      inspectionLoopItem: { findFirst: jest.fn(async () => ({ id: 'item-1' })) },
      photo: { findFirst: jest.fn(async () => null), count: jest.fn(async () => 0) },
    } as unknown as ConstructorParameters<typeof PopulateService>[0];
    const storage = {
      keyForPhoto: () => 'storage-key',
      presignUpload: () => 'https://example.invalid/upload',
    } as unknown as ConstructorParameters<typeof PopulateService>[1];
    const audit = { append: jest.fn() } as unknown as ConstructorParameters<typeof PopulateService>[2];
    return new PopulateService(prisma, storage, audit);
  }

  const actor = (role: string, over: Partial<AuthUser> = {}): AuthUser =>
    ({ userId: 'u-actor', orgId: ORG_A, role, actingAsOrgId: null, ...over }) as AuthUser;

  it('lets the assigned INSPECTOR load the inspection', async () => {
    const svc = scopedService();
    await expect(
      svc.loadForPopulate(INSP, actor('INSPECTOR', { userId: ASSIGNEE })),
    ).resolves.toMatchObject({ id: INSP });
  });

  it('hides the inspection from an INSPECTOR it is not assigned to — 404, never 403', async () => {
    const svc = scopedService();
    // 404 not 403: a 403 would confirm the row exists, turning the endpoint into
    // an existence oracle for other inspectors' work (the INS-057 rule).
    await expect(
      svc.loadForPopulate(INSP, actor('INSPECTOR', { userId: 'u-someone-else' })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets a QA_MANAGER in the owning org load it without being the assignee', async () => {
    const svc = scopedService();
    await expect(svc.loadForPopulate(INSP, actor('QA_MANAGER'))).resolves.toMatchObject({ id: INSP });
  });

  it('hides the inspection from a QA_MANAGER in another org', async () => {
    const svc = scopedService();
    await expect(
      svc.loadForPopulate(INSP, actor('QA_MANAGER', { orgId: ORG_B })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps the PLATFORM_ADMIN cross-tenant, as before', async () => {
    const svc = scopedService();
    // Unchanged behaviour: orgId is null and the admin still reaches any org's
    // inspection, which is what the whole cross-tenant populate path relies on.
    await expect(
      svc.loadForPopulate(INSP, actor('PLATFORM_ADMIN', { orgId: null })),
    ).resolves.toMatchObject({ id: INSP });
  });

  it('refuses an org role that somehow carries no org context', async () => {
    const svc = scopedService();
    await expect(
      svc.loadForPopulate(INSP, actor('QA_MANAGER', { orgId: null })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('scopes the write path too, not just the read', async () => {
    const svc = scopedService();
    // presign is the first step of capture; if it were unscoped an inspector
    // could mint an upload URL against another org's inspection.
    await expect(
      svc.presignPhotoUpload(INSP, actor('INSPECTOR', { userId: 'u-someone-else' }), {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      svc.presignPhotoUpload(INSP, actor('INSPECTOR', { userId: ASSIGNEE }), {}),
    ).resolves.toMatchObject({ storageKey: expect.any(String) });
  });
});
