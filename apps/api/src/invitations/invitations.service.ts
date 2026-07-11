import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from '../auth/password';

export interface AcceptInvitationInput {
  token: string;
  name?: string;
  password: string;
}

/** Accept an invite: set the password and activate the User (spec §3). Public. */
@Injectable()
export class InvitationsService {
  constructor(private readonly prisma: PrismaService) {}

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
      const { passwordHash: _omit, ...safe } = user;
      return safe;
    });
  }
}
