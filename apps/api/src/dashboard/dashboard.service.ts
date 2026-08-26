import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  QUALITY_SCAN_LIMIT,
  computeQualityMetrics,
  toQaDecisionCounts,
  type QaDecisionCounts,
  type QualityMetrics,
} from './dashboard-metrics';

export interface DashboardSummary {
  inspectionsByStatus: Record<string, number>;
  /** INS-068: exact PASS/FAIL/HOLD/PENDING rollup of the binding QA calls. */
  qaDecisionCounts: QaDecisionCounts;
  /** INS-068: passRate (headline) + DPHU (secondary). See dashboard-metrics.ts. */
  quality: QualityMetrics;
  /** INS-055: one unified counterparty count (was `buyers` + `suppliers`). */
  companies: number;
  products: number;
  purchaseOrders: number;
  reports: number;
}

/** Org-scoped rollups for the console dashboard (INS-005, KPIs extended in INS-068). */
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

    // INS-068 (a): the QA-decision rollup — exact and unbounded, served by
    // @@index([orgId, qaDecision]) on aql_results. The `inspection: { orgId }`
    // leg is the tenant-isolation belt-and-braces required by CLAUDE.md: never
    // trust a child row's denormalized orgId on its own.
    const byDecision = await this.prisma.aqlResult.groupBy({
      by: ['qaDecision'],
      where: { orgId, inspection: { orgId } },
      _count: { _all: true },
      orderBy: { qaDecision: 'asc' },
    });

    const [companies, products, purchaseOrders, reports] =
      await this.prisma.$transaction([
        this.prisma.company.count({ where: { orgId, archivedAt: null } }),
        this.prisma.product.count({ where: { orgId, archivedAt: null } }),
        this.prisma.purchaseOrder.count({ where: { orgId } }),
        this.prisma.report.count({ where: { orgId } }),
      ]);

    // INS-068 (b): DPHU needs `found` (perClass Json) and `sampleSize`
    // (computedSampling Json) — neither is SQL-aggregatable, so this is a
    // BOUNDED scan: at most QUALITY_SCAN_LIMIT (500) of the most recently
    // submitted decided results per org, never the whole table. `quality.
    // truncated` tells the console when that window clipped the history.
    const decided = await this.prisma.aqlResult.findMany({
      where: { orgId, qaDecision: { not: null }, inspection: { orgId } },
      select: {
        perClass: true,
        inspection: { select: { computedSampling: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: QUALITY_SCAN_LIMIT,
    });

    const qaDecisionCounts = toQaDecisionCounts(
      byDecision.map((row) => ({
        qaDecision: row.qaDecision,
        count: row._count._all,
      })),
    );
    const quality = computeQualityMetrics(
      qaDecisionCounts,
      decided.map((row) => ({
        perClass: row.perClass,
        computedSampling: row.inspection.computedSampling,
      })),
    );

    return {
      inspectionsByStatus: Object.fromEntries(
        byStatus.map((row) => [row.status, row._count._all]),
      ),
      qaDecisionCounts,
      quality,
      companies,
      products,
      purchaseOrders,
      reports,
    };
  }
}
