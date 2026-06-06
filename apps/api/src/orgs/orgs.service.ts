import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface CreateOrgInput {
  name: string;
  type: 'INSPECTION_COMPANY' | 'MANUFACTURER';
  ownerEmail: string;
}

/** Platform-Admin onboarding: create an Org and invite its first Org Owner (spec §3). */
@Injectable()
export class OrgsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.organization.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async create(actorUserId: string, input: CreateOrgInput) {
    if (!input?.name?.trim()) throw new BadRequestException('name is required');
    if (!['INSPECTION_COMPANY', 'MANUFACTURER'].includes(input.type)) {
      throw new BadRequestException('type must be INSPECTION_COMPANY or MANUFACTURER');
    }
    if (!input?.ownerEmail?.trim()) throw new BadRequestException('ownerEmail is required');

    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: input.name.trim(), type: input.type },
      });
      const invitation = await tx.invitation.create({
        data: {
          orgId: org.id,
          email: input.ownerEmail.trim().toLowerCase(),
          role: 'ORG_OWNER',
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          invitedById: actorUserId,
        },
      });
      await this.audit.append(
        {
          orgId: org.id,
          actorType: 'PLATFORM_ADMIN',
          actorUserId,
          action: 'org.created',
          entityType: 'Organization',
          entityId: org.id,
          metadata: { name: org.name, type: org.type },
        },
        tx,
      );
      return { org, invitation };
    });
  }
}
