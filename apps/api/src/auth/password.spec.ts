import { hashPassword, verifyPassword } from './password';

describe('password hashing (scrypt)', () => {
  it('verifies a correct password against its hash', async () => {
    const stored = await hashPassword('s3cret-pw');
    expect(await verifyPassword('s3cret-pw', stored)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const stored = await hashPassword('s3cret-pw');
    expect(await verifyPassword('wrong-pw', stored)).toBe(false);
  });

  it('produces a different hash each time (random salt)', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('returns false for a malformed stored value', async () => {
    expect(await verifyPassword('x', 'not-a-valid-hash')).toBe(false);
  });

  it('uses the scrypt$N$r$p$salt$hash envelope', async () => {
    const stored = await hashPassword('x');
    expect(stored.split('$')).toHaveLength(6);
    expect(stored.startsWith('scrypt$')).toBe(true);
  });
});
