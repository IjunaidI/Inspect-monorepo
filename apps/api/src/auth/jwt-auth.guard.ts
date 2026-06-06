import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { verifyJwt } from './jwt';
import { IS_PUBLIC_KEY } from './public.decorator';
import { Role } from './rbac';

/**
 * Global guard: verifies the Bearer access token and attaches the principal to
 * the request. Routes marked @Public() bypass it. The API is the RBAC authority
 * keyed off orgId + role (spec §13).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice('Bearer '.length);
    const secret = this.config.get<string>('JWT_ACCESS_SECRET') ?? 'dev-access-secret';

    let claims: Record<string, unknown>;
    try {
      claims = verifyJwt(token, secret);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (claims.type !== 'access') {
      throw new UnauthorizedException('Not an access token');
    }

    req.user = {
      userId: String(claims.sub),
      orgId: (claims.orgId ?? null) as string | null,
      role: claims.role as Role,
    };
    return true;
  }
}
