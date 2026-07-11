import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuthUser } from '../auth/auth-user';
import { hasAtLeast, Role } from '../auth/rbac';

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const SAFE_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

export interface InviteUserInput {
  email: string;
  role: Role;
}

/** Org Owner user management within their own org (spec §4). */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  list(orgId: string) {
    return this.prisma.user.findMany({
      where: { orgId },
      orderBy: { createdAt: 'asc' },
      select: SAFE_SELECT,
    });
  }

  async invite(orgId: string, inviter: AuthUser, input: InviteUserInput) {
    if (!input?.email?.trim()) throw new BadRequestException('email is required');
    const email = input.email.trim().toLowerCase();
    const role = input.role ?? 'INSPECTOR';
    if (role === 'PLATFORM_ADMIN') {
      throw new ForbiddenException('Cannot invite a platform admin');
    }
    if (!hasAtLeast(inviter.role, role)) {
      throw new ForbiddenException('Cannot invite a role above your own');
    }
    // Defense-in-depth (security review): never issue an invite for an email that
    // already belongs to a user in a DIFFERENT org — accepting it could relocate
    // or reset that foreign-tenant account. (The accept path also enforces this.)
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { orgId: true },
    });
    if (existing && existing.orgId !== orgId) {
      throw new ForbiddenException('An account already exists for this email');
    }
    const invitation = await this.prisma.invitation.create({
      data: {
        orgId,
        email,
        role,
        // Security token: use a CSPRNG value, not the guessable cuid() default.
        token: randomUUID(),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        invitedById: inviter.userId,
      },
    });
    // MailService never throws — a failed send is logged, and the invitation
    // (with its copyable link in the console) is still returned to the caller.
    await this.mail.sendUserInvitation({
      to: invitation.email,
      token: invitation.token,
      role: invitation.role,
    });
    return invitation;
  }

  async updateRole(orgId: string, actor: AuthUser, userId: string, role: Role) {
    if (role === 'PLATFORM_ADMIN') {
      throw new ForbiddenException('Cannot assign platform admin');
    }
    if (!hasAtLeast(actor.role, role)) {
      throw new ForbiddenException('Cannot assign a role above your own');
    }
    const user = await this.prisma.user.findFirst({ where: { id: userId, orgId } });
    if (!user) throw new NotFoundException('User not found');
    return this.prisma.user.update({
      where: { id: userId },
      data: { role },
      select: SAFE_SELECT,
    });
  }

  async deactivate(orgId: string, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, orgId } });
    if (!user) throw new NotFoundException('User not found');
    return this.prisma.user.update({
      where: { id: userId },
      data: { status: 'DEACTIVATED' },
      select: SAFE_SELECT,
    });
  }
}
