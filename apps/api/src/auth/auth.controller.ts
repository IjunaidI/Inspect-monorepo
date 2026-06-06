import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { AuthService, TokenPair } from './auth.service';
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
  constructor(private readonly auth: AuthService) {}

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
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }
}
