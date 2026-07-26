import { actorTypeFor } from './actor-type';

describe('actorTypeFor (INS-079)', () => {
  it('reports PLATFORM_ADMIN when acting inside an assumed org', () => {
    expect(actorTypeFor({ actingAsOrgId: 'org-1' })).toBe('PLATFORM_ADMIN');
  });

  it('reports USER for an ordinary org principal', () => {
    expect(actorTypeFor({ actingAsOrgId: null })).toBe('USER');
  });
});
