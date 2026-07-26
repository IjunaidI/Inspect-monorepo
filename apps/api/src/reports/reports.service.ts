import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createPublicKey } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { actorTypeFor } from '../audit/actor-type';
import { AuthUser } from '../auth/auth-user';
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
    if (inspection.report) return inspection.report; // immutable + idempotent
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
      return await this.prisma.$transaction(async (tx) => {
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
            actorType: actorTypeFor(actor),
            actorUserId: actor.userId,
            action: 'report.generated',
            entityType: 'Report',
            entityId: report.id,
            metadata: { inspectionId: inspection.id, contentHash: hash },
          },
          tx,
        );
        return report;
      });
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
