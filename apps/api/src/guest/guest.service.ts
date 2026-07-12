import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/**
 * Buyer guest portal (spec §11): read-only access scoped to ONE buyer's reports
 * within ONE tenant, authenticated by a magic-link token (not a User).
 */
@Injectable()
export class GuestService {
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
    await this.prisma.reportAccess.create({
      data: {
        reportId: report.id,
        buyerGuestId: guest.id,
        action: 'VIEW',
        ipAddress,
        userAgent,
      },
    });
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
    return { ...report, photos };
  }
}
