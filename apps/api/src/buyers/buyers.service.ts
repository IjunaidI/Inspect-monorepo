import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateBuyerInput {
  name: string;
  logoUrl?: string;
  primaryColor?: string;
  branding?: unknown;
  defaultLoopPresetId?: string;
}
export interface UpdateBuyerInput {
  name?: string;
  logoUrl?: string;
  primaryColor?: string;
  branding?: unknown;
  defaultLoopPresetId?: string | null;
}

@Injectable()
export class BuyersService {
  constructor(private readonly prisma: PrismaService) {}

  list(orgId: string) {
    return this.prisma.buyer.findMany({
      where: { orgId, archivedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  async get(orgId: string, id: string) {
    const buyer = await this.prisma.buyer.findFirst({ where: { id, orgId } });
    if (!buyer) {
      throw new NotFoundException('Buyer not found');
    }
    return buyer;
  }

  create(orgId: string, userId: string, input: CreateBuyerInput) {
    if (!input?.name?.trim()) {
      throw new BadRequestException('name is required');
    }
    return this.prisma.buyer.create({
      data: {
        orgId,
        name: input.name.trim(),
        logoUrl: input.logoUrl,
        primaryColor: input.primaryColor,
        branding: input.branding as object | undefined,
        defaultLoopPresetId: input.defaultLoopPresetId,
        createdByUserId: userId,
      },
    });
  }

  async update(orgId: string, id: string, input: UpdateBuyerInput) {
    await this.get(orgId, id);
    return this.prisma.buyer.update({
      where: { id },
      data: {
        name: input.name?.trim(),
        logoUrl: input.logoUrl,
        primaryColor: input.primaryColor,
        branding: input.branding as object | undefined,
        defaultLoopPresetId:
          input.defaultLoopPresetId === undefined
            ? undefined
            : input.defaultLoopPresetId,
      },
    });
  }

  async archive(orgId: string, id: string) {
    await this.get(orgId, id);
    return this.prisma.buyer.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }
}
