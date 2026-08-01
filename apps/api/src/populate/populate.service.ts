import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuthUser } from '../auth/auth-user';
import { AuditService } from '../audit/audit.service';
import { actorTypeFor } from '../audit/actor-type';

type Severity = 'CRITICAL' | 'MAJOR' | 'MINOR';

export interface PresignInput {
  ext?: string;
}
export interface RegisterPhotoInput {
  storageKey: string;
  contentHash: string;
  inspectionLoopId?: string;
  thumbnailKey?: string;
  capturedAt?: string;
  deviceId?: string;
  gps?: unknown;
  exif?: unknown;
  clientRequestId?: string;
}
export interface AddDefectInput {
  inspectionLoopId?: string;
  defectCatalogId?: string;
  customText?: string;
  severity?: Severity;
  notes?: string;
  photoIds?: string[];
  clientRequestId?: string;
}
export interface AddMeasurementInput {
  inspectionLoopId: string;
  label: string;
  recordedValue?: string;
  unit?: string;
  notes?: string;
}

// Once submitted, an inspection is immutable (spec §9); corrections require a
// new re-inspection. Populate is only allowed before submission.
const LOCKED = new Set([
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REPORT_ISSUED',
  'REJECTED',
  'HOLD',
]);

@Injectable()
export class PopulateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  private async loadOpenInspection(inspectionId: string) {
    const insp = await this.prisma.inspection.findUnique({ where: { id: inspectionId } });
    if (!insp) {
      throw new NotFoundException('Inspection not found');
    }
    if (LOCKED.has(insp.status)) {
      throw new BadRequestException(
        `Inspection is locked (status ${insp.status}); corrections require a re-inspection`,
      );
    }
    return insp;
  }

  /**
   * INS-016 — the populate idempotency contract (decided 2026-08-01).
   *
   * `clientRequestId` is unique per ORG in the database (`@@unique([orgId,
   * clientRequestId])` on both Photo and DefectInstance), but the meaningful
   * unit of retry is one populate write against one inspection. Hence:
   *
   *  - **Replay** — same `clientRequestId` *and* same inspection: return the
   *    ORIGINAL row (2xx, no duplicate, no unique-violation surfaced). This is
   *    the double-click / offline-sync path; a phantom duplicate defect would
   *    change the per-class AQL count and could flip the verdict on submit.
   *  - **Collision** — same `clientRequestId`, DIFFERENT inspection: 409
   *    Conflict. The org-scoped constraint means the row can never attach to
   *    the second inspection anyway, so the old "return the existing row"
   *    behaviour told the client "saved" while nothing landed on the inspection
   *    it asked for — evidence silently missing from a signed report. This is a
   *    client bug (a reused token); fail loudly so it is fixable.
   *
   * Note: `InspectionMeasurement` has no `clientRequestId` column, so
   * `addMeasurement` has no idempotency token to honour; if one is added to the
   * schema it must route through this same helper.
   */
  private replayOrConflict<T extends { id: string; inspectionId: string }>(
    existing: T | null,
    kind: 'photo' | 'defect',
    inspectionId: string,
    clientRequestId: string,
  ): T | null {
    if (!existing) return null;
    if (existing.inspectionId !== inspectionId) {
      throw new ConflictException(
        `clientRequestId "${clientRequestId}" was already used for a ${kind} on a different ` +
          `inspection (${existing.inspectionId}); use a fresh clientRequestId per write`,
      );
    }
    return existing;
  }

  private async assertLoop(inspectionId: string, inspectionLoopId: string) {
    const loop = await this.prisma.inspectionLoop.findFirst({
      where: { id: inspectionLoopId, inspectionId },
      select: { id: true },
    });
    if (!loop) {
      throw new BadRequestException('inspectionLoopId not found on this inspection');
    }
  }

  async presignPhotoUpload(inspectionId: string, input: PresignInput) {
    const insp = await this.loadOpenInspection(inspectionId);
    const storageKey = this.storage.keyForPhoto(insp.orgId, insp.id, input?.ext ?? 'jpg');
    return { storageKey, uploadUrl: this.storage.presignUpload(storageKey), method: 'PUT' };
  }

  async registerPhoto(inspectionId: string, actor: AuthUser, input: RegisterPhotoInput) {
    const insp = await this.loadOpenInspection(inspectionId);
    if (!input?.storageKey) throw new BadRequestException('storageKey is required');
    if (!input?.contentHash) throw new BadRequestException('contentHash is required');
    if (input.inspectionLoopId) {
      await this.assertLoop(inspectionId, input.inspectionLoopId);
    }
    // Idempotency (INS-016): replay returns the original row; a token reused
    // against a different inspection is a 409 — see replayOrConflict().
    if (input.clientRequestId) {
      const replay = await this.findPhotoReplay(insp.orgId, insp.id, input.clientRequestId);
      if (replay) return replay;
    }
    try {
      // INS-006: audit inside the business transaction. Note orgId comes from the
      // INSPECTION, not the actor — the Platform Admin who populates is
      // cross-tenant (orgId=null), and the event belongs to the tenant.
      return await this.prisma.$transaction(async (tx) => {
        const photo = await tx.photo.create({
          data: {
            orgId: insp.orgId,
            inspectionId: insp.id,
            inspectionLoopId: input.inspectionLoopId,
            storageKey: input.storageKey,
            thumbnailKey: input.thumbnailKey,
            source: 'MANUAL_UPLOAD', // Admin manual upload — badged unverified (spec §9)
            uploaderUserId: actor.userId,
            capturedAt: input.capturedAt ? new Date(input.capturedAt) : undefined,
            deviceId: input.deviceId,
            gps: input.gps as Prisma.InputJsonValue,
            exif: input.exif as Prisma.InputJsonValue,
            contentHash: input.contentHash,
            clientRequestId: input.clientRequestId,
          },
        });
        await this.audit.append(
          {
            orgId: insp.orgId,
            actorType: actorTypeFor(actor),
            actorUserId: actor.userId,
            action: 'populate.photoRegistered',
            entityType: 'Photo',
            entityId: photo.id,
            // contentHash is what the report signature ultimately covers, so it
            // belongs in the immutable audit payload.
            metadata: {
              inspectionId: insp.id,
              inspectionLoopId: photo.inspectionLoopId,
              contentHash: photo.contentHash,
            },
          },
          tx,
        );
        return photo;
      });
    } catch (e) {
      // Concurrent replay (double-click / parallel offline sync): the
      // check-then-insert above can race, and the loser hits
      // @@unique([orgId, clientRequestId]). Converge to the winner's row rather
      // than surfacing an opaque 500 (INS-016, mirrors addDefect/INS-044).
      if (
        input.clientRequestId &&
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const replay = await this.findPhotoReplay(insp.orgId, insp.id, input.clientRequestId);
        if (replay) return replay;
      }
      throw e;
    }
  }

  private async findPhotoReplay(orgId: string, inspectionId: string, clientRequestId: string) {
    const existing = await this.prisma.photo.findFirst({
      where: { orgId, clientRequestId },
    });
    return this.replayOrConflict(existing, 'photo', inspectionId, clientRequestId);
  }

  /** Drag a photo into the correct loop slot (spec §6). */
  async assignPhotoToLoop(
    inspectionId: string,
    actor: AuthUser,
    photoId: string,
    inspectionLoopId: string,
  ) {
    const insp = await this.loadOpenInspection(inspectionId);
    const photo = await this.prisma.photo.findFirst({ where: { id: photoId, inspectionId } });
    if (!photo) {
      throw new NotFoundException('Photo not found on this inspection');
    }
    await this.assertLoop(inspectionId, inspectionLoopId);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.photo.update({
        where: { id: photoId },
        data: { inspectionLoopId },
      });
      await this.audit.append(
        {
          orgId: insp.orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'populate.photoAssignedToLoop',
          entityType: 'Photo',
          entityId: photoId,
          metadata: {
            inspectionId,
            from: photo.inspectionLoopId ?? null,
            to: inspectionLoopId,
          },
        },
        tx,
      );
      return updated;
    });
  }

  async addDefect(inspectionId: string, actor: AuthUser, input: AddDefectInput) {
    const insp = await this.loadOpenInspection(inspectionId);
    // Idempotency (INS-044/INS-016): a replayed add-defect (double-click /
    // offline sync) returns the original row — a phantom duplicate could flip
    // the per-class AQL verdict on submit. Reusing the token against a
    // different inspection is a 409 — see replayOrConflict().
    if (input?.clientRequestId) {
      const replay = await this.findDefectReplay(insp.orgId, insp.id, input.clientRequestId);
      if (replay) return replay;
    }
    if (!input?.defectCatalogId && !input?.customText?.trim()) {
      throw new BadRequestException('either defectCatalogId or customText is required');
    }
    if (input.defectCatalogId && input.customText) {
      throw new BadRequestException('provide either defectCatalogId or customText, not both');
    }
    let severity = input.severity;
    if (input.defectCatalogId) {
      const cat = await this.prisma.defectCatalog.findFirst({
        where: { id: input.defectCatalogId, OR: [{ orgId: insp.orgId }, { orgId: null }] },
      });
      if (!cat) throw new BadRequestException('defectCatalogId not accessible');
      severity = severity ?? (cat.defaultSeverity as Severity);
    }
    if (!severity) {
      throw new BadRequestException('severity is required for a custom defect');
    }
    if (input.inspectionLoopId) {
      await this.assertLoop(inspectionId, input.inspectionLoopId);
    }
    if (input.photoIds?.length) {
      const count = await this.prisma.photo.count({
        where: { id: { in: input.photoIds }, inspectionId },
      });
      if (count !== input.photoIds.length) {
        throw new BadRequestException('one or more photoIds are not on this inspection');
      }
    }
    try {
      // INS-006: audit inside the business transaction. A defect changes the
      // per-class AQL count that decides pass/fail, so this is one of the most
      // forensically important events in the product.
      return await this.prisma.$transaction(async (tx) => {
        const defect = await tx.defectInstance.create({
          data: {
            orgId: insp.orgId,
            inspectionId: insp.id,
            inspectionLoopId: input.inspectionLoopId,
            defectCatalogId: input.defectCatalogId,
            customText: input.customText,
            severity,
            notes: input.notes,
            createdByUserId: actor.userId,
            clientRequestId: input.clientRequestId,
            photos: input.photoIds?.length
              ? { create: input.photoIds.map((photoId) => ({ photoId })) }
              : undefined,
          },
        });
        await this.audit.append(
          {
            orgId: insp.orgId,
            actorType: actorTypeFor(actor),
            actorUserId: actor.userId,
            action: 'populate.defectAdded',
            entityType: 'DefectInstance',
            entityId: defect.id,
            metadata: {
              inspectionId: insp.id,
              inspectionLoopId: defect.inspectionLoopId,
              severity: defect.severity,
              defectCatalogId: defect.defectCatalogId,
              photoIds: [...(input.photoIds ?? [])].sort(),
            },
          },
          tx,
        );
        return defect;
      });
    } catch (e) {
      // Concurrent replay (double-click): the check-then-insert above can race,
      // and the loser hits @@unique([orgId, clientRequestId]). Converge to the
      // winner's row instead of surfacing an opaque 500 (INS-044).
      if (
        input.clientRequestId &&
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const replay = await this.findDefectReplay(insp.orgId, insp.id, input.clientRequestId);
        if (replay) return replay;
      }
      throw e;
    }
  }

  private async findDefectReplay(orgId: string, inspectionId: string, clientRequestId: string) {
    const existing = await this.prisma.defectInstance.findFirst({
      where: { orgId, clientRequestId },
    });
    return this.replayOrConflict(existing, 'defect', inspectionId, clientRequestId);
  }

  /**
   * Read for the populate console (final-review C1): the Platform Admin is
   * cross-tenant (orgId=null), so the org-scoped `InspectionsService.get()`
   * (which runs `requireOrgId(user)`) 403s for them — the only role allowed
   * to populate could never load the workspace. This mirrors that read's
   * include shape (spec §6) but looks the inspection up by id only, matching
   * the write routes' established cross-tenant populate contract (see the
   * controller's class doc comment). It deliberately skips the LOCKED guard
   * so a submitted inspection can still be viewed read-only.
   */
  async loadForPopulate(inspectionId: string) {
    const inspection = await this.prisma.inspection.findUnique({
      where: { id: inspectionId },
      include: {
        buyer: true,
        supplier: true,
        product: true,
        purchaseOrder: true,
        loops: {
          orderBy: { position: 'asc' },
          include: {
            photos: true,
            defects: { include: { defectCatalog: true } },
            measurements: true,
          },
        },
        assignedInspector: { select: { id: true, name: true, email: true } },
        photos: { orderBy: { createdAt: 'asc' } },
        aqlResult: true,
        report: true,
      },
    });
    if (!inspection) {
      throw new NotFoundException('Inspection not found');
    }
    return {
      ...inspection,
      photos: inspection.photos?.map((p) => this.withViewUrl(p)),
      loops: inspection.loops?.map((loop) => ({
        ...loop,
        photos: loop.photos?.map((p) => this.withViewUrl(p)),
      })),
    };
  }

  /**
   * Decorate a photo with a short-lived presigned GET URL (INS-049 / mirrors
   * InspectionsController.withViewUrl). Must never fail the read — a presign
   * problem degrades to viewUrl:null rather than 500ing the whole workspace.
   */
  private withViewUrl<T extends { storageKey: string }>(photo: T): T & { viewUrl: string | null } {
    try {
      return { ...photo, viewUrl: this.storage.presignDownload(photo.storageKey) };
    } catch {
      return { ...photo, viewUrl: null };
    }
  }

  async addMeasurement(inspectionId: string, actor: AuthUser, input: AddMeasurementInput) {
    const insp = await this.loadOpenInspection(inspectionId);
    if (!input?.inspectionLoopId) throw new BadRequestException('inspectionLoopId is required');
    if (!input?.label?.trim()) throw new BadRequestException('label is required');
    await this.assertLoop(inspectionId, input.inspectionLoopId);
    // INS-006: audit inside the business transaction. Measurements are rendered
    // into the signed report, so the recorded value is evidence.
    return this.prisma.$transaction(async (tx) => {
      const measurement = await tx.inspectionMeasurement.create({
        data: {
          inspectionLoopId: input.inspectionLoopId,
          label: input.label.trim(),
          recordedValue: input.recordedValue,
          unit: input.unit,
          notes: input.notes,
        },
      });
      await this.audit.append(
        {
          orgId: insp.orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'populate.measurementAdded',
          entityType: 'InspectionMeasurement',
          entityId: measurement.id,
          metadata: {
            inspectionId,
            inspectionLoopId: measurement.inspectionLoopId,
            label: measurement.label,
            recordedValue: measurement.recordedValue,
            unit: measurement.unit,
          },
        },
        tx,
      );
      return measurement;
    });
  }
}
