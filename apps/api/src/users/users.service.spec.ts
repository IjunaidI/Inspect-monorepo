import { UsersService } from './users.service';
import { AuthUser } from '../auth/auth-user';

const OWNER: AuthUser = { userId: 'u-owner', orgId: 'org1', role: 'ORG_OWNER' };
const QA: AuthUser = { userId: 'u-qa', orgId: 'org1', role: 'QA_MANAGER' };

function makeService(mailResult: { sent: boolean; messageId?: string } = { sent: true }) {
  const prisma = {
    invitation: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'inv1',
        token: 'tok-abc',
        acceptedAt: null,
        createdAt: new Date('2026-07-11T00:00:00Z'),
        ...data,
      })),
    },
  };
  const mail = {
    sendUserInvitation: jest.fn(async () => mailResult),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new UsersService(prisma as any, mail as any);
  return { service, prisma, mail };
}

describe('UsersService.invite', () => {
  it('creates the invitation and emails the invitee with token + role', async () => {
    const { service, prisma, mail } = makeService();

    const invitation = await service.invite('org1', OWNER, {
      email: '  New.User@Example.COM ',
      role: 'INSPECTOR',
    });

    expect(prisma.invitation.create).toHaveBeenCalledTimes(1);
    expect(invitation).toMatchObject({
      id: 'inv1',
      orgId: 'org1',
      email: 'new.user@example.com',
      role: 'INSPECTOR',
      token: 'tok-abc',
    });
    expect(mail.sendUserInvitation).toHaveBeenCalledTimes(1);
    expect(mail.sendUserInvitation).toHaveBeenCalledWith({
      to: 'new.user@example.com',
      token: 'tok-abc',
      role: 'INSPECTOR',
    });
  });

  it('still returns the invitation when the email fails to send', async () => {
    const { service } = makeService({ sent: false });

    const invitation = await service.invite('org1', OWNER, {
      email: 'x@y.com',
      role: 'INSPECTOR',
    });

    expect(invitation).toMatchObject({ email: 'x@y.com', token: 'tok-abc' });
  });

  it('rejects a missing email and sends nothing', async () => {
    const { service, mail } = makeService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(service.invite('org1', OWNER, { email: '  ' } as any)).rejects.toThrow(
      'email is required',
    );
    expect(mail.sendUserInvitation).not.toHaveBeenCalled();
  });

  it('rejects inviting a platform admin and sends nothing', async () => {
    const { service, mail } = makeService();
    await expect(
      service.invite('org1', OWNER, { email: 'x@y.com', role: 'PLATFORM_ADMIN' }),
    ).rejects.toThrow('Cannot invite a platform admin');
    expect(mail.sendUserInvitation).not.toHaveBeenCalled();
  });

  it('rejects inviting a role above your own and sends nothing', async () => {
    const { service, mail } = makeService();
    await expect(
      service.invite('org1', QA, { email: 'x@y.com', role: 'ORG_OWNER' }),
    ).rejects.toThrow('Cannot invite a role above your own');
    expect(mail.sendUserInvitation).not.toHaveBeenCalled();
  });
});
