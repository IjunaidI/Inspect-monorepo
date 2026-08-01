/**
 * AWS Signature V4 presigned S3 PUT URL — dependency-free (node:crypto), so the
 * API can issue presigned upload URLs without the AWS SDK (spec §13: presigned
 * uploads, no base64 through the API). Works with S3 and MinIO (path-style).
 *
 * `now` is injectable for deterministic tests. The signer is exercised against a
 * real S3-compatible endpoint by test/integration/storage-bytes.e2e-spec.ts
 * (presigned PUT of real bytes + presigned GET round-trip), which CI runs with
 * REQUIRE_STORAGE=1 so that coverage cannot silently vanish.
 */
import { createHash, createHmac } from 'node:crypto';

export interface PresignOptions {
  endpoint: string; // e.g. http://localhost:9000
  region: string;
  bucket: string;
  key: string;
  accessKeyId: string;
  secretAccessKey: string;
  expiresSeconds: number;
  now: Date;
  forcePathStyle?: boolean; // true for MinIO and most non-AWS S3-compatible endpoints
  method?: 'GET' | 'PUT'; // default PUT (upload); GET presigns a download/view URL
}

function uriEncode(input: string, encodeSlash: boolean): string {
  let out = '';
  for (const byte of Buffer.from(input, 'utf8')) {
    const isUnreserved =
      (byte >= 0x41 && byte <= 0x5a) || // A-Z
      (byte >= 0x61 && byte <= 0x7a) || // a-z
      (byte >= 0x30 && byte <= 0x39) || // 0-9
      byte === 0x2d || // -
      byte === 0x2e || // .
      byte === 0x5f || // _
      byte === 0x7e; // ~
    if (isUnreserved) {
      out += String.fromCharCode(byte);
    } else if (byte === 0x2f && !encodeSlash) {
      out += '/';
    } else {
      out += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
    }
  }
  return out;
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

export function presignS3Url(opts: PresignOptions): string {
  const url = new URL(opts.endpoint);
  const host = url.host;
  const amzDate = opts.now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${opts.region}/s3/aws4_request`;

  // Path-style canonical URI (bucket in the path). Slashes in the key are kept.
  const canonicalUri = opts.forcePathStyle === false
    ? '/' + uriEncode(opts.key, false)
    : '/' + uriEncode(opts.bucket, false) + '/' + uriEncode(opts.key, false);

  const params: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${opts.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(opts.expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.keys(params)
    .sort()
    .map((k) => `${uriEncode(k, true)}=${uriEncode(params[k], true)}`)
    .join('&');

  const canonicalHeaders = `host:${host}\n`;
  const canonicalRequest = [
    opts.method ?? 'PUT',
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac('AWS4' + opts.secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, opts.region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  return `${url.protocol}//${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** Back-compat wrapper — the original upload-only entry point. */
export function presignS3PutUrl(opts: PresignOptions): string {
  return presignS3Url({ ...opts, method: 'PUT' });
}
