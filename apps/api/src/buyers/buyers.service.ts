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

  list(orgId: string, opts: { includeArchived?: boolean; q?: string; take?: number; skip?: number } = {}) {
    return this.prisma.buyer.findMany({
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
        _count: {
          select: { purchaseOrders: true, inspections: true, reports: true },
        },
      },
    });
  }

  async get(orgId: string, id: string) {
    const buyer = await this.prisma.buyer.findFirst({ where: { id, orgId } });
    if (!buyer) {
      throw new NotFoundException('Buyer not found');
    }
    return buyer;
  }

  async create(orgId: string, userId: string, input: CreateBuyerInput) {
    if (!input?.name?.trim()) {
      throw new BadRequestException('name is required');
    }
    await this.assertPresetInOrg(orgId, input.defaultLoopPresetId);
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
    await this.assertPresetInOrg(orgId, input.defaultLoopPresetId);
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

  /**
   * Tenant-isolation guard (security review): a buyer's defaultLoopPresetId must
   * reference a preset in the SAME org. The DB FK only checks existence, so
   * without this a caller could point at another tenant's preset. null (clear)
   * and undefined (no change) pass through untouched.
   */
  private async assertPresetInOrg(orgId: string, presetId?: string | null): Promise<void> {
    if (!presetId) return;
    const preset = await this.prisma.loopPreset.findFirst({
      where: { id: presetId, orgId },
      select: { id: true },
    });
    if (!preset) {
      throw new BadRequestException('defaultLoopPresetId not found in organization');
    }
  }

  async archive(orgId: string, id: string) {
    await this.get(orgId, id);
    return this.prisma.buyer.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }
}
