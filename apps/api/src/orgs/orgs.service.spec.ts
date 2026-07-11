import { OrgsService } from './orgs.service';

function makeService(mailResult: { sent: boolean; messageId?: string } = { sent: true }) {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<any>) => fn(tx)),
  };
  const audit = { append: jest.fn(async () => ({})) };
  const mail = { sendUserInvitation: jest.fn(async () => mailResult) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new OrgsService(prisma as any, audit as any, mail as any);
  return { service, tx, audit, mail };
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
      token: 'tok-owner',
    });
    expect(mail.sendUserInvitation).toHaveBeenCalledTimes(1);
    expect(mail.sendUserInvitation).toHaveBeenCalledWith({
      to: 'owner@acme.com',
      token: 'tok-owner',
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
    expect(result.invitation.token).toBe('tok-owner');
  });

  it('rejects invalid input before any write or email', async () => {
    const { service, tx, mail } = makeService();

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      service.create('admin-1', { name: '', type: 'MANUFACTURER', ownerEmail: 'x@y.com' } as any),
    ).rejects.toThrow('name is required');
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      service.create('admin-1', { name: 'A', type: 'NOPE', ownerEmail: 'x@y.com' } as any),
    ).rejects.toThrow('type must be');
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      service.create('admin-1', { name: 'A', type: 'MANUFACTURER', ownerEmail: ' ' } as any),
    ).rejects.toThrow('ownerEmail is required');

    expect(tx.organization.create).not.toHaveBeenCalled();
    expect(mail.sendUserInvitation).not.toHaveBeenCalled();
  });
});
