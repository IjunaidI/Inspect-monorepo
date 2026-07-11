import { UsersService } from './users.service';
import { AuthUser } from '../auth/auth-user';

const OWNER: AuthUser = { userId: 'u-owner', orgId: 'org1', role: 'ORG_OWNER' };
const QA: AuthUser = { userId: 'u-qa', orgId: 'org1', role: 'QA_MANAGER' };

function makeService(
  mailResult: { sent: boolean; messageId?: string } = { sent: true },
  existingUser: { orgId: string | null } | null = null,
) {
  const prisma = {
    // The invite path re-checks the email against existing accounts (INS-035
    // defense-in-depth); default stub: no account exists for the email.
    user: {
      findUnique: jest.fn(async () => existingUser),
    },
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
    });
    // INS-037: the service generates a CSPRNG UUID token (never the cuid default).
    expect(invitation.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(mail.sendUserInvitation).toHaveBeenCalledTimes(1);
    expect(mail.sendUserInvitation).toHaveBeenCalledWith({
      to: 'new.user@example.com',
      token: invitation.token,
      role: 'INSPECTOR',
    });
  });

  it('still returns the invitation when the email fails to send', async () => {
    const { service } = makeService({ sent: false });

    const invitation = await service.invite('org1', OWNER, {
      email: 'x@y.com',
      role: 'INSPECTOR',
    });

    expect(invitation).toMatchObject({ email: 'x@y.com' });
    expect(invitation.token).toBeTruthy();
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

  it('rejects an email already registered in another org (INS-035) and sends nothing', async () => {
    const { service, mail, prisma } = makeService({ sent: true }, { orgId: 'other-org' });
    await expect(
      service.invite('org1', OWNER, { email: 'taken@y.com', role: 'INSPECTOR' }),
    ).rejects.toThrow('An account already exists for this email');
    expect(prisma.invitation.create).not.toHaveBeenCalled();
    expect(mail.sendUserInvitation).not.toHaveBeenCalled();
  });

  it('still allows re-inviting an email that belongs to the same org', async () => {
    const { service, mail } = makeService({ sent: true }, { orgId: 'org1' });
    const invitation = await service.invite('org1', OWNER, {
      email: 'same@y.com',
      role: 'INSPECTOR',
    });
    expect(invitation).toMatchObject({ email: 'same@y.com' });
    expect(invitation.token).toBeTruthy();
    expect(mail.sendUserInvitation).toHaveBeenCalledTimes(1);
  });
});
