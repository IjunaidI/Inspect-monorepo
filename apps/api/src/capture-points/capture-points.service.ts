import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CAPTURE_POINT_CATEGORIES,
  type CapturePointCategory,
  type CreateCapturePointInput,
} from '@inspect/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth-user';
import { AuditService } from '../audit/audit.service';
import { actorTypeFor } from '../audit/actor-type';

// The wire shape lives in the shared package; re-exported for the controller.
export type { CreateCapturePointInput } from '@inspect/shared-types';

/** A library row's identity is its NAME: trim and collapse inner whitespace. */
export function normalizeCapturePointName(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
}

/**
 * INS-097 — the hybrid capture-point library, mirroring DefectCatalogService:
 * GLOBAL seeded rows (orgId null) + this org's own, never another org's.
 *
 * POST is FIND-OR-CREATE rather than 409-on-duplicate: the builder wants "the
 * row for this name" and would only ever catch the 409 to do the same lookup.
 * A custom point the QA Manager types therefore becomes a reusable library row
 * the moment it is added to a loop.
 */
@Injectable()
export class CapturePointsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(
    orgId: string,
    opts: {
      q?: string;
      category?: CapturePointCategory;
      includeArchived?: boolean;
    } = {},
  ) {
    return this.prisma.capturePoint.findMany({
      where: {
        OR: [{ orgId }, { orgId: null }],
        ...(opts.includeArchived ? {} : { isArchived: false }),
        ...(opts.category ? { category: opts.category } : {}),
        ...(opts.q
          ? { name: { contains: opts.q, mode: 'insensitive' as const } }
          : {}),
      },
      // Inside a category the org's own rows come first (enum order GLOBAL,
      // ORG → desc), then by name.
      orderBy: [{ category: 'asc' }, { scope: 'desc' }, { name: 'asc' }],
    });
  }

  async findOrCreate(
    orgId: string,
    actor: AuthUser,
    input: CreateCapturePointInput,
  ) {
    const name = normalizeCapturePointName(input?.name);
    if (!name) {
      throw new BadRequestException('name is required');
    }
    if (!CAPTURE_POINT_CATEGORIES.includes(input.category)) {
      throw new BadRequestException(
        `category must be one of ${CAPTURE_POINT_CATEGORIES.join(', ')}`,
      );
    }
    const existing = await this.prisma.capturePoint.findFirst({
      where: {
        isArchived: false,
        name: { equals: name, mode: 'insensitive' },
        OR: [{ orgId }, { orgId: null }],
      },
    });
    if (existing) return existing;

    try {
      // INS-006: audit inside the business transaction.
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.capturePoint.create({
          data: {
            scope: 'ORG',
            orgId,
            name,
            description: input.description?.trim() || null,
            category: input.category,
            iconKey: input.iconKey?.trim() || null,
            createdByUserId: actor.userId,
          },
        });
        await this.audit.append(
          {
            orgId,
            actorType: actorTypeFor(actor),
            actorUserId: actor.userId,
            action: 'capturePoint.created',
            entityType: 'CapturePoint',
            entityId: row.id,
            metadata: { name, category: input.category },
          },
          tx,
        );
        return row;
      });
    } catch (e) {
      // Lost a race on @@unique([orgId, name]) — converge on the winner rather
      // than surfacing a 500 for a row that now exists.
      if ((e as { code?: string })?.code === 'P2002') {
        const winner = await this.prisma.capturePoint.findFirst({
          where: { orgId, name: { equals: name, mode: 'insensitive' } },
        });
        if (winner) return winner;
      }
      throw e;
    }
  }

  async archive(orgId: string, actor: AuthUser, id: string) {
    const row = await this.prisma.capturePoint.findFirst({ where: { id } });
    if (!row) {
      throw new NotFoundException('Capture point not found');
    }
    if (row.orgId !== orgId) {
      throw new ForbiddenException(
        'Cannot modify a global or other-organization capture point',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.capturePoint.update({
        where: { id },
        data: { isArchived: true },
      });
      await this.audit.append(
        {
          orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'capturePoint.archived',
          entityType: 'CapturePoint',
          entityId: id,
          metadata: { name: row.name },
        },
        tx,
      );
      return updated;
    });
  }
}
