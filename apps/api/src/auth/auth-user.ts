import { Role } from './rbac';

/** The authenticated principal attached to each request by JwtAuthGuard. */
export interface AuthUser {
  userId: string;
  orgId: string | null; // null for the cross-tenant Platform Admin
  role: Role;
  /**
   * Set ONLY when a Platform Admin is operating inside an assumed org (INS-079).
   * `orgId` then holds that org; this field is what distinguishes "admin acting
   * inside org X" from "a real member of org X" — audit attribution depends on it.
   */
  actingAsOrgId: string | null;
}

export type TokenType = 'access' | 'refresh';
