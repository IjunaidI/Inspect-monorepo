import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth-user';
import { AuditService } from '../audit/audit.service';
import { actorTypeFor } from '../audit/actor-type';

/**
 * The only shape a supplier's `gps` column may hold (INS-071). A type alias (not
 * an interface) so it stays assignable to Prisma's JSON input types.
 */
export type GpsCoordinates = { lat: number; lng: number };

export interface CreateSupplierInput {
  name: string;
  address?: string;
  gps?: GpsCoordinates | null;
}
export interface UpdateSupplierInput {
  name?: string;
  address?: string;
  gps?: GpsCoordinates | null;
}

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
 * the console's hand-typed JSON saved a supplier with no usable coordinates and
 * no error. Validate the structure here — the API is the authority — and return
 * a canonical `{ lat, lng }` with any extra keys stripped.
 *
 * `undefined` = field absent (no change); `null` = explicit clear.
 */
export function normalizeGps(value: unknown): GpsCoordinates | null | undefined {
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
    throw new BadRequestException(`gps.lat must be between -90 and 90 (got ${lat})`);
  }
  if (lng < -180 || lng > 180) {
    throw new BadRequestException(`gps.lng must be between -180 and 180 (got ${lng})`);
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

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(orgId: string, opts: { includeArchived?: boolean; q?: string; take?: number; skip?: number } = {}) {
    return this.prisma.supplier.findMany({
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
        _count: { select: { purchaseOrders: true, inspections: true } },
      },
    });
  }

  async get(orgId: string, id: string) {
    const row = await this.prisma.supplier.findFirst({ where: { id, orgId } });
    if (!row) {
      throw new NotFoundException('Supplier not found');
    }
    return row;
  }

  // async so a validation failure surfaces as a rejected promise rather than a
  // synchronous throw — callers (and specs) treat every write path uniformly.
  async create(orgId: string, actor: AuthUser, input: CreateSupplierInput) {
    if (!input?.name?.trim()) {
      throw new BadRequestException('name is required');
    }
    const gps = normalizeGps(input.gps);
    // INS-006: audit inside the business transaction.
    return this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.create({
        data: {
          orgId,
          name: input.name.trim(),
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
          action: 'supplier.created',
          entityType: 'Supplier',
          entityId: supplier.id,
          metadata: { name: supplier.name },
        },
        tx,
      );
      return supplier;
    });
  }

  async update(orgId: string, actor: AuthUser, id: string, input: UpdateSupplierInput) {
    // Validate before touching the DB (INS-071).
    const gps = normalizeGps(input.gps);
    await this.get(orgId, id);
    return this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.update({
        where: { id },
        data: {
          name: input.name?.trim(),
          address: input.address,
          gps: gpsWrite(gps),
        },
      });
      await this.audit.append(
        {
          orgId,
          actorType: actorTypeFor(actor),
          actorUserId: actor.userId,
          action: 'supplier.updated',
          entityType: 'Supplier',
          entityId: id,
          metadata: { fields: Object.keys(input ?? {}).sort() },
        },
        tx,
      );
      return supplier;
    });
  }

  async archive(orgId: string, actor: AuthUser, id: string) {
    const supplier = await this.get(orgId, id);
    // Idempotent: re-archiving must not overwrite the original timestamp (INS-061).
    if (supplier.archivedAt) return supplier;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.supplier.update({ where: { id }, data: { archivedAt: new Date() } });
      await this.audit.append(
        { orgId, actorType: actorTypeFor(actor), actorUserId: actor.userId, action: 'supplier.archived', entityType: 'Supplier', entityId: id },
        tx,
      );
      return updated;
    });
  }

  /** Archive is a reversible state, not a delete — restore clears it (INS-061). */
  async restore(orgId: string, actor: AuthUser, id: string) {
    const supplier = await this.get(orgId, id);
    if (!supplier.archivedAt) return supplier;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.supplier.update({ where: { id }, data: { archivedAt: null } });
      await this.audit.append(
        { orgId, actorType: actorTypeFor(actor), actorUserId: actor.userId, action: 'supplier.restored', entityType: 'Supplier', entityId: id },
        tx,
      );
      return updated;
    });
  }
}
