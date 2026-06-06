import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

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

  async registerPhoto(inspectionId: string, userId: string, input: RegisterPhotoInput) {
    const insp = await this.loadOpenInspection(inspectionId);
    if (!input?.storageKey) throw new BadRequestException('storageKey is required');
    if (!input?.contentHash) throw new BadRequestException('contentHash is required');
    if (input.inspectionLoopId) {
      await this.assertLoop(inspectionId, input.inspectionLoopId);
    }
    if (input.clientRequestId) {
      const existing = await this.prisma.photo.findFirst({
        where: { orgId: insp.orgId, clientRequestId: input.clientRequestId },
      });
      if (existing) return existing;
    }
    return this.prisma.photo.create({
      data: {
        orgId: insp.orgId,
        inspectionId: insp.id,
        inspectionLoopId: input.inspectionLoopId,
        storageKey: input.storageKey,
        thumbnailKey: input.thumbnailKey,
        source: 'MANUAL_UPLOAD', // Admin manual upload — badged unverified (spec §9)
        uploaderUserId: userId,
        capturedAt: input.capturedAt ? new Date(input.capturedAt) : undefined,
        deviceId: input.deviceId,
        gps: input.gps as Prisma.InputJsonValue,
        exif: input.exif as Prisma.InputJsonValue,
        contentHash: input.contentHash,
        clientRequestId: input.clientRequestId,
      },
    });
  }

  /** Drag a photo into the correct loop slot (spec §6). */
  async assignPhotoToLoop(inspectionId: string, photoId: string, inspectionLoopId: string) {
    await this.loadOpenInspection(inspectionId);
    const photo = await this.prisma.photo.findFirst({ where: { id: photoId, inspectionId } });
    if (!photo) {
      throw new NotFoundException('Photo not found on this inspection');
    }
    await this.assertLoop(inspectionId, inspectionLoopId);
    return this.prisma.photo.update({ where: { id: photoId }, data: { inspectionLoopId } });
  }

  async addDefect(inspectionId: string, userId: string, input: AddDefectInput) {
    const insp = await this.loadOpenInspection(inspectionId);
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
    return this.prisma.defectInstance.create({
      data: {
        orgId: insp.orgId,
        inspectionId: insp.id,
        inspectionLoopId: input.inspectionLoopId,
        defectCatalogId: input.defectCatalogId,
        customText: input.customText,
        severity,
        notes: input.notes,
        createdByUserId: userId,
        photos: input.photoIds?.length
          ? { create: input.photoIds.map((photoId) => ({ photoId })) }
          : undefined,
      },
    });
  }

  async addMeasurement(inspectionId: string, input: AddMeasurementInput) {
    await this.loadOpenInspection(inspectionId);
    if (!input?.inspectionLoopId) throw new BadRequestException('inspectionLoopId is required');
    if (!input?.label?.trim()) throw new BadRequestException('label is required');
    await this.assertLoop(inspectionId, input.inspectionLoopId);
    return this.prisma.inspectionMeasurement.create({
      data: {
        inspectionLoopId: input.inspectionLoopId,
        label: input.label.trim(),
        recordedValue: input.recordedValue,
        unit: input.unit,
        notes: input.notes,
      },
    });
  }
}
