import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { computeSampling, evaluateInspection } from '../aql/aql.engine';
import { AqlPlanInput } from '../aql/aql.types';
import {
  buildPresetSnapshot,
  PresetLike,
  QaDecisionValue,
  qaDecisionToStatus,
  toDefectCounts,
} from './inspection-mapping';
import { AuthUser } from '../auth/auth-user';
import { AuditService } from '../audit/audit.service';

export interface CreateInspectionInput {
  poId: string;
  loopPresetId: string;
  lotSize?: number;
  aqlPlan?: { critical?: number; major?: number; minor?: number };
  assignedInspectorId?: string;
  supersedesInspectionId?: string;
  clientRequestId?: string;
}
export interface TamperProofInput {
  deviceId?: string;
  gps?: unknown;
}
export interface QaDecisionInput {
  decision: QaDecisionValue;
  remarks?: string;
}

const SUBMITTABLE = new Set(['DRAFT', 'ASSIGNED', 'IN_PROGRESS']);
const DECIDABLE = new Set(['SUBMITTED', 'UNDER_REVIEW', 'HOLD']);

@Injectable()
export class InspectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * INSPECTOR sees/acts only on inspections assigned to them (INS-057);
   * QA_MANAGER+ keeps org-wide access. Applied inside the org-scoped where, so
   * a foreign id resolves to 404 — no existence oracle.
   */
  private inspectorScope(actor: AuthUser): { assignedInspectorId?: string } {
    return actor.role === 'INSPECTOR' ? { assignedInspectorId: actor.userId } : {};
  }

  list(
    orgId: string,
    actor: AuthUser,
    status?: string,
    opts: { q?: string; take?: number; skip?: number } = {},
  ) {
    return this.prisma.inspection.findMany({
      where: {
        orgId,
        ...this.inspectorScope(actor),
        ...(status ? { status: status as never } : {}),
        ...(opts.q
          ? {
              OR: [
                { purchaseOrder: { poNumber: { contains: opts.q, mode: 'insensitive' as const } } },
                { buyer: { name: { contains: opts.q, mode: 'insensitive' as const } } },
                { product: { styleNumber: { contains: opts.q, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: opts.take,
      skip: opts.skip,
      include: { buyer: true, supplier: true, product: true, purchaseOrder: true, aqlResult: true },
    });
  }

  async get(orgId: string, actor: AuthUser, id: string) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, orgId, ...this.inspectorScope(actor) },
      include: {
        buyer: true,
        supplier: true,
        product: true,
        purchaseOrder: true,
        // Loops carry their evidence: without these includes the populate
        // workspace "loses" registered photos/defects/measurements on reload
        // and report previews render empty.
        loops: {
          orderBy: { position: 'asc' },
          include: {
            photos: true,
            defects: { include: { defectCatalog: true } },
            measurements: true,
          },
        },
        assignedInspector: { select: { id: true, name: true, email: true } },
        // Top-level photos too: not-yet-assigned uploads have no loop.
        photos: { orderBy: { createdAt: 'asc' } },
        aqlResult: true,
        report: true,
      },
    });
    if (!inspection) {
      throw new NotFoundException('Inspection not found');
    }
    return inspection;
  }

  async create(orgId: string, userId: string, input: CreateInspectionInput) {
    if (!input?.poId) throw new BadRequestException('poId is required');
    if (!input?.loopPresetId) throw new BadRequestException('loopPresetId is required');

    // Idempotency (offline-sync readiness): dedupe on (orgId, clientRequestId).
    if (input.clientRequestId) {
      const existing = await this.prisma.inspection.findFirst({
        where: { orgId, clientRequestId: input.clientRequestId },
      });
      if (existing) return existing;
    }

    const po = await this.prisma.purchaseOrder.findFirst({ where: { id: input.poId, orgId } });
    if (!po) throw new BadRequestException('purchase order not found in organization');

    const preset = await this.prisma.loopPreset.findFirst({
      where: { id: input.loopPresetId, orgId },
      include: {
        steps: {
          orderBy: { position: 'asc' },
          include: {
            measurementFields: { orderBy: { position: 'asc' } },
            allowedDefects: { include: { defectCatalog: true } },
          },
        },
      },
    });
    if (!preset) throw new BadRequestException('loop preset not found in organization');

    if (input.assignedInspectorId) {
      const inspector = await this.prisma.user.findFirst({
        where: { id: input.assignedInspectorId, orgId },
      });
      if (!inspector) throw new BadRequestException('assigned inspector not found in organization');
    }

    // Tenant-isolation + billing-integrity guard (security review): a re-inspection
    // may only supersede an inspection in the SAME org. Without this check a caller
    // could link across tenants and force a RE_INSPECTION BillableEvent (submit()
    // derives the billing kind solely from this field).
    if (input.supersedesInspectionId) {
      const prior = await this.prisma.inspection.findFirst({
        where: { id: input.supersedesInspectionId, orgId },
        select: { id: true },
      });
      if (!prior) {
        throw new BadRequestException('superseded inspection not found in organization');
      }
    }

    const snapshot = buildPresetSnapshot(preset as unknown as PresetLike);
    const aqlPlan: AqlPlanInput = input.aqlPlan ?? {};
    const computedSampling = input.lotSize ? computeSampling(input.lotSize, aqlPlan) : undefined;

    return this.prisma.inspection.create({
      data: {
        orgId,
        buyerId: po.buyerId,
        supplierId: po.supplierId,
        poId: po.id,
        productId: po.productId,
        lotSize: input.lotSize,
        loopPresetId: preset.id,
        loopPresetSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        aqlLevel: 'II',
        aqlPlan: aqlPlan as unknown as Prisma.InputJsonValue,
        computedSampling: computedSampling as unknown as Prisma.InputJsonValue,
        assignedInspectorId: input.assignedInspectorId,
        supersedesInspectionId: input.supersedesInspectionId,
        clientRequestId: input.clientRequestId,
        createdByUserId: userId,
        status: input.assignedInspectorId ? 'ASSIGNED' : 'DRAFT',
        loops: {
          create: snapshot.steps.map((s) => ({
            orgId,
            position: s.position,
            zoneName: s.zoneName,
            requiredShotCount: s.requiredShotCount,
            allowedDefectsSnapshot: s.allowedDefects as unknown as Prisma.InputJsonValue,
          })),
        },
      },
      include: { loops: { orderBy: { position: 'asc' } } },
    });
  }

  /** Read-only AQL plan preview for the create screen (spec §8). Reuses computeSampling. */
  aqlPreview(lotSize: number, plan: { critical?: number; major?: number; minor?: number }) {
    if (!Number.isInteger(lotSize) || lotSize < 2) {
      throw new BadRequestException('lotSize must be an integer >= 2');
    }
    try {
      return computeSampling(lotSize, plan as AqlPlanInput);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'AQL plan not available');
    }
  }

  /** Lock the inspection, compute the AQL result, record the billable event (spec §8/§9/§14#16). */
  async submit(orgId: string, actor: AuthUser, id: string, tamper: TamperProofInput) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, orgId, ...this.inspectorScope(actor) },
    });
    if (!inspection) throw new NotFoundException('Inspection not found');
    if (!SUBMITTABLE.has(inspection.status)) {
      throw new BadRequestException(`Cannot submit an inspection in status ${inspection.status}`);
    }
    if (inspection.lotSize == null) {
      throw new BadRequestException('lotSize must be set before submitting (required for AQL sampling)');
    }

    // INS-056: a verdict must never be computed from missing evidence. The AQL
    // engine folds absent counts to zero, so an empty inspection would otherwise
    // mint a PASS — refuse to submit while any loop lacks its required photos.
    const loops = await this.prisma.inspectionLoop.findMany({
      where: { inspectionId: id },
      select: { zoneName: true, requiredShotCount: true, _count: { select: { photos: true } } },
      orderBy: { position: 'asc' },
    });
    const short = loops.filter((l) => l._count.photos < l.requiredShotCount);
    if (short.length > 0) {
      const detail = short.map((l) => `${l.zoneName} (${l._count.photos}/${l.requiredShotCount})`).join(', ');
      throw new BadRequestException(
        `Cannot submit: photo evidence incomplete — ${detail}. Upload the required shots first.`,
      );
    }

    const sampling = computeSampling(
      inspection.lotSize,
      (inspection.aqlPlan ?? {}) as unknown as AqlPlanInput,
    );

    const groups = await this.prisma.defectInstance.groupBy({
      by: ['severity'],
      where: { inspectionId: id },
      _count: { _all: true },
    });
    const counts = toDefectCounts(
      groups.map((g) => ({
        severity: g.severity as 'CRITICAL' | 'MAJOR' | 'MINOR',
        count: g._count._all,
      })),
    );
    const evaluation = evaluateInspection(sampling, counts);

    const submittedAt = new Date();
    const tamperProof = {
      inspectorId: actor.userId,
      deviceId: tamper?.deviceId,
      submittedAt: submittedAt.toISOString(),
      gps: tamper?.gps,
    };

    return this.prisma.$transaction(async (tx) => {
      await tx.inspection.update({
        where: { id },
        data: {
          status: 'SUBMITTED',
          submittedAt,
          tamperProof: tamperProof as unknown as Prisma.InputJsonValue,
          computedSampling: sampling as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.aqlResult.upsert({
        where: { inspectionId: id },
        create: {
          inspectionId: id,
          orgId,
          perClass: evaluation.perClass as unknown as Prisma.InputJsonValue,
          systemRecommendation: evaluation.systemRecommendation,
        },
        update: {
          perClass: evaluation.perClass as unknown as Prisma.InputJsonValue,
          systemRecommendation: evaluation.systemRecommendation,
          qaDecision: null,
          qaRemarks: null,
          decidedByUserId: null,
          decidedAt: null,
        },
      });
      const existing = await tx.billableEvent.findUnique({ where: { inspectionId: id } });
      if (!existing) {
        await tx.billableEvent.create({
          data: {
            orgId,
            inspectionId: id,
            kind: inspection.supersedesInspectionId ? 'RE_INSPECTION' : 'INSPECTION',
          },
        });
      }
      return tx.inspection.findUnique({ where: { id }, include: { aqlResult: true } });
    });
  }

  /** ASSIGNED -> IN_PROGRESS (INS-057). Allowed for the assigned inspector or QA_MANAGER+. */
  async start(orgId: string, actor: AuthUser, id: string) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, orgId, ...this.inspectorScope(actor) },
    });
    if (!inspection) throw new NotFoundException('Inspection not found');
    if (inspection.status !== 'ASSIGNED') {
      throw new BadRequestException(`Cannot start an inspection in status ${inspection.status} (only ASSIGNED)`);
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.inspection.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
      await this.audit.append(
        { orgId, actorType: 'USER', actorUserId: actor.userId, action: 'inspection.started', entityType: 'Inspection', entityId: id },
        tx,
      );
      return updated;
    });
  }

  /** IN_PROGRESS -> ASSIGNED (the "reset and restart" model — nothing submitted is touched). */
  async reset(orgId: string, actor: AuthUser, id: string) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, orgId, ...this.inspectorScope(actor) },
    });
    if (!inspection) throw new NotFoundException('Inspection not found');
    if (inspection.status !== 'IN_PROGRESS') {
      throw new BadRequestException(`Cannot reset an inspection in status ${inspection.status} (only IN_PROGRESS)`);
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.inspection.update({ where: { id }, data: { status: 'ASSIGNED' } });
      await this.audit.append(
        { orgId, actorType: 'USER', actorUserId: actor.userId, action: 'inspection.reset', entityType: 'Inspection', entityId: id },
        tx,
      );
      return updated;
    });
  }

  /** QA Manager's binding decision (spec §8). */
  async decide(orgId: string, userId: string, id: string, input: QaDecisionInput) {
    if (!input?.decision) throw new BadRequestException('decision is required');
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, orgId },
      include: { aqlResult: true },
    });
    if (!inspection) throw new NotFoundException('Inspection not found');
    if (!inspection.aqlResult) {
      throw new BadRequestException('Inspection has no AQL result (submit first)');
    }
    if (!DECIDABLE.has(inspection.status)) {
      throw new BadRequestException(`Cannot decide an inspection in status ${inspection.status}`);
    }

    const status = qaDecisionToStatus(input.decision);
    const decidedAt = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.aqlResult.update({
        where: { inspectionId: id },
        data: {
          qaDecision: input.decision,
          qaRemarks: input.remarks,
          decidedByUserId: userId,
          decidedAt,
        },
      });
      return tx.inspection.update({
        where: { id },
        data: { status },
        include: { aqlResult: true },
      });
    });
  }
}
