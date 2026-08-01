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
 * Buyer guest portal (spec §11): read-only access scoped to ONE buyer's reports
 * within ONE tenant, authenticated by a magic-link token (not a User).
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
    const guest = await this.prisma.buyerGuest.findUnique({ where: { token } });
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
    buyerGuestId: string,
    action: 'VIEW' | 'DOWNLOAD',
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    try {
      await this.prisma.reportAccess.create({
        data: { reportId, buyerGuestId, action, ipAddress, userAgent },
      });
    } catch (err) {
      this.logger.error(
        `Failed to record ${action} access to report ${reportId} by guest ${buyerGuestId}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  async listReports(token: string) {
    const guest = await this.guestByToken(token);
    await this.prisma.buyerGuest.update({
      where: { id: guest.id },
      data: { lastAccessAt: new Date() },
    });
    return this.prisma.report.findMany({
      where: { buyerId: guest.buyerId, orgId: guest.orgId },
      orderBy: { generatedAt: 'desc' },
    });
  }

  async getReport(token: string, reportId: string, ipAddress?: string, userAgent?: string) {
    const guest = await this.guestByToken(token);
    const report = await this.prisma.report.findFirst({
      where: { id: reportId, buyerId: guest.buyerId, orgId: guest.orgId },
    });
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    await this.recordAccess(report.id, guest.id, 'VIEW', ipAddress, userAgent);
    // Buyer-visible photo evidence (INS-049): short-lived presigned GET URLs.
    // Never fails the read — presign problems degrade to viewUrl:null.
    const photoRows = await this.prisma.photo.findMany({
      where: { inspectionId: report.inspectionId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, contentHash: true, storageKey: true, inspectionLoopId: true },
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
      where: { id: reportId, buyerId: guest.buyerId, orgId: guest.orgId },
      select: { id: true, pdfStorageKey: true },
    });
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    const presigned = presignReportPdf(this.storage, report.pdfStorageKey);
    await this.recordAccess(report.id, guest.id, 'DOWNLOAD', ipAddress, userAgent);
    return { reportId: report.id, ...presigned };
  }
}
