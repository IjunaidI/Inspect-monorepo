/**
 * Ed25519 signing for the tamper-proof report seal (spec §9). Uses Node's
 * built-in crypto — no external dependency. The platform holds the private key;
 * the public key powers independent verification (the public verification page).
 */
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';

export interface Ed25519KeyPairPem {
  publicKey: string;
  privateKey: string;
}

/** Generate an Ed25519 key pair as PEM strings (SPKI public, PKCS8 private). */
export function generateKeyPair(): Ed25519KeyPairPem {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

/** Sign a message (typically a content hash) and return a base64 signature. */
export function sign(message: string, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  // Ed25519 takes a null algorithm (it hashes internally).
  return cryptoSign(null, Buffer.from(message, 'utf8'), key).toString('base64');
}

/** Verify a base64 Ed25519 signature against a message and public key. */
export function verify(
  message: string,
  signatureBase64: string,
  publicKeyPem: string,
): boolean {
  try {
    const key = createPublicKey(publicKeyPem);
    return cryptoVerify(
      null,
      Buffer.from(message, 'utf8'),
      key,
      Buffer.from(signatureBase64, 'base64'),
    );
  } catch {
    return false;
  }
}
