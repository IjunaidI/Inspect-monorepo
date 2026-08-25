import { signJwt, verifyJwt } from './jwt';

const SECRET = 'test-secret';
const T0 = 1_000_000; // fixed "now" (seconds) for determinism

describe('HS256 JWT', () => {
  it('round-trips claims and stamps iat/exp', () => {
    const token = signJwt({ sub: 'u1', role: 'QA_MANAGER' }, SECRET, 3600, T0);
    const payload = verifyJwt(token, SECRET, T0);
    expect(payload.sub).toBe('u1');
    expect(payload.role).toBe('QA_MANAGER');
    expect(payload.iat).toBe(T0);
    expect(payload.exp).toBe(T0 + 3600);
  });

  it('rejects a tampered payload', () => {
    const token = signJwt({ sub: 'u1' }, SECRET, 3600, T0);
    const [h, , s] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: 'admin', exp: T0 + 3600 }),
    ).toString('base64url');
    expect(() => verifyJwt(`${h}.${forged}.${s}`, SECRET, T0)).toThrow();
  });

  it('rejects a wrong secret', () => {
    const token = signJwt({ sub: 'u1' }, SECRET, 3600, T0);
    expect(() => verifyJwt(token, 'other-secret', T0)).toThrow();
  });

  it('rejects an expired token', () => {
    const token = signJwt({ sub: 'u1' }, SECRET, 100, T0);
    expect(() => verifyJwt(token, SECRET, T0 + 101)).toThrow(/expired/i);
  });

  it('accepts a token within its validity window', () => {
    const token = signJwt({ sub: 'u1' }, SECRET, 100, T0);
    expect(verifyJwt(token, SECRET, T0 + 99).sub).toBe('u1');
  });

  it('rejects a malformed token', () => {
    expect(() => verifyJwt('not.a.jwt.token', SECRET, T0)).toThrow();
  });
});
