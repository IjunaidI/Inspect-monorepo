import {
  authRateLimit,
  clientIpFromRequest,
  guestRateLimit,
  inviteRateLimit,
  normalizeIp,
  rateLimitDisabled,
  trustedProxyHops,
} from './throttler.config';

describe('rate-limit config helpers (INS-047)', () => {
  const OLD_ENV = process.env;
  afterEach(() => {
    process.env = OLD_ENV;
  });

  /** Every RATE_LIMIT_* var cleared, so a real repo-root .env cannot skew a default. */
  function cleanEnv(overrides: Record<string, string> = {}): void {
    const next: Record<string, string | undefined> = { ...OLD_ENV };
    for (const key of Object.keys(next)) {
      if (key.startsWith('RATE_LIMIT_')) delete next[key];
    }
    process.env = { ...next, ...overrides } as NodeJS.ProcessEnv;
  }

  describe('bucket defaults', () => {
    it('defaults to production-sane per-minute windows', () => {
      cleanEnv();
      expect(authRateLimit()).toEqual({ ttl: 60_000, limit: 30 });
      expect(inviteRateLimit()).toEqual({ ttl: 60_000, limit: 30 });
      // Guest report reads are legitimately chattier than auth.
      expect(guestRateLimit()).toEqual({ ttl: 60_000, limit: 120 });
    });

    it('reads each bucket from its own env pair', () => {
      cleanEnv({
        RATE_LIMIT_AUTH_LIMIT: '10',
        RATE_LIMIT_AUTH_TTL_MS: '30000',
        RATE_LIMIT_INVITE_LIMIT: '5',
        RATE_LIMIT_INVITE_TTL_MS: '15000',
        RATE_LIMIT_GUEST_LIMIT: '200',
        RATE_LIMIT_GUEST_TTL_MS: '90000',
      });
      expect(authRateLimit()).toEqual({ ttl: 30_000, limit: 10 });
      expect(inviteRateLimit()).toEqual({ ttl: 15_000, limit: 5 });
      expect(guestRateLimit()).toEqual({ ttl: 90_000, limit: 200 });
    });

    it('buckets are independent — tightening auth never touches guest', () => {
      cleanEnv({ RATE_LIMIT_AUTH_LIMIT: '1' });
      expect(authRateLimit().limit).toBe(1);
      expect(inviteRateLimit().limit).toBe(30);
      expect(guestRateLimit().limit).toBe(120);
    });

    it('falls back on garbage, zero or negative values (never unlimited)', () => {
      cleanEnv({ RATE_LIMIT_AUTH_LIMIT: 'lots', RATE_LIMIT_AUTH_TTL_MS: 'soon' });
      expect(authRateLimit()).toEqual({ ttl: 60_000, limit: 30 });
      cleanEnv({ RATE_LIMIT_AUTH_LIMIT: '0', RATE_LIMIT_AUTH_TTL_MS: '-5' });
      expect(authRateLimit()).toEqual({ ttl: 60_000, limit: 30 });
    });

    it('reads process.env on every call, not once at import', () => {
      cleanEnv();
      expect(authRateLimit().limit).toBe(30);
      process.env.RATE_LIMIT_AUTH_LIMIT = '2';
      expect(authRateLimit().limit).toBe(2);
    });
  });

  describe('rateLimitDisabled', () => {
    it('is off by default — throttling is fail-closed', () => {
      cleanEnv();
      expect(rateLimitDisabled()).toBe(false);
    });

    it('accepts the usual truthy spellings', () => {
      for (const value of ['1', 'true', 'TRUE', 'yes', 'on', ' true ']) {
        cleanEnv({ RATE_LIMIT_DISABLED: value });
        expect(rateLimitDisabled()).toBe(true);
      }
    });

    it('treats anything else (incl. "0"/"false"/empty) as enabled', () => {
      for (const value of ['0', 'false', 'no', 'off', '', 'maybe']) {
        cleanEnv({ RATE_LIMIT_DISABLED: value });
        expect(rateLimitDisabled()).toBe(false);
      }
    });
  });

  describe('trustedProxyHops', () => {
    it('defaults to 0 (trust nobody)', () => {
      cleanEnv();
      expect(trustedProxyHops()).toBe(0);
    });

    it('reads RATE_LIMIT_TRUSTED_PROXIES and allows an explicit 0', () => {
      cleanEnv({ RATE_LIMIT_TRUSTED_PROXIES: '2' });
      expect(trustedProxyHops()).toBe(2);
      cleanEnv({ RATE_LIMIT_TRUSTED_PROXIES: '0' });
      expect(trustedProxyHops()).toBe(0);
    });

    it('falls back to 0 on garbage or a negative count', () => {
      cleanEnv({ RATE_LIMIT_TRUSTED_PROXIES: 'two' });
      expect(trustedProxyHops()).toBe(0);
      cleanEnv({ RATE_LIMIT_TRUSTED_PROXIES: '-1' });
      expect(trustedProxyHops()).toBe(0);
    });
  });

  describe('normalizeIp', () => {
    it('unwraps IPv4-mapped IPv6 and trims', () => {
      expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
      expect(normalizeIp('  203.0.113.9 ')).toBe('203.0.113.9');
      expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
    });

    it('returns an empty string for non-strings', () => {
      expect(normalizeIp(undefined)).toBe('');
      expect(normalizeIp(null)).toBe('');
      expect(normalizeIp(42)).toBe('');
    });
  });

  describe('clientIpFromRequest', () => {
    it('uses the socket peer when no proxy is trusted, ignoring X-Forwarded-For', () => {
      const req = {
        ip: '::ffff:198.51.100.7',
        headers: { 'x-forwarded-for': '1.2.3.4' },
      };
      expect(clientIpFromRequest(req, 0)).toBe('198.51.100.7');
    });

    it('falls back to socket.remoteAddress when req.ip is absent', () => {
      expect(clientIpFromRequest({ socket: { remoteAddress: '10.0.0.5' } }, 0)).toBe('10.0.0.5');
    });

    it('resolves the real client through one trusted proxy', () => {
      const req = {
        ip: '10.0.0.1', // the proxy
        headers: { 'x-forwarded-for': '203.0.113.9' },
      };
      expect(clientIpFromRequest(req, 1)).toBe('203.0.113.9');
    });

    it('resolves the real client through two trusted proxies', () => {
      const req = {
        ip: '10.0.0.2',
        headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
      };
      expect(clientIpFromRequest(req, 2)).toBe('203.0.113.9');
    });

    it('is spoof-resistant: a client-supplied XFF prefix cannot mint a fresh bucket', () => {
      // Attacker sends "X-Forwarded-For: 9.9.9.9"; our single proxy appends the
      // real peer to the RIGHT, so counting from the right still finds it.
      const req = {
        ip: '10.0.0.1',
        headers: { 'x-forwarded-for': '9.9.9.9, 203.0.113.9' },
      };
      expect(clientIpFromRequest(req, 1)).toBe('203.0.113.9');

      // A longer forged prefix does not help either.
      const longer = {
        ip: '10.0.0.1',
        headers: { 'x-forwarded-for': 'a.a.a.a, b.b.b.b, c.c.c.c, 203.0.113.9' },
      };
      expect(clientIpFromRequest(longer, 1)).toBe('203.0.113.9');
    });

    it('falls back to the socket peer when the chain is shorter than the hop count', () => {
      const req = { ip: '10.0.0.9', headers: { 'x-forwarded-for': '203.0.113.9' } };
      expect(clientIpFromRequest(req, 3)).toBe('10.0.0.9');
    });

    it('falls back to the socket peer when the header is missing or blank', () => {
      expect(clientIpFromRequest({ ip: '10.0.0.9', headers: {} }, 1)).toBe('10.0.0.9');
      expect(
        clientIpFromRequest({ ip: '10.0.0.9', headers: { 'x-forwarded-for': ' , ' } }, 1),
      ).toBe('10.0.0.9');
    });

    it('handles a repeated (array) X-Forwarded-For header', () => {
      const req = {
        ip: '10.0.0.2',
        headers: { 'x-forwarded-for': ['203.0.113.9', '10.0.0.1'] },
      };
      expect(clientIpFromRequest(req, 2)).toBe('203.0.113.9');
    });

    it('never returns an empty key — an unknown peer still shares one bucket', () => {
      expect(clientIpFromRequest(undefined, 0)).toBe('unknown');
      expect(clientIpFromRequest({}, 1)).toBe('unknown');
    });

    it('reads RATE_LIMIT_TRUSTED_PROXIES when no hop count is passed', () => {
      const req = { ip: '10.0.0.1', headers: { 'x-forwarded-for': '203.0.113.9' } };
      cleanEnv();
      expect(clientIpFromRequest(req)).toBe('10.0.0.1');
      cleanEnv({ RATE_LIMIT_TRUSTED_PROXIES: '1' });
      expect(clientIpFromRequest(req)).toBe('203.0.113.9');
    });
  });
});
