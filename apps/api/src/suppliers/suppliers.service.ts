import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

  list(orgId: string) {
    return this.prisma.supplier.findMany({
      where: { orgId, archivedAt: null },
      orderBy: { name: 'asc' },
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

  async archive(orgId: string, id: string) {
    await this.get(orgId, id);
    return this.prisma.supplier.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }
}
