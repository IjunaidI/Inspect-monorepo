import { UsersService } from './users.service';
import { AuthUser } from '../auth/auth-user';

const OWNER: AuthUser = { userId: 'u-owner', orgId: 'org1', role: 'ORG_OWNER' };
const QA: AuthUser = { userId: 'u-qa', orgId: 'org1', role: 'QA_MANAGER' };

function makeService(
  mailResult: { sent: boolean; messageId?: string } = { sent: true },
  existingUser: { orgId: string | null } | null = null,
  targetUser: Record<string, unknown> | null = null,
  otherActiveOwners = 1,
) {
  const txUser = {
    update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'u-target', ...data })),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'u-new', ...data })),
  };
  const tx = { user: txUser };
  const prisma = {
    user: {
      findUnique: jest.fn(async () => existingUser),
      findFirst: jest.fn(async () => targetUser),
      count: jest.fn(async () => otherActiveOwners),
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
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const mail = { sendUserInvitation: jest.fn(async () => mailResult) };
  const audit = { append: jest.fn(async () => ({})) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new UsersService(prisma as any, mail as any, audit as any);
  return { service, prisma, mail, audit, txUser };
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

    expect(invitation).toMatchObject({ email: 'x@y.com', emailSent: false });
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

describe('UsersService guards (INS-058)', () => {
  it('rejects changing your own role', async () => {
    const { service } = makeService();
    await expect(service.updateRole('org1', OWNER, OWNER.userId, 'QA_MANAGER')).rejects.toThrow(
      'You cannot change your own role',
    );
  });

  it('rejects deactivating your own account', async () => {
    const { service } = makeService();
    await expect(service.deactivate('org1', OWNER, OWNER.userId)).rejects.toThrow(
      'You cannot deactivate your own account',
    );
  });

  it("refuses to demote the organization's only active owner", async () => {
    const { service } = makeService(
      { sent: true },
      null,
      { id: 'u-target', orgId: 'org1', role: 'ORG_OWNER', status: 'ACTIVE' },
      0,
    );
    await expect(service.updateRole('org1', OWNER, 'u-target', 'QA_MANAGER')).rejects.toThrow(
      /only active owner/,
    );
  });

  it('deactivates a non-last owner inside a transaction with an audit row', async () => {
    const { service, audit } = makeService(
      { sent: true },
      null,
      { id: 'u-target', orgId: 'org1', role: 'ORG_OWNER', status: 'ACTIVE' },
      1,
    );
    const out = await service.deactivate('org1', OWNER, 'u-target');
    expect(out.status).toBe('DEACTIVATED');
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.deactivated', entityId: 'u-target' }),
      expect.anything(),
    );
  });

  it('changes another user\'s role inside a transaction with an audit row', async () => {
    const { service, prisma, audit } = makeService(
      { sent: true },
      null,
      { id: 'u-target', orgId: 'org1', role: 'INSPECTOR', status: 'ACTIVE' },
    );
    const out = await service.updateRole('org1', OWNER, 'u-target', 'QA_MANAGER');
    expect(out.role).toBe('QA_MANAGER');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.role_changed', entityId: 'u-target', metadata: { role: 'QA_MANAGER' } }),
      expect.anything(),
    );
  });

  it('reactivate flips DEACTIVATED back to ACTIVE; INVITED is refused', async () => {
    const deact = makeService({ sent: true }, null, { id: 'u-target', orgId: 'org1', role: 'INSPECTOR', status: 'DEACTIVATED' });
    const out = await deact.service.reactivate('org1', OWNER, 'u-target');
    expect(out.status).toBe('ACTIVE');
    expect(deact.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.reactivated', entityId: 'u-target' }),
      expect.anything(),
    );

    const invited = makeService({ sent: true }, null, { id: 'u-target', orgId: 'org1', role: 'INSPECTOR', status: 'INVITED' });
    await expect(invited.service.reactivate('org1', OWNER, 'u-target')).rejects.toThrow(/pending invitation/);
  });
});

describe('UsersService.createMember (INS-059)', () => {
  it('creates an ACTIVE member with a scrypt hash and an audit row', async () => {
    const { service, txUser, audit } = makeService();
    const out = await service.createMember('org1', OWNER, {
      name: 'Direct Member',
      email: '  Direct@Example.COM ',
      password: 'longenough1',
      role: 'QA_MANAGER',
    });
    expect(out).toMatchObject({ email: 'direct@example.com', role: 'QA_MANAGER', status: 'ACTIVE' });
    const created = txUser.create.mock.calls[0][0].data as Record<string, string>;
    expect(created.passwordHash).toMatch(/^scrypt\$/);
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.member_added' }),
      expect.anything(),
    );
  });

  it('rejects short passwords, platform-admin role, above-own-role, and existing emails', async () => {
    const { service } = makeService();
    await expect(
      service.createMember('org1', OWNER, { email: 'a@b.com', password: 'short' }),
    ).rejects.toThrow(/min 8 characters/);
    await expect(
      service.createMember('org1', OWNER, { email: 'a@b.com', password: 'longenough1', role: 'PLATFORM_ADMIN' }),
    ).rejects.toThrow('Cannot create a platform admin');
    await expect(
      service.createMember('org1', QA, { email: 'a@b.com', password: 'longenough1', role: 'ORG_OWNER' }),
    ).rejects.toThrow('Cannot create a role above your own');

    const dup = makeService({ sent: true }, { orgId: 'org2' });
    await expect(
      dup.service.createMember('org1', OWNER, { email: 'a@b.com', password: 'longenough1' }),
    ).rejects.toThrow('An account already exists for this email');
  });
});
