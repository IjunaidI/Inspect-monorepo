import { SetMetadata } from '@nestjs/common';
import { Role } from './rbac';

export const ROLES_KEY = 'requiredRole';

/** Requires the caller's role to be at least `role` (additive hierarchy, spec §4). */
export const Roles = (role: Role) => SetMetadata(ROLES_KEY, role);
