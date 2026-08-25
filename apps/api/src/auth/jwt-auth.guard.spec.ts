import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from './jwt-auth.guard';
import { signJwt } from './jwt';
import { Role } from './rbac';

const SECRET = 'test-access-secret-not-a-placeholder';

/** Minimal ExecutionContext double — only what JwtAuthGuard actually touches. */
function contextFor(headers: Record<string, string>) {
  const req: { headers: Record<string, string>; user?: any } = { headers };
  const ctx = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

function guard(): JwtAuthGuard {
  const reflector = { getAllAndOverride: () => false } as unknown as Reflector;
  const config = {
    get: (key: string) => (key === 'JWT_ACCESS_SECRET' ? SECRET : undefined),
  } as unknown as ConfigService;
  return new JwtAuthGuard(reflector, config);
}

function tokenFor(role: Role, orgId: string | null): string {
  return signJwt({ sub: 'user-1', orgId, role, type: 'access' }, SECRET, 900);
}

/** Express lowercases incoming header names, so the double must too. */
function headers(role: Role, orgId: string | null, assumed?: string) {
  const h: Record<string, string> = {
    authorization: `Bearer ${tokenFor(role, orgId)}`,
  };
  if (assumed !== undefined) h['x-org-id'] = assumed;
  return h;
}

describe('JwtAuthGuard — assumed org resolution (INS-079)', () => {
  it('honors X-Org-Id for a verified PLATFORM_ADMIN', () => {
    const { ctx, req } = contextFor(
      headers('PLATFORM_ADMIN', null, 'org-target'),
    );
    expect(guard().canActivate(ctx)).toBe(true);
    expect(req.user).toEqual({
      userId: 'user-1',
      orgId: 'org-target',
      role: 'PLATFORM_ADMIN',
      actingAsOrgId: 'org-target',
    });
  });

  // The tenant boundary: a non-admin must be completely unaffected by the header.
  it.each(['ORG_OWNER', 'QA_MANAGER', 'INSPECTOR'] as Role[])(
    "ignores X-Org-Id for %s — orgId stays the token's own",
    (role) => {
      const { ctx, req } = contextFor(
        headers(role, 'org-own', 'org-someone-else'),
      );
      expect(guard().canActivate(ctx)).toBe(true);
      expect(req.user.orgId).toBe('org-own');
      expect(req.user.actingAsOrgId).toBeNull();
    },
  );

  it('ignores the header silently — it must not throw for a non-admin', () => {
    const { ctx } = contextFor(headers('INSPECTOR', 'org-own', 'org-other'));
    expect(() => guard().canActivate(ctx)).not.toThrow();
  });

  it('leaves an admin with no header at orgId null', () => {
    const { ctx, req } = contextFor(headers('PLATFORM_ADMIN', null));
    expect(guard().canActivate(ctx)).toBe(true);
    expect(req.user.orgId).toBeNull();
    expect(req.user.actingAsOrgId).toBeNull();
  });

  it.each(['', '   '])(
    'treats a blank header (%p) as no assumption',
    (blank) => {
      const { ctx, req } = contextFor(headers('PLATFORM_ADMIN', null, blank));
      expect(guard().canActivate(ctx)).toBe(true);
      expect(req.user.orgId).toBeNull();
      expect(req.user.actingAsOrgId).toBeNull();
    },
  );

  it('trims surrounding whitespace on an assumed org id', () => {
    const { ctx, req } = contextFor(
      headers('PLATFORM_ADMIN', null, '  org-target  '),
    );
    expect(guard().canActivate(ctx)).toBe(true);
    expect(req.user.orgId).toBe('org-target');
  });

  it('sets actingAsOrgId null for an ordinary org principal', () => {
    const { ctx, req } = contextFor(headers('QA_MANAGER', 'org-own'));
    expect(guard().canActivate(ctx)).toBe(true);
    expect(req.user.actingAsOrgId).toBeNull();
  });

  // INS-036 regression: a token signed with the wrong secret is rejected before
  // any of the above matters, even when it claims PLATFORM_ADMIN.
  it('rejects a forged PLATFORM_ADMIN token regardless of the header', () => {
    const forged = signJwt(
      { sub: 'attacker', orgId: null, role: 'PLATFORM_ADMIN', type: 'access' },
      'wrong-secret',
      900,
    );
    const { ctx } = contextFor({
      authorization: `Bearer ${forged}`,
      'x-org-id': 'org-target',
    });
    expect(() => guard().canActivate(ctx)).toThrow('Invalid or expired token');
  });
});
