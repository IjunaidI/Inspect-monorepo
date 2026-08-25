import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { inviteTtlMs } from '../common/config';
import { ORG_TYPES, type OrgType } from '@inspect/shared-types';

export interface CreateOrgInput {
  name: string;
  type: OrgType;
  ownerEmail: string;
}

/** Platform-Admin onboarding: create an Org and invite its first Org Owner (spec §3). */
@Injectable()
export class OrgsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  list() {
    return this.prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(actorUserId: string, input: CreateOrgInput) {
    if (!input?.name?.trim()) throw new BadRequestException('name is required');
    // Cast widens the readonly tuple so the runtime check still guards untrusted
    // input, which TypeScript would otherwise consider redundant given the type.
    if (!(ORG_TYPES as readonly string[]).includes(input.type)) {
      throw new BadRequestException(`type must be ${ORG_TYPES.join(' or ')}`);
    }
    if (!input?.ownerEmail?.trim())
      throw new BadRequestException('ownerEmail is required');
    const ownerEmail = input.ownerEmail.trim().toLowerCase();
    const name = input.name.trim();

    // Organization.name had no uniqueness of any kind, so the console happily
    // minted "Polo" twice. Compared case-insensitively on the trimmed value so
    // "polo", "Polo " and "POLO" all collide, matching what an operator means by
    // "that company already exists".
    const duplicate = await this.prisma.organization.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
    if (duplicate) {
      throw new ConflictException(
        `An organization named "${duplicate.name}" already exists`,
      );
    }

    // Don't onboard an owner whose email already has an account — accepting the
    // invite would relocate/reset that existing account (security review).
    const existing = await this.prisma.user.findUnique({
      where: { email: ownerEmail },
      select: { id: true },
    });
    if (existing) {
      throw new ForbiddenException('An account already exists for this email');
    }

    const result = await this.runCreate(
      name,
      input.type,
      ownerEmail,
      actorUserId,
    );
    // Email the first Org Owner after the transaction commits. MailService
    // never throws, so a failed send cannot roll back or fail org creation.
    // `emailSent` lets the console distinguish "emailed" from "copy this link".
    const { sent } = await this.mail.sendUserInvitation({
      to: result.invitation.email,
      token: result.invitation.token,
      role: result.invitation.role,
      orgName: result.org.name,
    });
    return { ...result, emailSent: sent };
  }

  /**
   * The check above is advisory only — two concurrent creates can both pass it.
   * Once the unique index on lower(btrim(name)) is applied the loser comes back
   * as P2002, which must read as the same 409 the pre-check produces rather than
   * leaking a raw 500.
   */
  private async runCreate(
    name: string,
    type: CreateOrgInput['type'],
    ownerEmail: string,
    actorUserId: string,
  ) {
    try {
      return await this.createInTransaction(
        name,
        type,
        ownerEmail,
        actorUserId,
      );
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new ConflictException(
          `An organization named "${name}" already exists`,
        );
      }
      throw e;
    }
  }

  private createInTransaction(
    name: string,
    type: CreateOrgInput['type'],
    ownerEmail: string,
    actorUserId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name, type },
      });
      const invitation = await tx.invitation.create({
        data: {
          orgId: org.id,
          email: ownerEmail,
          role: 'ORG_OWNER',
          // Security token: CSPRNG value, not the guessable cuid() default.
          token: randomUUID(),
          expiresAt: new Date(Date.now() + inviteTtlMs()),
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
