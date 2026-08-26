import { CompanyGuestsService } from './company-guests.service';
import { AuthUser } from '../auth/auth-user';

/**
 * INS-055 — ported from `buyer-guests.service.spec.ts`, plus the guarantee that
 * spec §4 makes load-bearing: the audit row for an invite must NOT contain the
 * magic-link token. Granting a guest widens who can read this tenant's signed
 * reports, so the event is recorded — but the credential itself never lands in
 * an append-only log that other people can read.
 */

const ACTOR = {
  userId: 'u1',
  orgId: 'org1',
  role: 'ORG_OWNER',
} as unknown as AuthUser;

function makeService(options?: {
  company?: Record<string, unknown> | null;
  mailResult?: { sent: boolean; messageId?: string };
}) {
  const company =
    options?.company === undefined
      ? { id: 'c1', orgId: 'org1', name: 'Nordwind Retail' }
      : options.company;
  const prisma: Record<string, unknown> = {
    company: {
      findFirst: jest.fn(async () => company),
    },
    companyGuest: {
      findFirst: jest.fn(async () => ({
        id: 'g1',
        orgId: 'org1',
        companyId: 'c1',
        email: 'guest@client.com',
      })),
      update: jest.fn(async () => ({ id: 'g1', status: 'SUSPENDED' })),
      upsert: jest.fn(
        async ({ create }: { create: Record<string, unknown> }) => ({
          id: 'g1',
          email: create.email,
          status: 'ACTIVE',
          lastAccessAt: null,
          tokenExpiresAt: create.tokenExpiresAt,
          createdAt: new Date('2026-07-11T00:00:00Z'),
        }),
      ),
    },
  };
  // INS-006: invite/revoke write their audit row in the same transaction.
  prisma.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) =>
    fn(prisma),
  );
  const mail = {
    sendCompanyGuestMagicLink: jest.fn(
      async () => options?.mailResult ?? { sent: true },
    ),
  };
  const audit = { append: jest.fn(async () => ({})) };

  const service = new CompanyGuestsService(
    prisma as any,
    mail as any,
    audit as any,
  );

  return { service, prisma: prisma as any, mail, audit };
}

describe('CompanyGuestsService.invite', () => {
  it('upserts the guest and emails the magic-link token with the company name', async () => {
    const { service, prisma, mail } = makeService();

    const { guest, token } = await service.invite('org1', ACTOR, 'c1', {
      email: '  Guest@Client.COM ',
    });

    expect(prisma.companyGuest.upsert).toHaveBeenCalledTimes(1);
    expect(guest).toMatchObject({
      id: 'g1',
      email: 'guest@client.com',
      status: 'ACTIVE',
    });
    expect(token).toBeTruthy();
    expect(mail.sendCompanyGuestMagicLink).toHaveBeenCalledTimes(1);
    expect(mail.sendCompanyGuestMagicLink).toHaveBeenCalledWith({
      to: 'guest@client.com',
      token,
      companyName: 'Nordwind Retail',
    });
  });

  it('keys the upsert on (companyId, email), not on the company alone', async () => {
    const { service, prisma } = makeService();
    await service.invite('org1', ACTOR, 'c1', { email: 'g@c.com' });
    expect(prisma.companyGuest.upsert.mock.calls[0][0].where).toEqual({
      companyId_email: { companyId: 'c1', email: 'g@c.com' },
    });
  });

  /**
   * The token is the credential. Recording the EVENT is required (INS-006);
   * recording the SECRET would put a live magic link into a log designed to be
   * readable and append-only.
   */
  it('audits the invite WITHOUT putting the token in the audit row', async () => {
    const { service, audit } = makeService();
    const { token } = await service.invite('org1', ACTOR, 'c1', {
      email: 'g@c.com',
    });

    expect(audit.append).toHaveBeenCalledTimes(1);
    const [entry] = audit.append.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(entry).toMatchObject({
      orgId: 'org1',
      action: 'companyGuest.invited',
      entityType: 'CompanyGuest',
      entityId: 'g1',
    });
    expect(JSON.stringify(entry)).not.toContain(token);
  });

  it('still returns {guest, token} when the email fails to send', async () => {
    const { service } = makeService({ mailResult: { sent: false } });

    const { guest, token } = await service.invite('org1', ACTOR, 'c1', {
      email: 'g@c.com',
    });

    expect(guest.id).toBe('g1');
    expect(token).toBeTruthy();
  });

  it('rejects a missing email and sends nothing', async () => {
    const { service, mail } = makeService();

    await expect(
      service.invite('org1', ACTOR, 'c1', { email: ' ' } as any),
    ).rejects.toThrow('email is required');
    expect(mail.sendCompanyGuestMagicLink).not.toHaveBeenCalled();
  });

  it('rejects an unknown company (tenant-scoped) and sends nothing', async () => {
    const { service, mail } = makeService({ company: null });
    await expect(
      service.invite('org1', ACTOR, 'c-nope', { email: 'g@c.com' }),
    ).rejects.toThrow('Company not found');
    expect(mail.sendCompanyGuestMagicLink).not.toHaveBeenCalled();
  });

  it('scopes the company lookup to the caller org (a foreign id is not invitable)', async () => {
    const { service, prisma } = makeService();
    await service.invite('org1', ACTOR, 'c1', { email: 'g@c.com' });
    expect(prisma.company.findFirst).toHaveBeenCalledWith({
      where: { id: 'c1', orgId: 'org1' },
    });
  });
});

describe('CompanyGuestsService.revoke', () => {
  it('suspends the guest and clears the token, so the live link dies', async () => {
    const { service, prisma } = makeService();
    await service.revoke('org1', ACTOR, 'g1');
    expect(prisma.companyGuest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'g1' },
        data: { status: 'SUSPENDED', token: null },
      }),
    );
  });

  it('audits the revoke', async () => {
    const { service, audit } = makeService();
    await service.revoke('org1', ACTOR, 'g1');
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'companyGuest.revoked',
        entityType: 'CompanyGuest',
        entityId: 'g1',
      }),
      expect.anything(),
    );
  });
});
