import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { InvitationsService } from './invitations.service';

/**
 * Regression coverage for the cross-org account-takeover fix (security review,
 * 2026-07-11): accepting an invitation must never relocate/overwrite/reset an
 * account that already belongs to a different tenant.
 */
function makeService(opts: {
  invitation: Record<string, unknown> | null;
  existingUser?: Record<string, unknown> | null;
}) {
  const upsert = jest.fn(
    async ({ create }: { create: Record<string, unknown> }) => ({
      id: 'u-new',
      passwordHash: 'x',
      ...create,
    }),
  );
  const invitationUpdate = jest.fn(async () => ({}));
  const prisma = {
    invitation: {
      findUnique: jest.fn(async () => opts.invitation),
    },
    user: {
      findUnique: jest.fn(async () => opts.existingUser ?? null),
    },
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) =>
      cb({ user: { upsert }, invitation: { update: invitationUpdate } }),
    ),
  };
  const audit = { append: jest.fn(async () => ({})) };

  const service = new InvitationsService(prisma as any, audit as any);
  return { service, upsert, invitationUpdate, prisma, audit };
}

const validInvite = {
  id: 'inv1',
  token: 'tok',
  email: 'alice@orga.com',
  orgId: 'orgA',
  role: 'INSPECTOR',
  acceptedAt: null,
  expiresAt: new Date(Date.now() + 60_000),
};

describe('InvitationsService.getByToken (INS-054)', () => {
  it('returns verified email/role/orgName for a pending invitation', async () => {
    const { service } = makeService({
      invitation: { ...validInvite, organization: { name: 'Acme Apparel' } },
    });
    const result = await service.getByToken('tok');
    expect(result).toEqual({
      email: 'alice@orga.com',
      role: 'INSPECTOR',
      orgName: 'Acme Apparel',
      expiresAt: validInvite.expiresAt,
    });
  });

  it('404s an unknown token', async () => {
    const { service } = makeService({ invitation: null });
    await expect(service.getByToken('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('410s a consumed invitation', async () => {
    const { service } = makeService({
      invitation: {
        ...validInvite,
        acceptedAt: new Date(),
        organization: { name: 'A' },
      },
    });
    await expect(service.getByToken('tok')).rejects.toBeInstanceOf(
      GoneException,
    );
  });

  it('410s an expired invitation', async () => {
    const { service } = makeService({
      invitation: {
        ...validInvite,
        expiresAt: new Date(Date.now() - 1000),
        organization: { name: 'A' },
      },
    });
    await expect(service.getByToken('tok')).rejects.toBeInstanceOf(
      GoneException,
    );
  });
});

describe('InvitationsService.accept', () => {
  it('refuses when an account with that email exists in another org (cross-tenant takeover)', async () => {
    const { service, upsert } = makeService({
      invitation: validInvite,
      existingUser: { id: 'uA', orgId: 'orgB' },
    });
    await expect(
      service.accept({ token: 'tok', password: 'password123' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('activates a brand-new account for the invitation email + org', async () => {
    const { service, upsert, invitationUpdate } = makeService({
      invitation: validInvite,
      existingUser: null,
    });
    const user = await service.accept({
      token: 'tok',
      password: 'password123',
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(invitationUpdate).toHaveBeenCalledTimes(1);
    expect((user as { orgId: string }).orgId).toBe('orgA');
    expect((user as Record<string, unknown>).passwordHash).toBeUndefined();
  });

  it('allows accepting for an existing user already in the invitation org', async () => {
    const { service, upsert } = makeService({
      invitation: validInvite,
      existingUser: { id: 'uA', orgId: 'orgA' },
    });
    await service.accept({ token: 'tok', password: 'password123' });
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('rejects an expired invitation', async () => {
    const { service } = makeService({
      invitation: { ...validInvite, expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(
      service.accept({ token: 'tok', password: 'password123' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an already-accepted invitation', async () => {
    const { service } = makeService({
      invitation: { ...validInvite, acceptedAt: new Date() },
    });
    await expect(
      service.accept({ token: 'tok', password: 'password123' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a too-short password before any lookup', async () => {
    const { service, prisma } = makeService({ invitation: validInvite });
    await expect(
      service.accept({ token: 'tok', password: 'short' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.invitation.findUnique).not.toHaveBeenCalled();
  });
});
