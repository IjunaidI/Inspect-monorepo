import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface SearchHit {
  /**
   * INS-055: `buyer` and `supplier` collapsed into one `company` type. A hit is
   * a row, and a row has no trade role — role lives on the PO/inspection edge —
   * so the palette can no longer label a counterparty as one or the other.
   */
  type: 'company' | 'product' | 'po' | 'inspection';
  id: string;
  label: string;
  sublabel: string | null;
}

const PER_TYPE = 5;

/** Org-scoped global search backing the console command palette (INS-051). */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(orgId: string, q?: string): Promise<SearchHit[]> {
    if (!q) return [];
    const contains = { contains: q, mode: 'insensitive' as const };
    const [companies, products, pos, inspections] =
      await this.prisma.$transaction([
        this.prisma.company.findMany({
          where: { orgId, name: contains },
          take: PER_TYPE,
          select: { id: true, name: true },
        }),
        this.prisma.product.findMany({
          where: {
            orgId,
            OR: [{ styleNumber: contains }, { description: contains }],
          },
          take: PER_TYPE,
          select: { id: true, styleNumber: true, description: true },
        }),
        this.prisma.purchaseOrder.findMany({
          where: { orgId, poNumber: contains },
          take: PER_TYPE,
          select: {
            id: true,
            poNumber: true,
            clientCompany: { select: { name: true } },
          },
        }),
        this.prisma.inspection.findMany({
          where: {
            orgId,
            OR: [
              { purchaseOrder: { poNumber: contains } },
              { buyer: { name: contains } },
              { product: { styleNumber: contains } },
            ],
          },
          take: PER_TYPE,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            purchaseOrder: { select: { poNumber: true } },
            buyer: { select: { name: true } },
          },
        }),
      ]);
    return [
      ...companies.map<SearchHit>((c) => ({
        type: 'company',
        id: c.id,
        label: c.name,
        sublabel: null,
      })),
      ...products.map<SearchHit>((p) => ({
        type: 'product',
        id: p.id,
        label: p.styleNumber,
        sublabel: p.description ?? null,
      })),
      ...pos.map<SearchHit>((po) => ({
        type: 'po',
        id: po.id,
        label: po.poNumber,
        sublabel: po.clientCompany?.name ?? null,
      })),
      ...inspections.map<SearchHit>((i) => ({
        type: 'inspection',
        id: i.id,
        label: i.purchaseOrder?.poNumber ?? i.id.slice(0, 8),
        sublabel: `${i.buyer?.name ?? '—'} · ${i.status}`,
      })),
    ];
  }
}
