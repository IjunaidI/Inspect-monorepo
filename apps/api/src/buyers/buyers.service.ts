import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth-user';
import { AuditService } from '../audit/audit.service';
import { actorTypeFor } from '../audit/actor-type';

/**
 * `logoUrl` is a DURABLE value, never a presigned URL (INS-072). It holds either
 *   - an object key in this org's namespace: `orgs/{orgId}/buyers/<uuid>.<ext>`
 *     (produced by POST /buyers/presign), or
 *   - a legacy absolute `https://…` URL stored verbatim before INS-072.
 *
 * CONTRACT for anything that renders a buyer logo (notably the PDF renderer,
 * INS-003): this column freezes verbatim into `Report.brandingSnapshot`, so a
 * consumer must presign the key at RENDER time (see BuyersController's
 * `logoViewUrl` decoration for the org-prefix guard + legacy fallback). Storing
 * a ~900s presigned URL here would permanently rot the tamper-proof artifact.
 */
export interface CreateBuyerInput {
  name: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  branding?: unknown;
  defaultLoopPresetId?: string;
}
export interface UpdateBuyerInput {
  name?: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  branding?: unknown;
  defaultLoopPresetId?: string | null;
}

/** Exactly `#RRGGBB` — the only shape the console's colour picker emits. */
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * INS-077: `primaryColor` freezes into the signed report's `brandingSnapshot`,
 * so an unvalidated value ("red", "", "javascript:…") becomes permanent garbage
 * in a tamper-proof artifact. Accept only `#RRGGBB`, normalised to lower case so
 * the stored value is canonical (`#1457A3` and `#1457a3` are the same colour and
 * must not produce two different snapshots).
 *
 * `undefined` = field absent (no change); `null`/`''` = explicit clear.
 */
export function normalizePrimaryColor(
  value: unknown,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new BadRequestException(
      'primaryColor must be a hex colour string like #1457A3',
    );
  }
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (!HEX_COLOR_RE.test(trimmed)) {
    throw new BadRequestException(
      `primaryColor must be a hex colour like #1457A3 (got ${JSON.stringify(value)})`,
    );
  }
  return trimmed.toLowerCase();
}

@Injectable()
export class BuyersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(
    orgId: string,
    opts: {
      includeArchived?: boolean;
      q?: string;
      take?: number;
      skip?: number;
    } = {},
  ) {
    return this.prisma.buyer.findMany({
      where: {
        orgId,
        ...(opts.includeArchived ? {} : { archivedAt: null }),
        ...(opts.q
          ? { name: { contains: opts.q, mode: 'insensitive' as const } }
          : {}),
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

  async create(orgId: string, actor: AuthUser, input: CreateBuyerInput) {
    if (!input?.name?.trim()) {
      throw new BadRequestException('name is required');
    }
    // Validate before touching the DB (INS-077).
    const primaryColor = normalizePrimaryColor(input.primaryColor);
    await this.assertPresetInOrg(orgId, input.defaultLoopPresetId);
    // INS-006: the audit row is written INSIDE the same transaction as the
    // business mutation, so the chain can never record a write that rolled back
    // (nor miss one that committed).
    return this.prisma.$transaction(async (tx) => {
      const buyer = await tx.buyer.create({
        data: {
          orgId,
          name: input.name.trim(),
          logoUrl: input.logoUrl,
          primaryColor,
          branding: input.branding as object | undefined,
          defaultLoopPresetId: input.defaultLoopPresetId,
          createdByUserId: actor.userId,
        },
      });
      await this.audit.append(
        {
          orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'buyer.created',
          entityType: 'Buyer',
          entityId: buyer.id,
          metadata: { name: buyer.name },
        },
        tx,
      );
      return buyer;
    });
  }

  async update(
    orgId: string,
    actor: AuthUser,
    id: string,
    input: UpdateBuyerInput,
  ) {
    // Validate before touching the DB (INS-077).
    const primaryColor = normalizePrimaryColor(input.primaryColor);
    await this.get(orgId, id);
    await this.assertPresetInOrg(orgId, input.defaultLoopPresetId);
    return this.prisma.$transaction(async (tx) => {
      const buyer = await tx.buyer.update({
        where: { id },
        data: {
          name: input.name?.trim(),
          logoUrl: input.logoUrl,
          primaryColor,
          branding: input.branding as object | undefined,
          defaultLoopPresetId:
            input.defaultLoopPresetId === undefined
              ? undefined
              : input.defaultLoopPresetId,
        },
      });
      await this.audit.append(
        {
          orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'buyer.updated',
          entityType: 'Buyer',
          entityId: id,
          // Which fields the caller actually supplied — enough to reconstruct
          // intent without copying (potentially large) branding blobs.
          metadata: { fields: Object.keys(input ?? {}).sort() },
        },
        tx,
      );
      return buyer;
    });
  }

  /**
   * Tenant-isolation guard (security review): a buyer's defaultLoopPresetId must
   * reference a preset in the SAME org. The DB FK only checks existence, so
   * without this a caller could point at another tenant's preset. null (clear)
   * and undefined (no change) pass through untouched.
   */
  private async assertPresetInOrg(
    orgId: string,
    presetId?: string | null,
  ): Promise<void> {
    if (!presetId) return;
    const preset = await this.prisma.loopPreset.findFirst({
      where: { id: presetId, orgId },
      select: { id: true },
    });
    if (!preset) {
      throw new BadRequestException(
        'defaultLoopPresetId not found in organization',
      );
    }
  }

  async archive(orgId: string, actor: AuthUser, id: string) {
    const buyer = await this.get(orgId, id);
    // Idempotent: re-archiving must not overwrite the original timestamp (INS-061).
    if (buyer.archivedAt) return buyer;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.buyer.update({
        where: { id },
        data: { archivedAt: new Date() },
      });
      await this.audit.append(
        {
          orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'buyer.archived',
          entityType: 'Buyer',
          entityId: id,
        },
        tx,
      );
      return updated;
    });
  }

  /** Archive is a reversible state, not a delete — restore clears it (INS-061). */
  async restore(orgId: string, actor: AuthUser, id: string) {
    const buyer = await this.get(orgId, id);
    if (!buyer.archivedAt) return buyer;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.buyer.update({
        where: { id },
        data: { archivedAt: null },
      });
      await this.audit.append(
        {
          orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'buyer.restored',
          entityType: 'Buyer',
          entityId: id,
        },
        tx,
      );
      return updated;
    });
  }
}
