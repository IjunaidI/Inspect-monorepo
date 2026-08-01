import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
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
  loopExists?: boolean;
  existingPhoto?: Row | null;
  existingDefect?: Row | null;
  catalog?: Row | null;
  photoCount?: number;
  /** Make photo.create / defectInstance.create throw this on first call. */
  createThrows?: unknown;
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function makeService(opts: HarnessOpts = {}) {
  const {
    status = 'IN_PROGRESS',
    inspectionExists = true,
    loopExists = true,
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
  const measurementCreate = jest.fn(async ({ data }: { data: Row }) => ({ id: 'm-new', ...data }));
  const photoUpdate = jest.fn(async ({ data }: { data: Row }) => ({ id: 'photo-1', ...data }));

  const prisma = {
    inspection: {
      findUnique: jest.fn(async () =>
        inspectionExists ? { id: INSPECTION_ID, orgId: TENANT_ORG, status } : null,
      ),
    },
    inspectionLoop: {
      findFirst: jest.fn(async () => (loopExists ? { id: 'loop-1' } : null)),
    },
    photo: {
      findFirst: jest.fn(async () => existingPhoto),
      count: jest.fn(async () => photoCount),
      create: photoCreate,
      update: photoUpdate,
    },
    defectInstance: {
      findFirst: jest.fn(async () => existingDefect),
      create: defectCreate,
    },
    defectCatalog: {
      findFirst: jest.fn(async () => catalog),
    },
    inspectionMeasurement: { create: measurementCreate },
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
  return { service, prisma, storage, audit, photoCreate, defectCreate, measurementCreate, photoUpdate };
}

const VALID_PHOTO = { storageKey: 'k/1.jpg', contentHash: 'a'.repeat(64) };

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

    await expect(h.service.presignPhotoUpload(INSPECTION_ID, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      h.service.registerPhoto(INSPECTION_ID, ADMIN_USER, VALID_PHOTO),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      h.service.assignPhotoToLoop(INSPECTION_ID, ADMIN_USER, 'photo-1', 'loop-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      h.service.addDefect(INSPECTION_ID, ADMIN_USER, { customText: 'x', severity: 'MINOR' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      h.service.addMeasurement(INSPECTION_ID, ADMIN_USER, { inspectionLoopId: 'loop-1', label: 'Length' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Nothing was written, and no presigned upload URL was minted.
    expect(h.photoCreate).not.toHaveBeenCalled();
    expect(h.defectCreate).not.toHaveBeenCalled();
    expect(h.measurementCreate).not.toHaveBeenCalled();
    expect(h.photoUpdate).not.toHaveBeenCalled();
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
    await expect(h.service.loadForPopulate(INSPECTION_ID)).resolves.toMatchObject({
      id: INSPECTION_ID,
    });
  });
});

describe('PopulateService.addDefect catalog XOR custom (INS-007)', () => {
  it('rejects when NEITHER defectCatalogId nor customText is provided', async () => {
    const h = makeService();
    await expect(h.service.addDefect(INSPECTION_ID, ADMIN_USER, {})).rejects.toThrow(
      /either defectCatalogId or customText is required/,
    );
    expect(h.defectCreate).not.toHaveBeenCalled();
  });

  it('rejects whitespace-only customText as absent', async () => {
    const h = makeService();
    await expect(
      h.service.addDefect(INSPECTION_ID, ADMIN_USER, { customText: '   ', severity: 'MINOR' }),
    ).rejects.toThrow(/either defectCatalogId or customText is required/);
    expect(h.defectCreate).not.toHaveBeenCalled();
  });

  it('rejects when BOTH defectCatalogId and customText are provided', async () => {
    const h = makeService({ catalog: { id: 'cat-1', defaultSeverity: 'MAJOR' } });
    await expect(
      h.service.addDefect(INSPECTION_ID, ADMIN_USER, {
        defectCatalogId: 'cat-1',
        customText: 'also custom',
      }),
    ).rejects.toThrow(/not both/);
    expect(h.defectCreate).not.toHaveBeenCalled();
  });

  it('still enforces the XOR when a clientRequestId is present but unseen', async () => {
    const h = makeService({ existingDefect: null });
    await expect(
      h.service.addDefect(INSPECTION_ID, ADMIN_USER, { clientRequestId: 'req-fresh' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.defectCreate).not.toHaveBeenCalled();
  });

  it('inherits severity from the catalog entry for a catalog defect', async () => {
    const h = makeService({ catalog: { id: 'cat-1', defaultSeverity: 'CRITICAL' } });
    const out = await h.service.addDefect(INSPECTION_ID, ADMIN_USER, { defectCatalogId: 'cat-1' });
    expect(out).toMatchObject({ severity: 'CRITICAL', defectCatalogId: 'cat-1' });
  });

  it('rejects a catalog id that is neither this org’s nor global', async () => {
    const h = makeService({ catalog: null });
    await expect(
      h.service.addDefect(INSPECTION_ID, ADMIN_USER, { defectCatalogId: 'cat-foreign' }),
    ).rejects.toThrow(/not accessible/);
    expect(h.defectCreate).not.toHaveBeenCalled();
  });

  it('requires an explicit severity for a custom defect', async () => {
    const h = makeService();
    await expect(
      h.service.addDefect(INSPECTION_ID, ADMIN_USER, { customText: 'Loose thread' }),
    ).rejects.toThrow(/severity is required for a custom defect/);
    expect(h.defectCreate).not.toHaveBeenCalled();
  });

  it('rejects photoIds that are not on this inspection', async () => {
    const h = makeService({ photoCount: 1 });
    await expect(
      h.service.addDefect(INSPECTION_ID, ADMIN_USER, {
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

  it('validates storageKey/contentHash and the loop before writing', async () => {
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

    const foreignLoop = makeService({ loopExists: false });
    await expect(
      foreignLoop.service.registerPhoto(INSPECTION_ID, ADMIN_USER, {
        ...VALID_PHOTO,
        inspectionLoopId: 'loop-of-another-inspection',
      }),
    ).rejects.toThrow(/inspectionLoopId not found on this inspection/);
    expect(foreignLoop.photoCreate).not.toHaveBeenCalled();
  });
});

describe('PopulateService.addDefect idempotency (INS-044 / INS-016)', () => {
  it('returns the ORIGINAL row on replay within the same inspection, creating nothing', async () => {
    const existing = { id: 'defect-1', inspectionId: INSPECTION_ID, orgId: TENANT_ORG };
    const h = makeService({ existingDefect: existing });
    const out = await h.service.addDefect(INSPECTION_ID, ADMIN_USER, {
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
        customText: 'Loose thread',
        severity: 'MINOR',
        clientRequestId: 'req-race',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('skips the dedupe lookup entirely when no clientRequestId is supplied', async () => {
    const h = makeService();
    await h.service.addDefect(INSPECTION_ID, ADMIN_USER, {
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
    await h.service.addDefect(INSPECTION_ID, ADMIN_USER, { defectCatalogId: 'cat-1' });
    const data = h.defectCreate.mock.calls[0][0].data as Row;
    expect(data.orgId).toBe(TENANT_ORG);
    expect(data.createdByUserId).toBe(ADMIN_USER.userId);
    expect(h.prisma.defectCatalog.findFirst).toHaveBeenCalledWith({
      where: { id: 'cat-1', OR: [{ orgId: TENANT_ORG }, { orgId: null }] },
    });
  });

  it('derives the presigned upload key from the inspection’s org', async () => {
    const h = makeService();
    const out = await h.service.presignPhotoUpload(INSPECTION_ID, { ext: 'png' });
    expect(h.storage.keyForPhoto).toHaveBeenCalledWith(TENANT_ORG, INSPECTION_ID, 'png');
    expect(out.method).toBe('PUT');
    expect(out.uploadUrl).toBe('https://s3.example/put');
  });
});

describe('PopulateService.assignPhotoToLoop / addMeasurement (INS-007)', () => {
  it('refuses to move a photo that is not on this inspection', async () => {
    const h = makeService();
    h.prisma.photo.findFirst.mockResolvedValueOnce(null as never);
    await expect(
      h.service.assignPhotoToLoop(INSPECTION_ID, ADMIN_USER, 'photo-elsewhere', 'loop-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(h.photoUpdate).not.toHaveBeenCalled();
  });

  it('refuses to move a photo into a loop from another inspection', async () => {
    const h = makeService({ loopExists: false });
    h.prisma.photo.findFirst.mockResolvedValueOnce({
      id: 'photo-1',
      inspectionId: INSPECTION_ID,
    } as never);
    await expect(
      h.service.assignPhotoToLoop(INSPECTION_ID, ADMIN_USER, 'photo-1', 'loop-foreign'),
    ).rejects.toThrow(/inspectionLoopId not found on this inspection/);
    expect(h.photoUpdate).not.toHaveBeenCalled();
  });

  it('requires an inspectionLoopId and a non-blank label, and trims the label', async () => {
    const h = makeService();
    await expect(
      h.service.addMeasurement(INSPECTION_ID, ADMIN_USER, { label: 'Length' } as never),
    ).rejects.toThrow(/inspectionLoopId is required/);
    await expect(
      h.service.addMeasurement(INSPECTION_ID, ADMIN_USER, { inspectionLoopId: 'loop-1', label: '  ' }),
    ).rejects.toThrow(/label is required/);
    expect(h.measurementCreate).not.toHaveBeenCalled();

    await h.service.addMeasurement(INSPECTION_ID, ADMIN_USER, {
      inspectionLoopId: 'loop-1',
      label: '  Length  ',
      recordedValue: '42.0',
      unit: 'cm',
    });
    const data = h.measurementCreate.mock.calls[0][0].data as Row;
    expect(data.label).toBe('Length');
    expect(data.inspectionLoopId).toBe('loop-1');
  });
});
