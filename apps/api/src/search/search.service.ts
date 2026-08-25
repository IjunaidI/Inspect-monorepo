import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface SearchHit {
  type: 'buyer' | 'supplier' | 'product' | 'po' | 'inspection';
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
    const [buyers, suppliers, products, pos, inspections] =
      await this.prisma.$transaction([
        this.prisma.buyer.findMany({
          where: { orgId, name: contains },
          take: PER_TYPE,
          select: { id: true, name: true },
        }),
        this.prisma.supplier.findMany({
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
            buyer: { select: { name: true } },
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
      ...buyers.map<SearchHit>((b) => ({
        type: 'buyer',
        id: b.id,
        label: b.name,
        sublabel: null,
      })),
      ...suppliers.map<SearchHit>((s) => ({
        type: 'supplier',
        id: s.id,
        label: s.name,
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
        sublabel: po.buyer?.name ?? null,
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
