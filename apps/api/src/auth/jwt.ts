/**
 * Minimal HS256 JWT using node:crypto HMAC — no external dependency. Used to
 * issue access/refresh tokens carrying `sub`, `orgId`, `role`. A later phase may
 * wrap this in `@nestjs/jwt` behind the same shape if desired.
 *
 * `now` (epoch seconds) is injectable so tests are deterministic.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface JwtPayload {
  [claim: string]: unknown;
  iat?: number;
  exp?: number;
}

function encodeSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function signJwt(
  payload: JwtPayload,
  secret: string,
  expiresInSeconds: number,
  now: number = nowSeconds(),
): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const body: JwtPayload = { ...payload, iat: now, exp: now + expiresInSeconds };
  const signingInput = `${encodeSegment(header)}.${encodeSegment(body)}`;
  const signature = createHmac('sha256', secret).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

export function verifyJwt(
  token: string,
  secret: string,
  now: number = nowSeconds(),
): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed JWT');
  }
  const [headerB64, bodyB64, signature] = parts;
  const expected = createHmac('sha256', secret)
    .update(`${headerB64}.${bodyB64}`)
    .digest('base64url');

  const got = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    throw new Error('Invalid JWT signature');
  }

  let payload: JwtPayload;
  try {
    payload = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Malformed JWT payload');
  }

  if (typeof payload.exp === 'number' && now >= payload.exp) {
    throw new Error('JWT expired');
  }
  return payload;
}
