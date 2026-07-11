import { MailService } from './mail.service';

type FakeTransport = {
  sendMail: jest.Mock;
};

function makeConfig(values: Record<string, string | undefined> = {}) {
  return { get: (k: string) => values[k] };
}

function makeTransport(impl?: () => Promise<unknown>): FakeTransport {
  return {
    sendMail: jest.fn(impl ?? (async () => ({ messageId: 'fake-message-id' }))),
  };
}

function makeService(
  values: Record<string, string | undefined> = {},
  transport?: FakeTransport,
): { service: MailService; transport?: FakeTransport } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new MailService(makeConfig(values) as any, transport as any);
  return { service, transport };
}

describe('MailService', () => {
  describe('sendUserInvitation', () => {
    it('sends from MAIL_FROM to the invitee with the exact URL-encoded invite link', async () => {
      const transport = makeTransport();
      const { service } = makeService(
        {
          MAIL_FROM: 'Inspect QA <qa@inspect.example>',
          WEB_BASE_URL: 'https://console.inspect.example',
        },
        transport,
      );

      const result = await service.sendUserInvitation({
        to: 'new user+qa@example.com',
        token: 'tok en/1',
        role: 'QA_MANAGER',
        orgName: 'Acme Apparel',
      });

      expect(result).toEqual({ sent: true, messageId: 'fake-message-id' });
      expect(transport.sendMail).toHaveBeenCalledTimes(1);
      const message = transport.sendMail.mock.calls[0][0];
      expect(message.from).toBe('Inspect QA <qa@inspect.example>');
      expect(message.to).toBe('new user+qa@example.com');
      expect(message.subject).toBe("You're invited to Inspect");
      expect(message.text).toContain(
        'https://console.inspect.example/invite?token=tok%20en%2F1&email=new%20user%2Bqa%40example.com&role=QA_MANAGER',
      );
      expect(message.text).toContain('Acme Apparel');
      expect(message.text).toContain('QA_MANAGER');
    });

    it('defaults MAIL_FROM and WEB_BASE_URL when config is unset', async () => {
      const transport = makeTransport();
      const { service } = makeService({}, transport);

      await service.sendUserInvitation({
        to: 'owner@example.com',
        token: 'tok-1',
        role: 'ORG_OWNER',
      });

      const message = transport.sendMail.mock.calls[0][0];
      expect(message.from).toBe('Inspect <no-reply@inspect.local>');
      expect(message.text).toContain(
        'http://localhost:3001/invite?token=tok-1&email=owner%40example.com&role=ORG_OWNER',
      );
    });

    it('returns {sent:false} and does not throw when the transport rejects', async () => {
      const transport = makeTransport(async () => {
        throw new Error('SMTP connection refused');
      });
      const { service } = makeService({}, transport);

      await expect(
        service.sendUserInvitation({ to: 'x@y.com', token: 't', role: 'INSPECTOR' }),
      ).resolves.toEqual({ sent: false });
    });
  });

  describe('sendBuyerGuestMagicLink', () => {
    it('sends the exact URL-encoded portal magic link', async () => {
      const transport = makeTransport();
      const { service } = makeService({ WEB_BASE_URL: 'https://console.inspect.example' }, transport);

      const result = await service.sendBuyerGuestMagicLink({
        to: 'guest@buyer.com',
        token: 'magic token/2',
        buyerName: 'Nordwind Retail',
      });

      expect(result).toEqual({ sent: true, messageId: 'fake-message-id' });
      const message = transport.sendMail.mock.calls[0][0];
      expect(message.to).toBe('guest@buyer.com');
      expect(message.text).toContain(
        'https://console.inspect.example/portal?token=magic%20token%2F2',
      );
      expect(message.text).toContain('Nordwind Retail');
    });

    it('returns {sent:false} and does not throw when the transport rejects', async () => {
      const transport = makeTransport(async () => {
        throw new Error('boom');
      });
      const { service } = makeService({}, transport);

      await expect(
        service.sendBuyerGuestMagicLink({ to: 'guest@buyer.com', token: 't' }),
      ).resolves.toEqual({ sent: false });
    });
  });

  describe('transport selection', () => {
    it('falls back to the JSON transport when SMTP_URL is unset', async () => {
      const { service } = makeService({});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const transporter = (service as any).transporter;
      expect(transporter.transporter.name).toBe('JSONTransport');

      // The JSON transport "delivers" by serializing — a real end-to-end send succeeds.
      const result = await service.sendUserInvitation({
        to: 'dev@example.com',
        token: 'tok-json',
        role: 'INSPECTOR',
      });
      expect(result.sent).toBe(true);
      expect(result.messageId).toBeTruthy();
    });

    it('uses an SMTP transport when SMTP_URL is set', () => {
      const { service } = makeService({
        SMTP_URL: 'smtp://user:pass@smtp.example.com:587',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const transporter = (service as any).transporter;
      expect(transporter.transporter.name).toBe('SMTP');
    });
  });
});
