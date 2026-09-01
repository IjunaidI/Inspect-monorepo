import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth-user';
import { AuditService } from '../audit/audit.service';
import { actorTypeFor } from '../audit/actor-type';

/**
 * INS-055 — a PO is an explicitly TWO-PARTY trade document. Trade role belongs
 * to this edge, not to the Company row, so the same company can be the client
 * here and the factory on another PO.
 */
// The wire shapes live in the shared package (INS-086 §4.4); re-exported so
// existing imports keep working.
export type {
  CreatePurchaseOrderInput,
  UpdatePurchaseOrderInput,
} from '@inspect/shared-types';
import type {
  CreatePurchaseOrderInput,
  UpdatePurchaseOrderInput,
} from '@inspect/shared-types';

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
      include: { clientCompany: true, factoryCompany: true, product: true },
    });
  }

  async get(orgId: string, id: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, orgId },
      include: { clientCompany: true, factoryCompany: true, product: true },
    });
    if (!po) {
      throw new NotFoundException('Purchase order not found');
    }
    return po;
  }

  async create(
    orgId: string,
    actor: AuthUser,
    input: CreatePurchaseOrderInput,
  ) {
    if (!input?.poNumber?.trim()) {
      throw new BadRequestException('poNumber is required');
    }
    if (!input.clientCompanyId || !input.factoryCompanyId || !input.productId) {
      throw new BadRequestException(
        'clientCompanyId, factoryCompanyId and productId are required',
      );
    }
    // INS-055 spec §2.4: two FKs make self-dealing EXPRESSIBLE for the first
    // time (it was structurally impossible while the parties were different
    // tables). Guarded at the application layer, not as a DB check constraint —
    // consistent with every other cross-field invariant here, and easy to relax
    // if internal self-inspection turns out to be a real workflow. Checked
    // BEFORE the org lookups so the message names the actual problem.
    if (input.clientCompanyId === input.factoryCompanyId) {
      throw new BadRequestException('client and factory must differ');
    }
    await this.assertBelongsToOrg(
      orgId,
      input.clientCompanyId,
      input.factoryCompanyId,
      input.productId,
    );
    // INS-006: audit inside the business transaction.
    return this.runCreate(orgId, actor, input).catch((e: unknown) =>
      this.rethrowDuplicatePoNumber(e, input.poNumber.trim()),
    );
  }

  /**
   * `@@unique([orgId, poNumber])` makes the duplicate come back as P2002,
   * which must read as a 409 naming the PO number — not leak as a raw 500
   * (same fix as ProductsService's styleNumber).
   */
  private rethrowDuplicatePoNumber(e: unknown, poNumber: string): never {
    if ((e as { code?: string }).code === 'P2002') {
      throw new ConflictException(
        `A purchase order numbered "${poNumber}" already exists`,
      );
    }
    throw e;
  }

  private runCreate(
    orgId: string,
    actor: AuthUser,
    input: CreatePurchaseOrderInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.create({
        data: {
          orgId,
          poNumber: input.poNumber.trim(),
          clientCompanyId: input.clientCompanyId,
          factoryCompanyId: input.factoryCompanyId,
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
            clientCompanyId: po.clientCompanyId,
            factoryCompanyId: po.factoryCompanyId,
            productId: po.productId,
          },
        },
        tx,
      );
      return po;
    });
  }

  async update(
    orgId: string,
    actor: AuthUser,
    id: string,
    input: UpdatePurchaseOrderInput,
  ) {
    await this.get(orgId, id);
    return this.runUpdate(orgId, actor, id, input).catch((e: unknown) =>
      this.rethrowDuplicatePoNumber(e, input.poNumber?.trim() ?? ''),
    );
  }

  private runUpdate(
    orgId: string,
    actor: AuthUser,
    id: string,
    input: UpdatePurchaseOrderInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.update({
        where: { id },
        data: {
          poNumber: input.poNumber?.trim(),
          totalQuantity: input.totalQuantity,
        },
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

  /**
   * Tenant guard: both parties and the product must live in the CALLER's org.
   * The DB FKs only check existence, so without this a caller could name another
   * tenant's company on their own PO.
   */
  private async assertBelongsToOrg(
    orgId: string,
    clientCompanyId: string,
    factoryCompanyId: string,
    productId: string,
  ): Promise<void> {
    const [clientCompany, factoryCompany, product] = await Promise.all([
      this.prisma.company.findFirst({
        where: { id: clientCompanyId, orgId },
        select: { id: true },
      }),
      this.prisma.company.findFirst({
        where: { id: factoryCompanyId, orgId },
        select: { id: true },
      }),
      this.prisma.product.findFirst({
        where: { id: productId, orgId },
        select: { id: true },
      }),
    ]);
    if (!clientCompany)
      throw new BadRequestException('client company not found in organization');
    if (!factoryCompany)
      throw new BadRequestException(
        'factory company not found in organization',
      );
    if (!product)
      throw new BadRequestException('product not found in organization');
  }
}
