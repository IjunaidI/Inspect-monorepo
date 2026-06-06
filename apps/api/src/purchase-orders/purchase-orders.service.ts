import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

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

  async create(orgId: string, userId: string, input: CreatePurchaseOrderInput) {
    if (!input?.poNumber?.trim()) {
      throw new BadRequestException('poNumber is required');
    }
    if (!input.buyerId || !input.supplierId || !input.productId) {
      throw new BadRequestException('buyerId, supplierId and productId are required');
    }
    await this.assertBelongsToOrg(orgId, input.buyerId, input.supplierId, input.productId);
    return this.prisma.purchaseOrder.create({
      data: {
        orgId,
        poNumber: input.poNumber.trim(),
        buyerId: input.buyerId,
        supplierId: input.supplierId,
        productId: input.productId,
        totalQuantity: input.totalQuantity,
        createdByUserId: userId,
      },
    });
  }

  async update(orgId: string, id: string, input: UpdatePurchaseOrderInput) {
    await this.get(orgId, id);
    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { poNumber: input.poNumber?.trim(), totalQuantity: input.totalQuantity },
    });
  }

  async remove(orgId: string, id: string) {
    await this.get(orgId, id);
    try {
      return await this.prisma.purchaseOrder.delete({ where: { id } });
    } catch {
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
