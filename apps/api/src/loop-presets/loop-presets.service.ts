import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth-user';
import { AuditService } from '../audit/audit.service';
import { actorTypeFor } from '../audit/actor-type';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(orgId: string, opts: { includeArchived?: boolean; q?: string; take?: number; skip?: number } = {}) {
    return this.prisma.loopPreset.findMany({
      where: {
        orgId,
        ...(opts.includeArchived ? {} : { isArchived: false }),
        ...(opts.q ? { name: { contains: opts.q, mode: 'insensitive' as const } } : {}),
      },
      orderBy: [{ name: 'asc' }, { version: 'desc' }],
      take: opts.take,
      skip: opts.skip,
      // INS-005: usage counts so the presets screen renders real figures.
      include: {
        _count: {
          select: { steps: true, inspections: true, defaultForBuyers: true },
        },
      },
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

  async create(orgId: string, actor: AuthUser, input: CreateLoopPresetInput) {
    if (!input?.name?.trim()) {
      throw new BadRequestException('name is required');
    }
    // Honesty guard (INS-052): the AQL engine implements General Level II only.
    // Storing another level would silently disagree with every computed sampling.
    if (input.aqlLevel && input.aqlLevel !== 'II') {
      throw new BadRequestException(
        `Only AQL General Level II is supported in the MVP (got '${input.aqlLevel}')`,
      );
    }
    if (!Array.isArray(input.steps) || input.steps.length === 0) {
      throw new BadRequestException('at least one step is required');
    }
    const refPrefix = `orgs/${orgId}/presets/`;
    input.steps.forEach((s, i) => {
      if (!s?.zoneName?.trim()) {
        throw new BadRequestException(`step ${i + 1}: zoneName is required`);
      }
      // Tenant isolation (security review): reference-image keys must live in
      // THIS org's preset namespace. Storing an arbitrary key would let the
      // preset-detail presign turn the API into a signing oracle over any other
      // tenant's object (keys leak via viewUrls + inspection detail).
      for (const key of s.referenceImageUrls ?? []) {
        if (typeof key !== 'string' || !key.startsWith(refPrefix)) {
          throw new BadRequestException(
            `step ${i + 1}: referenceImageUrls must be keys under ${refPrefix} (use POST /loop-presets/presign)`,
          );
        }
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

    // INS-006: audit inside the business transaction.
    return this.prisma.$transaction(async (tx) => {
      const preset = await tx.loopPreset.create({
        data: {
          orgId,
          name: input.name.trim(),
          description: input.description,
          aqlLevel: input.aqlLevel,
          version,
          createdByUserId: actor.userId,
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
      await this.audit.append(
        {
          orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'loopPreset.created',
          entityType: 'LoopPreset',
          entityId: preset.id,
          metadata: { name: preset.name, version: preset.version, steps: preset.steps.length },
        },
        tx,
      );
      return preset;
    });
  }

  async archive(orgId: string, actor: AuthUser, id: string) {
    await this.get(orgId, id);
    return this.prisma.$transaction(async (tx) => {
      const preset = await tx.loopPreset.update({
        where: { id },
        data: { isArchived: true },
      });
      await this.audit.append(
        {
          orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'loopPreset.archived',
          entityType: 'LoopPreset',
          entityId: id,
        },
        tx,
      );
      return preset;
    });
  }
}
