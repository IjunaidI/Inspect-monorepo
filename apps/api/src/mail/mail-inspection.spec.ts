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

describe('MailService inspection notifications (INS-069)', () => {
  it('sendInspectionSubmitted links the review page and names the PO', async () => {
    const { service, sendMail } = makeMail();
    const res = await service.sendInspectionSubmitted({
      to: 'qa@x.com',
      poNumber: 'PO-77',
      inspectionId: 'insp-9',
    });
    expect(res.sent).toBe(true);
    const msg = sendMail.mock.calls[0][0] as {
      to: string;
      subject: string;
      text: string;
    };
    expect(msg.to).toBe('qa@x.com');
    expect(msg.subject).toContain('PO-77');
    expect(msg.text).toContain(
      'https://console.example/inspections/insp-9/review',
    );
  });

  it('sendInspectionDecided carries decision + remarks and never throws on transport failure', async () => {
    const { service, sendMail } = makeMail();
    const res = await service.sendInspectionDecided({
      to: 'insp@x.com',
      poNumber: null,
      inspectionId: 'insp-9',
      decision: 'FAIL',
      remarks: 'stitching',
    });
    expect(res.sent).toBe(true);
    const msg = sendMail.mock.calls[0][0] as { subject: string; text: string };
    expect(msg.subject).toContain('FAIL');
    expect(msg.text).toContain('stitching');

    sendMail.mockRejectedValueOnce(new Error('smtp down'));
    const failed = await service.sendInspectionDecided({
      to: 'a@b.c',
      poNumber: 'P',
      inspectionId: 'i',
      decision: 'PASS',
    });
    expect(failed.sent).toBe(false);
  });
});
