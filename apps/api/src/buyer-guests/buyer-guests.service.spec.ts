import { BuyerGuestsService } from './buyer-guests.service';

function makeService(options?: {
  buyer?: Record<string, unknown> | null;
  mailResult?: { sent: boolean; messageId?: string };
}) {
  const buyer =
    options?.buyer === undefined
      ? { id: 'b1', orgId: 'org1', name: 'Nordwind Retail' }
      : options.buyer;
  const prisma = {
    buyer: {
      findFirst: jest.fn(async () => buyer),
    },
    buyerGuest: {
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
  const mail = {
    sendBuyerGuestMagicLink: jest.fn(async () => options?.mailResult ?? { sent: true }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new BuyerGuestsService(prisma as any, mail as any);
  return { service, prisma, mail };
}

describe('BuyerGuestsService.invite', () => {
  it('upserts the guest and emails the magic-link token with the buyer name', async () => {
    const { service, prisma, mail } = makeService();

    const { guest, token } = await service.invite('org1', 'b1', {
      email: '  Guest@Buyer.COM ',
    });

    expect(prisma.buyerGuest.upsert).toHaveBeenCalledTimes(1);
    expect(guest).toMatchObject({ id: 'g1', email: 'guest@buyer.com', status: 'ACTIVE' });
    expect(token).toBeTruthy();
    expect(mail.sendBuyerGuestMagicLink).toHaveBeenCalledTimes(1);
    expect(mail.sendBuyerGuestMagicLink).toHaveBeenCalledWith({
      to: 'guest@buyer.com',
      token,
      buyerName: 'Nordwind Retail',
    });
  });

  it('still returns {guest, token} when the email fails to send', async () => {
    const { service } = makeService({ mailResult: { sent: false } });

    const { guest, token } = await service.invite('org1', 'b1', { email: 'g@b.com' });

    expect(guest.id).toBe('g1');
    expect(token).toBeTruthy();
  });

  it('rejects a missing email and sends nothing', async () => {
    const { service, mail } = makeService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(service.invite('org1', 'b1', { email: ' ' } as any)).rejects.toThrow(
      'email is required',
    );
    expect(mail.sendBuyerGuestMagicLink).not.toHaveBeenCalled();
  });

  it('rejects an unknown buyer (tenant-scoped) and sends nothing', async () => {
    const { service, mail } = makeService({ buyer: null });
    await expect(service.invite('org1', 'b-nope', { email: 'g@b.com' })).rejects.toThrow(
      'Buyer not found',
    );
    expect(mail.sendBuyerGuestMagicLink).not.toHaveBeenCalled();
  });
});
