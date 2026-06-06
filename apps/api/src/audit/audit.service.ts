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
}

/**
 * Append-only, hash-chained audit writer (spec §9). Assigns the monotonic
 * per-org sequence and links each entry to the previous via prevEntryHash.
 * Pass the transaction client when atomicity with the audited write matters.
 *
 * NOTE: sequence assignment reads the latest entry then writes — wrap in the
 * same transaction as the audited mutation to avoid races under concurrency.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async append(
    input: AuditAppendInput,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const payloadHash = createHash('sha256')
      .update(
        canonicalize({
          action: input.action,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          metadata: input.metadata ?? null,
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
      },
    });
  }
}
