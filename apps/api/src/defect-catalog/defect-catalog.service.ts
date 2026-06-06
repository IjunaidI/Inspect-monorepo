import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type Severity = 'CRITICAL' | 'MAJOR' | 'MINOR';

export interface CreateDefectInput {
  name: string;
  defaultSeverity: Severity;
}

@Injectable()
export class DefectCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /** Accessible defects = the global seeded library (orgId null) + this org's. */
  list(orgId: string) {
    return this.prisma.defectCatalog.findMany({
      where: { isArchived: false, OR: [{ orgId }, { orgId: null }] },
      orderBy: [{ scope: 'asc' }, { defaultSeverity: 'asc' }, { name: 'asc' }],
    });
  }

  create(orgId: string, userId: string, input: CreateDefectInput) {
    if (!input?.name?.trim()) {
      throw new BadRequestException('name is required');
    }
    if (!['CRITICAL', 'MAJOR', 'MINOR'].includes(input.defaultSeverity)) {
      throw new BadRequestException('defaultSeverity must be CRITICAL, MAJOR or MINOR');
    }
    return this.prisma.defectCatalog.create({
      data: {
        scope: 'ORG',
        orgId,
        name: input.name.trim(),
        defaultSeverity: input.defaultSeverity,
        createdByUserId: userId,
      },
    });
  }

  async archive(orgId: string, id: string) {
    const row = await this.prisma.defectCatalog.findFirst({ where: { id } });
    if (!row) {
      throw new NotFoundException('Defect not found');
    }
    if (row.orgId !== orgId) {
      throw new ForbiddenException('Cannot modify a global or other-organization defect');
    }
    return this.prisma.defectCatalog.update({ where: { id }, data: { isArchived: true } });
  }
}
