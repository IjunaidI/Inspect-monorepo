import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { presignReportPdf } from '../reports/reports.service';
import { StorageService } from '../storage/storage.service';

/**
 * Company guest portal (spec §11): read-only access scoped to ONE company's
 * CLIENT-role reports within ONE tenant, authenticated by a magic-link token
 * (not a User).
 *
 * ── THE SECURITY BOUNDARY (INS-055 spec §4.2) ──────────────────────────────
 * Every report lookup below keys on `clientCompanyId` AND `orgId`. Three rules
 * the implementation must not violate:
 *
 *  1. KEEP THE orgId CONJUNCT. It is the tenant boundary, not belt-and-braces.
 *     "Simplifying" to clientCompanyId alone would rest the whole isolation
 *     guarantee on company ids being unguessable.
 *  2. KEY ON clientCompanyId ONLY — never a party-agnostic predicate. Now that
 *     one model plays both trade roles, `OR: [{clientCompanyId}, {factoryCompanyId}]`
 *     reads like a natural generalization. It would hand a FACTORY's guest the
 *     CLIENT's signed report. That leak did not exist before this epic and must
 *     not be introduced by it. Regression test: company-model.e2e-spec.ts,
 *     'a factory-role guest sees no reports'.
 *  3. LEAVE THE PHOTO QUERY'S REACHABILITY ALONE. getReport()'s photo fetch has
 *     no orgId filter and is safe ONLY because it is reached through an
 *     already-scoped report lookup. Keep that ordering: scoped report first,
 *     photos second, never photos from a caller-supplied id.
 */
@Injectable()
export class GuestService {
  private readonly logger = new Logger(GuestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private async guestByToken(token: string) {
    if (!token) {
      throw new UnauthorizedException('Missing guest token');
    }
    const guest = await this.prisma.companyGuest.findUnique({
      where: { token },
    });
    if (!guest || guest.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid guest token');
    }
    if (guest.tokenExpiresAt && guest.tokenExpiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Guest token expired');
    }
    return guest;
  }

  /**
   * INS-020 — the buyer-side half of the delivery loop: who opened which report,
   * when, and from where.
   *
   * Deliberately non-blocking. This is an access LOG, not an access CHECK (the
   * magic-link check already happened) — a logging failure must never deny a
   * buyer the report they were legitimately delivered.
   */
  private async recordAccess(
    reportId: string,
    companyGuestId: string,
    action: 'VIEW' | 'DOWNLOAD',
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    try {
      await this.prisma.reportAccess.create({
        data: { reportId, companyGuestId, action, ipAddress, userAgent },
      });
    } catch (err) {
      this.logger.error(
        `Failed to record ${action} access to report ${reportId} by guest ${companyGuestId}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  async listReports(token: string) {
    const guest = await this.guestByToken(token);
    await this.prisma.companyGuest.update({
      where: { id: guest.id },
      data: { lastAccessAt: new Date() },
    });
    return this.prisma.report.findMany({
      where: { clientCompanyId: guest.companyId, orgId: guest.orgId },
      orderBy: { generatedAt: 'desc' },
    });
  }

  async getReport(
    token: string,
    reportId: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const guest = await this.guestByToken(token);
    const report = await this.prisma.report.findFirst({
      where: {
        id: reportId,
        clientCompanyId: guest.companyId,
        orgId: guest.orgId,
      },
    });
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    await this.recordAccess(report.id, guest.id, 'VIEW', ipAddress, userAgent);
    // Buyer-visible photo evidence (INS-049): short-lived presigned GET URLs.
    // Never fails the read — presign problems degrade to viewUrl:null.
    // INS-081: ordered by unit, then by the item's position in the loop — the
    // same sequence the signed snapshot's photoHashes use.
    const photoRows = await this.prisma.photo.findMany({
      where: { inspectionId: report.inspectionId },
      orderBy: [
        { cycleIndex: 'asc' },
        { inspectionLoopItem: { position: 'asc' } },
      ],
      select: {
        id: true,
        contentHash: true,
        storageKey: true,
        inspectionLoopItemId: true,
        cycleIndex: true,
      },
    });
    const photos = photoRows.map(({ storageKey, ...p }) => {
      try {
        return { ...p, viewUrl: this.storage.presignDownload(storageKey) };
      } catch {
        return { ...p, viewUrl: null as string | null };
      }
    });
    return { ...report, photos, pdfAvailable: report.pdfStorageKey !== null };
  }

  /**
   * INS-020 — the buyer downloads the branded PDF of a report delivered to them.
   *
   * Returns a short-lived presigned GET URL (never streams bytes through the
   * API), exactly like the org-side `GET /reports/:id/pdf`, and records a
   * DOWNLOAD access. The presign runs FIRST so a report with no stored rendition
   * 404s without logging a download that never happened.
   */
  async downloadReportPdf(
    token: string,
    reportId: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const guest = await this.guestByToken(token);
    const report = await this.prisma.report.findFirst({
      where: {
        id: reportId,
        clientCompanyId: guest.companyId,
        orgId: guest.orgId,
      },
      select: { id: true, pdfStorageKey: true },
    });
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    const presigned = presignReportPdf(this.storage, report.pdfStorageKey);
    await this.recordAccess(
      report.id,
      guest.id,
      'DOWNLOAD',
      ipAddress,
      userAgent,
    );
    return { reportId: report.id, ...presigned };
  }
}
