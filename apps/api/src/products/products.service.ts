import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth-user';
import { AuditService } from '../audit/audit.service';
import { actorTypeFor } from '../audit/actor-type';

export interface CreateProductInput {
  styleNumber: string;
  description?: string;
}
export interface UpdateProductInput {
  styleNumber?: string;
  description?: string;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(orgId: string, opts: { includeArchived?: boolean; q?: string; take?: number; skip?: number } = {}) {
    return this.prisma.product.findMany({
      where: {
        orgId,
        ...(opts.includeArchived ? {} : { archivedAt: null }),
        ...(opts.q
          ? {
              OR: [
                { styleNumber: { contains: opts.q, mode: 'insensitive' as const } },
                { description: { contains: opts.q, mode: 'insensitive' as const } },
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

  create(orgId: string, userId: string, input: CreateProductInput) {
    if (!input?.styleNumber?.trim()) {
      throw new BadRequestException('styleNumber is required');
    }
    return this.prisma.product.create({
      data: {
        orgId,
        styleNumber: input.styleNumber.trim(),
        description: input.description,
        createdByUserId: userId,
      },
    });
  }

  async update(orgId: string, id: string, input: UpdateProductInput) {
    await this.get(orgId, id);
    return this.prisma.product.update({
      where: { id },
      data: {
        styleNumber: input.styleNumber?.trim(),
        description: input.description,
      },
    });
  }

  async archive(orgId: string, actor: AuthUser, id: string) {
    const product = await this.get(orgId, id);
    // Idempotent: re-archiving must not overwrite the original timestamp (INS-061).
    if (product.archivedAt) return product;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({ where: { id }, data: { archivedAt: new Date() } });
      await this.audit.append(
        { orgId, actorType: actorTypeFor(actor), actorUserId: actor.userId, action: 'product.archived', entityType: 'Product', entityId: id },
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
      const updated = await tx.product.update({ where: { id }, data: { archivedAt: null } });
      await this.audit.append(
        { orgId, actorType: actorTypeFor(actor), actorUserId: actor.userId, action: 'product.restored', entityType: 'Product', entityId: id },
        tx,
      );
      return updated;
    });
  }
}
