import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { verifyPassword } from './password';
import { signJwt, verifyJwt } from './jwt';
import { Role } from './rbac';
import { AuthUser } from './auth-user';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get accessSecret(): string {
    return this.config.get<string>('JWT_ACCESS_SECRET') ?? 'dev-access-secret';
  }
  private get refreshSecret(): string {
    return this.config.get<string>('JWT_REFRESH_SECRET') ?? 'dev-refresh-secret';
  }
  private get accessTtl(): number {
    return Number(this.config.get('JWT_ACCESS_TTL_SECONDS') ?? 900);
  }
  private get refreshTtl(): number {
    return Number(this.config.get('JWT_REFRESH_TTL_SECONDS') ?? 2592000);
  }

  /** Returns the principal for valid credentials, or null. */
  async validateUser(email: string, password: string): Promise<AuthUser | null> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash || user.status !== 'ACTIVE') {
      return null;
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return null;
    }
    return { userId: user.id, orgId: user.orgId, role: user.role as Role };
  }

  issueTokens(user: AuthUser): TokenPair {
    const base = { sub: user.userId, orgId: user.orgId, role: user.role };
    return {
      accessToken: signJwt({ ...base, type: 'access' }, this.accessSecret, this.accessTtl),
      refreshToken: signJwt({ ...base, type: 'refresh' }, this.refreshSecret, this.refreshTtl),
    };
  }

  async login(email: string, password: string): Promise<TokenPair> {
    const user = await this.validateUser(email, password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    let claims: Record<string, unknown>;
    try {
      claims = verifyJwt(refreshToken, this.refreshSecret);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (claims.type !== 'refresh') {
      throw new UnauthorizedException('Not a refresh token');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: String(claims.sub) },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User is not active');
    }
    return this.issueTokens({
      userId: user.id,
      orgId: user.orgId,
      role: user.role as Role,
    });
  }
}
