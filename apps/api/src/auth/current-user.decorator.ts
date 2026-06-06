import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from './auth-user';

/** Injects the authenticated principal attached by JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    return ctx.switchToHttp().getRequest().user as AuthUser;
  },
);
