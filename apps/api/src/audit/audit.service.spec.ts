/**
 * INS-013: unit coverage for the hash-chained audit writer, and INS-012's
 * race-free sequence assignment.
 *
 * Pure unit test — Prisma is mocked, there is no DB. The in-memory fake keeps a
 * real `rows` array so sequence/link assertions are made against what the
 * service actually persisted, not against what it was asked to persist.
 */
import { AuditService, AuditAppendInput, auditSequenceLockKey } from './audit.service';
import { linkHash, verifyChain } from './audit-chain';

interface StoredRow {
  id: string;
  orgId: string | null;
  sequence: number;
  payloadHash: string;
  prevEntryHash: string | null;
  actorUserId?: string | null;
  action: string;
  createdAt: Date;
}

function duplicateSequenceError(): Error & { code: string } {
  const err = new Error(
    'Unique constraint failed on the fields: (`orgId`,`sequence`)',
  ) as Error & { code: string };
  err.code = 'P2002';
  return err;
}

/**
 * @param createFails how many leading `auditLog.create` calls throw P2002 before
 *   one is allowed to succeed (simulates the duplicate-sequence collision).
 */
function makeService(opts: { createFails?: number } = {}) {
  const rows: StoredRow[] = [];
  let remainingFailures = opts.createFails ?? 0;

  const $executeRaw = jest.fn(async () => 1);
  const findFirst = jest.fn(
    async ({ where }: { where: { orgId: string | null } }) => {
      const matches = rows.filter((r) => r.orgId === where.orgId);
      if (matches.length === 0) return null;
      return matches.reduce((a, b) => (b.sequence > a.sequence ? b : a));
    },
  );
  const create = jest.fn(async ({ data }: { data: StoredRow }) => {
    if (remainingFailures > 0) {
      remainingFailures -= 1;
      throw duplicateSequenceError();
    }
    const row = { id: `audit-${rows.length + 1}`, ...data };
    rows.push(row);
    return row;
  });

  // A transaction client is the root client MINUS $transaction — that absence is
  // exactly what AuditService uses to decide whether it must open its own.
  const tx = { $executeRaw, auditLog: { findFirst, create } };
  const $transaction = jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
  const prisma = { ...tx, $transaction };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new AuditService(prisma as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { service, prisma, tx: tx as any, rows, $executeRaw, findFirst, create, $transaction };
}

const BASE: AuditAppendInput = {
  orgId: 'org1',
  actorType: 'USER',
  actorUserId: 'u1',
  action: 'buyer.archived',
  entityType: 'Buyer',
  entityId: 'b1',
};

describe('AuditService.append — chain construction', () => {
  it('gives the genesis entry sequence 1 and a null prevEntryHash', async () => {
    const { service, tx, rows } = makeService();
    await service.append(BASE, tx);
    expect(rows).toHaveLength(1);
    expect(rows[0].sequence).toBe(1);
    expect(rows[0].prevEntryHash).toBeNull();
    expect(rows[0].payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('links a subsequent entry to linkHash(previous) at sequence N+1', async () => {
    const { service, tx, rows } = makeService();
    await service.append(BASE, tx);
    await service.append({ ...BASE, action: 'buyer.restored' }, tx);

    expect(rows.map((r) => r.sequence)).toEqual([1, 2]);
    expect(rows[1].prevEntryHash).toBe(
      linkHash({
        sequence: rows[0].sequence,
        payloadHash: rows[0].payloadHash,
        prevEntryHash: rows[0].prevEntryHash,
      }),
    );
    // The whole point of the linkage: the persisted rows must verify as a chain.
    expect(verifyChain(rows)).toBe(true);
    // Non-vacuity: a chain built from an unrelated payloadHash must NOT verify,
    // so verifyChain() above is doing real work.
    expect(
      verifyChain([rows[0], { ...rows[1], prevEntryHash: 'deadbeef' }]),
    ).toBe(false);
  });

  it('keeps sequence counters independent per org', async () => {
    const { service, tx, rows } = makeService();
    await service.append(BASE, tx);
    await service.append(BASE, tx);
    await service.append({ ...BASE, orgId: 'org2' }, tx);
    await service.append({ ...BASE, orgId: null }, tx);

    expect(rows.filter((r) => r.orgId === 'org1').map((r) => r.sequence)).toEqual([1, 2]);
    expect(rows.filter((r) => r.orgId === 'org2').map((r) => r.sequence)).toEqual([1]);
    expect(rows.filter((r) => r.orgId === null).map((r) => r.sequence)).toEqual([1]);
  });
});

describe('AuditService.append — payload hash coverage (INS-039)', () => {
  const FROZEN = new Date('2026-08-01T12:00:00.000Z');

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(FROZEN);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  async function hashFor(input: AuditAppendInput): Promise<string> {
    const { service, tx, rows } = makeService();
    await service.append(input, tx);
    return rows[0].payloadHash;
  }

  it('is deterministic for identical input at an identical clock', async () => {
    // Control for the two tests below: without this, "the hash changed" would be
    // explained by the app-assigned createdAt alone and prove nothing.
    expect(await hashFor(BASE)).toBe(await hashFor(BASE));
  });

  it('changes when actorUserId changes', async () => {
    expect(await hashFor(BASE)).not.toBe(
      await hashFor({ ...BASE, actorUserId: 'someone-else' }),
    );
  });

  it('changes when actorType changes', async () => {
    expect(await hashFor(BASE)).not.toBe(
      await hashFor({ ...BASE, actorType: 'PLATFORM_ADMIN' }),
    );
  });

  it('changes when the app-assigned createdAt changes', async () => {
    const before = await hashFor(BASE);
    jest.setSystemTime(new Date(FROZEN.getTime() + 1000));
    expect(await hashFor(BASE)).not.toBe(before);
  });

  it('stamps the row createdAt with the same instant it hashed', async () => {
    const { service, tx, rows } = makeService();
    await service.append(BASE, tx);
    expect(rows[0].createdAt.toISOString()).toBe(FROZEN.toISOString());
  });
});

describe('AuditService.append — sequence serialization (INS-012)', () => {
  function lockKeysUsed(executeRaw: jest.Mock): string[] {
    return executeRaw.mock.calls.map((call) => call[1] as string);
  }
  function sqlOf(executeRaw: jest.Mock, i = 0): string {
    return (executeRaw.mock.calls[i][0] as unknown as string[]).join('?');
  }

  it('takes a transaction-scoped advisory lock BEFORE reading the sequence tail', async () => {
    const { service, tx, $executeRaw, findFirst, create } = makeService();
    await service.append(BASE, tx);

    expect($executeRaw).toHaveBeenCalledTimes(1);
    expect(sqlOf($executeRaw)).toContain('pg_advisory_xact_lock');
    // Ordering is the whole guarantee: a lock taken after the read serializes
    // nothing.
    expect($executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      findFirst.mock.invocationCallOrder[0],
    );
    expect(findFirst.mock.invocationCallOrder[0]).toBeLessThan(
      create.mock.invocationCallOrder[0],
    );
  });

  it('keys the lock on the org so different tenants do not serialize on each other', async () => {
    const { service, tx, $executeRaw } = makeService();
    await service.append(BASE, tx);
    await service.append({ ...BASE, orgId: 'org2' }, tx);
    await service.append(BASE, tx);

    expect(lockKeysUsed($executeRaw)).toEqual([
      auditSequenceLockKey('org1'),
      auditSequenceLockKey('org2'),
      auditSequenceLockKey('org1'),
    ]);
    expect(auditSequenceLockKey('org1')).not.toBe(auditSequenceLockKey('org2'));
  });

  it('uses one stable sentinel key for platform-level (orgId null) rows', async () => {
    const { service, tx, $executeRaw } = makeService();
    await service.append({ ...BASE, orgId: null }, tx);
    await service.append({ ...BASE, orgId: null }, tx);

    const keys = lockKeysUsed($executeRaw);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toBe('inspect:audit-sequence:__platform__');
    // A null-org row must not collide with a real org's counter lock.
    expect(keys[0]).not.toBe(auditSequenceLockKey('org1'));
  });

  it('opens its own transaction when no client is supplied, so the lock has one to live in', async () => {
    const { service, $transaction, $executeRaw, rows } = makeService();
    await service.append(BASE);

    expect($transaction).toHaveBeenCalledTimes(1);
    // pg_advisory_xact_lock outside a transaction is released immediately and
    // serializes nothing, so the lock MUST be taken inside the callback.
    expect($transaction.mock.invocationCallOrder[0]).toBeLessThan(
      $executeRaw.mock.invocationCallOrder[0],
    );
    expect(rows).toHaveLength(1);
  });

  it('does not open a nested transaction when the caller already owns one', async () => {
    const { service, tx, $transaction } = makeService();
    await service.append(BASE, tx);
    expect($transaction).not.toHaveBeenCalled();
  });
});

describe('AuditService.append — duplicate-sequence retry (INS-012 defence in depth)', () => {
  it('retries the whole transaction on P2002 when it owns the transaction', async () => {
    const { service, create, $transaction, $executeRaw, rows } = makeService({ createFails: 1 });
    const row = await service.append(BASE);

    expect(create).toHaveBeenCalledTimes(2);
    // A retry must re-open the transaction (the first one is aborted) and
    // re-take the lock + re-read the tail, not reuse the stale sequence.
    expect($transaction).toHaveBeenCalledTimes(2);
    expect($executeRaw).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(1);
    expect((row as unknown as StoredRow).sequence).toBe(1);
  });

  it('gives up after a bounded number of attempts rather than looping forever', async () => {
    const { service, create } = makeService({ createFails: 99 });
    await expect(service.append(BASE)).rejects.toMatchObject({ code: 'P2002' });
    expect(create).toHaveBeenCalledTimes(4);
  });

  it('does not retry a non-P2002 failure', async () => {
    const { service, create, $transaction } = makeService();
    create.mockRejectedValueOnce(new Error('connection reset'));
    await expect(service.append(BASE)).rejects.toThrow('connection reset');
    expect($transaction).toHaveBeenCalledTimes(1);
  });

  it('propagates P2002 to the caller when the caller owns the transaction', async () => {
    // Postgres aborts the entire transaction on error, so retrying inside a
    // caller-supplied tx is impossible — it must surface and let the caller's
    // business mutation roll back. The advisory lock is what prevents this.
    const { service, tx, create } = makeService({ createFails: 1 });
    await expect(service.append(BASE, tx)).rejects.toMatchObject({ code: 'P2002' });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
