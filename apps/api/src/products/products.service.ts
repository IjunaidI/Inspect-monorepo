import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth-user';
import { AuditService } from '../audit/audit.service';
import { actorTypeFor } from '../audit/actor-type';

export interface CreateProductInput {
  styleNumber: string;
  description?: string | null;
}
export interface UpdateProductInput {
  styleNumber?: string;
  /**
   * INS-074: `undefined` means "not supplied — leave unchanged"; an explicit
   * `null` (or an empty/whitespace-only string) means "clear the column".
   * Prisma treats `undefined` as a no-op, so the console MUST send `null` to
   * empty a description — otherwise it can never be cleared.
   */
  description?: string | null;
}

/**
 * Normalise a submitted description to what the column should hold: trimmed
 * text, or `null` when the caller sent nothing meaningful. Only the outer
 * whitespace is stripped — internal line breaks are content and are preserved
 * (the detail screen renders them).
 */
function normalizeDescription(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(
    orgId: string,
    opts: {
      includeArchived?: boolean;
      q?: string;
      take?: number;
      skip?: number;
    } = {},
  ) {
    return this.prisma.product.findMany({
      where: {
        orgId,
        ...(opts.includeArchived ? {} : { archivedAt: null }),
        ...(opts.q
          ? {
              OR: [
                {
                  styleNumber: {
                    contains: opts.q,
                    mode: 'insensitive' as const,
                  },
                },
                {
                  description: {
                    contains: opts.q,
                    mode: 'insensitive' as const,
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: { styleNumber: 'asc' },
      take: opts.take,
      skip: opts.skip,
      // INS-005: relation counts so the console lists render real figures.
      include: {
        _count: { select: { purchaseOrders: true, inspections: true } },
      },
    });
  }

  async get(orgId: string, id: string) {
    const row = await this.prisma.product.findFirst({ where: { id, orgId } });
    if (!row) {
      throw new NotFoundException('Product not found');
    }
    return row;
  }

  async create(orgId: string, actor: AuthUser, input: CreateProductInput) {
    if (!input?.styleNumber?.trim()) {
      throw new BadRequestException('styleNumber is required');
    }
    // INS-006: audit inside the business transaction.
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          orgId,
          styleNumber: input.styleNumber.trim(),
          description: normalizeDescription(input.description),
          createdByUserId: actor.userId,
        },
      });
      await this.audit.append(
        {
          orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'product.created',
          entityType: 'Product',
          entityId: product.id,
          metadata: { styleNumber: product.styleNumber },
        },
        tx,
      );
      return product;
    });
  }

  async update(
    orgId: string,
    actor: AuthUser,
    id: string,
    input: UpdateProductInput,
  ) {
    await this.get(orgId, id);
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.update({
        where: { id },
        data: {
          styleNumber: input.styleNumber?.trim(),
          // INS-074: only touch `description` when the caller actually supplied
          // it. Spreading keeps an omitted key out of the update entirely, while
          // an explicit null / empty string clears the column instead of being
          // swallowed by Prisma's "undefined = leave unchanged" rule.
          ...(input.description === undefined
            ? {}
            : { description: normalizeDescription(input.description) }),
        },
      });
      await this.audit.append(
        {
          orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'product.updated',
          entityType: 'Product',
          entityId: id,
          metadata: { fields: Object.keys(input ?? {}).sort() },
        },
        tx,
      );
      return product;
    });
  }

  async archive(orgId: string, actor: AuthUser, id: string) {
    const product = await this.get(orgId, id);
    // Idempotent: re-archiving must not overwrite the original timestamp (INS-061).
    if (product.archivedAt) return product;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id },
        data: { archivedAt: new Date() },
      });
      await this.audit.append(
        {
          orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'product.archived',
          entityType: 'Product',
          entityId: id,
        },
        tx,
      );
      return updated;
    });
  }

  /** Archive is a reversible state, not a delete — restore clears it (INS-061). */
  async restore(orgId: string, actor: AuthUser, id: string) {
    const product = await this.get(orgId, id);
    if (!product.archivedAt) return product;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id },
        data: { archivedAt: null },
      });
      await this.audit.append(
        {
          orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'product.restored',
          entityType: 'Product',
          entityId: id,
        },
        tx,
      );
      return updated;
    });
  }
}
