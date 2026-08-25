/**
 * INS-012 regression: concurrent same-org audited mutations must produce a
 * gap-free, duplicate-free, verifiable audit chain — and must never leak the
 * duplicate-sequence collision (P2002 -> 500) to the caller.
 *
 * Before the advisory lock, AuditService.append() read max(sequence) then wrote.
 * Under Postgres's default READ COMMITTED that read is not serialized, so two
 * concurrent same-org appends pick the same sequence, @@unique([orgId, sequence])
 * rejects the loser, and that rollback takes the caller's BUSINESS mutation with
 * it. This spec drives real concurrent HTTP mutations to prove that is closed.
 *
 * DELETE /buyers/:id (archive) is used because it is one of the mutations that
 * actually appends an audit row today (POST /buyers does not — that gap is
 * INS-006).
 */
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { verifyChain } from '../../src/audit/audit-chain';
import {
  ApiClient,
  ApiResult,
  apiClient,
  bootApp,
  createOrgWithOwner,
  expect2xx,
  loginAdmin,
  runTag,
} from './support';

/**
 * Concurrency is deliberately bounded: every archive holds a Prisma interactive
 * transaction (and therefore a pooled connection) for its duration, and the
 * default pool on a 2-core CI runner is only 5. Eight in flight is well past the
 * point where the old read-then-write raced (two was enough) while staying
 * inside the pool's `maxWait`.
 */
const SAME_ORG_BURST = 6;
const OTHER_ORG_BURST = 2;

describe('Audit chain under concurrent mutations (INS-012)', () => {
  let app: INestApplication;
  let client: ApiClient;
  let prisma: PrismaClient;
  let orgA: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let orgB: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let buyerIdsA: string[];
  let buyerIdsB: string[];
  let burst: ApiResult[];

  async function seedBuyers(
    token: string,
    tag: string,
    count: number,
  ): Promise<string[]> {
    // POST /buyers does not audit, so seeding in parallel is safe and cheap.
    const created = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        client.post('/buyers', {
          token,
          body: { name: `Audit Race Buyer ${tag}-${i}` },
        }),
      ),
    );
    return created.map(
      (res, i) => expect2xx(res, `POST /buyers #${i} (${tag})`).id as string,
    );
  }

  async function chainFor(orgId: string) {
    return prisma.auditLog.findMany({
      where: { orgId },
      orderBy: { sequence: 'asc' },
    });
  }

  beforeAll(async () => {
    app = await bootApp();
    client = apiClient(app);
    prisma = new PrismaClient();
    const adminToken = await loginAdmin(client);
    const tagA = runTag('audit-race-a');
    const tagB = runTag('audit-race-b');
    orgA = await createOrgWithOwner(client, adminToken, tagA);
    orgB = await createOrgWithOwner(client, adminToken, tagB);

    buyerIdsA = await seedBuyers(orgA.ownerToken, tagA, SAME_ORG_BURST);
    buyerIdsB = await seedBuyers(orgB.ownerToken, tagB, OTHER_ORG_BURST);

    // Fire everything at once, interleaving the two orgs so same-org contention
    // (which the lock must serialize) and cross-org traffic (which it must NOT
    // serialize away into a deadlock) overlap in time. Building the array of
    // promises eagerly is what makes them genuinely concurrent.
    const pending: Promise<ApiResult>[] = [];
    for (let i = 0; i < Math.max(SAME_ORG_BURST, OTHER_ORG_BURST); i++) {
      if (i < SAME_ORG_BURST) {
        pending.push(
          client.delete(`/buyers/${buyerIdsA[i]}`, { token: orgA.ownerToken }),
        );
      }
      if (i < OTHER_ORG_BURST) {
        pending.push(
          client.delete(`/buyers/${buyerIdsB[i]}`, { token: orgB.ownerToken }),
        );
      }
    }
    burst = await Promise.all(pending);
  }, 240_000);

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
    if (app) await app.close();
  });

  it('surfaces no duplicate-sequence failure to any caller', () => {
    expect(burst).toHaveLength(SAME_ORG_BURST + OTHER_ORG_BURST);
    // Report the actual failures, not just a count — a P2002 leak shows up as a
    // 500 whose body names the unique constraint.
    const failures = burst
      .filter((r) => r.status < 200 || r.status >= 300)
      .map((r) => ({ status: r.status, body: r.body }));
    expect(failures).toEqual([]);
  });

  it('commits the business mutation of every concurrent request', () => {
    // The failure mode INS-012 describes is not just a bad audit row: the P2002
    // rolls back the caller's transaction, so the archive silently does not
    // happen. Assert the domain effect landed for all of them.
    return prisma.buyer
      .findMany({
        where: { id: { in: buyerIdsA } },
        select: { id: true, archivedAt: true },
      })
      .then((rows) => {
        expect(rows).toHaveLength(SAME_ORG_BURST);
        expect(rows.filter((r) => r.archivedAt !== null)).toHaveLength(
          SAME_ORG_BURST,
        );
      });
  });

  it('produces a gap-free, duplicate-free 1..M sequence for the contended org', async () => {
    const rows = await chainFor(orgA.orgId);
    // org.created (from createOrgWithOwner) + one row per concurrent archive.
    expect(rows.length).toBeGreaterThanOrEqual(SAME_ORG_BURST + 1);
    // Ordered by sequence asc, so this single assertion proves: starts at 1,
    // strictly +1 each step (no gaps), and no duplicates.
    expect(rows.map((r) => r.sequence)).toEqual(rows.map((_, i) => i + 1));
    expect(new Set(rows.map((r) => r.sequence)).size).toBe(rows.length);
  });

  it('records exactly one audit row per concurrent archive, one per buyer', async () => {
    const rows = await chainFor(orgA.orgId);
    const archived = rows.filter((r) => r.action === 'buyer.archived');
    // Non-vacuity guard for the sequence test above: a chain of length M is
    // trivially 1..M if the appends never happened at all.
    expect(archived).toHaveLength(SAME_ORG_BURST);
    expect(new Set(archived.map((r) => r.entityId))).toEqual(
      new Set(buyerIdsA),
    );
  });

  it("leaves the contended org's hash chain verifiable end to end", async () => {
    const rows = await chainFor(orgA.orgId);
    expect(verifyChain(rows)).toBe(true);
    // Non-vacuity: verifyChain must reject a tampered copy of these very rows,
    // otherwise the assertion above proves nothing about this data.
    const tampered = rows.map((r, i) =>
      i === rows.length - 1 ? { ...r, prevEntryHash: null } : r,
    );
    expect(verifyChain(tampered)).toBe(false);
  });

  it('keeps the concurrently-written second org on its own independent, verifiable chain', async () => {
    const rows = await chainFor(orgB.orgId);
    expect(rows.length).toBeGreaterThanOrEqual(OTHER_ORG_BURST + 1);
    expect(rows.map((r) => r.sequence)).toEqual(rows.map((_, i) => i + 1));
    expect(verifyChain(rows)).toBe(true);
    expect(rows.filter((r) => r.action === 'buyer.archived')).toHaveLength(
      OTHER_ORG_BURST,
    );
    // Per-org counters, not a global one: both orgs must own a sequence 1.
    expect(rows[0].sequence).toBe(1);
    // Tenant isolation: org A's writes must not have leaked into org B's chain.
    expect(rows.every((r) => r.orgId === orgB.orgId)).toBe(true);
    const entityIds = new Set(rows.map((r) => r.entityId));
    expect(buyerIdsA.some((id) => entityIds.has(id))).toBe(false);
  });
});
