import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { canonicalize } from '../tamper-proof/canonicalize';
import { linkHash } from './audit-chain';

export type AuditActorType = 'USER' | 'PLATFORM_ADMIN' | 'BUYER_GUEST' | 'SYSTEM';

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
 * Append-only, hash-chained audit writer (spec §9). Assigns the monotonic
 * per-org sequence and links each entry to the previous via prevEntryHash.
 * Pass the transaction client when atomicity with the audited write matters.
 *
 * NOTE: sequence assignment reads-latest-then-writes. Wrapping in the caller's
 * transaction gives atomicity but does NOT serialize the read under Postgres's
 * default Read Committed isolation, so two concurrent same-org appends can pick
 * the same sequence; the @@unique([orgId, sequence]) constraint then rejects the
 * loser with P2002 (loud failure, no silent fork). A gap-free, race-free counter
 * needs Serializable + retry or an advisory lock — tracked as INS-012.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async append(
    input: AuditAppendInput,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    // Assign the timestamp in application code so it participates in the hash
    // (a DB @default(now()) is unknowable at hash time).
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
