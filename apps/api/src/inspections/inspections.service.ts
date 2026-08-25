import type { DefectSeverity } from '@inspect/shared-types';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { computeSampling, evaluateInspection } from '../aql/aql.engine';
import { AqlPlanInput } from '../aql/aql.types';
import {
  billableKindFor,
  buildPresetSnapshot,
  PresetLike,
  QaDecisionValue,
  qaDecisionToStatus,
  toDefectCounts,
} from './inspection-mapping';
import { cycleState } from './cycle-state';
import { RawAqlPlanInput, resolveAqlPlan } from './aql-plan-input';
import { AuthUser } from '../auth/auth-user';
import { AuditService } from '../audit/audit.service';
import { actorTypeFor } from '../audit/actor-type';
import { MailService } from '../mail/mail.service';

export interface CreateInspectionInput {
  poId: string;
  loopPresetId: string;
  lotSize?: number;
  /** Per-class AQLs (INS-063). Validated against the verified band; omitted classes take the spec defaults. */
  aqlPlan?: RawAqlPlanInput;
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
export interface UpdateInspectionInput {
  assignedInspectorId?: string | null;
  lotSize?: number;
}

const SUBMITTABLE = new Set(['DRAFT', 'ASSIGNED', 'IN_PROGRESS']);
const DECIDABLE = new Set(['SUBMITTED', 'UNDER_REVIEW', 'HOLD']);

@Injectable()
export class InspectionsService {
  private readonly logger = new Logger(InspectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
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
        // Items carry their evidence: without these includes the populate
        // workspace "loses" registered photos/defects on reload and report
        // previews render empty. INS-081: measurements hang off the inspection
        // (per cycle), not off an item, and there is no orphan-photo list —
        // every upload targets a (item, cycle) slot.
        items: {
          orderBy: { position: 'asc' },
          include: {
            photos: { orderBy: { cycleIndex: 'asc' } },
            defects: { include: { defectCatalog: true } },
          },
        },
        measurements: { orderBy: [{ cycleIndex: 'asc' }, { label: 'asc' }] },
        assignedInspector: { select: { id: true, name: true, email: true } },
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
        items: { orderBy: { position: 'asc' } },
        measurementFields: { orderBy: { position: 'asc' } },
        allowedDefects: { include: { defectCatalog: true } },
      },
    });
    if (!preset) throw new BadRequestException('loop preset not found in organization');

    if (input.assignedInspectorId) {
      const inspector = await this.prisma.user.findFirst({
        where: { id: input.assignedInspectorId, orgId, status: 'ACTIVE' },
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

    // INS-063: the per-class AQLs are caller-configurable, so both the value
    // check and the grid lookup are USER input errors — a hole in the verified
    // band (e.g. lot 100 -> code letter F) must surface as a 400 naming the
    // problem, never as an unhandled 500. aqlPreview() does the same.
    let aqlPlan: AqlPlanInput;
    let computedSampling;
    try {
      aqlPlan = resolveAqlPlan(input.aqlPlan);
      computedSampling = input.lotSize ? computeSampling(input.lotSize, aqlPlan) : undefined;
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'invalid AQL plan');
    }

    // INS-010 gave the inspection's children a composite FK to Inspection(id, orgId)
    // *alongside* their singular FK to Organization(id). Prisma's nested-create
    // input for a scalar claimed by two relations drops the raw `orgId`
    // ("Unknown argument `orgId`") — a 500 on every create. The fix is to set it
    // through the relation, below; `main` independently hit the same wall and
    // solved it with a second createMany() pass, which is equally valid.
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
        items: {
          create: snapshot.items.map((i) => ({
            position: i.position,
            itemName: i.itemName,
            description: i.description,
            referenceImageUrl: i.referenceImageUrl,
            // orgId is carried by BOTH the composite inspection FK (implied by
            // this nesting) and the organization FK, so Prisma exposes it only
            // through the relation — a bare `orgId` scalar is rejected here.
            organization: { connect: { id: orgId } },
          })),
        },
      },
      include: { items: { orderBy: { position: 'asc' } } },
    });
  }

  /**
   * Pre-submission edits only (INS-066): reassign the inspector and/or adjust
   * lot size. SUBMITTED+ inspections are frozen by the immutability invariant.
   * The aqlPlan itself stays fixed at creation (INS-063) — only the lot size may
   * move, and the sampling is recomputed from the frozen plan.
   */
  async update(orgId: string, actor: AuthUser, id: string, input: UpdateInspectionInput) {
    const inspection = await this.prisma.inspection.findFirst({ where: { id, orgId } });
    if (!inspection) throw new NotFoundException('Inspection not found');
    if (!SUBMITTABLE.has(inspection.status)) {
      throw new BadRequestException(
        `Cannot modify an inspection in status ${inspection.status} — submitted inspections are frozen`,
      );
    }

    const changes: Record<string, unknown> = {};
    if (input.assignedInspectorId !== undefined) {
      // A blank string is an explicit unassign, same as null — without this an
      // empty-string payload skips the existence check (falsy) and writes ''
      // straight into the FK column, producing a raw 500. `undefined` (field
      // absent) still means "no change" and never reaches this branch.
      const assignedInspectorId = input.assignedInspectorId === '' ? null : input.assignedInspectorId;
      if (assignedInspectorId) {
        const inspector = await this.prisma.user.findFirst({
          where: { id: assignedInspectorId, orgId, status: 'ACTIVE' },
        });
        if (!inspector) throw new BadRequestException('assigned inspector not found in organization');
      }
      // An IN_PROGRESS inspection has no DRAFT/ASSIGNED fallback: clearing the
      // assignee here would strand it in a status that claims work is underway
      // with nobody assigned, invisible to every inspector. Reset first (INS-057).
      if (inspection.status === 'IN_PROGRESS' && assignedInspectorId === null) {
        throw new BadRequestException(
          'Cannot unassign an in-progress inspection; reset it first (POST /:id/reset)',
        );
      }
      changes.assignedInspectorId = assignedInspectorId;
      if (inspection.status === 'DRAFT' && assignedInspectorId) changes.status = 'ASSIGNED';
      if (inspection.status === 'ASSIGNED' && assignedInspectorId === null) changes.status = 'DRAFT';
    }
    if (input.lotSize !== undefined) {
      if (!Number.isInteger(input.lotSize) || input.lotSize < 2) {
        throw new BadRequestException('lotSize must be an integer >= 2');
      }
      try {
        changes.computedSampling = computeSampling(
          input.lotSize,
          resolveAqlPlan(inspection.aqlPlan as RawAqlPlanInput | null),
        ) as unknown as Prisma.InputJsonValue;
      } catch (e) {
        throw new BadRequestException(e instanceof Error ? e.message : 'AQL plan not available for this lot size');
      }
      changes.lotSize = input.lotSize;
    }
    if (Object.keys(changes).length === 0) return inspection;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.inspection.update({
        where: { id },
        data: changes as Prisma.InspectionUncheckedUpdateInput,
      });
      await this.audit.append(
        {
          orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'inspection.updated',
          entityType: 'Inspection',
          entityId: id,
          metadata: { fields: Object.keys(changes) },
        },
        tx,
      );
      return updated;
    });
  }

  /** Read-only AQL plan preview for the create screen (spec §8). Reuses computeSampling. */
  aqlPreview(lotSize: number, plan: RawAqlPlanInput) {
    if (!Number.isInteger(lotSize) || lotSize < 2) {
      throw new BadRequestException('lotSize must be an integer >= 2');
    }
    try {
      // Same validation the create path applies, so the preview the QA Manager
      // sees can never differ from the plan the API would actually accept.
      return computeSampling(lotSize, resolveAqlPlan(plan));
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'AQL plan not available');
    }
  }

  /** Lock the inspection, compute the AQL result, record the billable event (spec §8/§9/§14#16). */
  async submit(orgId: string, actor: AuthUser, id: string, tamper: TamperProofInput) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, orgId, ...this.inspectorScope(actor) },
      include: { purchaseOrder: { select: { poNumber: true } } },
    });
    if (!inspection) throw new NotFoundException('Inspection not found');
    if (!SUBMITTABLE.has(inspection.status)) {
      throw new BadRequestException(`Cannot submit an inspection in status ${inspection.status}`);
    }
    if (inspection.lotSize == null) {
      throw new BadRequestException('lotSize must be set before submitting (required for AQL sampling)');
    }

    // INS-056 + INS-081: a verdict must never be computed from missing evidence.
    // The AQL engine folds absent counts to zero, so an empty inspection would
    // otherwise mint a PASS. The rule is now cycle-shaped: at least one complete
    // pass over every loop item, and no half-finished unit left behind.
    const items = await this.prisma.inspectionLoopItem.findMany({
      where: { inspectionId: id },
      select: { id: true, position: true, itemName: true },
      orderBy: { position: 'asc' },
    });
    const slots = await this.prisma.photo.findMany({
      where: { inspectionId: id },
      select: { inspectionLoopItemId: true, cycleIndex: true },
    });
    const state = cycleState(items, slots);
    if (state.completedCycles === 0) {
      throw new BadRequestException(
        'Cannot submit: no complete unit has been photographed. Shoot every loop item at least once.',
      );
    }
    if (state.partialCycles.length > 0) {
      const nameById = new Map(items.map((i) => [i.id, i.itemName]));
      const detail = state.partialCycles
        .map(
          (pc) =>
            `unit ${pc.cycleIndex + 1} (missing ${pc.missingItemIds
              .map((itemId) => nameById.get(itemId) ?? itemId)
              .join(', ')})`,
        )
        .join('; ');
      throw new BadRequestException(
        `Cannot submit: incomplete ${detail}. Finish or discard it before submitting.`,
      );
    }

    // Re-derived from the plan frozen at creation (never from the live defaults),
    // so the verdict matches the plan the QA Manager configured and saw.
    let sampling;
    try {
      sampling = computeSampling(
        inspection.lotSize,
        resolveAqlPlan(inspection.aqlPlan as RawAqlPlanInput | null),
      );
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'AQL plan not available for this lot');
    }

    const groups = await this.prisma.defectInstance.groupBy({
      by: ['severity'],
      where: { inspectionId: id },
      _count: { _all: true },
    });
    const counts = toDefectCounts(
      groups.map((g) => ({
        severity: g.severity as DefectSeverity,
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

    const result = await this.prisma.$transaction(async (tx) => {
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
      // INS-018: the billing kind is DERIVED from the re-inspection linkage and
      // never supplied by a caller — a RE_INSPECTION event may only exist for an
      // inspection that actually supersedes another (and vice versa). Until the
      // DB carries a CHECK constraint, this service path is the enforcement point.
      const billableKind = billableKindFor(inspection.supersedesInspectionId);
      const existing = await tx.billableEvent.findUnique({ where: { inspectionId: id } });
      if (!existing) {
        await tx.billableEvent.create({ data: { orgId, inspectionId: id, kind: billableKind } });
      } else if (existing.kind !== billableKind) {
        // A pre-existing event that contradicts the linkage is a billing-integrity
        // fault: fail the submit rather than silently bill the wrong kind.
        throw new BadRequestException(
          `Billing integrity: existing BillableEvent kind ${existing.kind} contradicts the inspection's re-inspection linkage (expected ${billableKind})`,
        );
      }
      // INS-079: same attribution story as decide() — a Platform Admin submitting
      // inside an assumed org must show up as PLATFORM_ADMIN, in the same
      // transaction as the status change it is attesting to.
      await this.audit.append(
        {
          orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'inspection.submitted',
          entityType: 'Inspection',
          entityId: id,
          metadata: { systemRecommendation: evaluation.systemRecommendation },
        },
        tx,
      );
      return tx.inspection.findUnique({ where: { id }, include: { aqlResult: true } });
    });

    // INS-069: notify reviewers AFTER the commit — never inside the tx, never
    // throwing (MailService resolves {sent:false} on failure). The submitter is excluded.
    try {
      const reviewers = await this.prisma.user.findMany({
        where: { orgId, status: 'ACTIVE', id: { not: actor.userId }, role: { in: ['QA_MANAGER', 'ORG_OWNER'] } },
        select: { email: true },
      });
      const poNumber = inspection.purchaseOrder?.poNumber ?? null;
      await Promise.all(
        [...new Set(reviewers.map((r) => r.email))].map((to) =>
          this.mail.sendInspectionSubmitted({ to, poNumber, inspectionId: id }),
        ),
      );
    } catch (err) {
      // The inspection IS submitted — a notification problem must never turn a
      // successful commit into a 500 (MailService already swallows send
      // failures; this covers the recipient lookup itself).
      this.logger.error(
        `Failed to notify reviewers that inspection ${id} was submitted`,
        err instanceof Error ? err.stack : String(err),
      );
    }
    return result;
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
        { orgId, actorType: actorTypeFor(actor), actorUserId: actor.userId, action: 'inspection.started', entityType: 'Inspection', entityId: id },
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
        { orgId, actorType: actorTypeFor(actor), actorUserId: actor.userId, action: 'inspection.reset', entityType: 'Inspection', entityId: id },
        tx,
      );
      return updated;
    });
  }

  /** QA Manager's binding decision (spec §8). */
  async decide(orgId: string, actor: AuthUser, id: string, input: QaDecisionInput) {
    if (!input?.decision) throw new BadRequestException('decision is required');
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, orgId },
      include: { aqlResult: true, purchaseOrder: { select: { poNumber: true } } },
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
    const decided = await this.prisma.$transaction(async (tx) => {
      await tx.aqlResult.update({
        where: { inspectionId: id },
        data: {
          qaDecision: input.decision,
          qaRemarks: input.remarks,
          decidedByUserId: actor.userId,
          decidedAt,
        },
      });
      const updated = await tx.inspection.update({
        where: { id },
        data: { status },
        include: { aqlResult: true },
      });
      // INS-079: this is the product's binding pass/fail call — it must be
      // attributed truthfully (a Platform Admin acting inside an assumed org
      // records as PLATFORM_ADMIN, never as an ordinary org member) and it
      // must roll back with the decision if the audit write fails.
      await this.audit.append(
        {
          orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'inspection.decided',
          entityType: 'Inspection',
          entityId: id,
          metadata: { decision: input.decision, status },
        },
        tx,
      );
      return updated;
    });

    // INS-069: assigned inspector + active owners learn the binding call (post-commit).
    try {
      const recipients = await this.prisma.user.findMany({
        where: {
          orgId,
          status: 'ACTIVE',
          id: { not: actor.userId },
          OR: [
            { role: 'ORG_OWNER' },
            ...(inspection.assignedInspectorId ? [{ id: inspection.assignedInspectorId }] : []),
          ],
        },
        select: { email: true },
      });
      const poNumber = inspection.purchaseOrder?.poNumber ?? null;
      await Promise.all(
        [...new Set(recipients.map((r) => r.email))].map((to) =>
          this.mail.sendInspectionDecided({ to, poNumber, inspectionId: id, decision: input.decision, remarks: input.remarks }),
        ),
      );
    } catch (err) {
      // The decision IS recorded — see the submit() note above.
      this.logger.error(
        `Failed to notify stakeholders of the decision on inspection ${id}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
    return decided;
  }
}
