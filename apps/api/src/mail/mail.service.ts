import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

/**
 * DI token for overriding the nodemailer transport (used by tests; not bound
 * in production, where the transport is derived from SMTP_URL).
 */
export const MAIL_TRANSPORT = 'MAIL_TRANSPORT';

const DEFAULT_MAIL_FROM = 'Inspect <no-reply@inspect.local>';
const DEFAULT_WEB_BASE_URL = 'http://localhost:3001';

export interface SendResult {
  sent: boolean;
  messageId?: string;
}

export interface UserInvitationMail {
  to: string;
  token: string;
  role: string;
  orgName?: string;
}

export interface BuyerGuestMagicLinkMail {
  to: string;
  token: string;
  buyerName?: string;
}

/**
 * Outbound email for onboarding (INS-004): user/org-owner invitations and
 * buyer-guest magic links. Report-delivery email is INS-020 (needs INS-003 PDF).
 *
 * Delivery contract: every send method resolves — it NEVER throws. Email is a
 * side effect of a business write (invitation row, guest token) that must not
 * fail or roll back that write; failures are logged and reported as {sent:false}.
 *
 * Transport: SMTP_URL when configured, otherwise nodemailer's JSON transport
 * (dev mode — messages are serialized/logged, not delivered).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;
  private readonly webBaseUrl: string;

  constructor(
    config: ConfigService,
    @Optional() @Inject(MAIL_TRANSPORT) transporter?: Transporter,
  ) {
    this.from = config.get<string>('MAIL_FROM') || DEFAULT_MAIL_FROM;
    this.webBaseUrl = (config.get<string>('WEB_BASE_URL') || DEFAULT_WEB_BASE_URL).replace(
      /\/+$/,
      '',
    );

    if (transporter) {
      this.transporter = transporter;
    } else {
      const smtpUrl = config.get<string>('SMTP_URL');
      if (smtpUrl) {
        this.transporter = nodemailer.createTransport(smtpUrl);
      } else {
        this.transporter = nodemailer.createTransport({ jsonTransport: true });
        this.logger.log(
          'SMTP_URL is not set — mail is in dev/json mode (messages are logged as JSON, not delivered)',
        );
      }
    }
  }

  /** Invitation email for org users and first org owners (accept at /invite). */
  async sendUserInvitation(input: UserInvitationMail): Promise<SendResult> {
    const link =
      `${this.webBaseUrl}/invite` +
      `?token=${encodeURIComponent(input.token)}` +
      `&email=${encodeURIComponent(input.to)}` +
      `&role=${encodeURIComponent(input.role)}`;
    const orgSuffix = input.orgName ? ` to join ${input.orgName}` : '';
    const text = [
      `You've been invited${orgSuffix} on Inspect as ${input.role}.`,
      '',
      'Accept your invitation and set up your account:',
      link,
      '',
      'This link expires — if it has, ask the person who invited you to send a new one.',
      'If you were not expecting this invitation, you can ignore this email.',
    ].join('\n');

    return this.send({ to: input.to, subject: "You're invited to Inspect", text });
  }

  /** Magic-link email for read-only buyer guests (opens the /portal). */
  async sendBuyerGuestMagicLink(input: BuyerGuestMagicLinkMail): Promise<SendResult> {
    const link = `${this.webBaseUrl}/portal?token=${encodeURIComponent(input.token)}`;
    const buyerSuffix = input.buyerName ? ` for ${input.buyerName}` : '';
    const text = [
      `You've been given access to inspection reports${buyerSuffix} on Inspect.`,
      '',
      'Open your portal with this magic link:',
      link,
      '',
      'Keep this link private — anyone with it can view the portal.',
      'If you were not expecting this email, you can ignore it.',
    ].join('\n');

    return this.send({ to: input.to, subject: 'Your Inspect report portal access', text });
  }

  /** Shared send path — logs failures and resolves {sent:false}; never throws. */
  private async send(message: { to: string; subject: string; text: string }): Promise<SendResult> {
    try {
      const info = await this.transporter.sendMail({ from: this.from, ...message });
      return { sent: true, messageId: info?.messageId };
    } catch (err) {
      this.logger.error(
        `Failed to send "${message.subject}" to ${message.to}`,
        err instanceof Error ? err.stack : String(err),
      );
      return { sent: false };
    }
  }
}
