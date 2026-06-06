import { Role } from './rbac';

/** The authenticated principal attached to each request by JwtAuthGuard. */
export interface AuthUser {
  userId: string;
  orgId: string | null; // null for the cross-tenant Platform Admin
  role: Role;
}

export type TokenType = 'access' | 'refresh';
