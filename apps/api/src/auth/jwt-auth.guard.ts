import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { verifyJwt } from './jwt';
import { requireSecret } from './jwt-secret';
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
    const secret = requireSecret(this.config, 'JWT_ACCESS_SECRET');

    let claims: Record<string, unknown>;
    try {
      claims = verifyJwt(token, secret);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (claims.type !== 'access') {
      throw new UnauthorizedException('Not an access token');
    }

    // INS-079: a Platform Admin may name an org to operate inside via X-Org-Id.
    // Honored ONLY for a verified PLATFORM_ADMIN claim, and silently IGNORED for
    // every other role — rejecting it would confirm the header is meaningful.
    // This is not escalation: the admin is already the cross-tenant principal;
    // the header only selects a scope it already has.
    const role = claims.role as Role;
    const rawAssumed = req.headers?.['x-org-id'];
    const assumed = typeof rawAssumed === 'string' ? rawAssumed.trim() : '';
    const actingAsOrgId =
      role === 'PLATFORM_ADMIN' && assumed !== '' ? assumed : null;

    req.user = {
      userId: String(claims.sub),
      orgId: actingAsOrgId ?? ((claims.orgId ?? null) as string | null),
      role,
      actingAsOrgId,
    };
    return true;
  }
}
