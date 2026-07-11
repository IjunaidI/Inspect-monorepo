import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

  list(orgId: string, opts: { includeArchived?: boolean } = {}) {
    return this.prisma.product.findMany({
      where: { orgId, ...(opts.includeArchived ? {} : { archivedAt: null }) },
      orderBy: { styleNumber: 'asc' },
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

  async archive(orgId: string, id: string) {
    await this.get(orgId, id);
    return this.prisma.product.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }
}
