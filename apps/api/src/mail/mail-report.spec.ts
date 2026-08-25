/**
 * INS-020 — the buyer-facing report-delivery email.
 *
 * What matters here is what leaves the building: the recipient gets a working
 * portal link built from THEIR magic-link token, an independent verification URL
 * (so the buyer never has to trust the portal), and never the report bytes
 * themselves. And, per the MailService contract, a dead transport degrades to
 * {sent:false} instead of failing the delivery write that triggered it.
 *
 * Mirrors mail-inspection.spec.ts.
 */
import { ConfigService } from '@nestjs/config';
import type { Transporter } from 'nodemailer';
import { MailService } from './mail.service';

function makeMail() {
  // Typed as the generic `jest.Mock` (not inferred from the 0-arg impl) so
  // `.mock.calls[0][0]` below indexes an `any[]` tuple rather than `[]`.
  const sendMail: jest.Mock = jest.fn(async () => ({ messageId: 'mid-1' }));
  const config = new ConfigService({ WEB_BASE_URL: 'https://console.example' });
  const service = new MailService(config, {
    sendMail,
  } as unknown as Transporter);
  return { service, sendMail };
}

describe('MailService report delivery (INS-020)', () => {
  it('links the portal with the recipient URL-encoded token and the verification page', async () => {
    const { service, sendMail } = makeMail();
    const res = await service.sendReportDelivered({
      to: 'buyer.qa@northwind.example',
      token: 'magic token/1',
      reportId: 'rep-abcdef123',
      poNumber: 'PO-77',
      buyerName: 'Northwind Apparel',
      verificationToken: 'verify-9',
    });

    expect(res).toEqual({ sent: true, messageId: 'mid-1' });
    const msg = sendMail.mock.calls[0][0] as {
      to: string;
      subject: string;
      text: string;
    };
    expect(msg.to).toBe('buyer.qa@northwind.example');
    expect(msg.subject).toContain('PO-77');
    expect(msg.text).toContain(
      'https://console.example/portal?token=magic%20token%2F1',
    );
    expect(msg.text).toContain('https://console.example/r/verify-9');
    expect(msg.text).toContain('Northwind Apparel');
  });

  it('falls back to a short report reference when the inspection has no PO number', async () => {
    const { service, sendMail } = makeMail();
    await service.sendReportDelivered({
      to: 'guest@buyer.com',
      token: 'tok',
      reportId: 'rep-abcdef123',
      poNumber: null,
    });
    const msg = sendMail.mock.calls[0][0] as { subject: string; text: string };
    expect(msg.subject).toContain('rep-abcd');
    expect(msg.text).toContain('https://console.example/portal?token=tok');
  });

  it('omits the verification line when no verification token is available', async () => {
    const { service, sendMail } = makeMail();
    await service.sendReportDelivered({
      to: 'guest@buyer.com',
      token: 'tok',
      reportId: 'rep-1',
    });
    const msg = sendMail.mock.calls[0][0] as { text: string };
    // No dangling "verify it here" copy pointing at nothing.
    expect(msg.text).not.toContain('/r/');
    expect(msg.text).not.toMatch(/Verify this report independently/);
    expect(msg.text).toContain('https://console.example/portal?token=tok');
  });

  it('returns {sent:false} and does not throw when the transport rejects', async () => {
    const { service, sendMail } = makeMail();
    sendMail.mockRejectedValueOnce(new Error('SMTP connection refused'));
    await expect(
      service.sendReportDelivered({
        to: 'guest@buyer.com',
        token: 'tok',
        reportId: 'rep-1',
      }),
    ).resolves.toEqual({ sent: false });
  });
});
