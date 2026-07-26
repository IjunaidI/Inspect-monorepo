import { AuthUser } from '../auth/auth-user';
import { AuditActorType } from './audit.service';

/**
 * Who is really acting (INS-079). A Platform Admin operating inside an assumed
 * org must never be recorded as an ordinary member of that org — AuditService
 * folds actorType into payloadHash, so getting this right is what makes an
 * admin's in-tenant action tamper-evident rather than disguised.
 */
export function actorTypeFor(actor: Pick<AuthUser, 'actingAsOrgId'>): AuditActorType {
  return actor.actingAsOrgId ? 'PLATFORM_ADMIN' : 'USER';
}
