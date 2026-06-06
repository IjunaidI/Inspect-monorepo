import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createPublicKey } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { contentHash } from '../tamper-proof/content-hash';
import { sign, verify } from '../tamper-proof/signature';

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private signingPrivateKey(): string {
    const pem = this.config.get<string>('REPORT_SIGNING_PRIVATE_KEY_PEM');
    if (!pem) {
      throw new BadRequestException('REPORT_SIGNING_PRIVATE_KEY_PEM is not configured');
    }
    return pem;
  }

  /** Generate the immutable, signed report for an APPROVED inspection (spec §10). */
  async generate(orgId: string, inspectionId: string) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id: inspectionId, orgId },
      include: {
        buyer: true,
        purchaseOrder: true,
        aqlResult: true,
        loops: { orderBy: { position: 'asc' }, include: { measurements: true } },
        photos: { orderBy: { createdAt: 'asc' } },
        report: true,
      },
    });
    if (!inspection) throw new NotFoundException('Inspection not found');
    if (inspection.report) return inspection.report; // immutable + idempotent
    if (inspection.status !== 'APPROVED') {
      throw new BadRequestException('Only an APPROVED inspection can be reported');
    }

    const orderedPhotoHashes = inspection.photos.map((p) => p.contentHash);
    const canonical = {
      inspectionId: inspection.id,
      poNumber: inspection.purchaseOrder?.poNumber,
      buyer: { id: inspection.buyerId, name: inspection.buyer?.name },
      supplierId: inspection.supplierId,
      productId: inspection.productId,
      lotSize: inspection.lotSize,
      aqlLevel: inspection.aqlLevel,
      aqlPlan: inspection.aqlPlan,
      computedSampling: inspection.computedSampling,
      aqlResult: inspection.aqlResult
        ? {
            perClass: inspection.aqlResult.perClass,
            systemRecommendation: inspection.aqlResult.systemRecommendation,
            qaDecision: inspection.aqlResult.qaDecision,
            qaRemarks: inspection.aqlResult.qaRemarks,
          }
        : null,
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

    const hash = contentHash(canonical, orderedPhotoHashes);
    const signature = sign(hash, this.signingPrivateKey());
    const brandingSnapshot = {
      logoUrl: inspection.buyer?.logoUrl ?? undefined,
      primaryColor: inspection.buyer?.primaryColor ?? undefined,
      branding: inspection.buyer?.branding ?? undefined,
    };

    return this.prisma.$transaction(async (tx) => {
      const report = await tx.report.create({
        data: {
          inspectionId: inspection.id,
          orgId,
          buyerId: inspection.buyerId,
          brandingSnapshot: brandingSnapshot as unknown as Prisma.InputJsonValue,
          canonicalSnapshot: canonical as unknown as Prisma.InputJsonValue,
          contentHash: hash,
          signature,
          status: 'GENERATED',
          // pdfStorageKey is set when the PDF binary is rendered (pdf-lib, follow-up).
        },
      });
      await tx.inspection.update({
        where: { id: inspection.id },
        data: { status: 'REPORT_ISSUED' },
      });
      await this.audit.append(
        {
          orgId,
          actorType: 'USER',
          action: 'report.generated',
          entityType: 'Report',
          entityId: report.id,
          metadata: { inspectionId: inspection.id, contentHash: hash },
        },
        tx,
      );
      return report;
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
