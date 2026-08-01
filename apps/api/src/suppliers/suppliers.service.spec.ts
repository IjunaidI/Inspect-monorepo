import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SuppliersService, normalizeGps } from './suppliers.service';
import { AuthUser } from '../auth/auth-user';

/**
 * INS-071 — `gps` used to be typed `unknown` and written verbatim, so the
 * console's hand-typed JSON could silently save a supplier with no usable
 * coordinates. The API is the authority: bad input is a 400, good input is
 * canonicalised to exactly { lat, lng }.
 */
describe('normalizeGps (INS-071)', () => {
  it('passes through undefined (no change) and null (explicit clear)', () => {
    expect(normalizeGps(undefined)).toBeUndefined();
    expect(normalizeGps(null)).toBeNull();
  });

  it('accepts valid coordinates and strips extra keys', () => {
    expect(normalizeGps({ lat: 23.8103, lng: 90.4125, note: 'x' })).toEqual({
      lat: 23.8103,
      lng: 90.4125,
    });
  });

  it('accepts the boundary values', () => {
    expect(normalizeGps({ lat: -90, lng: -180 })).toEqual({ lat: -90, lng: -180 });
    expect(normalizeGps({ lat: 90, lng: 180 })).toEqual({ lat: 90, lng: 180 });
  });

  it('coerces unambiguous numeric strings (form inputs)', () => {
    expect(normalizeGps({ lat: '11.1085', lng: '77.3411' })).toEqual({
      lat: 11.1085,
      lng: 77.3411,
    });
  });

  it.each([
    ['a shapeless object', { foo: 1 }],
    ['a missing lng', { lat: 10 }],
    ['a missing lat', { lng: 10 }],
    ['a non-numeric string', { lat: 'north', lng: '5' }],
    ['an empty string', { lat: '', lng: '' }],
    ['NaN', { lat: NaN, lng: 0 }],
    ['Infinity', { lat: 0, lng: Infinity }],
    ['null members', { lat: null, lng: null }],
    ['a string body', 'lat=1,lng=2'],
    ['an array', [1, 2]],
    ['a number', 42],
  ])('rejects %s with a 400', (_label, value) => {
    expect(() => normalizeGps(value)).toThrow(BadRequestException);
  });

  it('rejects out-of-range coordinates', () => {
    expect(() => normalizeGps({ lat: 999, lng: 0 })).toThrow(BadRequestException);
    expect(() => normalizeGps({ lat: -90.1, lng: 0 })).toThrow(BadRequestException);
    expect(() => normalizeGps({ lat: 0, lng: 180.5 })).toThrow(BadRequestException);
    expect(() => normalizeGps({ lat: 0, lng: -200 })).toThrow(BadRequestException);
  });
});

describe('SuppliersService gps write path (INS-071)', () => {
  const ACTOR = { userId: 'u1', orgId: 'orgA', role: 'ORG_OWNER' } as unknown as AuthUser;

  function makeService() {
    const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 's1', ...data }));
    const update = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 's1', ...data }));
    const prisma = {
      supplier: { findFirst: jest.fn(async () => ({ id: 's1', orgId: 'orgA' })), create, update },
      // INS-006: writes audit inside their own transaction.
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    const audit = { append: jest.fn(async () => ({})) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new SuppliersService(prisma as any, audit as any);
    return { service, create, update, audit };
  }
  const dataOf = (mock: jest.Mock) => mock.mock.calls[0][0].data as Record<string, unknown>;

  it('create persists canonical coordinates', async () => {
    const { service, create } = makeService();
    await service.create('orgA', ACTOR, { name: 'Mill', gps: { lat: 11.1085, lng: 77.3411 } });
    expect(dataOf(create).gps).toEqual({ lat: 11.1085, lng: 77.3411 });
  });

  it('create rejects bad input instead of silently dropping it', async () => {
    const { service, create } = makeService();
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      service.create('orgA', ACTOR, { name: 'Mill', gps: { foo: 1 } as any }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('create without gps leaves the column unset', async () => {
    const { service, create } = makeService();
    await service.create('orgA', ACTOR, { name: 'Mill' });
    expect(dataOf(create).gps).toBeUndefined();
  });

  it('update rejects an out-of-range lat before touching the DB', async () => {
    const { service, update } = makeService();
    await expect(
      service.update('orgA', ACTOR, 's1', { gps: { lat: 999, lng: 0 } }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('update with gps null clears the column via Prisma.DbNull', async () => {
    const { service, update } = makeService();
    await service.update('orgA', ACTOR, 's1', { gps: null });
    expect(dataOf(update).gps).toBe(Prisma.DbNull);
  });

  it('update without gps is a no-change, not a clear', async () => {
    const { service, update } = makeService();
    await service.update('orgA', ACTOR, 's1', { name: 'Mill 2' });
    expect(dataOf(update).gps).toBeUndefined();
  });
});
