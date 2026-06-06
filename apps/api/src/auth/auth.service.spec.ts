import { AuthService } from './auth.service';
import { hashPassword } from './password';
import { verifyJwt } from './jwt';

const SECRETS: Record<string, unknown> = {
  JWT_ACCESS_SECRET: 'access-secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  JWT_ACCESS_TTL_SECONDS: 900,
  JWT_REFRESH_TTL_SECONDS: 100000,
};

function makeService(user: Record<string, unknown> | null) {
  const prisma = {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
        if (!user) return null;
        if (where.email !== undefined) return user.email === where.email ? user : null;
        if (where.id !== undefined) return user.id === where.id ? user : null;
        return null;
      }),
    },
  };
  const config = { get: (k: string) => SECRETS[k] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new AuthService(prisma as any, config as any);
}

describe('AuthService', () => {
  let activeUser: Record<string, unknown>;

  beforeAll(async () => {
    activeUser = {
      id: 'u1',
      email: 'qa@org.com',
      passwordHash: await hashPassword('correct-pw'),
      role: 'QA_MANAGER',
      orgId: 'org1',
      status: 'ACTIVE',
    };
  });

  describe('validateUser', () => {
    it('returns null for an unknown email', async () => {
      expect(await makeService(null).validateUser('x@y.com', 'pw')).toBeNull();
    });

    it('returns null for a wrong password', async () => {
      expect(await makeService(activeUser).validateUser('qa@org.com', 'wrong')).toBeNull();
    });

    it('returns null for a non-active user', async () => {
      const svc = makeService({ ...activeUser, status: 'INVITED' });
      expect(await svc.validateUser('qa@org.com', 'correct-pw')).toBeNull();
    });

    it('returns the principal for valid credentials', async () => {
      const principal = await makeService(activeUser).validateUser('qa@org.com', 'correct-pw');
      expect(principal).toEqual({ userId: 'u1', orgId: 'org1', role: 'QA_MANAGER' });
    });
  });

  describe('issueTokens', () => {
    it('issues an access token carrying sub/orgId/role', () => {
      const { accessToken } = makeService(activeUser).issueTokens({
        userId: 'u1',
        orgId: 'org1',
        role: 'QA_MANAGER',
      });
      const claims = verifyJwt(accessToken, 'access-secret');
      expect(claims.sub).toBe('u1');
      expect(claims.orgId).toBe('org1');
      expect(claims.role).toBe('QA_MANAGER');
      expect(claims.type).toBe('access');
    });
  });

  describe('login', () => {
    it('throws on bad credentials', async () => {
      await expect(makeService(activeUser).login('qa@org.com', 'nope')).rejects.toThrow();
    });

    it('returns a token pair on success', async () => {
      const pair = await makeService(activeUser).login('qa@org.com', 'correct-pw');
      expect(pair.accessToken).toBeTruthy();
      expect(pair.refreshToken).toBeTruthy();
    });
  });

  describe('refresh', () => {
    it('rejects an access token used as a refresh token', async () => {
      const svc = makeService(activeUser);
      const { accessToken } = svc.issueTokens({ userId: 'u1', orgId: 'org1', role: 'QA_MANAGER' });
      await expect(svc.refresh(accessToken)).rejects.toThrow();
    });

    it('issues fresh tokens for a valid refresh token', async () => {
      const svc = makeService(activeUser);
      const { refreshToken } = svc.issueTokens({ userId: 'u1', orgId: 'org1', role: 'QA_MANAGER' });
      const pair = await svc.refresh(refreshToken);
      expect(pair.accessToken).toBeTruthy();
      expect(verifyJwt(pair.accessToken, 'access-secret').sub).toBe('u1');
    });
  });
});
