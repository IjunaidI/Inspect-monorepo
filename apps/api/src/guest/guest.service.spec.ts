import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { GuestService } from './guest.service';

/**
 * INS-034 — the guest module's magic-link auth and report-visibility predicate.
 *
 * The visibility predicate is a SECURITY BOUNDARY (INS-055 spec §4.2, and the
 * "Guest report visibility keys on clientCompanyId AND orgId" invariant in the
 * root CLAUDE.md). Two mutations this suite must catch:
 *
 *   - dropping the `orgId` conjunct (a same-company guest from another tenant
 *     would see this tenant's reports);
 *   - generalising to a party-agnostic predicate (a FACTORY's guest would see
 *     the CLIENT's signed report). `Report` deliberately has NO
 *     `factoryCompanyId` column, so the realistic form of that mutation is the
 *     relation filter `OR: [{ clientCompanyId }, { inspection: { factoryCompanyId } }]`
 *     — which is why the fixture carries the factory on `inspection`, and why
 *     the `where` evaluator below descends into relation filters.
 *
 * The Prisma mock is a tiny in-memory store with a real `where` evaluator for
 * the `report` delegate, so the assertions run against what the service
 * actually asks the database — the predicate the service builds is the thing
 * under test, and matching on `toHaveBeenCalledWith` alone would let an `OR`
 * rewrite through if the test author mirrored it.
 */

const NOW = new Date('2026-09-05T12:00:00Z');
const FUTURE = new Date('2026-12-31T00:00:00Z');
const PAST = new Date('2026-01-01T00:00:00Z');

type GuestRow = {
  id: string;
  token: string;
  orgId: string;
  companyId: string;
  status: 'ACTIVE' | 'REVOKED';
  tokenExpiresAt: Date | null;
};

type ReportRow = {
  id: string;
  orgId: string;
  inspectionId: string;
  clientCompanyId: string;
  /** The factory lives on the inspection edge; Report has no such column. */
  inspection: { factoryCompanyId: string | null };
  generatedAt: Date;
  pdfStorageKey: string | null;
};

const GUESTS: GuestRow[] = [
  // The client (buyer) company's guest, in orgA. The happy path.
  {
    id: 'g-client',
    token: 'tok-client',
    orgId: 'orgA',
    companyId: 'brand',
    status: 'ACTIVE',
    tokenExpiresAt: FUTURE,
  },
  // The FACTORY company's guest, same org — must see nothing.
  {
    id: 'g-factory',
    token: 'tok-factory',
    orgId: 'orgA',
    companyId: 'mill',
    status: 'ACTIVE',
    tokenExpiresAt: FUTURE,
  },
  // Same company id, DIFFERENT org — must see nothing.
  {
    id: 'g-other-org',
    token: 'tok-other-org',
    orgId: 'orgB',
    companyId: 'brand',
    status: 'ACTIVE',
    tokenExpiresAt: FUTURE,
  },
  // Non-expiring token (null expiry) — allowed.
  {
    id: 'g-no-expiry',
    token: 'tok-no-expiry',
    orgId: 'orgA',
    companyId: 'brand',
    status: 'ACTIVE',
    tokenExpiresAt: null,
  },
  {
    id: 'g-expired',
    token: 'tok-expired',
    orgId: 'orgA',
    companyId: 'brand',
    status: 'ACTIVE',
    tokenExpiresAt: PAST,
  },
  {
    id: 'g-revoked',
    token: 'tok-revoked',
    orgId: 'orgA',
    companyId: 'brand',
    status: 'REVOKED',
    tokenExpiresAt: FUTURE,
  },
];

const REPORTS: ReportRow[] = [
  // orgA: brand is the client, mill is the factory.
  {
    id: 'r1',
    orgId: 'orgA',
    inspectionId: 'i1',
    clientCompanyId: 'brand',
    inspection: { factoryCompanyId: 'mill' },
    generatedAt: new Date('2026-08-01T00:00:00Z'),
    pdfStorageKey: 'orgs/orgA/reports/r1.pdf',
  },
  {
    id: 'r2',
    orgId: 'orgA',
    inspectionId: 'i2',
    clientCompanyId: 'brand',
    inspection: { factoryCompanyId: 'mill' },
    generatedAt: new Date('2026-08-15T00:00:00Z'),
    pdfStorageKey: null,
  },
  // orgA: a report where mill is the CLIENT — the only one its guest may see.
  {
    id: 'r-mill-client',
    orgId: 'orgA',
    inspectionId: 'i3',
    clientCompanyId: 'mill',
    inspection: { factoryCompanyId: 'other' },
    generatedAt: new Date('2026-07-01T00:00:00Z'),
    pdfStorageKey: null,
  },
  // orgB: a report for a company that happens to share brand's id in orgB's
  // namespace. brand's orgA guest must never see it.
  {
    id: 'r-orgB',
    orgId: 'orgB',
    inspectionId: 'i4',
    clientCompanyId: 'brand',
    inspection: { factoryCompanyId: 'mill' },
    generatedAt: new Date('2026-08-20T00:00:00Z'),
    pdfStorageKey: 'orgs/orgB/reports/r-orgB.pdf',
  },
];

/**
 * Evaluate a Prisma `where` against a row. Supports equality on scalar keys,
 * the `OR`/`AND` combinators and one-level relation filters (`inspection: {…}`)
 * — enough to make a party-agnostic rewrite of the predicate OBSERVABLE: an
 * `OR` reaching `inspection.factoryCompanyId` would start matching r1/r2 for
 * the factory guest and fail the tests below.
 */
function matches(
  row: Record<string, unknown>,
  where: Record<string, unknown>,
): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (key === 'OR') {
      const alts = value as Record<string, unknown>[];
      if (!alts.some((alt) => matches(row, alt))) return false;
      continue;
    }
    if (key === 'AND') {
      const alts = value as Record<string, unknown>[];
      if (!alts.every((alt) => matches(row, alt))) return false;
      continue;
    }
    if (
      value !== null &&
      typeof value === 'object' &&
      !(value instanceof Date)
    ) {
      // Relation filter: descend into the related row.
      const related = row[key];
      if (!related || typeof related !== 'object') return false;
      if (
        !matches(
          related as Record<string, unknown>,
          value as Record<string, unknown>,
        )
      ) {
        return false;
      }
      continue;
    }
    if (row[key] !== value) return false;
  }
  return true;
}

function makeService(
  opts: { reports?: ReportRow[]; presignThrows?: boolean } = {},
) {
  const reports = opts.reports ?? REPORTS;
  const findManyReports = jest.fn(
    async ({
      where,
      orderBy,
    }: {
      where: Record<string, unknown>;
      orderBy?: { generatedAt?: 'asc' | 'desc' };
    }) => {
      const hits = reports.filter((r) => matches(r, where));
      // Honour the one ordering the service asks for, so "newest first" is a
      // real assertion rather than an accident of fixture order.
      if (orderBy?.generatedAt) {
        const sign = orderBy.generatedAt === 'desc' ? -1 : 1;
        hits.sort(
          (a, b) => sign * (a.generatedAt.getTime() - b.generatedAt.getTime()),
        );
      }
      return hits;
    },
  );
  const findFirstReport = jest.fn(
    async ({ where }: { where: Record<string, unknown> }) =>
      reports.find((r) => matches(r, where)) ?? null,
  );
  const prisma = {
    companyGuest: {
      findUnique: jest.fn(
        async ({ where }: { where: { token: string } }) =>
          GUESTS.find((g) => g.token === where.token) ?? null,
      ),
      update: jest.fn(async () => ({})),
    },
    report: { findMany: findManyReports, findFirst: findFirstReport },
    photo: {
      findMany: jest.fn(async () => [
        {
          id: 'p1',
          contentHash: 'h1',
          storageKey: 'orgs/orgA/photos/p1.jpg',
          inspectionLoopItemId: 'li1',
          cycleIndex: 0,
        },
      ]),
    },
    reportAccess: { create: jest.fn(async () => ({})) },
  };
  const storage = {
    presignDownload: jest.fn((key: string) => {
      if (opts.presignThrows) throw new Error('storage unconfigured');
      return `https://signed/${key}`;
    }),
  };
  const service = new GuestService(prisma as any, storage as any);
  return { service, prisma, storage };
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
});
afterEach(() => {
  jest.useRealTimers();
});

// ── token → guest resolution ─────────────────────────────────────────────────

describe('GuestService token resolution', () => {
  it('looks the guest up by the raw token', async () => {
    const { service, prisma } = makeService();
    await service.listReports('tok-client');
    expect(prisma.companyGuest.findUnique).toHaveBeenCalledWith({
      where: { token: 'tok-client' },
    });
  });

  it('refuses an empty token with 401 before touching the DB', async () => {
    const { service, prisma } = makeService();
    await expect(service.listReports('')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.companyGuest.findUnique).not.toHaveBeenCalled();
    expect(prisma.report.findMany).not.toHaveBeenCalled();
  });

  it('refuses an unknown token with 401', async () => {
    const { service, prisma } = makeService();
    await expect(service.listReports('tok-nobody')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.report.findMany).not.toHaveBeenCalled();
  });

  it('refuses a REVOKED guest with 401 even when the token is unexpired', async () => {
    const { service, prisma } = makeService();
    await expect(service.listReports('tok-revoked')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.report.findMany).not.toHaveBeenCalled();
  });

  it('refuses an expired token with 401 even when the guest is ACTIVE', async () => {
    const { service, prisma } = makeService();
    await expect(service.listReports('tok-expired')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.report.findMany).not.toHaveBeenCalled();
  });

  it('a token expiring exactly now is still valid (strict less-than)', async () => {
    const { service } = makeService();
    // GUESTS is shared; add a boundary guest through the mock instead.
    const boundary: GuestRow = {
      id: 'g-boundary',
      token: 'tok-boundary',
      orgId: 'orgA',
      companyId: 'brand',
      status: 'ACTIVE',
      tokenExpiresAt: new Date(NOW.getTime()),
    };
    GUESTS.push(boundary);
    try {
      await expect(service.listReports('tok-boundary')).resolves.toHaveLength(
        2,
      );
    } finally {
      GUESTS.pop();
    }
  });

  it('a null tokenExpiresAt never expires', async () => {
    const { service } = makeService();
    await expect(service.listReports('tok-no-expiry')).resolves.toHaveLength(2);
  });

  it('every entry point runs the same guest check', async () => {
    const { service } = makeService();
    await expect(service.getReport('tok-revoked', 'r1')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      service.downloadReportPdf('tok-expired', 'r1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('a successful list stamps lastAccessAt on the guest', async () => {
    const { service, prisma } = makeService();
    await service.listReports('tok-client');
    expect(prisma.companyGuest.update).toHaveBeenCalledWith({
      where: { id: 'g-client' },
      data: { lastAccessAt: expect.any(Date) },
    });
  });
});

// ── the visibility predicate (security boundary) ─────────────────────────────

describe('GuestService report visibility — clientCompanyId AND orgId', () => {
  it('the client company guest sees exactly its org-scoped client-role reports, newest first', async () => {
    const { service } = makeService();
    const rows = await service.listReports('tok-client');
    expect(rows.map((r) => r.id)).toEqual(['r2', 'r1']);
  });

  it('the predicate the service sends is the conjunction, with no factory edge', async () => {
    const { service, prisma } = makeService();
    await service.listReports('tok-client');
    const { where } = prisma.report.findMany.mock.calls[0][0];
    expect(where).toEqual({ clientCompanyId: 'brand', orgId: 'orgA' });
    // Belt and braces against a "helpful" generalisation.
    expect(JSON.stringify(where)).not.toContain('factoryCompanyId');
    expect(where).not.toHaveProperty('OR');
  });

  /**
   * MUTATION CHECK — party-agnostic predicate. `mill` is the factory on r1/r2
   * and the client on exactly one report. An `OR: [{ clientCompanyId },
   * { inspection: { factoryCompanyId } }]` would return three rows here; the
   * boundary says one.
   */
  it("a FACTORY-side guest does not see the client's reports (list)", async () => {
    const { service } = makeService();
    const rows = await service.listReports('tok-factory');
    expect(rows.map((r) => r.id)).toEqual(['r-mill-client']);
    expect(rows.map((r) => r.id)).not.toContain('r1');
    expect(rows.map((r) => r.id)).not.toContain('r2');
  });

  it("a FACTORY-side guest gets 404 for the client's report by id (get)", async () => {
    const { service, prisma } = makeService();
    await expect(service.getReport('tok-factory', 'r1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // Nothing downstream of the scoped lookup ran: no access log, no photos.
    expect(prisma.reportAccess.create).not.toHaveBeenCalled();
    expect(prisma.photo.findMany).not.toHaveBeenCalled();
  });

  it("a FACTORY-side guest gets 404 for the client's PDF (download)", async () => {
    const { service, prisma } = makeService();
    await expect(
      service.downloadReportPdf('tok-factory', 'r1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.reportAccess.create).not.toHaveBeenCalled();
  });

  /**
   * MUTATION CHECK — missing orgId conjunct. `brand`'s guest in orgB shares
   * the company id but not the tenant. Dropping `orgId` from the predicate
   * would hand it orgA's r1/r2 (and hand orgA's guest r-orgB).
   */
  it("a same-company guest from ANOTHER org sees only its own org's reports (list)", async () => {
    const { service } = makeService();
    const rows = await service.listReports('tok-other-org');
    expect(rows.map((r) => r.id)).toEqual(['r-orgB']);
  });

  it('the orgA client guest does not see the orgB report either', async () => {
    const { service } = makeService();
    const rows = await service.listReports('tok-client');
    expect(rows.map((r) => r.id)).not.toContain('r-orgB');
  });

  it('a same-company guest from another org gets 404 by id (get + download)', async () => {
    const { service, prisma } = makeService();
    await expect(
      service.getReport('tok-other-org', 'r1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.downloadReportPdf('tok-other-org', 'r1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.reportAccess.create).not.toHaveBeenCalled();
  });

  it('getReport and downloadReportPdf send the same conjunctive predicate plus the id', async () => {
    const { service, prisma } = makeService();
    await service.getReport('tok-client', 'r1');
    await service.downloadReportPdf('tok-client', 'r1');
    for (const call of prisma.report.findFirst.mock.calls) {
      const { where } = call[0];
      expect(where).toEqual({
        id: 'r1',
        clientCompanyId: 'brand',
        orgId: 'orgA',
      });
      expect(where).not.toHaveProperty('OR');
    }
  });
});

// ── getReport: access log + photo evidence ───────────────────────────────────

describe('GuestService.getReport', () => {
  it('returns the report with presigned photos and pdfAvailable', async () => {
    const { service, storage } = makeService();
    const out = await service.getReport('tok-client', 'r1', '1.2.3.4', 'UA');
    expect(out.id).toBe('r1');
    expect(out.pdfAvailable).toBe(true);
    expect(out.photos).toEqual([
      {
        id: 'p1',
        contentHash: 'h1',
        inspectionLoopItemId: 'li1',
        cycleIndex: 0,
        viewUrl: 'https://signed/orgs/orgA/photos/p1.jpg',
      },
    ]);
    // storageKey is never leaked to the guest.
    expect(out.photos[0]).not.toHaveProperty('storageKey');
    expect(storage.presignDownload).toHaveBeenCalledWith(
      'orgs/orgA/photos/p1.jpg',
    );
  });

  it('pdfAvailable is false when no rendition is stored', async () => {
    const { service } = makeService();
    const out = await service.getReport('tok-client', 'r2');
    expect(out.pdfAvailable).toBe(false);
  });

  it('records a VIEW access with ip + user agent (INS-020)', async () => {
    const { service, prisma } = makeService();
    await service.getReport('tok-client', 'r1', '1.2.3.4', 'UA');
    expect(prisma.reportAccess.create).toHaveBeenCalledWith({
      data: {
        reportId: 'r1',
        companyGuestId: 'g-client',
        action: 'VIEW',
        ipAddress: '1.2.3.4',
        userAgent: 'UA',
      },
    });
  });

  it('a failing access log never denies the read', async () => {
    const { service, prisma } = makeService();
    prisma.reportAccess.create.mockRejectedValueOnce(new Error('db down'));
    await expect(service.getReport('tok-client', 'r1')).resolves.toMatchObject({
      id: 'r1',
    });
  });

  it('a presign failure degrades to viewUrl null instead of failing the read', async () => {
    const { service } = makeService({ presignThrows: true });
    const out = await service.getReport('tok-client', 'r1');
    expect(out.photos[0].viewUrl).toBeNull();
  });

  it('the photo query is reached only through the scoped report (rule 3)', async () => {
    const { service, prisma } = makeService();
    await service.getReport('tok-client', 'r1');
    expect(prisma.photo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { inspectionId: 'i1' } }),
    );
    // findFirst (scoped) ran before the photo fetch.
    const order = [
      prisma.report.findFirst.mock.invocationCallOrder[0],
      prisma.photo.findMany.mock.invocationCallOrder[0],
    ];
    expect(order[0]).toBeLessThan(order[1]);
  });
});

// ── downloadReportPdf ────────────────────────────────────────────────────────

describe('GuestService.downloadReportPdf', () => {
  it('returns a presigned URL and records a DOWNLOAD access', async () => {
    const { service, prisma } = makeService();
    const out = await service.downloadReportPdf(
      'tok-client',
      'r1',
      '9.9.9.9',
      'UA',
    );
    expect(out).toEqual({
      reportId: 'r1',
      url: 'https://signed/orgs/orgA/reports/r1.pdf',
      expiresInSeconds: expect.any(Number),
    });
    expect(prisma.reportAccess.create).toHaveBeenCalledWith({
      data: {
        reportId: 'r1',
        companyGuestId: 'g-client',
        action: 'DOWNLOAD',
        ipAddress: '9.9.9.9',
        userAgent: 'UA',
      },
    });
  });

  it('404s without logging a download when no PDF rendition is stored', async () => {
    const { service, prisma } = makeService();
    await expect(
      service.downloadReportPdf('tok-client', 'r2'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.reportAccess.create).not.toHaveBeenCalled();
  });
});
