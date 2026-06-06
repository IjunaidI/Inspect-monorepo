import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type AqlLevelInput = 'I' | 'II' | 'III' | 'S1' | 'S2' | 'S3' | 'S4';

export interface PresetStepInput {
  zoneName: string;
  description?: string;
  referenceImageUrls?: string[];
  requiredShotCount?: number;
  measurementFields?: Array<{ label: string; unit?: string }>;
  allowedDefectCatalogIds?: string[];
}
export interface CreateLoopPresetInput {
  name: string;
  description?: string;
  aqlLevel?: AqlLevelInput;
  steps: PresetStepInput[];
}

@Injectable()
export class LoopPresetsService {
  constructor(private readonly prisma: PrismaService) {}

  list(orgId: string) {
    return this.prisma.loopPreset.findMany({
      where: { orgId, isArchived: false },
      orderBy: [{ name: 'asc' }, { version: 'desc' }],
      include: { _count: { select: { steps: true } } },
    });
  }

  async get(orgId: string, id: string) {
    const preset = await this.prisma.loopPreset.findFirst({
      where: { id, orgId },
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
    if (!preset) {
      throw new NotFoundException('Loop preset not found');
    }
    return preset;
  }

  async create(orgId: string, userId: string, input: CreateLoopPresetInput) {
    if (!input?.name?.trim()) {
      throw new BadRequestException('name is required');
    }
    if (!Array.isArray(input.steps) || input.steps.length === 0) {
      throw new BadRequestException('at least one step is required');
    }
    input.steps.forEach((s, i) => {
      if (!s?.zoneName?.trim()) {
        throw new BadRequestException(`step ${i + 1}: zoneName is required`);
      }
    });

    // Allowed defects must be accessible: a global entry (orgId null) or this org's.
    const catalogIds = [
      ...new Set(input.steps.flatMap((s) => s.allowedDefectCatalogIds ?? [])),
    ];
    if (catalogIds.length > 0) {
      const found = await this.prisma.defectCatalog.findMany({
        where: { id: { in: catalogIds }, OR: [{ orgId }, { orgId: null }] },
        select: { id: true },
      });
      if (found.length !== catalogIds.length) {
        throw new BadRequestException('one or more allowedDefectCatalogIds are not accessible');
      }
    }

    // New presets auto-version per name (editing == new version; history is preserved).
    const latest = await this.prisma.loopPreset.findFirst({
      where: { orgId, name: input.name.trim() },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (latest?.version ?? 0) + 1;

    return this.prisma.loopPreset.create({
      data: {
        orgId,
        name: input.name.trim(),
        description: input.description,
        aqlLevel: input.aqlLevel,
        version,
        createdByUserId: userId,
        steps: {
          create: input.steps.map((s, i) => ({
            position: i + 1,
            zoneName: s.zoneName.trim(),
            description: s.description,
            referenceImageUrls: s.referenceImageUrls ?? [],
            requiredShotCount: s.requiredShotCount ?? 1,
            measurementFields: {
              create: (s.measurementFields ?? []).map((m, j) => ({
                position: j + 1,
                label: m.label,
                unit: m.unit,
              })),
            },
            allowedDefects: {
              create: (s.allowedDefectCatalogIds ?? []).map((cid) => ({
                defectCatalogId: cid,
              })),
            },
          })),
        },
      },
      include: { steps: { include: { measurementFields: true, allowedDefects: true } } },
    });
  }

  async archive(orgId: string, id: string) {
    await this.get(orgId, id);
    return this.prisma.loopPreset.update({
      where: { id },
      data: { isArchived: true },
    });
  }
}
