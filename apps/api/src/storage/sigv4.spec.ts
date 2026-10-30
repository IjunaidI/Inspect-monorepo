import { presignS3PutUrl, presignS3Url, PresignOptions } from './sigv4';

const base: PresignOptions = {
  endpoint: 'http://localhost:9000',
  region: 'us-east-1',
  bucket: 'inspect-photos',
  key: 'orgs/o1/inspections/i1/photos/abc.jpg',
  accessKeyId: 'AKIA-TEST',
  secretAccessKey: 'secret-test',
  expiresSeconds: 900,
  now: new Date('2026-06-06T12:00:00.000Z'),
  forcePathStyle: true,
};

describe('presignS3PutUrl', () => {
  it('is deterministic for identical inputs', () => {
    expect(presignS3PutUrl(base)).toBe(presignS3PutUrl({ ...base }));
  });

  it('includes the required SigV4 query parameters and signature', () => {
    const url = presignS3PutUrl(base);
    expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
    expect(url).toContain('X-Amz-Credential=AKIA-TEST');
    expect(url).toContain('X-Amz-Date=20260606T120000Z');
    expect(url).toContain('X-Amz-Expires=900');
    expect(url).toContain('X-Amz-SignedHeaders=host');
    expect(url).toMatch(/X-Amz-Signature=[0-9a-f]{64}$/);
  });

  it('uses a path-style URI with the bucket and key', () => {
    expect(presignS3PutUrl(base)).toContain(
      'http://localhost:9000/inspect-photos/orgs/o1/inspections/i1/photos/abc.jpg?',
    );
  });

  it('changes the signature when the secret key changes', () => {
    const a = presignS3PutUrl(base);
    const b = presignS3PutUrl({ ...base, secretAccessKey: 'different' });
    expect(a).not.toBe(b);
  });

  it('changes the signature when the key (object path) changes', () => {
    const a = presignS3PutUrl(base);
    const b = presignS3PutUrl({
      ...base,
      key: 'orgs/o1/inspections/i1/photos/other.jpg',
    });
    expect(a).not.toBe(b);
  });
});

describe('presignS3Url method generalization (INS-049)', () => {
  it('defaults to PUT — presignS3PutUrl stays byte-identical', () => {
    expect(presignS3Url(base)).toBe(presignS3PutUrl(base));
  });

  it('GET-mode produces a different signature than PUT for the same inputs', () => {
    const put = presignS3Url({ ...base, method: 'PUT' });
    const get = presignS3Url({ ...base, method: 'GET' });
    expect(get).not.toBe(put);
    // Same canonical URI/query scaffold — only the signed method differs.
    expect(get.split('X-Amz-Signature=')[0]).toBe(
      put.split('X-Amz-Signature=')[0],
    );
    expect(get).toMatch(/X-Amz-Signature=[0-9a-f]{64}$/);
  });

  it('GET-mode is deterministic', () => {
    const opts: PresignOptions = { ...base, method: 'GET' };
    expect(presignS3Url(opts)).toBe(presignS3Url({ ...opts }));
  });
});

describe('virtual-hosted style (forcePathStyle: false)', () => {
  // AWS's published SigV4 query-string example ("Authenticating Requests:
  // Using Query Parameters"): GET examplebucket/test.txt. An independent
  // vector — if this passes, the signer agrees with S3 byte for byte.
  const aws: PresignOptions = {
    endpoint: 'https://s3.amazonaws.com',
    region: 'us-east-1',
    bucket: 'examplebucket',
    key: 'test.txt',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    expiresSeconds: 86400,
    now: new Date('2013-05-24T00:00:00.000Z'),
    forcePathStyle: false,
    method: 'GET',
  };

  it('matches the AWS reference presigned URL', () => {
    expect(presignS3Url(aws)).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt' +
        '?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
        '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request' +
        '&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host' +
        '&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('puts the bucket in the host, not the path', () => {
    const url = new URL(
      presignS3Url({
        ...base,
        endpoint: 'https://storage.railway.app',
        forcePathStyle: false,
      }),
    );
    expect(url.host).toBe('inspect-photos.storage.railway.app');
    expect(url.pathname).toBe('/orgs/o1/inspections/i1/photos/abc.jpg');
  });

  it('does not prefix the bucket twice when the endpoint already carries it', () => {
    const url = new URL(
      presignS3Url({
        ...base,
        endpoint: 'https://inspect-photos.storage.railway.app',
        forcePathStyle: false,
      }),
    );
    expect(url.host).toBe('inspect-photos.storage.railway.app');
  });
});
