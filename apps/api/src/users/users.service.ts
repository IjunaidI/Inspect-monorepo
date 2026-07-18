import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth-user';
import { hasAtLeast, Role } from '../auth/rbac';
import { hashPassword } from '../auth/password';
import { inviteTtlMs } from '../common/config';
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

export interface CreateMemberInput {
  name?: string;
  email: string;
  password: string;
  role?: Role;
}

/** Org Owner user management within their own org (spec §4). */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  list(orgId: string, opts: { q?: string; take?: number; skip?: number } = {}) {
    return this.prisma.user.findMany({
      where: {
        orgId,
        ...(opts.q
          ? {
              OR: [
                { email: { contains: opts.q, mode: 'insensitive' as const } },
                { name: { contains: opts.q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: opts.take,
      skip: opts.skip,
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
        expiresAt: new Date(Date.now() + inviteTtlMs()),
        invitedById: inviter.userId,
      },
    });
    // MailService never throws — a failed send is logged, and the invitation
    // (with its copyable link in the console) is still returned to the caller.
    // `emailSent` lets the console distinguish "emailed" from "copy this link".
    const { sent } = await this.mail.sendUserInvitation({
      to: invitation.email,
      token: invitation.token,
      role: invitation.role,
    });
    return { ...invitation, emailSent: sent };
  }

  /**
   * Direct add-member (INS-059): the owner sets name/email/password and the
   * account is ACTIVE immediately — no email round-trip. Reuses the invite()
   * guard set; a duplicate email (same or foreign org) gets one generic refusal
   * so this endpoint is not an account-existence oracle.
   */
  async createMember(orgId: string, actor: AuthUser, input: CreateMemberInput) {
    if (!input?.email?.trim()) throw new BadRequestException('email is required');
    if (!input?.password || input.password.length < 8) {
      throw new BadRequestException('password (min 8 characters) is required');
    }
    const email = input.email.trim().toLowerCase();
    const role = input.role ?? 'INSPECTOR';
    if (role === 'PLATFORM_ADMIN') throw new ForbiddenException('Cannot create a platform admin');
    if (!hasAtLeast(actor.role, role)) throw new ForbiddenException('Cannot create a role above your own');
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { orgId: true } });
    if (existing) throw new ForbiddenException('An account already exists for this email');

    const passwordHash = await hashPassword(input.password);
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { orgId, email, name: input.name?.trim() || email, role, status: 'ACTIVE', passwordHash },
        select: SAFE_SELECT,
      });
      await this.audit.append(
        { orgId, actorType: 'USER', actorUserId: actor.userId, action: 'user.member_added', entityType: 'User', entityId: user.id, metadata: { role } },
        tx,
      );
      return user;
    });
  }

  /**
   * An org must always retain >= 1 ACTIVE ORG_OWNER (INS-058). Reachable in
   * practice via a deactivated-but-token-alive owner (JwtAuthGuard is stateless),
   * so this is not dead defense.
   */
  private async assertNotLastActiveOwner(orgId: string, targetUserId: string, verb: string): Promise<void> {
    const otherActiveOwners = await this.prisma.user.count({
      where: { orgId, role: 'ORG_OWNER', status: 'ACTIVE', id: { not: targetUserId } },
    });
    if (otherActiveOwners === 0) {
      throw new BadRequestException(`Cannot ${verb} the organization's only active owner`);
    }
  }

  async updateRole(orgId: string, actor: AuthUser, userId: string, role: Role) {
    if (actor.userId === userId) {
      throw new ForbiddenException('You cannot change your own role');
    }
    if (role === 'PLATFORM_ADMIN') {
      throw new ForbiddenException('Cannot assign platform admin');
    }
    if (!hasAtLeast(actor.role, role)) {
      throw new ForbiddenException('Cannot assign a role above your own');
    }
    const user = await this.prisma.user.findFirst({ where: { id: userId, orgId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === 'ORG_OWNER' && role !== 'ORG_OWNER' && user.status === 'ACTIVE') {
      await this.assertNotLastActiveOwner(orgId, userId, 'demote');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: userId }, data: { role }, select: SAFE_SELECT });
      await this.audit.append(
        { orgId, actorType: 'USER', actorUserId: actor.userId, action: 'user.role_changed', entityType: 'User', entityId: userId, metadata: { role } },
        tx,
      );
      return updated;
    });
  }

  async deactivate(orgId: string, actor: AuthUser, userId: string) {
    if (actor.userId === userId) {
      throw new ForbiddenException('You cannot deactivate your own account');
    }
    const user = await this.prisma.user.findFirst({ where: { id: userId, orgId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === 'ORG_OWNER' && user.status === 'ACTIVE') {
      await this.assertNotLastActiveOwner(orgId, userId, 'deactivate');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: userId }, data: { status: 'DEACTIVATED' }, select: SAFE_SELECT });
      await this.audit.append(
        { orgId, actorType: 'USER', actorUserId: actor.userId, action: 'user.deactivated', entityType: 'User', entityId: userId },
        tx,
      );
      return updated;
    });
  }

  /** Deactivation is reversible (INS-058) — INVITED accounts must finish their invite instead. */
  async reactivate(orgId: string, actor: AuthUser, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, orgId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.status === 'ACTIVE') return this.prisma.user.findFirst({ where: { id: userId }, select: SAFE_SELECT });
    if (user.status === 'INVITED') {
      throw new BadRequestException('This account has a pending invitation — it activates by accepting the invite');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: userId }, data: { status: 'ACTIVE' }, select: SAFE_SELECT });
      await this.audit.append(
        { orgId, actorType: 'USER', actorUserId: actor.userId, action: 'user.reactivated', entityType: 'User', entityId: userId },
        tx,
      );
      return updated;
    });
  }
}
