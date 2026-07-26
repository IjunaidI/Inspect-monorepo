import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth-user';
import { AuditService } from '../audit/audit.service';
import { actorTypeFor } from '../audit/actor-type';

export interface CreateSupplierInput {
  name: string;
  address?: string;
  gps?: unknown;
}
export interface UpdateSupplierInput {
  name?: string;
  address?: string;
  gps?: unknown;
}

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(orgId: string, opts: { includeArchived?: boolean; q?: string; take?: number; skip?: number } = {}) {
    return this.prisma.supplier.findMany({
      where: {
        orgId,
        ...(opts.includeArchived ? {} : { archivedAt: null }),
        ...(opts.q ? { name: { contains: opts.q, mode: 'insensitive' as const } } : {}),
      },
      orderBy: { name: 'asc' },
      take: opts.take,
      skip: opts.skip,
      // INS-005: relation counts so the console lists render real figures.
      include: {
        _count: { select: { purchaseOrders: true, inspections: true } },
      },
    });
  }

  async get(orgId: string, id: string) {
    const row = await this.prisma.supplier.findFirst({ where: { id, orgId } });
    if (!row) {
      throw new NotFoundException('Supplier not found');
    }
    return row;
  }

  create(orgId: string, userId: string, input: CreateSupplierInput) {
    if (!input?.name?.trim()) {
      throw new BadRequestException('name is required');
    }
    return this.prisma.supplier.create({
      data: {
        orgId,
        name: input.name.trim(),
        address: input.address,
        gps: input.gps as object | undefined,
        createdByUserId: userId,
      },
    });
  }

  async update(orgId: string, id: string, input: UpdateSupplierInput) {
    await this.get(orgId, id);
    return this.prisma.supplier.update({
      where: { id },
      data: {
        name: input.name?.trim(),
        address: input.address,
        gps: input.gps as object | undefined,
      },
    });
  }

  async archive(orgId: string, actor: AuthUser, id: string) {
    const supplier = await this.get(orgId, id);
    // Idempotent: re-archiving must not overwrite the original timestamp (INS-061).
    if (supplier.archivedAt) return supplier;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.supplier.update({ where: { id }, data: { archivedAt: new Date() } });
      await this.audit.append(
        { orgId, actorType: actorTypeFor(actor), actorUserId: actor.userId, action: 'supplier.archived', entityType: 'Supplier', entityId: id },
        tx,
      );
      return updated;
    });
  }

  /** Archive is a reversible state, not a delete — restore clears it (INS-061). */
  async restore(orgId: string, actor: AuthUser, id: string) {
    const supplier = await this.get(orgId, id);
    if (!supplier.archivedAt) return supplier;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.supplier.update({ where: { id }, data: { archivedAt: null } });
      await this.audit.append(
        { orgId, actorType: actorTypeFor(actor), actorUserId: actor.userId, action: 'supplier.restored', entityType: 'Supplier', entityId: id },
        tx,
      );
      return updated;
    });
  }
}
