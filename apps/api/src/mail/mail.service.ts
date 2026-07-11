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
 * Transport: SMTP_URL (`smtp://` or `smtps://`, short timeouts) when configured,
 * otherwise nodemailer's JSON transport (dev mode — each message is logged in
 * full, not delivered). A malformed SMTP_URL degrades LOUDLY to dev/json mode
 * instead of crashing boot.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;
  private readonly webBaseUrl: string;
  private jsonMode = false;

  constructor(
    config: ConfigService,
    @Optional() @Inject(MAIL_TRANSPORT) transporter?: Transporter,
  ) {
    this.from = config.get<string>('MAIL_FROM') || DEFAULT_MAIL_FROM;
    this.webBaseUrl = (config.get<string>('WEB_BASE_URL') || DEFAULT_WEB_BASE_URL).replace(
      /\/+$/,
      '',
    );
    this.transporter = transporter ?? this.buildTransport(config.get<string>('SMTP_URL'));
  }

  /**
   * SMTP_URL is parsed here (not passed to nodemailer as a string) for two
   * reasons found in review: (1) nodemailer's defaults would let a black-holed
   * SMTP host stall invite/onboarding requests for 30–120s — the awaited send
   * sits in the HTTP request path, so timeouts must be a few seconds; (2) a
   * scheme-less/malformed URL string makes nodemailer throw a cryptic TypeError
   * inside the constructor, taking the whole API down at boot — config problems
   * must degrade to dev/json mode with a loud error instead.
   */
  private buildTransport(smtpUrl: string | undefined): Transporter {
    if (smtpUrl) {
      try {
        const url = new URL(smtpUrl);
        if (!/^smtps?:$/.test(url.protocol)) {
          throw new Error(`unsupported scheme "${url.protocol}//" (use smtp:// or smtps://)`);
        }
        const secure = url.protocol === 'smtps:';
        return nodemailer.createTransport({
          host: url.hostname,
          port: url.port ? Number(url.port) : secure ? 465 : 587,
          secure,
          auth: url.username
            ? { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) }
            : undefined,
          connectionTimeout: 5_000,
          greetingTimeout: 5_000,
          socketTimeout: 10_000,
        });
      } catch (err) {
        this.logger.error(
          `SMTP_URL is set but unusable (${err instanceof Error ? err.message : String(err)}) — ` +
            'falling back to dev/json mode; NO EMAIL WILL BE DELIVERED until it is fixed',
        );
      }
    } else {
      this.logger.log(
        'SMTP_URL is not set — mail is in dev/json mode (each message is logged in full, not delivered)',
      );
    }
    this.jsonMode = true;
    return nodemailer.createTransport({ jsonTransport: true });
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
      // In dev/json mode the "delivery" is the serialized message itself — log it
      // (link + token included) so the documented dev workflow actually works.
      const serialized = (info as { message?: string })?.message;
      if (this.jsonMode && serialized) {
        this.logger.log(`[dev mail → ${message.to}] ${serialized}`);
      }
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
