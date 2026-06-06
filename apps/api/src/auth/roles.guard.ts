import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { hasAtLeast, Role } from './rbac';

/**
 * Global guard: enforces the @Roles(min) additive requirement. Runs after
 * JwtAuthGuard, so request.user is populated. No @Roles => no role requirement.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) {
      return true;
    }
    const user = context.switchToHttp().getRequest().user as
      | { role?: Role }
      | undefined;
    if (!user?.role || !hasAtLeast(user.role, required)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
