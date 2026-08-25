import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth-user';
import { AuditService } from '../audit/audit.service';
import { actorTypeFor } from '../audit/actor-type';
import type { DefectSeverity } from '@inspect/shared-types';

type Severity = DefectSeverity;

export interface CreateDefectInput {
  name: string;
  defaultSeverity: Severity;
}

@Injectable()
export class DefectCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Accessible defects = the global seeded library (orgId null) + this org's. */
  list(orgId: string) {
    return this.prisma.defectCatalog.findMany({
      where: { isArchived: false, OR: [{ orgId }, { orgId: null }] },
      orderBy: [{ scope: 'asc' }, { defaultSeverity: 'asc' }, { name: 'asc' }],
    });
  }

  async create(orgId: string, actor: AuthUser, input: CreateDefectInput) {
    if (!input?.name?.trim()) {
      throw new BadRequestException('name is required');
    }
    if (!['CRITICAL', 'MAJOR', 'MINOR'].includes(input.defaultSeverity)) {
      throw new BadRequestException(
        'defaultSeverity must be CRITICAL, MAJOR or MINOR',
      );
    }
    // INS-006: audit inside the business transaction. A defect's severity feeds
    // the AQL class counts, so who added it and when is forensically relevant.
    return this.prisma.$transaction(async (tx) => {
      const defect = await tx.defectCatalog.create({
        data: {
          scope: 'ORG',
          orgId,
          name: input.name.trim(),
          defaultSeverity: input.defaultSeverity,
          createdByUserId: actor.userId,
        },
      });
      await this.audit.append(
        {
          orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'defectCatalog.created',
          entityType: 'DefectCatalog',
          entityId: defect.id,
          metadata: {
            name: defect.name,
            defaultSeverity: defect.defaultSeverity,
          },
        },
        tx,
      );
      return defect;
    });
  }

  async archive(orgId: string, actor: AuthUser, id: string) {
    const row = await this.prisma.defectCatalog.findFirst({ where: { id } });
    if (!row) {
      throw new NotFoundException('Defect not found');
    }
    if (row.orgId !== orgId) {
      throw new ForbiddenException(
        'Cannot modify a global or other-organization defect',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const defect = await tx.defectCatalog.update({
        where: { id },
        data: { isArchived: true },
      });
      await this.audit.append(
        {
          orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'defectCatalog.archived',
          entityType: 'DefectCatalog',
          entityId: id,
          metadata: { name: row.name },
        },
        tx,
      );
      return defect;
    });
  }
}
