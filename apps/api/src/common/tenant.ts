import { ForbiddenException } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';

/**
 * Returns the caller's orgId, or throws if they have none. The Platform Admin
 * (orgId=null) is cross-tenant and must operate via admin/impersonation routes,
 * not the org-scoped workspace endpoints (spec §13).
 */
export function requireOrgId(user: AuthUser): string {
  if (!user || !user.orgId) {
    throw new ForbiddenException('This action requires an organization context');
  }
  return user.orgId;
}
