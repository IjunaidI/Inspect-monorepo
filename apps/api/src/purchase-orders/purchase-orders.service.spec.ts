import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { AuthUser } from '../auth/auth-user';

/**
 * INS-034 — `purchase-orders` had no spec, and it is the entry point of the
 * whole product: `POST /inspections` is PO-driven, so a PO that references
 * another org's buyer/supplier/product would carry that cross-tenant reference
 * into an inspection and, eventually, into an Ed25519-signed report.
 *
 * The behaviour that matters:
 *   1. every FK is validated to belong to the caller's org BEFORE the write —
 *      a tenant boundary the database only started backing with INS-010;
 *   2. reads are org-scoped, so a foreign id is 404 rather than a leak;
 *   3. audit rows written INSIDE the business transaction (INS-006).
 *
 * Pure unit test: Prisma and Audit are mocked, no DB.
 */

const ORG = 'org-1';

const ACTOR = {
  userId: 'u-qa',
  orgId: ORG,
  role: 'QA_MANAGER',
  actingAsOrgId: null,
} as AuthUser;

const VALID = {
  poNumber: 'PO-1001',
  buyerId: 'buyer-1',
  supplierId: 'supplier-1',
  productId: 'product-1',
};

interface HarnessOpts {
  /** Which of the three referenced rows resolve inside the caller's org. */
  buyerFound?: boolean;
  supplierFound?: boolean;
  productFound?: boolean;
  existingPo?: Record<string, unknown> | null;
}

function makeService(opts: HarnessOpts = {}) {
  const {
    buyerFound = true,
    supplierFound = true,
    productFound = true,
    existingPo = { id: 'po-1', orgId: ORG, poNumber: 'PO-1001' },
  } = opts;

  const poCreate = jest.fn(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'po-new',
      ...data,
    }),
  );
  const poFindFirst = jest.fn(
    async (_args?: { where?: unknown }) => existingPo,
  );
  const poFindMany = jest.fn(async (_args?: { where?: unknown }) => []);
  const append = jest.fn(async () => undefined);

  const tx = {
    purchaseOrder: { create: poCreate, update: jest.fn(), delete: jest.fn() },
  };
  const prisma = {
    purchaseOrder: {
      create: poCreate,
      findFirst: poFindFirst,
      findMany: poFindMany,
    },
    buyer: {
      findFirst: jest.fn(async () =>
        buyerFound ? { id: VALID.buyerId } : null,
      ),
    },
    supplier: {
      findFirst: jest.fn(async () =>
        supplierFound ? { id: VALID.supplierId } : null,
      ),
    },
    product: {
      findFirst: jest.fn(async () =>
        productFound ? { id: VALID.productId } : null,
      ),
    },
    $transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) =>
      fn(tx),
    ),
  } as unknown as ConstructorParameters<typeof PurchaseOrdersService>[0];
  const audit = { append } as unknown as ConstructorParameters<
    typeof PurchaseOrdersService
  >[1];

  return {
    service: new PurchaseOrdersService(prisma, audit),
    prisma: prisma as unknown as {
      buyer: { findFirst: jest.Mock };
      supplier: { findFirst: jest.Mock };
      product: { findFirst: jest.Mock };
    },
    poCreate,
    poFindFirst,
    poFindMany,
    append,
  };
}

describe('PurchaseOrdersService reads', () => {
  it('scopes the list to the caller org', () => {
    const h = makeService();
    h.service.list(ORG);
    expect(h.poFindMany.mock.calls[0][0].where).toEqual({ orgId: ORG });
  });

  it('scopes get by org so a foreign id is not readable', async () => {
    const h = makeService();
    await h.service.get(ORG, 'po-1');
    // orgId in the WHERE, not a post-read check: a foreign id must resolve to
    // 404 rather than reveal that the row exists.
    expect(h.poFindFirst.mock.calls[0][0].where).toEqual({
      id: 'po-1',
      orgId: ORG,
    });
  });

  it('404s when the id resolves to nothing in this org', async () => {
    const h = makeService({ existingPo: null });
    await expect(h.service.get(ORG, 'po-foreign')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('PurchaseOrdersService.create validation', () => {
  it('requires a poNumber', async () => {
    const h = makeService();
    await expect(
      h.service.create(ORG, ACTOR, { ...VALID, poNumber: '  ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.poCreate).not.toHaveBeenCalled();
  });

  it('requires all three references', async () => {
    const h = makeService();
    await expect(
      h.service.create(ORG, ACTOR, { ...VALID, buyerId: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.poCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['buyer', { buyerFound: false }],
    ['supplier', { supplierFound: false }],
    ['product', { productFound: false }],
  ])('refuses a %s that does not belong to the org', async (_label, opts) => {
    const h = makeService(opts as HarnessOpts);
    // This is the cross-tenant guard: without it a PO could reference another
    // org's counterparty and carry it into an inspection and a signed report.
    await expect(h.service.create(ORG, ACTOR, VALID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(h.poCreate).not.toHaveBeenCalled();
  });

  it('validates every reference against the caller org, not the payload', async () => {
    const h = makeService();
    await h.service.create(ORG, ACTOR, VALID);

    for (const model of ['buyer', 'supplier', 'product'] as const) {
      expect(h.prisma[model].findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orgId: ORG }),
        }),
      );
    }
  });
});

describe('PurchaseOrdersService.create write', () => {
  it('stores the trimmed poNumber, stamps the org and the creator', async () => {
    const h = makeService();
    await h.service.create(ORG, ACTOR, { ...VALID, poNumber: '  PO-2002  ' });

    expect(h.poCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: ORG,
        poNumber: 'PO-2002',
        buyerId: VALID.buyerId,
        supplierId: VALID.supplierId,
        productId: VALID.productId,
        createdByUserId: ACTOR.userId,
      }),
    });
  });

  it('appends the audit row inside the business transaction', async () => {
    const h = makeService();
    await h.service.create(ORG, ACTOR, VALID);

    expect(h.append).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: ORG,
        action: 'purchaseOrder.created',
        entityType: 'PurchaseOrder',
      }),
      expect.objectContaining({ purchaseOrder: expect.anything() }),
    );
  });
});
