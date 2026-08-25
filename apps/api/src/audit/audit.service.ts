import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { canonicalize } from '../tamper-proof/canonicalize';
import { linkHash } from './audit-chain';

export type AuditActorType =
  | 'USER'
  | 'PLATFORM_ADMIN'
  | 'BUYER_GUEST'
  | 'SYSTEM';

export interface AuditAppendInput {
  orgId: string | null;
  actorUserId?: string | null;
  actorType: AuditActorType;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Namespace prefix for the per-org advisory lock that serializes sequence
 * assignment (INS-012). Prefixed so the key space cannot collide with any other
 * advisory lock the app might take later.
 */
const AUDIT_SEQUENCE_LOCK_NAMESPACE = 'inspect:audit-sequence';

/**
 * Stable sentinel for platform-level rows (orgId = null). Those rows share one
 * sequence counter, so they must share one lock key — `null` cannot be hashed.
 */
const AUDIT_SEQUENCE_LOCK_PLATFORM_SCOPE = '__platform__';

/** The advisory-lock key that serializes sequence assignment for one org. */
export function auditSequenceLockKey(orgId: string | null): string {
  return `${AUDIT_SEQUENCE_LOCK_NAMESPACE}:${orgId ?? AUDIT_SEQUENCE_LOCK_PLATFORM_SCOPE}`;
}

/**
 * Bounded retry budget for the own-transaction path. The advisory lock should
 * make a duplicate-sequence collision unreachable; this is defence in depth.
 */
const MAX_APPEND_ATTEMPTS = 4;

/**
 * Duck-typed rather than `instanceof Prisma.PrismaClientKnownRequestError` so it
 * also recognises the error shape thrown by a mocked client in unit tests.
 */
function isDuplicateSequence(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'P2002'
  );
}

/**
 * `Prisma.TransactionClient` is `PrismaClient` minus `$transaction`, so the
 * presence of `$transaction` at runtime is exactly the signal "this is the root
 * client, we are NOT inside a transaction yet".
 */
type MaybeRootClient = Prisma.TransactionClient & {
  $transaction?: <R>(
    fn: (tx: Prisma.TransactionClient) => Promise<R>,
  ) => Promise<R>;
};

/**
 * Append-only, hash-chained audit writer (spec §9). Assigns the monotonic
 * per-org sequence and links each entry to the previous via prevEntryHash.
 * Pass the transaction client when atomicity with the audited write matters.
 *
 * Sequence assignment reads-latest-then-writes, which is a lost-update race
 * under Postgres's default Read Committed isolation: the caller's transaction
 * gives atomicity but does NOT serialize the read, so two concurrent same-org
 * appends could pick the same sequence and the @@unique([orgId, sequence])
 * constraint would reject the loser with P2002 — rolling back that caller's
 * business mutation and surfacing as a 500.
 *
 * INS-012 closes that: every append first takes `pg_advisory_xact_lock` keyed on
 * the org, so same-org appends serialize on the read-modify-write while
 * different orgs stay fully parallel. The lock is transaction-scoped (released
 * at COMMIT/ROLLBACK, even on crash), so it only serializes correctly INSIDE a
 * transaction — when `append()` is called without one it opens its own.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async append(
    input: AuditAppendInput,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const root = client as MaybeRootClient;
    if (typeof root.$transaction !== 'function') {
      // The caller owns the transaction: the advisory lock lives in it, and the
      // caller's rollback undoes this row atomically with its business write.
      // No retry is possible here — Postgres aborts the entire transaction on
      // any error, so a second attempt inside it would fail with 25P02. The
      // lock is what makes P2002 unreachable on this path.
      return this.appendWithin(input, client);
    }

    // No ambient transaction. Open one so the advisory lock has a transaction to
    // live in, and retry the WHOLE transaction (fresh lock, fresh read) if a
    // duplicate sequence somehow still lands.
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_APPEND_ATTEMPTS; attempt++) {
      try {
        return await root.$transaction((tx) => this.appendWithin(input, tx));
      } catch (err) {
        if (!isDuplicateSequence(err)) throw err;
        lastError = err;
      }
    }
    throw lastError;
  }

  private async appendWithin(
    input: AuditAppendInput,
    client: Prisma.TransactionClient,
  ) {
    // INS-012: serialize the read-modify-write of this org's sequence counter.
    // Must be the FIRST statement of the append so no read escapes it. Advisory
    // locks are re-entrant within a session, so a transaction that appends twice
    // for the same org does not self-deadlock; and because every append takes
    // exactly one lock, two appends can never deadlock against each other.
    //
    // hashtext() narrows the key to int4, so two orgs can in principle collide
    // onto one lock. That is safe by construction — a collision only makes two
    // unrelated orgs serialize briefly; it can never let them share a sequence,
    // because the counter itself is still read WHERE orgId = <this org>.
    await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${auditSequenceLockKey(
      input.orgId,
    )}))`;

    // Assign the timestamp in application code so it participates in the hash
    // (a DB @default(now()) is unknowable at hash time). Taken after the lock so
    // createdAt ordering agrees with sequence ordering under contention.
    const createdAt = new Date();
    // The payload hash covers EVERY forensically-meaningful, immutable field —
    // including actor identity, type, org, request origin, and time — so a direct
    // row UPDATE of any of them breaks the chain and verifyChain() detects it.
    // (Security review: previously only action/entity/metadata were hashed, so
    // the "who"/"when" of an event could be silently forged.)
    const payloadHash = createHash('sha256')
      .update(
        canonicalize({
          v: 2,
          orgId: input.orgId ?? null,
          actorType: input.actorType,
          actorUserId: input.actorUserId ?? null,
          action: input.action,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          metadata: input.metadata ?? null,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          createdAt: createdAt.toISOString(),
        }),
        'utf8',
      )
      .digest('hex');

    const prev = await client.auditLog.findFirst({
      where: { orgId: input.orgId },
      orderBy: { sequence: 'desc' },
    });
    const sequence = (prev?.sequence ?? 0) + 1;
    const prevEntryHash = prev
      ? linkHash({
          sequence: prev.sequence,
          payloadHash: prev.payloadHash,
          prevEntryHash: prev.prevEntryHash,
        })
      : null;

    return client.auditLog.create({
      data: {
        orgId: input.orgId,
        actorUserId: input.actorUserId ?? undefined,
        actorType: input.actorType,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        payloadHash,
        prevEntryHash,
        sequence,
        metadata: input.metadata as Prisma.InputJsonValue,
        ipAddress: input.ipAddress ?? undefined,
        userAgent: input.userAgent ?? undefined,
        createdAt,
      },
    });
  }
}
