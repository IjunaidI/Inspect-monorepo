import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth-user';
import { AuditService } from '../audit/audit.service';
import { actorTypeFor } from '../audit/actor-type';

export interface CreatePurchaseOrderInput {
  poNumber: string;
  buyerId: string;
  supplierId: string;
  productId: string;
  totalQuantity?: number;
}
export interface UpdatePurchaseOrderInput {
  poNumber?: string;
  totalQuantity?: number;
}

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(orgId: string) {
    return this.prisma.purchaseOrder.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      include: { buyer: true, supplier: true, product: true },
    });
  }

  async get(orgId: string, id: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, orgId },
      include: { buyer: true, supplier: true, product: true },
    });
    if (!po) {
      throw new NotFoundException('Purchase order not found');
    }
    return po;
  }

  async create(orgId: string, actor: AuthUser, input: CreatePurchaseOrderInput) {
    if (!input?.poNumber?.trim()) {
      throw new BadRequestException('poNumber is required');
    }
    if (!input.buyerId || !input.supplierId || !input.productId) {
      throw new BadRequestException('buyerId, supplierId and productId are required');
    }
    await this.assertBelongsToOrg(orgId, input.buyerId, input.supplierId, input.productId);
    // INS-006: audit inside the business transaction.
    return this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.create({
        data: {
          orgId,
          poNumber: input.poNumber.trim(),
          buyerId: input.buyerId,
          supplierId: input.supplierId,
          productId: input.productId,
          totalQuantity: input.totalQuantity,
          createdByUserId: actor.userId,
        },
      });
      await this.audit.append(
        {
          orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'purchaseOrder.created',
          entityType: 'PurchaseOrder',
          entityId: po.id,
          metadata: {
            poNumber: po.poNumber,
            buyerId: po.buyerId,
            supplierId: po.supplierId,
            productId: po.productId,
          },
        },
        tx,
      );
      return po;
    });
  }

  async update(orgId: string, actor: AuthUser, id: string, input: UpdatePurchaseOrderInput) {
    await this.get(orgId, id);
    return this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.update({
        where: { id },
        data: { poNumber: input.poNumber?.trim(), totalQuantity: input.totalQuantity },
      });
      await this.audit.append(
        {
          orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'purchaseOrder.updated',
          entityType: 'PurchaseOrder',
          entityId: id,
          metadata: { fields: Object.keys(input ?? {}).sort() },
        },
        tx,
      );
      return po;
    });
  }

  async remove(orgId: string, actor: AuthUser, id: string) {
    const existing = await this.get(orgId, id);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const deleted = await tx.purchaseOrder.delete({ where: { id } });
        await this.audit.append(
          {
            orgId,
            actorType: actorTypeFor(actor),
            actorUserId: actor.userId,
            action: 'purchaseOrder.deleted',
            entityType: 'PurchaseOrder',
            entityId: id,
            metadata: { poNumber: existing.poNumber },
          },
          tx,
        );
        return deleted;
      });
    } catch (e) {
      // A PO referenced by an inspection is FK-restricted — surface that as a 400
      // rather than a 500. (Any audit row rolls back with the failed delete.)
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException(
        'Cannot delete a purchase order referenced by inspections',
      );
    }
  }

  private async assertBelongsToOrg(
    orgId: string,
    buyerId: string,
    supplierId: string,
    productId: string,
  ): Promise<void> {
    const [buyer, supplier, product] = await Promise.all([
      this.prisma.buyer.findFirst({ where: { id: buyerId, orgId }, select: { id: true } }),
      this.prisma.supplier.findFirst({ where: { id: supplierId, orgId }, select: { id: true } }),
      this.prisma.product.findFirst({ where: { id: productId, orgId }, select: { id: true } }),
    ]);
    if (!buyer) throw new BadRequestException('buyer not found in organization');
    if (!supplier) throw new BadRequestException('supplier not found in organization');
    if (!product) throw new BadRequestException('product not found in organization');
  }
}
