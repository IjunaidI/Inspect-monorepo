import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { AuthService, TokenPair } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from './public.decorator';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from './auth-user';

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
  @Post('login')
  login(@Body() body: LoginBody): Promise<TokenPair> {
    if (!body?.email || !body?.password) {
      throw new BadRequestException('email and password are required');
    }
    return this.auth.login(body.email, body.password);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() body: RefreshBody): Promise<TokenPair> {
    if (!body?.refreshToken) {
      throw new BadRequestException('refreshToken is required');
    }
    return this.auth.refresh(body.refreshToken);
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser): Promise<AuthUser & { orgName: string | null }> {
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
