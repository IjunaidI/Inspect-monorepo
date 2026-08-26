import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  COMPANY_KINDS,
  type CompanyKind,
  type CreateCompanyInput,
  type UpdateCompanyInput,
} from '@inspect/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth-user';
import { AuditService } from '../audit/audit.service';
import { actorTypeFor } from '../audit/actor-type';

/**
 * INS-055 — the unified counterparty. Replaces `BuyersService` +
 * `SuppliersService`, whose validation rules are carried over verbatim because
 * each guards a field that freezes into a signed report:
 *
 *   - `logoUrl` is a DURABLE value, never a presigned URL (INS-072). It holds
 *     either an object key in this org's namespace
 *     (`orgs/{orgId}/companies/<uuid>.<ext>`, produced by POST
 *     /companies/presign) or a legacy absolute `https://…` URL. It freezes
 *     verbatim into `Report.brandingSnapshot`, so a consumer must presign the
 *     key at RENDER time — see `CompaniesController.logoViewUrl`. Storing a
 *     ~900s presigned URL here would permanently rot the tamper-proof artifact.
 *   - `primaryColor` freezes into the same snapshot (INS-077).
 *   - `gps` was once typed `unknown` and written verbatim (INS-071).
 *
 * Trade role is NOT stored here. Whether this company is the client or the
 * factory is a property of the PurchaseOrder / Inspection / Report edge.
 */

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

/**
 * The only shape a company's `gps` column may hold (INS-071). A type alias (not
 * an interface) so it stays assignable to Prisma's JSON input types.
 */
export type GpsCoordinates = { lat: number; lng: number };

const GPS_SHAPE_MESSAGE =
  'gps must be an object with numeric lat and lng, e.g. { "lat": 23.8103, "lng": 90.4125 }';

/** Accept a real number or an unambiguous numeric string; reject NaN/Infinity. */
function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * INS-071: `gps` used to be typed `unknown` and persisted verbatim, so a typo in
 * the console's hand-typed JSON saved a row with no usable coordinates and no
 * error. Validate the structure here — the API is the authority — and return a
 * canonical `{ lat, lng }` with any extra keys stripped.
 *
 * `undefined` = field absent (no change); `null` = explicit clear.
 */
export function normalizeGps(
  value: unknown,
): GpsCoordinates | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException(GPS_SHAPE_MESSAGE);
  }
  const raw = value as Record<string, unknown>;
  const lat = finiteNumber(raw.lat);
  const lng = finiteNumber(raw.lng);
  if (lat === null || lng === null) {
    throw new BadRequestException(GPS_SHAPE_MESSAGE);
  }
  if (lat < -90 || lat > 90) {
    throw new BadRequestException(
      `gps.lat must be between -90 and 90 (got ${lat})`,
    );
  }
  if (lng < -180 || lng > 180) {
    throw new BadRequestException(
      `gps.lng must be between -180 and 180 (got ${lng})`,
    );
  }
  return { lat, lng };
}

/** Map the normalised value onto Prisma's nullable-JSON write semantics. */
function gpsWrite(
  gps: GpsCoordinates | null | undefined,
): Prisma.InputJsonObject | typeof Prisma.DbNull | undefined {
  if (gps === undefined) return undefined;
  if (gps === null) return Prisma.DbNull;
  return gps as Prisma.InputJsonObject;
}

/**
 * INS-055: validate `kind` against the shared tuple rather than trusting the
 * caller. `undefined` leaves the column to its `THIRD_PARTY` default on create
 * and unchanged on update.
 */
export function normalizeKind(value: unknown): CompanyKind | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== 'string' ||
    !(COMPANY_KINDS as readonly string[]).includes(value)
  ) {
    throw new BadRequestException(
      `kind must be one of ${COMPANY_KINDS.join(', ')}`,
    );
  }
  return value as CompanyKind;
}

/** The four role-edge relation counts Prisma returns for a company row. */
interface RoleEdgeCounts {
  poAsClient: number;
  poAsFactory: number;
  inspAsClient: number;
  inspAsFactory: number;
  reports: number;
}

/**
 * Collapse the four role-edge counts into the two numbers the wire DTO carries.
 *
 * Done server-side ON PURPOSE: `Company` plays both trade roles, so a client
 * that summed these itself would be re-implementing a domain rule. One place,
 * one answer, for the console and the future mobile app alike.
 */
function flattenCounts<T extends { _count?: RoleEdgeCounts }>(row: T) {
  if (!row._count) return row;
  const c = row._count;
  return {
    ...row,
    _count: {
      purchaseOrders: c.poAsClient + c.poAsFactory,
      inspections: c.inspAsClient + c.inspAsFactory,
      reports: c.reports,
    },
  };
}

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    orgId: string,
    opts: {
      includeArchived?: boolean;
      q?: string;
      take?: number;
      skip?: number;
      kind?: CompanyKind;
    } = {},
  ) {
    const rows = await this.prisma.company.findMany({
      where: {
        orgId,
        ...(opts.includeArchived ? {} : { archivedAt: null }),
        ...(opts.kind ? { kind: opts.kind } : {}),
        ...(opts.q
          ? { name: { contains: opts.q, mode: 'insensitive' as const } }
          : {}),
      },
      orderBy: { name: 'asc' },
      take: opts.take,
      skip: opts.skip,
      // INS-005: relation counts so the console list renders real figures.
      // Both role edges, flattened below.
      include: {
        _count: {
          select: {
            poAsClient: true,
            poAsFactory: true,
            inspAsClient: true,
            inspAsFactory: true,
            reports: true,
          },
        },
      },
    });
    return rows.map(flattenCounts);
  }

  async get(orgId: string, id: string) {
    const company = await this.prisma.company.findFirst({
      where: { id, orgId },
    });
    if (!company) {
      throw new NotFoundException('Company not found');
    }
    return company;
  }

  async create(orgId: string, actor: AuthUser, input: CreateCompanyInput) {
    if (!input?.name?.trim()) {
      throw new BadRequestException('name is required');
    }
    // Validate everything before touching the DB (INS-071 / INS-077).
    const kind = normalizeKind(input.kind);
    const primaryColor = normalizePrimaryColor(input.primaryColor);
    const gps = normalizeGps(input.gps);
    await this.assertPresetInOrg(orgId, input.defaultLoopPresetId);
    // INS-006: the audit row is written INSIDE the same transaction as the
    // business mutation, so the chain can never record a write that rolled back
    // (nor miss one that committed).
    return this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          orgId,
          name: input.name.trim(),
          kind: kind ?? 'THIRD_PARTY',
          logoUrl: input.logoUrl,
          primaryColor,
          branding: input.branding as object | undefined,
          defaultLoopPresetId: input.defaultLoopPresetId ?? undefined,
          address: input.address,
          gps: gpsWrite(gps),
          createdByUserId: actor.userId,
        },
      });
      await this.audit.append(
        {
          orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'company.created',
          entityType: 'Company',
          entityId: company.id,
          metadata: { name: company.name, kind: company.kind },
        },
        tx,
      );
      return company;
    });
  }

  async update(
    orgId: string,
    actor: AuthUser,
    id: string,
    input: UpdateCompanyInput,
  ) {
    // Validate before touching the DB (INS-071 / INS-077).
    const kind = normalizeKind(input.kind);
    const primaryColor = normalizePrimaryColor(input.primaryColor);
    const gps = normalizeGps(input.gps);
    await this.get(orgId, id);
    await this.assertPresetInOrg(orgId, input.defaultLoopPresetId);
    return this.prisma.$transaction(async (tx) => {
      const company = await tx.company.update({
        where: { id },
        data: {
          name: input.name?.trim(),
          kind,
          logoUrl: input.logoUrl,
          primaryColor,
          branding: input.branding as object | undefined,
          defaultLoopPresetId:
            input.defaultLoopPresetId === undefined
              ? undefined
              : input.defaultLoopPresetId,
          address: input.address,
          gps: gpsWrite(gps),
        },
      });
      await this.audit.append(
        {
          orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'company.updated',
          entityType: 'Company',
          entityId: id,
          // Which fields the caller actually supplied — enough to reconstruct
          // intent without copying (potentially large) branding blobs.
          metadata: { fields: Object.keys(input ?? {}).sort() },
        },
        tx,
      );
      return company;
    });
  }

  /**
   * Tenant-isolation guard (security review): a company's defaultLoopPresetId
   * must reference a preset in the SAME org. The DB FK only checks existence, so
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
    const company = await this.get(orgId, id);
    // Idempotent: re-archiving must not overwrite the original timestamp (INS-061).
    if (company.archivedAt) return company;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.company.update({
        where: { id },
        data: { archivedAt: new Date() },
      });
      await this.audit.append(
        {
          orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'company.archived',
          entityType: 'Company',
          entityId: id,
        },
        tx,
      );
      return updated;
    });
  }

  /** Archive is a reversible state, not a delete — restore clears it (INS-061). */
  async restore(orgId: string, actor: AuthUser, id: string) {
    const company = await this.get(orgId, id);
    if (!company.archivedAt) return company;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.company.update({
        where: { id },
        data: { archivedAt: null },
      });
      await this.audit.append(
        {
          orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'company.restored',
          entityType: 'Company',
          entityId: id,
        },
        tx,
      );
      return updated;
    });
  }
}
