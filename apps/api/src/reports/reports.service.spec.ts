/**
 * INS-019 — ReportsService unit spec (mocked Prisma, no DB, no network).
 *
 * What is actually being protected here is the product's core guarantee: the
 * report a buyer receives is the exact inspection state that was hashed and
 * Ed25519-signed, generation is idempotent under races, the act is attributed in
 * the hash-chained audit log, and an undecided inspection can never be reported.
 * Mocking style follows buyers.service.spec.ts.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth-user';
import { contentHash } from '../tamper-proof/content-hash';
import { generateKeyPair, verify } from '../tamper-proof/signature';
import { extractPdfText } from './pdf-text';
import { ReportsService } from './reports.service';

const KEYS = generateKeyPair();

const OWNER: AuthUser = {
  userId: 'u-owner',
  orgId: 'org1',
  role: 'ORG_OWNER',
  actingAsOrgId: null,
};
const ADMIN_IN_ORG: AuthUser = {
  userId: 'u-admin',
  orgId: 'org1',
  role: 'PLATFORM_ADMIN',
  actingAsOrgId: 'org1',
};

function approvedInspection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'insp1',
    orgId: 'org1',
    clientCompanyId: 'buy1',
    factoryCompanyId: 'sup1',
    productId: 'prod1',
    status: 'APPROVED',
    inspectionType: 'PRE_SHIPMENT',
    lotSize: 1000,
    aqlLevel: 'II',
    aqlPlan: { critical: 0, major: 2.5, minor: 4.0 },
    computedSampling: {
      sampleSizeCodeLetter: 'J',
      sampleSize: 80,
      perClass: { minor: { aql: 4, ac: 7, re: 8 } },
    },
    cartonsTotal: 40,
    cartonsInspected: 8,
    quantityPresented: 990,
    quantityShortfall: 10,
    workmanshipNotes: 'Fine',
    packagingNotes: 'Fine',
    tamperProof: { deviceId: 'dev1' },
    clientCompany: {
      id: 'buy1',
      name: 'Northwind Apparel',
      logoUrl: null,
      primaryColor: '#037BF4',
      branding: null,
    },
    supplier: { id: 'sup1', name: 'Dhaka Knitwear' },
    product: { id: 'prod1', styleNumber: 'NW-1', description: 'Tee' },
    purchaseOrder: { poNumber: 'PO-1' },
    aqlResult: {
      perClass: { minor: { found: 1, ac: 7, re: 8, outcome: 'PASS' } },
      systemRecommendation: 'PASS',
      qaDecision: 'PASS',
      qaRemarks: 'ok',
      decidedByUserId: 'u-qa',
      decidedAt: new Date('2026-07-30T10:00:00.000Z'),
    },
    // INS-081: two single-image items, photographed for one complete unit.
    items: [
      {
        id: 'item1',
        position: 1,
        itemName: 'Front',
        notes: null,
        photos: [
          {
            contentHash: 'a'.repeat(64),
            inspectionLoopItemId: 'item1',
            cycleIndex: 0,
          },
        ],
      },
      {
        id: 'item2',
        position: 2,
        itemName: 'Back',
        notes: null,
        photos: [
          {
            contentHash: 'b'.repeat(64),
            inspectionLoopItemId: 'item2',
            cycleIndex: 0,
          },
        ],
      },
    ],
    measurements: [
      { cycleIndex: 0, label: 'Length', recordedValue: '42.0', unit: 'cm' },
    ],
    defects: [
      {
        defectCatalogId: null,
        customText: 'Loose thread',
        severity: 'MINOR',
        notes: null,
        inspectionLoopItemId: 'item1',
        cycleIndex: 0,
        photos: [{ photoId: 'ph1' }],
      },
    ],
    report: null,
    ...overrides,
  };
}

interface Harness {
  service: ReportsService;
  audit: { append: jest.Mock };
  storage: {
    isConfigured: jest.Mock;
    keyForReportPdf: jest.Mock;
    putObject: jest.Mock;
    presignDownload: jest.Mock;
  };
  created: jest.Mock;
  reportUpdate: jest.Mock;
  reportFindFirst: jest.Mock;
  inspectionUpdate: jest.Mock;
  uploaded: () => Uint8Array | undefined;
}

function makeService(
  opts: {
    inspection?: Record<string, unknown> | null;
    storageConfigured?: boolean;
    uploadFails?: boolean;
    createThrows?: unknown;
    existingReport?: Record<string, unknown> | null;
    config?: Record<string, unknown>;
  } = {},
): Harness {
  const inspection =
    opts.inspection === undefined ? approvedInspection() : opts.inspection;
  let uploadedBytes: Uint8Array | undefined;

  const created = jest.fn(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'rep1',
      pdfStorageKey: null,
      verificationToken: 'tok-verify',
      generatedAt: new Date('2026-08-01T09:00:00.000Z'),
      ...data,
    }),
  );
  const reportUpdate = jest.fn(
    async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => ({
      id: where.id,
      ...data,
    }),
  );
  const inspectionUpdate = jest.fn(async () => ({}));
  const reportFindFirst = jest.fn(async () => opts.existingReport ?? null);

  const tx = {
    report: {
      create: opts.createThrows
        ? jest.fn(async () => {
            throw opts.createThrows;
          })
        : created,
      update: reportUpdate,
    },
    inspection: { update: inspectionUpdate },
  };
  const prisma = {
    inspection: { findFirst: jest.fn(async () => inspection) },
    report: {
      findFirst: reportFindFirst,
      update: reportUpdate,
      findUnique: jest.fn(async () => null),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const audit = { append: jest.fn(async () => ({})) };
  const storage = {
    isConfigured: jest.fn(() => opts.storageConfigured !== false),
    keyForReportPdf: jest.fn(
      (orgId: string, reportId: string) =>
        `orgs/${orgId}/reports/${reportId}.pdf`,
    ),
    putObject: jest.fn(async (_key: string, bytes: Uint8Array) => {
      if (opts.uploadFails) throw new Error('storage exploded');
      uploadedBytes = bytes;
    }),
    presignDownload: jest.fn(
      (key: string) => `https://s3.example/${key}?sig=abc`,
    ),
  };
  const config = new ConfigService({
    REPORT_SIGNING_PRIVATE_KEY_PEM: KEYS.privateKey,
    WEB_BASE_URL: 'https://console.inspect.example/',
    ...opts.config,
  });

  const mail = {
    sendReportDelivered: jest.fn(async () => ({
      sent: true,
      messageId: 'mid',
    })),
  };
  const service = new ReportsService(
    prisma as never,
    config,
    audit as never,
    storage as never,
    mail as never,
  );
  return {
    service,
    audit,
    storage,
    created,
    reportUpdate,
    reportFindFirst,
    inspectionUpdate,
    uploaded: () => uploadedBytes,
  };
}

describe('ReportsService.generate — signed envelope (INS-019)', () => {
  it('signs a content hash that verifies against the platform public key', async () => {
    const { service, created } = makeService();
    const report = (await service.generate(
      'org1',
      OWNER,
      'insp1',
    )) as unknown as {
      contentHash: string;
      signature: string;
      canonicalSnapshot: Record<string, unknown>;
    };

    expect(created).toHaveBeenCalledTimes(1);
    expect(verify(report.contentHash, report.signature, KEYS.publicKey)).toBe(
      true,
    );
  });

  it('round-trips: recomputing the hash from the stored snapshot reproduces the signed hash', async () => {
    const { service } = makeService();
    const report = (await service.generate(
      'org1',
      OWNER,
      'insp1',
    )) as unknown as {
      contentHash: string;
      canonicalSnapshot: { photoHashes: string[] };
    };
    // This is exactly what the public verification endpoint does.
    const recomputed = contentHash(
      report.canonicalSnapshot,
      report.canonicalSnapshot.photoHashes,
    );
    expect(recomputed).toBe(report.contentHash);
  });

  it('freezes the buyer-visible fields (defects, quantity, decision, evidence) inside the signed envelope', async () => {
    const { service } = makeService();
    const report = (await service.generate(
      'org1',
      OWNER,
      'insp1',
    )) as unknown as {
      canonicalSnapshot: Record<string, any>;
      brandingSnapshot: Record<string, unknown>;
    };
    const snap = report.canonicalSnapshot;
    expect(snap.poNumber).toBe('PO-1');
    expect(snap.defects).toHaveLength(1);
    expect(snap.defects[0]).toMatchObject({
      customText: 'Loose thread',
      severity: 'MINOR',
    });
    expect(snap.quantity).toMatchObject({
      quantityPresented: 990,
      quantityShortfall: 10,
    });
    expect(snap.aqlResult.qaDecision).toBe('PASS');
    expect(snap.aqlResult.decidedByUserId).toBe('u-qa');
    expect(snap.photoHashes).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
    // Branding is snapshotted too, so a later buyer rebrand cannot restyle history.
    expect(report.brandingSnapshot).toMatchObject({ primaryColor: '#037BF4' });
  });

  it('is order-sensitive on photo evidence: a reordered photo set breaks the hash', async () => {
    const { service } = makeService();
    const report = (await service.generate(
      'org1',
      OWNER,
      'insp1',
    )) as unknown as {
      contentHash: string;
      canonicalSnapshot: { photoHashes: string[] };
    };
    const swapped = [...report.canonicalSnapshot.photoHashes].reverse();
    expect(
      contentHash(
        { ...report.canonicalSnapshot, photoHashes: swapped },
        swapped,
      ),
    ).not.toBe(report.contentHash);
  });

  it('refuses a non-APPROVED inspection', async () => {
    const { service, created } = makeService({
      inspection: approvedInspection({ status: 'SUBMITTED' }),
    });
    await expect(
      service.generate('org1', OWNER, 'insp1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(created).not.toHaveBeenCalled();
  });

  it('404s an inspection outside the caller tenant', async () => {
    const { service } = makeService({ inspection: null });
    await expect(
      service.generate('org1', OWNER, 'insp1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses to sign when no signing key is configured', async () => {
    const { service, created } = makeService({
      config: { REPORT_SIGNING_PRIVATE_KEY_PEM: '' },
    });
    await expect(
      service.generate('org1', OWNER, 'insp1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(created).not.toHaveBeenCalled();
  });
});

describe('ReportsService.generate — loop items + cycle depth (INS-081)', () => {
  function snapshotOf(created: { mock: { calls: unknown[][] } }) {
    const arg = created.mock.calls[0][0] as {
      data: { canonicalSnapshot: unknown };
    };
    return arg.data.canonicalSnapshot as Record<string, unknown>;
  }

  it('freezes the loop items in order, without shot counts or zone names', async () => {
    const { service, created } = makeService();
    await service.generate('org1', OWNER, 'insp1');
    expect(snapshotOf(created).items).toEqual([
      { position: 1, itemName: 'Front', notes: null },
      { position: 2, itemName: 'Back', notes: null },
    ]);
    expect(snapshotOf(created)).not.toHaveProperty('loops');
  });

  it('records units photographed against the sampling plan n', async () => {
    const { service, created } = makeService();
    await service.generate('org1', OWNER, 'insp1');
    // One complete pass over both items, against a plan calling for 80.
    expect(snapshotOf(created).cycles).toEqual({
      completed: 1,
      sampleSize: 80,
    });
  });

  it('attributes each defect to its slot so the narrative can name the unit', async () => {
    const { service, created } = makeService();
    await service.generate('org1', OWNER, 'insp1');
    expect(snapshotOf(created).defects).toEqual([
      expect.objectContaining({
        itemPosition: 1,
        cycleIndex: 0,
        severity: 'MINOR',
      }),
    ]);
  });

  it('carries the per-unit measurement sheet', async () => {
    const { service, created } = makeService();
    await service.generate('org1', OWNER, 'insp1');
    expect(snapshotOf(created).measurements).toEqual([
      { cycleIndex: 0, label: 'Length', recordedValue: '42.0', unit: 'cm' },
    ]);
  });

  it('orders the signed photo hashes by unit, then by item position', async () => {
    const { service, created } = makeService();
    await service.generate('org1', OWNER, 'insp1');
    expect(snapshotOf(created).photoHashes).toEqual([
      'a'.repeat(64),
      'b'.repeat(64),
    ]);
  });
});

describe('ReportsService.generate — idempotency (INS-019)', () => {
  it('returns the existing report without re-signing', async () => {
    const existing = {
      id: 'rep-existing',
      orgId: 'org1',
      pdfStorageKey: 'orgs/org1/reports/rep-existing.pdf',
      contentHash: 'x'.repeat(64),
      signature: 'sig',
      verificationToken: 'tok',
      generatedAt: new Date(),
      canonicalSnapshot: {},
      brandingSnapshot: {},
    };
    const { service, created, storage } = makeService({
      inspection: approvedInspection({ report: existing }),
    });
    const out = await service.generate('org1', OWNER, 'insp1');
    expect(out).toMatchObject({ id: 'rep-existing' });
    expect(created).not.toHaveBeenCalled();
    // Already has a PDF — no pointless re-render/re-upload.
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('converges when a racing generate() wins the Report.inspectionId unique index (P2002)', async () => {
    const raceWinner = { id: 'rep-race', orgId: 'org1', pdfStorageKey: null };
    const { service, reportFindFirst } = makeService({
      createThrows: new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      }),
      existingReport: raceWinner,
    });
    const out = await service.generate('org1', OWNER, 'insp1');
    expect(out).toMatchObject({ id: 'rep-race' });
    expect(reportFindFirst).toHaveBeenCalledWith({
      where: { inspectionId: 'insp1', orgId: 'org1' },
    });
  });

  it('rethrows a P2002 that is not a lost report race', async () => {
    const { service } = makeService({
      createThrows: new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      }),
      existingReport: null,
    });
    await expect(
      service.generate('org1', OWNER, 'insp1'),
    ).rejects.toMatchObject({
      code: 'P2002',
    });
  });
});

describe('ReportsService.generate — audit attribution (INS-019)', () => {
  it('appends report.generated inside the transaction with the acting user', async () => {
    const { service, audit } = makeService();
    await service.generate('org1', OWNER, 'insp1');
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org1',
        action: 'report.generated',
        entityType: 'Report',
        entityId: 'rep1',
        actorType: 'USER',
        actorUserId: 'u-owner',
      }),
      expect.anything(), // the tx client — atomic with the Report row
    );
  });

  // INS-079: a Platform Admin inside an assumed org must never be recorded as an
  // ordinary member of that org.
  it('attributes actorType PLATFORM_ADMIN when an admin generates inside an assumed org', async () => {
    const { service, audit } = makeService();
    await service.generate('org1', ADMIN_IN_ORG, 'insp1');
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'report.generated',
        actorType: 'PLATFORM_ADMIN',
        actorUserId: 'u-admin',
      }),
      expect.anything(),
    );
  });

  it('records the signed content hash in the audit metadata', async () => {
    const { service, audit } = makeService();
    const report = (await service.generate(
      'org1',
      OWNER,
      'insp1',
    )) as unknown as {
      contentHash: string;
    };
    const call = audit.append.mock.calls.find(
      (c) => c[0].action === 'report.generated',
    );
    expect(call![0].metadata).toEqual({
      inspectionId: 'insp1',
      contentHash: report.contentHash,
    });
  });
});

describe('ReportsService.generate — PDF rendition (INS-003)', () => {
  it('renders the signed snapshot to a PDF, stores it and sets pdfStorageKey', async () => {
    const { service, storage, uploaded, reportUpdate } = makeService();
    const report = (await service.generate(
      'org1',
      OWNER,
      'insp1',
    )) as unknown as {
      pdfStorageKey: string | null;
      contentHash: string;
    };

    expect(storage.keyForReportPdf).toHaveBeenCalledWith('org1', 'rep1');
    expect(storage.putObject).toHaveBeenCalledWith(
      'orgs/org1/reports/rep1.pdf',
      expect.anything(),
      'application/pdf',
    );
    expect(reportUpdate).toHaveBeenCalledWith({
      where: { id: 'rep1' },
      data: { pdfStorageKey: 'orgs/org1/reports/rep1.pdf' },
    });
    expect(report.pdfStorageKey).toBe('orgs/org1/reports/rep1.pdf');

    const bytes = uploaded()!;
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
    const text = extractPdfText(bytes);
    // Rendered STRICTLY from the signed snapshot — same hash the signature covers.
    expect(text).toContain('Northwind Apparel');
    expect(text).toContain('PO-1');
    expect(text).toContain('ACCEPTED');
    expect(text).toContain(report.contentHash);
    expect(text).toContain('https://console.inspect.example/r/tok-verify');
  });

  it('appends a hash-chained audit row for the rendition, with the byte length', async () => {
    const { service, audit, uploaded } = makeService();
    await service.generate('org1', OWNER, 'insp1');
    const call = audit.append.mock.calls.find(
      (c) => c[0].action === 'report.pdf.rendered',
    );
    expect(call).toBeTruthy();
    expect(call![0]).toMatchObject({
      orgId: 'org1',
      entityType: 'Report',
      entityId: 'rep1',
      actorUserId: 'u-owner',
      metadata: {
        pdfStorageKey: 'orgs/org1/reports/rep1.pdf',
        pdfBytes: uploaded()!.length,
      },
    });
  });

  // The signed record is the product guarantee; the PDF is a rendition. A storage
  // outage must not lose the signature.
  it('still returns the signed report when the upload fails', async () => {
    const { service, reportUpdate } = makeService({ uploadFails: true });
    const report = (await service.generate(
      'org1',
      OWNER,
      'insp1',
    )) as unknown as {
      pdfStorageKey: string | null;
      signature: string;
      contentHash: string;
    };
    expect(report.signature).toBeTruthy();
    expect(verify(report.contentHash, report.signature, KEYS.publicKey)).toBe(
      true,
    );
    expect(report.pdfStorageKey).toBeNull();
    expect(reportUpdate).not.toHaveBeenCalled();
  });

  it('skips rendering entirely when object storage is not configured', async () => {
    const { service, storage } = makeService({ storageConfigured: false });
    const report = (await service.generate(
      'org1',
      OWNER,
      'insp1',
    )) as unknown as {
      pdfStorageKey: string | null;
    };
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(report.pdfStorageKey).toBeNull();
  });

  it('backfills a missing PDF on a later generate() without re-signing', async () => {
    const existing = {
      id: 'rep-old',
      orgId: 'org1',
      pdfStorageKey: null,
      contentHash: 'd'.repeat(64),
      signature: 'sig-old',
      verificationToken: 'tok-old',
      generatedAt: new Date('2026-07-01T00:00:00.000Z'),
      canonicalSnapshot: {
        client: { companyId: 'buy1', name: 'Northwind Apparel' },
        poNumber: 'PO-1',
      },
      brandingSnapshot: { primaryColor: '#037BF4' },
    };
    const { service, created, storage, uploaded } = makeService({
      inspection: approvedInspection({ report: existing }),
    });
    const out = (await service.generate('org1', OWNER, 'insp1')) as unknown as {
      id: string;
      signature: string;
      pdfStorageKey: string | null;
    };
    expect(created).not.toHaveBeenCalled(); // never re-signs
    expect(out.signature).toBe('sig-old');
    expect(out.pdfStorageKey).toBe('orgs/org1/reports/rep-old.pdf');
    expect(storage.putObject).toHaveBeenCalledTimes(1);
    expect(extractPdfText(uploaded()!)).toContain('d'.repeat(64));
  });
});

describe('ReportsService.pdfDownload (INS-003)', () => {
  function makeDownloadService(report: Record<string, unknown> | null) {
    const findFirst = jest.fn(async () => report);
    const storage = {
      presignDownload: jest.fn(
        (key: string, ttl: number) => `https://s3.example/${key}?ttl=${ttl}`,
      ),
      isConfigured: jest.fn(() => true),
    };
    const service = new ReportsService(
      { report: { findFirst } } as never,
      new ConfigService({}),
      { append: jest.fn() } as never,
      storage as never,
      { sendReportDelivered: jest.fn() } as never,
    );
    return { service, findFirst, storage };
  }

  it('returns a short-lived presigned GET URL, org-scoped', async () => {
    const { service, findFirst, storage } = makeDownloadService({
      id: 'rep1',
      pdfStorageKey: 'orgs/org1/reports/rep1.pdf',
      generatedAt: new Date(),
    });
    const out = await service.pdfDownload('org1', 'rep1');
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'rep1', orgId: 'org1' } }),
    );
    expect(out.reportId).toBe('rep1');
    expect(out.expiresInSeconds).toBe(300);
    expect(storage.presignDownload).toHaveBeenCalledWith(
      'orgs/org1/reports/rep1.pdf',
      300,
    );
    expect(out.url).toContain('orgs/org1/reports/rep1.pdf');
  });

  it('404s a report belonging to another tenant (no existence leak)', async () => {
    const { service } = makeDownloadService(null);
    await expect(
      service.pdfDownload('org1', 'rep-foreign'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s with a clear message when no PDF has been rendered yet', async () => {
    const { service } = makeDownloadService({
      id: 'rep1',
      pdfStorageKey: null,
      generatedAt: new Date(),
    });
    await expect(service.pdfDownload('org1', 'rep1')).rejects.toThrow(
      /No PDF rendition/i,
    );
  });
});

/**
 * INS-020 — report delivery. The guarantees under test: the buyer's guests are
 * each told exactly once, the delivery is recorded as an auditable event inside
 * the transaction, and neither an SMTP outage nor an empty recipient list can
 * corrupt or fail the delivery that already committed.
 */
describe('ReportsService.deliver (INS-020)', () => {
  const HOUR = 60 * 60 * 1000;

  function guest(overrides: Record<string, unknown> = {}) {
    return {
      id: 'g1',
      email: 'buyer.qa@northwind.example',
      token: 'magic-1',
      ...overrides,
    };
  }

  function makeDeliverService(
    opts: {
      report?: Record<string, unknown> | null;
      guests?: Array<Record<string, unknown>>;
      mailSent?: boolean;
      mailThrows?: boolean;
    } = {},
  ) {
    const report =
      opts.report === undefined
        ? {
            id: 'rep1',
            orgId: 'org1',
            clientCompanyId: 'buy1',
            verificationToken: 'tok-verify',
            deliveredAt: null,
            status: 'GENERATED',
            clientCompany: { id: 'buy1', name: 'Northwind Apparel' },
            inspection: { purchaseOrder: { poNumber: 'PO-1' } },
          }
        : opts.report;

    const reportFindFirst = jest.fn(async () => report);
    // Typed as the generic `jest.Mock` (not inferred from the 0-arg impl) so the
    // `.mock.calls[0][0]` assertions below index an `any[]` tuple rather than `[]`.
    const guestFindMany: jest.Mock = jest.fn(
      async () => opts.guests ?? [guest()],
    );
    const deliveryCreate = jest.fn(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'del1',
        ...data,
      }),
    );
    const deliveryCreateMany = jest.fn(async () => ({ count: 1 }));
    const reportUpdate = jest.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => ({
        id: where.id,
        ...data,
      }),
    );
    const audit: { append: jest.Mock } = { append: jest.fn(async () => ({})) };
    const sendReportDelivered: jest.Mock = jest.fn(async () => {
      if (opts.mailThrows) throw new Error('transport exploded');
      return { sent: opts.mailSent !== false, messageId: 'mid-1' };
    });

    const tx = {
      report: { update: reportUpdate },
      reportDelivery: { create: deliveryCreate },
    };
    const prisma = {
      report: { findFirst: reportFindFirst },
      companyGuest: { findMany: guestFindMany },
      reportDelivery: { createMany: deliveryCreateMany },
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
        fn(tx),
      ),
    };
    const service = new ReportsService(
      prisma as never,
      new ConfigService({}),
      audit as never,
      {
        presignDownload: jest.fn(),
        isConfigured: jest.fn(() => true),
      } as never,
      { sendReportDelivered } as never,
    );
    return {
      service,
      audit,
      reportFindFirst,
      guestFindMany,
      deliveryCreate,
      deliveryCreateMany,
      reportUpdate,
      sendReportDelivered,
    };
  }

  it('emails every eligible guest exactly once, with their own magic link', async () => {
    const { service, sendReportDelivered } = makeDeliverService({
      guests: [
        guest(),
        guest({
          id: 'g2',
          email: 'sourcing@northwind.example',
          token: 'magic-2',
        }),
      ],
    });
    const out = await service.deliver('org1', OWNER, 'rep1');

    expect(sendReportDelivered).toHaveBeenCalledTimes(2);
    expect(sendReportDelivered).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'buyer.qa@northwind.example',
        token: 'magic-1',
        reportId: 'rep1',
        poNumber: 'PO-1',
        companyName: 'Northwind Apparel',
        verificationToken: 'tok-verify',
      }),
    );
    // Each recipient gets their OWN token — never another guest's credential.
    expect(sendReportDelivered).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'sourcing@northwind.example',
        token: 'magic-2',
      }),
    );
    expect(out.emailsSent).toBe(2);
    expect(out.recipients).toEqual([
      { email: 'buyer.qa@northwind.example', sent: true },
      { email: 'sourcing@northwind.example', sent: true },
    ]);
  });

  it('never mails the same address twice in one call', async () => {
    const { service, sendReportDelivered, deliveryCreateMany } =
      makeDeliverService({
        guests: [
          guest(),
          guest({
            id: 'g2',
            email: 'Buyer.QA@Northwind.example',
            token: 'magic-2',
          }),
        ],
      });
    const out = await service.deliver('org1', OWNER, 'rep1');
    expect(sendReportDelivered).toHaveBeenCalledTimes(1);
    expect(out.emailsSent).toBe(1);
    expect(deliveryCreateMany).toHaveBeenCalledWith({
      data: [
        {
          reportId: 'rep1',
          channel: 'EMAIL',
          recipientEmail: 'buyer.qa@northwind.example',
        },
      ],
    });
  });

  it('only considers ACTIVE, unexpired, token-holding guests of this buyer + tenant', async () => {
    const { service, guestFindMany } = makeDeliverService();
    await service.deliver('org1', OWNER, 'rep1');
    const where = guestFindMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      orgId: 'org1',
      companyId: 'buy1',
      status: 'ACTIVE',
      token: { not: null },
    });
    // A live token means "no expiry" OR "expires in the future" — never a
    // revoked/expired guest, whose magic link would be a dead end.
    expect(where.OR).toEqual([
      { tokenExpiresAt: null },
      { tokenExpiresAt: { gt: expect.any(Date) } },
    ]);
  });

  it('records the PORTAL delivery + DELIVERED status + audit row in ONE transaction', async () => {
    const { service, deliveryCreate, reportUpdate, audit } =
      makeDeliverService();
    const out = await service.deliver('org1', OWNER, 'rep1');

    expect(deliveryCreate).toHaveBeenCalledWith({
      data: { reportId: 'rep1', channel: 'PORTAL' },
    });
    expect(reportUpdate).toHaveBeenCalledWith({
      where: { id: 'rep1' },
      data: { status: 'DELIVERED', deliveredAt: expect.any(Date) },
    });
    expect(out.status).toBe('DELIVERED');
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org1',
        action: 'report.delivered',
        entityType: 'Report',
        entityId: 'rep1',
        actorType: 'USER',
        actorUserId: 'u-owner',
        metadata: {
          clientCompanyId: 'buy1',
          recipientCount: 1,
          recipients: ['buyer.qa@northwind.example'],
        },
      }),
      expect.anything(), // the tx client — atomic with the delivery row
    );
  });

  it('attributes the delivery to PLATFORM_ADMIN inside an assumed org (INS-079)', async () => {
    const { service, audit } = makeDeliverService();
    await service.deliver('org1', ADMIN_IN_ORG, 'rep1');
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'report.delivered',
        actorType: 'PLATFORM_ADMIN',
        actorUserId: 'u-admin',
      }),
      expect.anything(),
    );
  });

  it('writes EMAIL delivery rows only for messages the transport accepted', async () => {
    const { service, deliveryCreateMany, sendReportDelivered } =
      makeDeliverService({
        guests: [
          guest(),
          guest({
            id: 'g2',
            email: 'sourcing@northwind.example',
            token: 'magic-2',
          }),
        ],
      });
    sendReportDelivered
      .mockResolvedValueOnce({ sent: true, messageId: 'mid-1' })
      .mockResolvedValueOnce({ sent: false, messageId: 'mid-2' });

    const out = await service.deliver('org1', OWNER, 'rep1');
    expect(out.recipients).toEqual([
      { email: 'buyer.qa@northwind.example', sent: true },
      { email: 'sourcing@northwind.example', sent: false },
    ]);
    expect(out.emailsSent).toBe(1);
    expect(deliveryCreateMany).toHaveBeenCalledWith({
      data: [
        {
          reportId: 'rep1',
          channel: 'EMAIL',
          recipientEmail: 'buyer.qa@northwind.example',
        },
      ],
    });
  });

  // MailService's contract is {sent:false}, never a throw — but the whole
  // post-commit block is still belt-and-braces: the delivery already committed.
  it('survives a failing mail path without failing (or rolling back) the delivery', async () => {
    const { service, deliveryCreate, deliveryCreateMany } = makeDeliverService({
      mailThrows: true,
    });
    const out = await service.deliver('org1', OWNER, 'rep1');
    expect(out.status).toBe('DELIVERED');
    expect(out.emailsSent).toBe(0);
    expect(deliveryCreate).toHaveBeenCalledTimes(1); // the PORTAL row still committed
    expect(deliveryCreateMany).not.toHaveBeenCalled(); // no row claims a send that failed
  });

  it('reports {sent:false} per recipient when SMTP refuses the message', async () => {
    const { service, deliveryCreateMany } = makeDeliverService({
      mailSent: false,
    });
    const out = await service.deliver('org1', OWNER, 'rep1');
    expect(out.recipients).toEqual([
      { email: 'buyer.qa@northwind.example', sent: false },
    ]);
    expect(out.emailsSent).toBe(0);
    expect(deliveryCreateMany).not.toHaveBeenCalled();
  });

  it('handles a buyer with no eligible guests: publishes to the portal, mails nobody', async () => {
    const {
      service,
      sendReportDelivered,
      deliveryCreate,
      deliveryCreateMany,
      audit,
    } = makeDeliverService({ guests: [] });
    const out = await service.deliver('org1', OWNER, 'rep1');

    expect(sendReportDelivered).not.toHaveBeenCalled();
    expect(deliveryCreateMany).not.toHaveBeenCalled();
    expect(deliveryCreate).toHaveBeenCalledWith({
      data: { reportId: 'rep1', channel: 'PORTAL' },
    });
    expect(out.status).toBe('DELIVERED');
    expect(out.recipients).toEqual([]);
    expect(out.emailsSent).toBe(0);
    const call = audit.append.mock.calls.find(
      (c) => c[0].action === 'report.delivered',
    );
    expect(call![0].metadata).toMatchObject({
      recipientCount: 0,
      recipients: [],
    });
  });

  it('re-delivering appends a new row and keeps the ORIGINAL deliveredAt', async () => {
    const firstDelivery = new Date(Date.now() - 3 * HOUR);
    const { service, deliveryCreate, reportUpdate } = makeDeliverService({
      report: {
        id: 'rep1',
        orgId: 'org1',
        clientCompanyId: 'buy1',
        verificationToken: 'tok-verify',
        deliveredAt: firstDelivery,
        status: 'DELIVERED',
        clientCompany: { id: 'buy1', name: 'Northwind Apparel' },
        inspection: { purchaseOrder: { poNumber: 'PO-1' } },
      },
    });
    await service.deliver('org1', OWNER, 'rep1');
    expect(deliveryCreate).toHaveBeenCalledTimes(1); // appended, never updated
    expect(reportUpdate).toHaveBeenCalledWith({
      where: { id: 'rep1' },
      data: { status: 'DELIVERED', deliveredAt: firstDelivery },
    });
  });

  it('404s a report in another tenant without touching guests or mail', async () => {
    const { service, guestFindMany, sendReportDelivered } = makeDeliverService({
      report: null,
    });
    await expect(
      service.deliver('org1', OWNER, 'rep-foreign'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(guestFindMany).not.toHaveBeenCalled();
    expect(sendReportDelivered).not.toHaveBeenCalled();
  });

  it('tolerates a report whose inspection has no PO number', async () => {
    const { service, sendReportDelivered } = makeDeliverService({
      report: {
        id: 'rep1',
        orgId: 'org1',
        clientCompanyId: 'buy1',
        verificationToken: 'tok-verify',
        deliveredAt: null,
        status: 'GENERATED',
        clientCompany: { id: 'buy1', name: 'Northwind Apparel' },
        inspection: { purchaseOrder: null },
      },
    });
    await service.deliver('org1', OWNER, 'rep1');
    expect(sendReportDelivered).toHaveBeenCalledWith(
      expect.objectContaining({ poNumber: null }),
    );
  });
});
