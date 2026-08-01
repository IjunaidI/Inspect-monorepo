import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createPublicKey } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { actorTypeFor } from '../audit/actor-type';
import { AuthUser } from '../auth/auth-user';
import { MailService } from '../mail/mail.service';
import { StorageService } from '../storage/storage.service';
import { contentHash } from '../tamper-proof/content-hash';
import { sign, verify } from '../tamper-proof/signature';
import { renderReportPdf } from './report-pdf';

/** Minimal shape the PDF rendition needs — satisfied by a Prisma Report row. */
type ReportRow = {
  id: string;
  orgId: string;
  pdfStorageKey: string | null;
  brandingSnapshot: unknown;
  canonicalSnapshot: unknown;
  contentHash: string;
  signature: string;
  verificationToken: string;
  generatedAt: Date;
};

const DEFAULT_WEB_BASE_URL = 'http://localhost:3001';

/** TTL of a presigned report-PDF URL — short, because the link is handed out. */
const REPORT_PDF_URL_TTL_SECONDS = 300;

/**
 * Presign a stored report PDF.
 *
 * A free function (not just a method) because the buyer-guest portal needs the
 * exact same behaviour after its own magic-link check, and `GuestService` cannot
 * inject `ReportsService` without a module import. Keeping the "is there a PDF /
 * how long is the URL good for" contract here means both callers 404 identically.
 */
export function presignReportPdf(
  storage: StorageService,
  pdfStorageKey: string | null | undefined,
): { url: string; expiresInSeconds: number } {
  if (!pdfStorageKey) {
    throw new NotFoundException(
      'No PDF rendition is stored for this report yet (the signed record is still valid — re-generate to render it)',
    );
  }
  return {
    url: storage.presignDownload(pdfStorageKey, REPORT_PDF_URL_TTL_SECONDS),
    expiresInSeconds: REPORT_PDF_URL_TTL_SECONDS,
  };
}

/** One recipient of a report delivery and whether their email actually left. */
export interface DeliveryRecipientResult {
  email: string;
  sent: boolean;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly mail: MailService,
  ) {}

  private signingPrivateKey(): string {
    const pem = this.config.get<string>('REPORT_SIGNING_PRIVATE_KEY_PEM');
    if (!pem) {
      throw new BadRequestException('REPORT_SIGNING_PRIVATE_KEY_PEM is not configured');
    }
    return pem;
  }

  /** Public verification page for a report (spec §9) — printed in the PDF footer. */
  private verificationUrl(verificationToken: string): string {
    const base = (this.config.get<string>('WEB_BASE_URL') || DEFAULT_WEB_BASE_URL).replace(
      /\/+$/,
      '',
    );
    return `${base}/r/${verificationToken}`;
  }

  /** Generate the immutable, signed report for an APPROVED inspection (spec §10). */
  async generate(orgId: string, actor: AuthUser, inspectionId: string) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id: inspectionId, orgId },
      include: {
        buyer: true,
        supplier: true,
        product: true,
        purchaseOrder: true,
        aqlResult: true,
        loops: { orderBy: { position: 'asc' }, include: { measurements: true } },
        defects: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: { photos: true },
        },
        photos: { orderBy: { createdAt: 'asc' } },
        report: true,
      },
    });
    if (!inspection) throw new NotFoundException('Inspection not found');
    // Immutable + idempotent. The signed record never changes; the PDF rendition
    // is backfilled here when a previous generate() ran with storage down.
    if (inspection.report) return this.ensurePdf(orgId, actor, inspection.report);
    if (inspection.status !== 'APPROVED') {
      throw new BadRequestException('Only an APPROVED inspection can be reported');
    }

    const orderedPhotoHashes = inspection.photos.map((p) => p.contentHash);
    // Everything a buyer can see on the report MUST be inside the signed envelope
    // (security review): the defect list + its photo evidence, the quantity/carton
    // verification, workmanship/packaging notes, supplier/product identity, and the
    // decision author/timestamp — otherwise those fields could be altered after
    // signing while public verification still returns valid:true.
    const rawCanonical = {
      inspectionId: inspection.id,
      inspectionType: inspection.inspectionType,
      poNumber: inspection.purchaseOrder?.poNumber ?? null,
      buyer: { id: inspection.buyerId, name: inspection.buyer?.name ?? null },
      supplier: { id: inspection.supplierId, name: inspection.supplier?.name ?? null },
      product: {
        id: inspection.productId,
        styleNumber: inspection.product?.styleNumber ?? null,
        description: inspection.product?.description ?? null,
      },
      lotSize: inspection.lotSize,
      aqlLevel: inspection.aqlLevel,
      aqlPlan: inspection.aqlPlan,
      computedSampling: inspection.computedSampling,
      quantity: {
        cartonsTotal: inspection.cartonsTotal,
        cartonsInspected: inspection.cartonsInspected,
        quantityPresented: inspection.quantityPresented,
        quantityShortfall: inspection.quantityShortfall,
      },
      workmanshipNotes: inspection.workmanshipNotes,
      packagingNotes: inspection.packagingNotes,
      aqlResult: inspection.aqlResult
        ? {
            perClass: inspection.aqlResult.perClass,
            systemRecommendation: inspection.aqlResult.systemRecommendation,
            qaDecision: inspection.aqlResult.qaDecision,
            qaRemarks: inspection.aqlResult.qaRemarks,
            decidedByUserId: inspection.aqlResult.decidedByUserId,
            decidedAt: inspection.aqlResult.decidedAt
              ? inspection.aqlResult.decidedAt.toISOString()
              : null,
          }
        : null,
      // Ordered, canonicalized defect narrative + evidence mapping (the core of
      // a photo-loop QC report). Ordering is fixed by the query (createdAt, id).
      defects: inspection.defects.map((d) => ({
        defectCatalogId: d.defectCatalogId ?? null,
        customText: d.customText ?? null,
        severity: d.severity,
        notes: d.notes ?? null,
        inspectionLoopId: d.inspectionLoopId ?? null,
        photoIds: d.photos.map((p) => p.photoId).sort(),
      })),
      tamperProof: inspection.tamperProof,
      loops: inspection.loops.map((l) => ({
        position: l.position,
        zoneName: l.zoneName,
        notes: l.notes,
        measurements: l.measurements.map((m) => ({
          label: m.label,
          recordedValue: m.recordedValue,
          unit: m.unit,
        })),
      })),
      photoHashes: orderedPhotoHashes,
    };
    // Hash the exact structure that will be persisted: a jsonb round-trip drops
    // undefined-valued keys, so normalize first to keep generate-time and
    // verify-time hashes identical (security review).
    const canonical = JSON.parse(JSON.stringify(rawCanonical));

    const hash = contentHash(canonical, orderedPhotoHashes);
    const signature = sign(hash, this.signingPrivateKey());
    const brandingSnapshot = {
      logoUrl: inspection.buyer?.logoUrl ?? undefined,
      primaryColor: inspection.buyer?.primaryColor ?? undefined,
      branding: inspection.buyer?.branding ?? undefined,
    };

    try {
      const report = await this.prisma.$transaction(async (tx) => {
        const created = await tx.report.create({
          data: {
            inspectionId: inspection.id,
            orgId,
            buyerId: inspection.buyerId,
            brandingSnapshot: brandingSnapshot as unknown as Prisma.InputJsonValue,
            canonicalSnapshot: canonical as unknown as Prisma.InputJsonValue,
            contentHash: hash,
            signature,
            status: 'GENERATED',
            // pdfStorageKey is attached right after commit (INS-003): the signed
            // row is the product guarantee and must not depend on object storage.
          },
        });
        await tx.inspection.update({
          where: { id: inspection.id },
          data: { status: 'REPORT_ISSUED' },
        });
        await this.audit.append(
          {
            orgId,
            actorType: actorTypeFor(actor),
            actorUserId: actor.userId,
            action: 'report.generated',
            entityType: 'Report',
            entityId: created.id,
            metadata: { inspectionId: inspection.id, contentHash: hash },
          },
          tx,
        );
        return created;
      });
      return await this.ensurePdf(orgId, actor, report);
    } catch (e) {
      // Concurrency-safe idempotency (security review): if a racing generate()
      // won the Report.inspectionId @unique, return the existing report instead
      // of surfacing an opaque 500.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.prisma.report.findFirst({
          where: { inspectionId, orgId },
        });
        if (existing) return existing;
      }
      throw e;
    }
  }

  /**
   * INS-003 — render + store the PDF rendition of an already-signed report.
   *
   * Deliberately best-effort: a storage outage, a misconfigured bucket or a
   * renderer bug must NEVER fail report generation or roll back the signed row.
   * The PDF is derived entirely from the frozen canonicalSnapshot/brandingSnapshot,
   * so re-rendering later produces the same document from the same signed content.
   */
  private async ensurePdf<T extends ReportRow>(
    orgId: string,
    actor: AuthUser,
    report: T,
  ): Promise<T> {
    if (report.pdfStorageKey) return report;
    if (!this.storage.isConfigured()) {
      this.logger.warn(
        `Report ${report.id} signed without a PDF rendition — object storage is not configured.`,
      );
      return report;
    }
    try {
      const bytes = await renderReportPdf({
        reportId: report.id,
        contentHash: report.contentHash,
        signature: report.signature,
        generatedAt: report.generatedAt,
        verificationUrl: this.verificationUrl(report.verificationToken),
        canonicalSnapshot: report.canonicalSnapshot,
        brandingSnapshot: report.brandingSnapshot,
      });
      const key = this.storage.keyForReportPdf(orgId, report.id);
      await this.storage.putObject(key, bytes, 'application/pdf');
      const updated = await this.prisma.$transaction(async (tx) => {
        const row = await tx.report.update({
          where: { id: report.id },
          data: { pdfStorageKey: key },
        });
        await this.audit.append(
          {
            orgId,
            actorType: actorTypeFor(actor),
            actorUserId: actor.userId,
            action: 'report.pdf.rendered',
            entityType: 'Report',
            entityId: report.id,
            // No pdf-hash column exists on Report today, so the byte digest is
            // recorded in the (hash-chained) audit metadata instead.
            metadata: { pdfStorageKey: key, pdfBytes: bytes.length },
          },
          tx,
        );
        return row;
      });
      return { ...report, ...updated } as T;
    } catch (err) {
      this.logger.error(
        `Report ${report.id} PDF rendition failed (the signed record is unaffected): ` +
          (err instanceof Error ? err.message : String(err)),
      );
      return report;
    }
  }

  /**
   * Short-lived presigned GET URL for a report's stored PDF, org-scoped.
   * 404 when the report is not in the caller's tenant (never leak existence).
   */
  async pdfDownload(orgId: string, reportId: string) {
    const report = await this.prisma.report.findFirst({
      where: { id: reportId, orgId },
      select: { id: true, pdfStorageKey: true, generatedAt: true },
    });
    if (!report) throw new NotFoundException('Report not found');
    return {
      reportId: report.id,
      ...this.presignPdf(report.pdfStorageKey),
    };
  }

  /**
   * Presign a stored report PDF. Shared with the buyer-guest path (the guest
   * portal must be able to download the same artifact after its own magic-link
   * check) so the "is there a PDF / how long is the URL good for" contract lives
   * in exactly one place.
   */
  presignPdf(pdfStorageKey: string | null | undefined): {
    url: string;
    expiresInSeconds: number;
  } {
    return presignReportPdf(this.storage, pdfStorageKey);
  }

  /**
   * INS-020 — deliver a generated report to the buyer's guests.
   *
   * Deliberately an EXPLICIT action, never a side effect of generate(): the org
   * decides when a buyer is told, and every send is an auditable event.
   *
   * What is recorded, and why in this order:
   *   - IN the transaction: the PORTAL delivery row (the report is now published
   *     to the buyer portal), the report's DELIVERED status, and the hash-chained
   *     AuditLog row. These are the facts the org is accountable for, so they
   *     commit atomically or not at all.
   *   - AFTER the commit: the emails (MailService never throws) and one EMAIL
   *     delivery row per recipient whose message was actually accepted by the
   *     transport — a bounced/refused send must not leave a row claiming
   *     delivery, and a mail outage must never roll back the published state.
   *
   * Re-delivering is safe and appends new rows (that IS the audit trail); within
   * one call each recipient is emailed exactly once, and `deliveredAt` keeps the
   * FIRST delivery time rather than rewriting history.
   */
  async deliver(orgId: string, actor: AuthUser, reportId: string) {
    const report = await this.prisma.report.findFirst({
      where: { id: reportId, orgId },
      include: {
        buyer: { select: { id: true, name: true } },
        inspection: { select: { purchaseOrder: { select: { poNumber: true } } } },
      },
    });
    if (!report) throw new NotFoundException('Report not found');

    const now = new Date();
    // Eligible = an ACTIVE guest of THIS report's buyer, in THIS tenant, holding
    // a live magic-link token. A revoked (token: null) or expired guest gets
    // nothing: the email's only payload is that token, so mailing them would be
    // a dead link, and mailing a revoked guest would be an access-control bug.
    const guests = await this.prisma.buyerGuest.findMany({
      where: {
        orgId,
        buyerId: report.buyerId,
        status: 'ACTIVE',
        token: { not: null },
        OR: [{ tokenExpiresAt: null }, { tokenExpiresAt: { gt: now } }],
      },
      select: { id: true, email: true, token: true },
      orderBy: { createdAt: 'asc' },
    });
    // BuyerGuest is @@unique([buyerId, email]), so this only defends against
    // casing drift — but it is what guarantees "each recipient exactly once".
    // The canonical (trimmed, lower-cased) address becomes the recipient's
    // identity everywhere downstream — the send, the audit metadata and the
    // ReportDelivery row — so the delivery trail cannot disagree with the
    // dedupe key that produced it.
    const recipients = [
      ...new Map(
        guests.map((g) => {
          const email = g.email.trim().toLowerCase();
          return [email, { ...g, email }] as const;
        }),
      ).values(),
    ];
    const poNumber = report.inspection?.purchaseOrder?.poNumber ?? null;

    const delivered = await this.prisma.$transaction(async (tx) => {
      await tx.reportDelivery.create({
        data: { reportId: report.id, channel: 'PORTAL' },
      });
      const row = await tx.report.update({
        where: { id: report.id },
        data: {
          status: 'DELIVERED',
          // First delivery wins — the per-event history lives in ReportDelivery.
          deliveredAt: report.deliveredAt ?? now,
        },
      });
      await this.audit.append(
        {
          orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'report.delivered',
          entityType: 'Report',
          entityId: report.id,
          metadata: {
            buyerId: report.buyerId,
            recipientCount: recipients.length,
            // Sorted so the hashed metadata is order-independent.
            recipients: recipients.map((g) => g.email).sort(),
          },
        },
        tx,
      );
      return row;
    });

    let results: DeliveryRecipientResult[] = [];
    try {
      results = await Promise.all(
        recipients.map(async (guest) => ({
          email: guest.email,
          sent: (
            await this.mail.sendReportDelivered({
              to: guest.email,
              token: guest.token as string,
              reportId: report.id,
              poNumber,
              buyerName: report.buyer?.name ?? null,
              verificationToken: report.verificationToken,
            })
          ).sent,
        })),
      );
      const emailed = results.filter((r) => r.sent).map((r) => r.email);
      if (emailed.length > 0) {
        await this.prisma.reportDelivery.createMany({
          data: emailed.map((email) => ({
            reportId: report.id,
            channel: 'EMAIL' as const,
            recipientEmail: email,
          })),
        });
      }
    } catch (err) {
      // The report IS delivered (committed above) — a notification problem must
      // never turn a successful commit into a 500. MailService already swallows
      // send failures; this covers the recipient mail-out and the row write.
      this.logger.error(
        `Report ${report.id} was delivered but its email notifications could not be completed`,
        err instanceof Error ? err.stack : String(err),
      );
    }
    if (recipients.length === 0) {
      // Not an error: the report is published to the portal and any guest invited
      // later sees it. Surfaced in the response so the console can prompt
      // "invite a buyer guest" instead of implying an email went out.
      this.logger.warn(
        `Report ${report.id} delivered with no eligible buyer guests for buyer ${report.buyerId} — nothing was emailed`,
      );
    }

    return {
      reportId: report.id,
      status: delivered.status,
      deliveredAt: delivered.deliveredAt,
      recipients: results,
      emailsSent: results.filter((r) => r.sent).length,
    };
  }

  /**
   * Org-scoped report list (INS-062). Metadata + joins only — canonicalSnapshot
   * is large and stays out of list payloads by design.
   */
  list(orgId: string, opts: { q?: string; take?: number; skip?: number } = {}) {
    return this.prisma.report.findMany({
      where: {
        orgId,
        ...(opts.q
          ? {
              OR: [
                { buyer: { name: { contains: opts.q, mode: 'insensitive' as const } } },
                { inspection: { purchaseOrder: { poNumber: { contains: opts.q, mode: 'insensitive' as const } } } },
              ],
            }
          : {}),
      },
      orderBy: { generatedAt: 'desc' },
      take: opts.take,
      skip: opts.skip,
      select: {
        id: true,
        inspectionId: true,
        status: true,
        generatedAt: true,
        contentHash: true,
        pdfStorageKey: true,
        verificationToken: true,
        buyer: { select: { id: true, name: true } },
        inspection: {
          select: {
            status: true,
            purchaseOrder: { select: { poNumber: true } },
            product: { select: { styleNumber: true } },
          },
        },
      },
    });
  }

  async getForOrg(orgId: string, reportId: string) {
    const report = await this.prisma.report.findFirst({
      where: { id: reportId, orgId },
      include: { deliveries: true, accesses: true },
    });
    if (!report) throw new NotFoundException('Report not found');
    return report;
  }

  /**
   * Public verification (spec §9): recompute the content hash from the frozen
   * canonicalSnapshot and verify the Ed25519 signature with the platform public
   * key (derived from the private key). No portal trust required.
   */
  async verifyByToken(token: string) {
    const report = await this.prisma.report.findUnique({
      where: { verificationToken: token },
    });
    if (!report) {
      return { valid: false, reason: 'not_found' };
    }
    const pem = this.config.get<string>('REPORT_SIGNING_PRIVATE_KEY_PEM');
    if (!pem) {
      return { valid: false, reason: 'verifier_unavailable' };
    }
    const publicPem = createPublicKey(pem)
      .export({ type: 'spki', format: 'pem' })
      .toString();

    const snapshot = report.canonicalSnapshot as { photoHashes?: string[] } | null;
    const recomputed = contentHash(report.canonicalSnapshot, snapshot?.photoHashes ?? []);
    const hashMatches = recomputed === report.contentHash;
    const signatureValid = verify(report.contentHash, report.signature, publicPem);

    return {
      valid: hashMatches && signatureValid,
      hashMatches,
      signatureValid,
      reportId: report.id,
      inspectionId: report.inspectionId,
      generatedAt: report.generatedAt,
    };
  }
}
