import { OrgsService } from './orgs.service';

function makeService(
  mailResult: { sent: boolean; messageId?: string } = { sent: true },
  existingUser: { id: string } | null = null,
  existingOrg: { id: string; name: string } | null = null,
) {
  const tx = {
    organization: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'org1',
        createdAt: new Date('2026-07-11T00:00:00Z'),
        ...data,
      })),
    },
    invitation: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'inv1',
        token: 'tok-owner',
        acceptedAt: null,
        ...data,
      })),
    },
  };
  const prisma = {
    // Onboarding refuses an ownerEmail that already has an account (security
    // review); default stub: no existing account.
    user: {
      findUnique: jest.fn(async () => existingUser),
    },
    // Name-uniqueness pre-check; default stub: no org by that name.
    organization: {
      findFirst: jest.fn(async () => existingOrg),
    },

    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<any>) => fn(tx)),
  };
  const audit = { append: jest.fn(async () => ({})) };
  const mail = { sendUserInvitation: jest.fn(async () => mailResult) };

  const service = new OrgsService(prisma as any, audit as any, mail as any);
  return { service, tx, audit, mail, prisma };
}

describe('OrgsService.create', () => {
  it('creates the org + first ORG_OWNER invitation and emails the owner with the org name', async () => {
    const { service, tx, audit, mail } = makeService();

    const result = await service.create('admin-1', {
      name: '  Acme Apparel  ',
      type: 'INSPECTION_COMPANY',
      ownerEmail: ' Owner@Acme.COM ',
    });

    expect(tx.organization.create).toHaveBeenCalledTimes(1);
    expect(tx.invitation.create).toHaveBeenCalledTimes(1);
    expect(audit.append).toHaveBeenCalledTimes(1);
    expect(result.org).toMatchObject({ id: 'org1', name: 'Acme Apparel' });
    expect(result.invitation).toMatchObject({
      orgId: 'org1',
      email: 'owner@acme.com',
      role: 'ORG_OWNER',
    });
    // INS-037: the service generates a CSPRNG UUID token (never the cuid default).
    expect(result.invitation.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(mail.sendUserInvitation).toHaveBeenCalledTimes(1);
    expect(mail.sendUserInvitation).toHaveBeenCalledWith({
      to: 'owner@acme.com',
      token: result.invitation.token,
      role: 'ORG_OWNER',
      orgName: 'Acme Apparel',
    });
  });

  it('still returns {org, invitation} when the email fails to send', async () => {
    const { service } = makeService({ sent: false });

    const result = await service.create('admin-1', {
      name: 'Acme',
      type: 'MANUFACTURER',
      ownerEmail: 'owner@acme.com',
    });

    expect(result.org.id).toBe('org1');
    expect(result.invitation.token).toBeTruthy();
    expect(result.emailSent).toBe(false);
  });

  it('rejects invalid input before any write or email', async () => {
    const { service, tx, mail } = makeService();

    await expect(
      service.create('admin-1', {
        name: '',
        type: 'MANUFACTURER',
        ownerEmail: 'x@y.com',
      } as any),
    ).rejects.toThrow('name is required');
    await expect(
      service.create('admin-1', {
        name: 'A',
        type: 'NOPE',
        ownerEmail: 'x@y.com',
      } as any),
    ).rejects.toThrow('type must be');
    await expect(
      service.create('admin-1', {
        name: 'A',
        type: 'MANUFACTURER',
        ownerEmail: ' ',
      } as any),
    ).rejects.toThrow('ownerEmail is required');

    expect(tx.organization.create).not.toHaveBeenCalled();
    expect(mail.sendUserInvitation).not.toHaveBeenCalled();
  });

  it('rejects an ownerEmail that already has an account and sends nothing', async () => {
    const { service, tx, mail } = makeService(
      { sent: true },
      { id: 'existing-user' },
    );

    await expect(
      service.create('admin-1', {
        name: 'Acme',
        type: 'MANUFACTURER',
        ownerEmail: 'taken@acme.com',
      }),
    ).rejects.toThrow('An account already exists for this email');

    expect(tx.organization.create).not.toHaveBeenCalled();
    expect(mail.sendUserInvitation).not.toHaveBeenCalled();
  });

  it('rejects a duplicate name and writes nothing', async () => {
    const { service, tx, mail } = makeService({ sent: true }, null, {
      id: 'org-existing',
      name: 'Polo',
    });

    await expect(
      service.create('admin-1', {
        name: 'Polo',
        type: 'MANUFACTURER',
        ownerEmail: 'x@y.com',
      }),
    ).rejects.toThrow('An organization named "Polo" already exists');

    expect(tx.organization.create).not.toHaveBeenCalled();
    expect(mail.sendUserInvitation).not.toHaveBeenCalled();
  });

  it('compares the name case-insensitively on the trimmed value', async () => {
    const { service, prisma } = makeService();

    await service.create('admin-1', {
      name: '  Acme Apparel  ',
      type: 'MANUFACTURER',
      ownerEmail: 'x@y.com',
    });

    expect(prisma.organization.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: { equals: 'Acme Apparel', mode: 'insensitive' } },
      }),
    );
  });

  // The pre-check is advisory: concurrent creates can both pass it, and the DB
  // unique index is what actually rejects the loser. That must read as the same
  // 409, not a raw 500.
  it('maps a P2002 unique-violation from the race to the same conflict error', async () => {
    const { service, tx } = makeService();
    tx.organization.create.mockRejectedValueOnce(
      Object.assign(new Error('unique'), { code: 'P2002' }),
    );

    await expect(
      service.create('admin-1', {
        name: 'Polo',
        type: 'MANUFACTURER',
        ownerEmail: 'x@y.com',
      }),
    ).rejects.toThrow('An organization named "Polo" already exists');
  });
});
