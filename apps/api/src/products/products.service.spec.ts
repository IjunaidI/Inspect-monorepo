import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { AuthUser } from '../auth/auth-user';

const ACTOR = {
  userId: 'u1',
  orgId: 'orgA',
  role: 'ORG_OWNER',
} as unknown as AuthUser;

/**
 * INS-074: a description must be *clearable* from the console.
 *
 * Prisma treats `undefined` as "leave this column unchanged", so the old
 * `description: input.description` mapping made an emptied textarea a no-op —
 * the text stayed in the DB forever. These specs pin the three-way contract:
 *   key omitted      -> `description` absent from the update payload (no-op)
 *   null / '' / '  ' -> `description: null` (column cleared)
 *   text             -> trimmed text, inner line breaks preserved
 */
function makeService() {
  const update = jest.fn(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'p1',
      orgId: 'orgA',
      styleNumber: 'ST-1',
      ...data,
    }),
  );
  const create = jest.fn(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'p1',
      ...data,
    }),
  );
  const findFirst = jest.fn(async () => ({
    id: 'p1',
    orgId: 'orgA',
    styleNumber: 'ST-1',
    description: 'existing copy',
    archivedAt: null,
  }));
  const prisma = {
    product: { findFirst, create, update },
    // INS-006: create/update audit inside their own transaction.
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  const audit = { append: jest.fn(async () => undefined) };

  const service = new ProductsService(prisma as any, audit as any);
  return { service, create, update, findFirst, audit };
}

/** The `data` object handed to prisma.product.update on the last call. */
function lastUpdateData(update: jest.Mock): Record<string, unknown> {
  return update.mock.calls[update.mock.calls.length - 1][0].data as Record<
    string,
    unknown
  >;
}

describe('ProductsService.update description clear-path (INS-074)', () => {
  it('clears the column when the console sends an explicit null', async () => {
    const { service, update } = makeService();
    await service.update('orgA', ACTOR, 'p1', {
      styleNumber: 'ST-1',
      description: null,
    });
    const data = lastUpdateData(update);
    expect(data).toHaveProperty('description', null);
  });

  it('treats an emptied textarea ("") as a clear, not as "leave unchanged"', async () => {
    const { service, update } = makeService();
    await service.update('orgA', ACTOR, 'p1', {
      styleNumber: 'ST-1',
      description: '',
    });
    expect(lastUpdateData(update)).toHaveProperty('description', null);
  });

  it('treats a whitespace-only description as a clear', async () => {
    const { service, update } = makeService();
    await service.update('orgA', ACTOR, 'p1', {
      styleNumber: 'ST-1',
      description: '   \n\t  ',
    });
    expect(lastUpdateData(update)).toHaveProperty('description', null);
  });

  it('leaves the column untouched when the key is not supplied at all', async () => {
    const { service, update } = makeService();
    await service.update('orgA', ACTOR, 'p1', { styleNumber: 'ST-2' });
    const data = lastUpdateData(update);
    // Absent — NOT `undefined`-valued and NOT null: a styleNumber-only PATCH
    // must not wipe an existing description.
    expect(Object.prototype.hasOwnProperty.call(data, 'description')).toBe(
      false,
    );
    expect(data.styleNumber).toBe('ST-2');
  });

  it('stores a long multi-paragraph description with its line breaks intact', async () => {
    const { service, update } = makeService();
    const body = `${'a'.repeat(300)}\n\nSecond paragraph with detail.\nThird line.`;
    await service.update('orgA', ACTOR, 'p1', { description: `  ${body}  ` });
    // Outer padding trimmed, inner newlines preserved verbatim.
    expect(lastUpdateData(update).description).toBe(body);
  });

  it('checks org ownership before writing (tenant isolation)', async () => {
    const { service, update, findFirst } = makeService();
    findFirst.mockResolvedValueOnce(null as never);
    await expect(
      service.update('orgB', ACTOR, 'p1', { description: null }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('ProductsService.create description normalisation (INS-074)', () => {
  it('persists null rather than an empty string when no description is typed', async () => {
    const { service, create } = makeService();
    await service.create('orgA', ACTOR, {
      styleNumber: 'ST-9',
      description: '',
    });
    expect(create.mock.calls[0][0].data.description).toBeNull();
  });

  it('persists null when the field is omitted entirely', async () => {
    const { service, create } = makeService();
    await service.create('orgA', ACTOR, { styleNumber: 'ST-9' });
    expect(create.mock.calls[0][0].data.description).toBeNull();
  });

  it('trims the outer whitespace off a supplied description', async () => {
    const { service, create } = makeService();
    await service.create('orgA', ACTOR, {
      styleNumber: 'ST-9',
      description: '  Polo shirt  ',
    });
    expect(create.mock.calls[0][0].data.description).toBe('Polo shirt');
  });

  it('still requires a styleNumber', async () => {
    const { service, create } = makeService();
    // `create` is async (INS-006 wrapped the write in a transaction), so the
    // guard now surfaces as a rejected promise rather than a synchronous throw.
    await expect(
      service.create('orgA', ACTOR, { styleNumber: '   ', description: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });
});
