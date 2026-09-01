import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from '../auth/password';
import { AuditService } from '../audit/audit.service';

// The wire shape lives in the shared package (INS-086 §4.4); re-exported so
// the controller's existing import keeps working.
export type { AcceptInvitationInput } from '@inspect/shared-types';
import type { AcceptInvitationInput } from '@inspect/shared-types';

/** Accept an invite: set the password and activate the User (spec §3). Public. */
@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Public lookup so the /invite page renders VERIFIED data (email/role/org)
   * from the token instead of trusting spoofable query params (INS-054).
   * Leaks nothing beyond what the invitation email itself contains.
   */
  async getByToken(token: string) {
    if (!token?.trim()) throw new BadRequestException('token is required');
    const invitation = await this.prisma.invitation.findUnique({
      where: { token },
      include: { organization: { select: { name: true } } },
    });
    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.acceptedAt)
      throw new GoneException('Invitation already used');
    if (invitation.expiresAt.getTime() < Date.now()) {
      throw new GoneException('Invitation has expired');
    }
    return {
      email: invitation.email,
      role: invitation.role,
      orgName: invitation.organization?.name ?? null,
      expiresAt: invitation.expiresAt,
    };
  }

  async accept(input: AcceptInvitationInput) {
    if (!input?.token) throw new BadRequestException('token is required');
    if (!input?.password || input.password.length < 8) {
      throw new BadRequestException('password (min 8 characters) is required');
    }
    const invitation = await this.prisma.invitation.findUnique({
      where: { token: input.token },
    });
    if (!invitation || invitation.acceptedAt) {
      throw new BadRequestException('Invalid or already-accepted invitation');
    }
    if (invitation.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Invitation has expired');
    }

    // Tenant-isolation guard: User.email is globally unique. If an account with
    // this email already exists in ANOTHER org, accepting must NOT relocate it,
    // reset its password, or change its role — that would be a cross-tenant
    // account takeover. Only a brand-new account, or an existing one already in
    // the invitation's org, may be activated by an invite. (Security review.)
    const existing = await this.prisma.user.findUnique({
      where: { email: invitation.email },
      select: { id: true, orgId: true },
    });
    if (existing && existing.orgId !== invitation.orgId) {
      throw new ForbiddenException('An account already exists for this email');
    }

    const passwordHash = await hashPassword(input.password);
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { email: invitation.email },
        update: {
          orgId: invitation.orgId,
          role: invitation.role,
          status: 'ACTIVE',
          passwordHash,
          name: input.name ?? undefined,
        },
        create: {
          email: invitation.email,
          orgId: invitation.orgId,
          role: invitation.role,
          status: 'ACTIVE',
          passwordHash,
          name: input.name ?? invitation.email,
        },
      });
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });
      // INS-006: account activation is an unauthenticated public write that
      // grants a role inside a tenant — one of the few events with no logged-in
      // actor, so it is attributed to the newly-activated user themselves and
      // typed SYSTEM to make the self-service origin explicit in the chain.
      await this.audit.append(
        {
          orgId: invitation.orgId,
          actorType: 'SYSTEM',
          actorUserId: user.id,
          action: 'invitation.accepted',
          entityType: 'User',
          entityId: user.id,
          metadata: {
            invitationId: invitation.id,
            email: invitation.email,
            role: invitation.role,
          },
        },
        tx,
      );
      const { passwordHash: _omit, ...safe } = user;
      return safe;
    });
  }
}
