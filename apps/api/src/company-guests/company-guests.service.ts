import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { clampGuestTtlDays } from '../common/config';
import { AuthUser } from '../auth/auth-user';
import { AuditService } from '../audit/audit.service';
import { actorTypeFor } from '../audit/actor-type';
const SAFE_SELECT = {
  id: true,
  email: true,
  status: true,
  lastAccessAt: true,
  tokenExpiresAt: true,
  createdAt: true,
} as const;

// The wire shape lives in the shared package (INS-086 §4.4); re-exported so
// the controller's existing import keeps working.
export type { InviteGuestInput } from '@inspect/shared-types';
import type { InviteGuestInput } from '@inspect/shared-types';

/**
 * INS-055 — invite-only guests, attached to a company acting in its CLIENT role
 * only (spec §0 P7: there is no factory-side portal). What a guest can then SEE
 * is decided by GuestService, and that predicate is a security boundary.
 */
@Injectable()
export class CompanyGuestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  list(orgId: string, companyId: string) {
    return this.prisma.companyGuest.findMany({
      where: { orgId, companyId },
      orderBy: { createdAt: 'asc' },
      select: SAFE_SELECT,
    });
  }

  /** Returns the guest plus the magic-link token (the credential to send them). */
  async invite(
    orgId: string,
    actor: AuthUser,
    companyId: string,
    input: InviteGuestInput,
  ) {
    if (!input?.email?.trim())
      throw new BadRequestException('email is required');
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, orgId },
    });
    if (!company) throw new NotFoundException('Company not found');

    const token = randomUUID();
    // Clamped (INS-053): callers can neither mint a permanent token nor a dead one.
    const tokenExpiresAt = new Date(
      Date.now() + clampGuestTtlDays(input.ttlDays) * 24 * 60 * 60 * 1000,
    );
    const email = input.email.trim().toLowerCase();

    // INS-006: audit inside the business transaction. Granting a company guest a
    // magic link widens who can read this tenant's signed reports, so it is a
    // security-relevant event — the token itself is deliberately NOT recorded.
    const guest = await this.prisma.$transaction(async (tx) => {
      const row = await tx.companyGuest.upsert({
        where: { companyId_email: { companyId, email } },
        update: { status: 'ACTIVE', token, tokenExpiresAt },
        create: {
          orgId,
          companyId,
          email,
          status: 'ACTIVE',
          token,
          tokenExpiresAt,
        },
        select: SAFE_SELECT,
      });
      await this.audit.append(
        {
          orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'companyGuest.invited',
          entityType: 'CompanyGuest',
          entityId: row.id,
          metadata: {
            companyId,
            email,
            tokenExpiresAt: tokenExpiresAt.toISOString(),
          },
        },
        tx,
      );
      return row;
    });
    // MailService never throws — a failed send is logged, and the magic link
    // is still returned to the inviter as a copyable fallback. `emailSent`
    // lets the console distinguish "emailed" from "copy this link".
    const { sent } = await this.mail.sendCompanyGuestMagicLink({
      to: email,
      token,
      companyName: company.name,
    });
    return { guest, token, emailSent: sent };
  }

  async revoke(orgId: string, actor: AuthUser, id: string) {
    const guest = await this.prisma.companyGuest.findFirst({
      where: { id, orgId },
    });
    if (!guest) throw new NotFoundException('Guest not found');
    return this.prisma.$transaction(async (tx) => {
      const revoked = await tx.companyGuest.update({
        where: { id },
        data: { status: 'SUSPENDED', token: null },
        select: SAFE_SELECT,
      });
      await this.audit.append(
        {
          orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'companyGuest.revoked',
          entityType: 'CompanyGuest',
          entityId: id,
          metadata: { companyId: guest.companyId, email: guest.email },
        },
        tx,
      );
      return revoked;
    });
  }
}
