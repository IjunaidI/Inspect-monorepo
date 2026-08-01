import { actorTypeFor } from './actor-type';
import { AuthUser } from '../auth/auth-user';

/** Only the two fields actorTypeFor reads. */
const actor = (role: string, actingAsOrgId: string | null) =>
  ({ role, actingAsOrgId } as unknown as Pick<AuthUser, 'actingAsOrgId' | 'role'>);

describe('actorTypeFor (INS-079, widened by INS-006)', () => {
  it('reports PLATFORM_ADMIN when acting inside an assumed org', () => {
    expect(actorTypeFor(actor('PLATFORM_ADMIN', 'org-1'))).toBe('PLATFORM_ADMIN');
  });

  /**
   * The populate console is @Roles('PLATFORM_ADMIN') and derives orgId from the
   * target inspection, so the admin writes a tenant's evidence WITHOUT assuming
   * an org. Keying on actingAsOrgId alone recorded those writes as an ordinary
   * org member — the INS-039 attribution hole, reopened.
   */
  it('reports PLATFORM_ADMIN for a cross-tenant admin with no assumed org', () => {
    expect(actorTypeFor(actor('PLATFORM_ADMIN', null))).toBe('PLATFORM_ADMIN');
  });

  it.each(['ORG_OWNER', 'QA_MANAGER', 'INSPECTOR'])('reports USER for %s', (role) => {
    expect(actorTypeFor(actor(role, null))).toBe('USER');
  });

  /**
   * Defence in depth: JwtAuthGuard ignores X-Org-Id for every non-admin role, so
   * an org principal can never arrive here with actingAsOrgId set. If one ever
   * did, this is the behaviour — it is documented rather than silently relied on.
   */
  it('an org role carrying actingAsOrgId is still not a real admin session', () => {
    expect(actorTypeFor(actor('ORG_OWNER', 'org-1'))).toBe('PLATFORM_ADMIN');
  });
});
