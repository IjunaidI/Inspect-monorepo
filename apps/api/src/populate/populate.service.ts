import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuthUser } from '../auth/auth-user';
import { AuditService } from '../audit/audit.service';
import { actorTypeFor } from '../audit/actor-type';
import { cycleState } from '../inspections/cycle-state';
import type { DefectSeverity } from '@inspect/shared-types';

type Severity = DefectSeverity;

export interface PresignInput {
  ext?: string;
}
export interface RegisterPhotoInput {
  storageKey: string;
  contentHash: string;
  /** INS-081: every upload targets a slot — (loop item, cycle). Both required. */
  inspectionLoopItemId: string;
  cycleIndex: number;
  thumbnailKey?: string;
  capturedAt?: string;
  deviceId?: string;
  gps?: unknown;
  exif?: unknown;
  clientRequestId?: string;
}
export interface RetakePhotoInput {
  storageKey: string;
  contentHash: string;
  thumbnailKey?: string;
  capturedAt?: string;
  deviceId?: string;
  gps?: unknown;
  exif?: unknown;
}
export interface AddDefectInput {
  inspectionLoopItemId: string;
  cycleIndex: number;
  defectCatalogId?: string;
  customText?: string;
  severity?: Severity;
  notes?: string;
  photoIds?: string[];
  clientRequestId?: string;
}
export interface AddMeasurementInput {
  cycleIndex: number;
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

  /**
   * INS-083 — row-level scope for every populate route.
   *
   * Populate was `PLATFORM_ADMIN`-only, so the inspection lookup was a bare
   * `findUnique(id)` with no tenant filter — correct for a principal that is
   * cross-tenant by design, and a cross-tenant hole the moment an org role is
   * let through. Now that the mobile app (INS-086) needs `INSPECTOR` to capture
   * evidence, the scope has to travel with the actor:
   *
   *   PLATFORM_ADMIN → unscoped (unchanged; orgId is derived from the inspection)
   *   QA_MANAGER / ORG_OWNER → their org
   *   INSPECTOR → their org AND only inspections assigned to them
   *
   * Folded into the `where` rather than checked after the read, so a foreign id
   * resolves to 404 instead of 403 — same rule as `InspectionsService`
   * (INS-057): a 403 would confirm the row exists and turn the endpoint into an
   * existence oracle for other people's work.
   */
  private scopeFor(actor: AuthUser): {
    orgId?: string;
    assignedInspectorId?: string;
  } {
    if (actor?.role === 'PLATFORM_ADMIN') return {};
    if (!actor?.orgId) {
      throw new ForbiddenException('No organization context');
    }
    return {
      orgId: actor.orgId,
      ...(actor.role === 'INSPECTOR'
        ? { assignedInspectorId: actor.userId }
        : {}),
    };
  }

  private async loadOpenInspection(inspectionId: string, actor: AuthUser) {
    const insp = await this.prisma.inspection.findFirst({
      where: { id: inspectionId, ...this.scopeFor(actor) },
    });
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
   * Note: `InspectionMeasurement` has no `clientRequestId` column; INS-081 gives
   * it a natural key instead — (inspectionId, cycleIndex, label) — so
   * `addMeasurement` upserts and is idempotent without a token.
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

  private assertCycleIndex(cycleIndex: number) {
    if (!Number.isInteger(cycleIndex) || cycleIndex < 0) {
      throw new BadRequestException(
        'cycleIndex must be a non-negative integer',
      );
    }
  }

  private async assertItem(inspectionId: string, inspectionLoopItemId: string) {
    const item = await this.prisma.inspectionLoopItem.findFirst({
      where: { id: inspectionLoopItemId, inspectionId },
      select: { id: true },
    });
    if (!item) {
      throw new BadRequestException(
        'inspectionLoopItemId not found on this inspection',
      );
    }
  }

  /**
   * A slot is (item, cycle). A defect must hang off a slot that already holds
   * evidence, so "Unit 7 · Right sleeve" on the report always resolves to a
   * photo a buyer can look at.
   */
  private async assertSlotHasPhoto(
    inspectionId: string,
    inspectionLoopItemId: string,
    cycleIndex: number,
  ) {
    const photo = await this.prisma.photo.findFirst({
      where: { inspectionId, inspectionLoopItemId, cycleIndex },
      select: { id: true },
    });
    if (!photo) {
      throw new BadRequestException(
        `no photo has been uploaded for unit ${cycleIndex + 1} of that loop item yet`,
      );
    }
  }

  async presignPhotoUpload(
    inspectionId: string,
    actor: AuthUser,
    input: PresignInput,
  ) {
    const insp = await this.loadOpenInspection(inspectionId, actor);
    const storageKey = this.storage.keyForPhoto(
      insp.orgId,
      insp.id,
      input?.ext ?? 'jpg',
    );
    return {
      storageKey,
      uploadUrl: this.storage.presignUpload(storageKey),
      method: 'PUT',
    };
  }

  async registerPhoto(
    inspectionId: string,
    actor: AuthUser,
    input: RegisterPhotoInput,
  ) {
    const insp = await this.loadOpenInspection(inspectionId, actor);
    if (!input?.storageKey)
      throw new BadRequestException('storageKey is required');
    if (!input?.contentHash)
      throw new BadRequestException('contentHash is required');
    if (!input?.inspectionLoopItemId) {
      throw new BadRequestException('inspectionLoopItemId is required');
    }
    this.assertCycleIndex(input.cycleIndex);
    await this.assertItem(inspectionId, input.inspectionLoopItemId);
    // Idempotency (INS-016): replay returns the original row; a token reused
    // against a different inspection is a 409 — see replayOrConflict().
    if (input.clientRequestId) {
      const replay = await this.findPhotoReplay(
        insp.orgId,
        insp.id,
        input.clientRequestId,
      );
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
            inspectionLoopItemId: input.inspectionLoopItemId,
            cycleIndex: input.cycleIndex,
            storageKey: input.storageKey,
            thumbnailKey: input.thumbnailKey,
            source: 'MANUAL_UPLOAD', // Admin manual upload — badged unverified (spec §9)
            uploaderUserId: actor.userId,
            capturedAt: input.capturedAt
              ? new Date(input.capturedAt)
              : undefined,
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
              inspectionLoopItemId: photo.inspectionLoopItemId,
              cycleIndex: photo.cycleIndex,
              contentHash: photo.contentHash,
            },
          },
          tx,
        );
        return photo;
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const target = Array.isArray(e.meta?.target)
          ? (e.meta.target as string[])
          : [];
        // INS-081: the SLOT constraint is a different failure from the
        // idempotency one. This is not a retry — it is a second photo aimed at a
        // filled slot, and silently replaying would hide the operator's mistake.
        if (target.includes('cycleIndex')) {
          throw new ConflictException(
            `Unit ${input.cycleIndex + 1} already has a photo for that loop item; use retake to replace it`,
          );
        }
        // Concurrent replay (double-click / parallel offline sync): the
        // check-then-insert above can race, and the loser hits
        // @@unique([orgId, clientRequestId]). Converge to the winner's row rather
        // than surfacing an opaque 500 (INS-016, mirrors addDefect/INS-044).
        if (input.clientRequestId) {
          const replay = await this.findPhotoReplay(
            insp.orgId,
            insp.id,
            input.clientRequestId,
          );
          if (replay) return replay;
        }
      }
      throw e;
    }
  }

  private async findPhotoReplay(
    orgId: string,
    inspectionId: string,
    clientRequestId: string,
  ) {
    const existing = await this.prisma.photo.findFirst({
      where: { orgId, clientRequestId },
    });
    return this.replayOrConflict(
      existing,
      'photo',
      inspectionId,
      clientRequestId,
    );
  }

  /**
   * INS-081 — replace the bytes in an existing slot, pre-submit only.
   *
   * The row is updated IN PLACE rather than deleted and re-inserted because the
   * slot is the identity: defect links (DefectInstancePhoto) survive untouched
   * and the @@unique([inspectionLoopItemId, cycleIndex]) is never transiently
   * violated. Provenance is carried by the audit chain — the entry records BOTH
   * content hashes — not by the row's immutability. The superseded object is
   * left in storage; MVP has no object-lifecycle policy.
   */
  async retakePhoto(
    inspectionId: string,
    actor: AuthUser,
    photoId: string,
    input: RetakePhotoInput,
  ) {
    const insp = await this.loadOpenInspection(inspectionId, actor);
    if (!input?.storageKey)
      throw new BadRequestException('storageKey is required');
    if (!input?.contentHash)
      throw new BadRequestException('contentHash is required');
    const photo = await this.prisma.photo.findFirst({
      where: { id: photoId, inspectionId },
    });
    if (!photo)
      throw new NotFoundException('Photo not found on this inspection');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.photo.update({
        where: { id: photoId },
        data: {
          storageKey: input.storageKey,
          thumbnailKey: input.thumbnailKey ?? null,
          contentHash: input.contentHash,
          capturedAt: input.capturedAt ? new Date(input.capturedAt) : null,
          deviceId: input.deviceId ?? null,
          gps: input.gps as Prisma.InputJsonValue,
          exif: input.exif as Prisma.InputJsonValue,
          uploaderUserId: actor.userId,
          source: 'MANUAL_UPLOAD',
        },
      });
      await this.audit.append(
        {
          orgId: insp.orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'populate.photoRetaken',
          entityType: 'Photo',
          entityId: photoId,
          metadata: {
            inspectionId: insp.id,
            inspectionLoopItemId: photo.inspectionLoopItemId,
            cycleIndex: photo.cycleIndex,
            fromContentHash: photo.contentHash,
            toContentHash: updated.contentHash,
          },
        },
        tx,
      );
      return updated;
    });
  }

  /**
   * INS-081 — the "remove" half of the end-of-loop rule: a unit is either
   * finished or discarded whole. Deleting one photo out of a unit is deliberately
   * NOT offered; that is what would create an unfinishable hole in history.
   */
  async discardCycle(
    inspectionId: string,
    actor: AuthUser,
    cycleIndex: number,
  ) {
    const insp = await this.loadOpenInspection(inspectionId, actor);
    this.assertCycleIndex(cycleIndex);
    return this.prisma.$transaction(async (tx) => {
      // Defects first: their DefectInstancePhoto junction rows must go with
      // their parent defect rather than block the photo delete.
      const defects = await tx.defectInstance.deleteMany({
        where: { inspectionId, cycleIndex },
      });
      const photos = await tx.photo.deleteMany({
        where: { inspectionId, cycleIndex },
      });
      const measurements = await tx.inspectionMeasurement.deleteMany({
        where: { inspectionId, cycleIndex },
      });
      await this.audit.append(
        {
          orgId: insp.orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'populate.cycleDiscarded',
          entityType: 'Inspection',
          entityId: insp.id,
          metadata: {
            cycleIndex,
            photos: photos.count,
            defects: defects.count,
            measurements: measurements.count,
          },
        },
        tx,
      );
      return {
        cycleIndex,
        deleted: {
          photos: photos.count,
          defects: defects.count,
          measurements: measurements.count,
        },
      };
    });
  }

  async addDefect(
    inspectionId: string,
    actor: AuthUser,
    input: AddDefectInput,
  ) {
    const insp = await this.loadOpenInspection(inspectionId, actor);
    // Idempotency (INS-044/INS-016): a replayed add-defect (double-click /
    // offline sync) returns the original row — a phantom duplicate could flip
    // the per-class AQL verdict on submit. Reusing the token against a
    // different inspection is a 409 — see replayOrConflict().
    if (input?.clientRequestId) {
      const replay = await this.findDefectReplay(
        insp.orgId,
        insp.id,
        input.clientRequestId,
      );
      if (replay) return replay;
    }
    if (!input?.defectCatalogId && !input?.customText?.trim()) {
      throw new BadRequestException(
        'either defectCatalogId or customText is required',
      );
    }
    if (input.defectCatalogId && input.customText) {
      throw new BadRequestException(
        'provide either defectCatalogId or customText, not both',
      );
    }
    let severity = input.severity;
    if (input.defectCatalogId) {
      const cat = await this.prisma.defectCatalog.findFirst({
        where: {
          id: input.defectCatalogId,
          OR: [{ orgId: insp.orgId }, { orgId: null }],
        },
      });
      if (!cat) throw new BadRequestException('defectCatalogId not accessible');
      severity = severity ?? (cat.defaultSeverity as Severity);
    }
    if (!severity) {
      throw new BadRequestException('severity is required for a custom defect');
    }
    // INS-081: a defect pins to a SLOT. The taggable list is loop-global, but
    // the recorded instance names the unit and the item it was seen on.
    if (!input?.inspectionLoopItemId) {
      throw new BadRequestException('inspectionLoopItemId is required');
    }
    this.assertCycleIndex(input.cycleIndex);
    await this.assertItem(inspectionId, input.inspectionLoopItemId);
    await this.assertSlotHasPhoto(
      inspectionId,
      input.inspectionLoopItemId,
      input.cycleIndex,
    );
    if (input.photoIds?.length) {
      const count = await this.prisma.photo.count({
        where: { id: { in: input.photoIds }, inspectionId },
      });
      if (count !== input.photoIds.length) {
        throw new BadRequestException(
          'one or more photoIds are not on this inspection',
        );
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
            inspectionLoopItemId: input.inspectionLoopItemId,
            cycleIndex: input.cycleIndex,
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
              inspectionLoopItemId: defect.inspectionLoopItemId,
              cycleIndex: defect.cycleIndex,
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
        const replay = await this.findDefectReplay(
          insp.orgId,
          insp.id,
          input.clientRequestId,
        );
        if (replay) return replay;
      }
      throw e;
    }
  }

  private async findDefectReplay(
    orgId: string,
    inspectionId: string,
    clientRequestId: string,
  ) {
    const existing = await this.prisma.defectInstance.findFirst({
      where: { orgId, clientRequestId },
    });
    return this.replayOrConflict(
      existing,
      'defect',
      inspectionId,
      clientRequestId,
    );
  }

  /**
   * Read for the populate console (final-review C1): the Platform Admin is
   * cross-tenant (orgId=null), so the org-scoped `InspectionsService.get()`
   * (which runs `requireOrgId(user)`) 403s for them — the only role allowed
   * to populate could never load the workspace. This mirrors that read's
   * include shape (spec §6) but resolves the inspection through `scopeFor`
   * (INS-083) rather than the org-scoped read: the admin stays cross-tenant
   * while an org role is confined to its own org, and an INSPECTOR to their own
   * assignments. It deliberately skips the LOCKED guard so a submitted
   * inspection can still be viewed read-only.
   */
  async loadForPopulate(inspectionId: string, actor: AuthUser) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id: inspectionId, ...this.scopeFor(actor) },
      include: {
        buyer: true,
        supplier: true,
        product: true,
        purchaseOrder: true,
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
    const items = inspection.items ?? [];
    const slots = items.flatMap((item) =>
      (item.photos ?? []).map((p) => ({
        inspectionLoopItemId: item.id,
        cycleIndex: p.cycleIndex,
      })),
    );
    return {
      ...inspection,
      items: items.map((item) => ({
        ...item,
        photos: (item.photos ?? []).map((p) => this.withViewUrl(p)),
      })),
      // The console renders the SAME rule the submit guard enforces (INS-081) —
      // a divergence between them is how a half-shot unit reaches a report.
      cycleState: cycleState(
        items.map((i) => ({ id: i.id, position: i.position })),
        slots,
      ),
    };
  }

  /**
   * Decorate a photo with a short-lived presigned GET URL (INS-049 / mirrors
   * InspectionsController.withViewUrl). Must never fail the read — a presign
   * problem degrades to viewUrl:null rather than 500ing the whole workspace.
   */
  private withViewUrl<T extends { storageKey: string }>(
    photo: T,
  ): T & { viewUrl: string | null } {
    try {
      return {
        ...photo,
        viewUrl: this.storage.presignDownload(photo.storageKey),
      };
    } catch {
      return { ...photo, viewUrl: null };
    }
  }

  /**
   * INS-081 — the measurement sheet is loop-global and filled once per CYCLE, so
   * a measurement is keyed by (inspection, cycle, label) rather than by a loop
   * FK. That natural key is also the idempotency token: re-entering a value
   * updates the row instead of duplicating the point.
   */
  async addMeasurement(
    inspectionId: string,
    actor: AuthUser,
    input: AddMeasurementInput,
  ) {
    const insp = await this.loadOpenInspection(inspectionId, actor);
    this.assertCycleIndex(input?.cycleIndex);
    if (!input?.label?.trim())
      throw new BadRequestException('label is required');
    const label = input.label.trim();
    // INS-006: audit inside the business transaction. Measurements are rendered
    // into the signed report, so the recorded value is evidence.
    return this.prisma.$transaction(async (tx) => {
      const measurement = await tx.inspectionMeasurement.upsert({
        where: {
          inspectionId_cycleIndex_label: {
            inspectionId,
            cycleIndex: input.cycleIndex,
            label,
          },
        },
        create: {
          inspectionId,
          orgId: insp.orgId,
          cycleIndex: input.cycleIndex,
          label,
          recordedValue: input.recordedValue,
          unit: input.unit,
          notes: input.notes,
        },
        update: {
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
            cycleIndex: measurement.cycleIndex,
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
