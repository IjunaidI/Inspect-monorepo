import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService, TokenPair } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from './public.decorator';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from './auth-user';
import { authRateLimit } from '../common/throttler.config';

/**
 * INS-047: per-IP throttle for the unauthenticated credential surface. The
 * ThrottlerGuard keys on controller+handler, so /auth/login and /auth/refresh
 * each get their own budget; /auth/me (authenticated) is untouched.
 * Thunks, not literals: decorator metadata is frozen at import time, before
 * ConfigModule has loaded the repo-root .env into process.env.
 */
const authThrottle = {
  public: {
    ttl: () => authRateLimit().ttl,
    limit: () => authRateLimit().limit,
  },
};

interface LoginBody {
  email?: string;
  password?: string;
}
interface RefreshBody {
  refreshToken?: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle(authThrottle)
  @Post('login')
  login(@Body() body: LoginBody): Promise<TokenPair> {
    if (!body?.email || !body?.password) {
      throw new BadRequestException('email and password are required');
    }
    return this.auth.login(body.email, body.password);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle(authThrottle)
  @Post('refresh')
  refresh(@Body() body: RefreshBody): Promise<TokenPair> {
    if (!body?.refreshToken) {
      throw new BadRequestException('refreshToken is required');
    }
    return this.auth.refresh(body.refreshToken);
  }

  @Get('me')
  async me(
    @CurrentUser() user: AuthUser,
  ): Promise<AuthUser & { orgName: string | null }> {
    // The console shell shows the real workspace name (null for the cross-tenant
    // Platform Admin, which the web renders as "Platform").
    const org = user.orgId
      ? await this.prisma.organization.findUnique({
          where: { id: user.orgId },
          select: { name: true },
        })
      : null;
    return { ...user, orgName: org?.name ?? null };
  }
}
