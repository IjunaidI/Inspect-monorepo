import { generateKeyPair, sign, verify } from './signature';

describe('Ed25519 signature', () => {
  it('verifies a signature produced with the matching private key', () => {
    const { privateKey, publicKey } = generateKeyPair();
    const sig = sign('the-content-hash', privateKey);
    expect(verify('the-content-hash', sig, publicKey)).toBe(true);
  });

  it('rejects a tampered message', () => {
    const { privateKey, publicKey } = generateKeyPair();
    const sig = sign('the-content-hash', privateKey);
    expect(verify('THE-CONTENT-HASH', sig, publicKey)).toBe(false);
  });

  it('rejects a signature from a different key', () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    const sig = sign('msg', a.privateKey);
    expect(verify('msg', sig, b.publicKey)).toBe(false);
  });

  it('produces a base64 signature string', () => {
    const { privateKey } = generateKeyPair();
    expect(sign('msg', privateKey)).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});
