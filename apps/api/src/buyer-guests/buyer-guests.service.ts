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

export interface InviteGuestInput {
  email: string;
  ttlDays?: number;
}

/** Invite-only buyer guests, scoped to one buyer in one tenant (spec §3/§11). */
@Injectable()
export class BuyerGuestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  list(orgId: string, buyerId: string) {
    return this.prisma.buyerGuest.findMany({
      where: { orgId, buyerId },
      orderBy: { createdAt: 'asc' },
      select: SAFE_SELECT,
    });
  }

  /** Returns the guest plus the magic-link token (the credential to send them). */
  async invite(
    orgId: string,
    actor: AuthUser,
    buyerId: string,
    input: InviteGuestInput,
  ) {
    if (!input?.email?.trim())
      throw new BadRequestException('email is required');
    const buyer = await this.prisma.buyer.findFirst({
      where: { id: buyerId, orgId },
    });
    if (!buyer) throw new NotFoundException('Buyer not found');

    const token = randomUUID();
    // Clamped (INS-053): callers can neither mint a permanent token nor a dead one.
    const tokenExpiresAt = new Date(
      Date.now() + clampGuestTtlDays(input.ttlDays) * 24 * 60 * 60 * 1000,
    );
    const email = input.email.trim().toLowerCase();

    // INS-006: audit inside the business transaction. Granting a buyer guest a
    // magic link widens who can read this tenant's signed reports, so it is a
    // security-relevant event — the token itself is deliberately NOT recorded.
    const guest = await this.prisma.$transaction(async (tx) => {
      const row = await tx.buyerGuest.upsert({
        where: { buyerId_email: { buyerId, email } },
        update: { status: 'ACTIVE', token, tokenExpiresAt },
        create: {
          orgId,
          buyerId,
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
          action: 'buyerGuest.invited',
          entityType: 'BuyerGuest',
          entityId: row.id,
          metadata: {
            buyerId,
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
    const { sent } = await this.mail.sendBuyerGuestMagicLink({
      to: email,
      token,
      buyerName: buyer.name,
    });
    return { guest, token, emailSent: sent };
  }

  async revoke(orgId: string, actor: AuthUser, id: string) {
    const guest = await this.prisma.buyerGuest.findFirst({
      where: { id, orgId },
    });
    if (!guest) throw new NotFoundException('Guest not found');
    return this.prisma.$transaction(async (tx) => {
      const revoked = await tx.buyerGuest.update({
        where: { id },
        data: { status: 'SUSPENDED', token: null },
        select: SAFE_SELECT,
      });
      await this.audit.append(
        {
          orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'buyerGuest.revoked',
          entityType: 'BuyerGuest',
          entityId: id,
          metadata: { buyerId: guest.buyerId, email: guest.email },
        },
        tx,
      );
      return revoked;
    });
  }
}
