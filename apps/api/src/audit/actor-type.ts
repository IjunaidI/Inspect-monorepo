import { AuthUser } from '../auth/auth-user';
import { AuditActorType } from './audit.service';

/**
 * Who is really acting (INS-079, widened by INS-006).
 *
 * A Platform Admin acting inside a tenant must never be recorded as an ordinary
 * member of that tenant — `AuditService` folds `actorType` into `payloadHash`,
 * so getting this right is what makes an admin's in-tenant action tamper-evident
 * rather than disguised.
 *
 * The signal is the principal's ROLE, not whether they happened to assume an org:
 *   - org assumption (`actingAsOrgId`, INS-079) is one way an admin reaches a
 *     tenant — the console flow;
 *   - the populate console is the OTHER way: it is `@Roles('PLATFORM_ADMIN')` and
 *     derives orgId from the target inspection, so a genuine Platform Admin
 *     writes a tenant's evidence with `actingAsOrgId` still null. Keying on
 *     `actingAsOrgId` alone recorded those writes as `USER` — reopening exactly
 *     the attribution hole INS-039 closed.
 *
 * `actingAsOrgId` is retained as a signal because `JwtAuthGuard` only ever sets
 * it for a verified PLATFORM_ADMIN (it is ignored outright for every other role),
 * so it can never promote an org user.
 */
export function actorTypeFor(actor: Pick<AuthUser, 'actingAsOrgId' | 'role'>): AuditActorType {
  if (actor.role === 'PLATFORM_ADMIN') return 'PLATFORM_ADMIN';
  return actor.actingAsOrgId ? 'PLATFORM_ADMIN' : 'USER';
}
