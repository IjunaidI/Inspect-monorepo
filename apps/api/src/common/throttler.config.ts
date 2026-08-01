/**
 * INS-047 — env-backed rate-limit config for the PUBLIC (unauthenticated) routes.
 *
 * Why this file exists (mirrors `common/config.ts`): the limits must be tunable
 * per environment without a redeploy-time code change, and they must stay *pure*
 * so they can be unit-tested without booting Nest.
 *
 * WHERE IT IS APPLIED: `ThrottlerGuard` is deliberately NOT registered as an
 * `APP_GUARD`. It is attached per-route to the handful of `@Public()` endpoints
 * that an unauthenticated attacker can reach (auth login/refresh, invitation
 * lookup/accept, guest report reads). Authenticated routes are already gated by
 * `JwtAuthGuard` + `RolesGuard` and stay un-throttled.
 *
 * HOW THE VALUES ARE READ: every getter reads `process.env` on each call, and the
 * Nest wiring passes them as `Resolvable` thunks (`() => authRateLimit().limit`).
 * Decorator metadata is frozen at *import* time, which is before ConfigModule
 * populates `process.env` from the repo-root `.env` — resolving lazily is what
 * makes the values actually configurable (and lets a spec set a low limit before
 * `bootApp()`).
 *
 * Env vars (all optional; defaults below):
 *   RATE_LIMIT_DISABLED         kill switch: 1/true/yes/on disables throttling entirely
 *   RATE_LIMIT_AUTH_LIMIT       POST /auth/login, POST /auth/refresh   (default 30)
 *   RATE_LIMIT_AUTH_TTL_MS      window for the above                  (default 60000)
 *   RATE_LIMIT_INVITE_LIMIT     POST /invitations/accept, GET /invitations/:token (default 30)
 *   RATE_LIMIT_INVITE_TTL_MS    window for the above                  (default 60000)
 *   RATE_LIMIT_GUEST_LIMIT      GET /guest/reports[/:id]              (default 120)
 *   RATE_LIMIT_GUEST_TTL_MS     window for the above                  (default 60000)
 *   RATE_LIMIT_TRUSTED_PROXIES  number of reverse proxies in front of the API (default 0)
 *
 * On the defaults: each *handler* gets its own counter (the guard's key includes
 * the controller + handler name), so 30/min is 30 login attempts per IP per
 * minute — loose enough that the DB-backed integration suite (worst single spec
 * file: 9 logins) cannot trip it, tight enough that bulk credential stuffing from
 * one address dies. Production should tighten to `RATE_LIMIT_AUTH_LIMIT=10`.
 */

/** A single rate-limit bucket: at most `limit` requests per `ttl` ms per client IP. */
export interface RateLimitRule {
  /** Window length in milliseconds. */
  ttl: number;
  /** Max requests per client IP per window. */
  limit: number;
}

const DEFAULT_TTL_MS = 60_000;

/** Local copy of the `common/config.ts` idiom (that helper is not exported). */
function positiveIntEnv(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeIntEnv(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function boolEnv(name: string, fallback = false): boolean {
  const raw = (process.env[name] ?? '').trim().toLowerCase();
  if (raw === '') return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function rule(prefix: string, limitFallback: number): RateLimitRule {
  return {
    ttl: positiveIntEnv(`RATE_LIMIT_${prefix}_TTL_MS`, DEFAULT_TTL_MS),
    limit: positiveIntEnv(`RATE_LIMIT_${prefix}_LIMIT`, limitFallback),
  };
}

/** Global kill switch. Env: RATE_LIMIT_DISABLED, default false (throttling ON). */
export function rateLimitDisabled(): boolean {
  return boolEnv('RATE_LIMIT_DISABLED');
}

/** Credential-stuffing surface: POST /auth/login + POST /auth/refresh. */
export function authRateLimit(): RateLimitRule {
  return rule('AUTH', 30);
}

/** Invitation-token guessing surface (INS-037): accept + public lookup. */
export function inviteRateLimit(): RateLimitRule {
  return rule('INVITE', 30);
}

/** Buyer-guest magic-link report reads — legitimately chattier than auth. */
export function guestRateLimit(): RateLimitRule {
  return rule('GUEST', 120);
}

/**
 * How many reverse proxies sit between the public internet and this process.
 * Env: RATE_LIMIT_TRUSTED_PROXIES, default 0 (the API is addressed directly).
 */
export function trustedProxyHops(): number {
  return nonNegativeIntEnv('RATE_LIMIT_TRUSTED_PROXIES', 0);
}

/** Minimal shape of the request objects we read an IP from (Express-compatible). */
export interface RequestIpSource {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

/** `::ffff:127.0.0.1` → `127.0.0.1`; also trims surrounding whitespace. */
export function normalizeIp(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return s.toLowerCase().startsWith('::ffff:') ? s.slice('::ffff:'.length) : s;
}

/**
 * Resolve the client IP used as the throttle key.
 *
 * `main.ts` never calls `app.set('trust proxy', …)`, so Express's `req.ip` is
 * always the socket peer — which behind a proxy is the *proxy*, collapsing every
 * client into one bucket. We therefore resolve it ourselves:
 *
 *   - `hops === 0` (default): trust nobody, use the socket peer. Correct for a
 *     directly-addressed API and for the in-process test suite.
 *   - `hops === n > 0`: `n` proxies we control each appended the peer they saw to
 *     `X-Forwarded-For`, so the right-most `n` entries are trustworthy and the
 *     real client is `xff[xff.length - n]`.
 *
 * Counting from the RIGHT is what makes this spoof-resistant: a client that sends
 * its own `X-Forwarded-For: 1.2.3.4` only *prepends* to the chain, and our proxy
 * still appends the true peer to the right of it. Taking the *leftmost* entry —
 * the common shortcut — would let anyone mint a fresh bucket per request.
 */
export function clientIpFromRequest(
  req: RequestIpSource | undefined,
  hops: number = trustedProxyHops(),
): string {
  const direct = normalizeIp(req?.ip ?? req?.socket?.remoteAddress);
  if (hops <= 0) {
    return direct || 'unknown';
  }
  const raw = req?.headers?.['x-forwarded-for'];
  const chain = (Array.isArray(raw) ? raw.join(',') : (raw ?? ''))
    .split(',')
    .map(normalizeIp)
    .filter((s) => s !== '');
  const index = chain.length - hops;
  if (chain.length === 0 || index < 0) {
    // Either no header at all, or the chain is shorter than the configured hop
    // count (over-trust / misconfiguration). Fall back to the socket peer, which
    // is the one address an attacker cannot forge.
    return direct || 'unknown';
  }
  return chain[index] || direct || 'unknown';
}
