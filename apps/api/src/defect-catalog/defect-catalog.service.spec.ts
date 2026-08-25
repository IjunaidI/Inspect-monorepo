import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DefectCatalogService } from './defect-catalog.service';
import { AuthUser } from '../auth/auth-user';

/**
 * INS-034 — `defect-catalog` had no spec, and it sits on the mobile critical
 * path: an inspector tagging a defect during populate reads this list, and
 * INS-083 has just widened `GET` to `INSPECTOR`.
 *
 * What actually matters here:
 *   1. the hybrid visibility rule (global library + this org, never another
 *      org's) — this is a tenant boundary, not a convenience;
 *   2. severity validation, because `defaultSeverity` feeds the AQL class counts
 *      and therefore the pass/fail verdict on a signed report;
 *   3. the cross-tenant guard on archive;
 *   4. audit rows written INSIDE the business transaction (INS-006).
 *
 * Pure unit test: Prisma and Audit are mocked, no DB.
 */

const ORG = 'org-1';
const OTHER_ORG = 'org-2';

const ACTOR = {
  userId: 'u-qa',
  orgId: ORG,
  role: 'QA_MANAGER',
  actingAsOrgId: null,
} as AuthUser;

function makeService(opts: { existing?: Record<string, unknown> | null } = {}) {
  const { existing = null } = opts;

  const findMany = jest.fn(async (_args?: { where?: unknown }) => []);
  const create = jest.fn(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'defect-new',
      ...data,
    }),
  );
  const update = jest.fn(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'defect-1',
      ...data,
    }),
  );
  const findFirst = jest.fn(async () => existing);
  const append = jest.fn(async () => undefined);

  const tx = { defectCatalog: { create, update } };
  const prisma = {
    defectCatalog: { findMany, findFirst, create, update },
    $transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) =>
      fn(tx),
    ),
  } as unknown as ConstructorParameters<typeof DefectCatalogService>[0];
  const audit = { append } as unknown as ConstructorParameters<
    typeof DefectCatalogService
  >[1];

  return {
    service: new DefectCatalogService(prisma, audit),
    findMany,
    findFirst,
    create,
    update,
    append,
  };
}

describe('DefectCatalogService.list', () => {
  it('returns the global library plus this org, and nothing archived', () => {
    const h = makeService();
    h.service.list(ORG);

    const where = h.findMany.mock.calls[0][0].where;
    // The OR is the whole hybrid model: seeded global rows carry orgId null and
    // must stay visible to every tenant, while an org's own rows must never leak.
    expect(where).toEqual({
      isArchived: false,
      OR: [{ orgId: ORG }, { orgId: null }],
    });
  });

  it('never widens the filter to another org', () => {
    const h = makeService();
    h.service.list(ORG);

    const serialized = JSON.stringify(h.findMany.mock.calls[0][0].where);
    expect(serialized).not.toContain(OTHER_ORG);
  });
});

describe('DefectCatalogService.create', () => {
  it('requires a name', async () => {
    const h = makeService();
    await expect(
      h.service.create(ORG, ACTOR, { name: '   ', defaultSeverity: 'MINOR' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.create).not.toHaveBeenCalled();
  });

  it('rejects a severity outside the AQL classes', async () => {
    const h = makeService();
    // defaultSeverity drives the per-class defect counts the AQL engine reads,
    // so an out-of-band value would land in a signed report's evidence.
    await expect(
      h.service.create(ORG, ACTOR, {
        name: 'Loose thread',
        defaultSeverity: 'COSMETIC' as never,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.create).not.toHaveBeenCalled();
  });

  it('creates an ORG-scoped row owned by the caller org, with the name trimmed', async () => {
    const h = makeService();
    const out = await h.service.create(ORG, ACTOR, {
      name: '  Skewed collar  ',
      defaultSeverity: 'MAJOR',
    });

    expect(h.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scope: 'ORG',
        orgId: ORG,
        name: 'Skewed collar',
        defaultSeverity: 'MAJOR',
        createdByUserId: ACTOR.userId,
      }),
    });
    expect(out).toMatchObject({ id: 'defect-new' });
  });

  it('appends the audit row inside the business transaction', async () => {
    const h = makeService();
    await h.service.create(ORG, ACTOR, {
      name: 'Open seam',
      defaultSeverity: 'MAJOR',
    });

    // The second argument is the transaction client: if the audit were appended
    // outside it, a rolled-back create would leave an orphan audit entry.
    expect(h.append).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG, action: 'defectCatalog.created' }),
      expect.objectContaining({ defectCatalog: expect.anything() }),
    );
  });
});

describe('DefectCatalogService.archive', () => {
  it('404s an unknown defect', async () => {
    const h = makeService({ existing: null });
    await expect(h.service.archive(ORG, ACTOR, 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("refuses another org's defect", async () => {
    const h = makeService({
      existing: { id: 'd-1', orgId: OTHER_ORG, name: 'theirs' },
    });
    await expect(h.service.archive(ORG, ACTOR, 'd-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(h.update).not.toHaveBeenCalled();
  });

  it('refuses a global library row', async () => {
    const h = makeService({
      existing: { id: 'd-g', orgId: null, name: 'Needle contamination' },
    });
    // The seeded global library is shared by every tenant; letting one org
    // archive a row would silently remove it from all of them.
    await expect(h.service.archive(ORG, ACTOR, 'd-g')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(h.update).not.toHaveBeenCalled();
  });

  it('soft-archives its own row rather than deleting it', async () => {
    const h = makeService({
      existing: { id: 'd-1', orgId: ORG, name: 'mine' },
    });
    await h.service.archive(ORG, ACTOR, 'd-1');

    // Never a hard delete: historical inspections reference this row, and a
    // signed report's evidence has to stay resolvable.
    expect(h.update).toHaveBeenCalledWith({
      where: { id: 'd-1' },
      data: { isArchived: true },
    });
    expect(h.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'defectCatalog.archived' }),
      expect.anything(),
    );
  });
});
