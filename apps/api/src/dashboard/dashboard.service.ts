import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface DashboardSummary {
  inspectionsByStatus: Record<string, number>;
  buyers: number;
  suppliers: number;
  products: number;
  purchaseOrders: number;
  reports: number;
}

/** Org-scoped rollups for the console dashboard (INS-005). */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(orgId: string): Promise<DashboardSummary> {
    // groupBy lives outside the $transaction tuple: Prisma's groupBy type
    // trips TS2615 (circular mapped type) when inlined there.
    const byStatus = await this.prisma.inspection.groupBy({
      by: ['status'],
      where: { orgId },
      _count: { _all: true },
      orderBy: { status: 'asc' },
    });
    const [buyers, suppliers, products, purchaseOrders, reports] =
      await this.prisma.$transaction([
        this.prisma.buyer.count({ where: { orgId, archivedAt: null } }),
        this.prisma.supplier.count({ where: { orgId, archivedAt: null } }),
        this.prisma.product.count({ where: { orgId, archivedAt: null } }),
        this.prisma.purchaseOrder.count({ where: { orgId } }),
        this.prisma.report.count({ where: { orgId } }),
      ]);
    return {
      inspectionsByStatus: Object.fromEntries(
        byStatus.map((row) => [row.status, row._count._all]),
      ),
      buyers,
      suppliers,
      products,
      purchaseOrders,
      reports,
    };
  }
}
