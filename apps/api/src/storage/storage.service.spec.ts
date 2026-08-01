/**
 * INS-060 — presign must reject PLACEHOLDER configuration, not just empty
 * configuration. `.env.example` ships S3_ACCESS_KEY_ID="CHANGE_ME"; the old guard
 * only checked for emptiness, so a fresh deployment minted perfectly-formed,
 * permanently-broken presigned URLs and the failure only surfaced as a 403 from
 * the storage provider, long after the inspector had "uploaded" a photo.
 *
 * Plus INS-003 coverage for the report-PDF key + the server-side upload path.
 */
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { StorageService, looksLikePlaceholder } from './storage.service';

const REAL = {
  S3_ENDPOINT: 'https://fly.storage.tigris.dev',
  S3_REGION: 'auto',
  S3_BUCKET: 'inspect-photos',
  S3_ACCESS_KEY_ID: 'tid_ARealLookingAccessKey',
  S3_SECRET_ACCESS_KEY: 'tsec_ARealLookingSecretValue0123456789',
};

function makeService(overrides: Record<string, unknown> = {}): StorageService {
  return new StorageService(new ConfigService({ ...REAL, ...overrides }));
}

describe('looksLikePlaceholder (INS-060)', () => {
  it.each([
    'CHANGE_ME',
    'change_me',
    'Change-Me',
    'changeme',
    'please CHANGE_ME before deploying',
    'REPLACE_ME',
    'fill-me-in',
    'placeholder',
    'your-access-key',
    'YOUR_SECRET_HERE',
    '${{ Bucket.SECRET_ACCESS_KEY }}',
    '${S3_SECRET}',
    '<access-key-id>',
    'https://<your-endpoint>',
    'xxxxxxxx',
    'TODO',
    'tbd',
    'undefined',
  ])('flags %p as a placeholder', (value) => {
    expect(looksLikePlaceholder(value)).toBe(true);
  });

  it.each([
    'tid_ARealLookingAccessKey',
    'AKIAIOSFODNN7EXAMPLE',
    'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    'inspect-photos',
    'https://fly.storage.tigris.dev',
    'http://localhost:9000',
    'us-east-1',
    'minioadmin',
  ])('does not flag the real-looking value %p', (value) => {
    expect(looksLikePlaceholder(value)).toBe(false);
  });

  it('treats empty/absent values as "not a placeholder" (they are reported as missing)', () => {
    expect(looksLikePlaceholder('')).toBe(false);
    expect(looksLikePlaceholder('   ')).toBe(false);
    expect(looksLikePlaceholder(null)).toBe(false);
    expect(looksLikePlaceholder(undefined)).toBe(false);
  });
});

describe('StorageService.presign guard (INS-053 + INS-060)', () => {
  it('presigns a real, complete configuration', () => {
    const url = makeService().presignUpload('orgs/o1/photos/x.jpg');
    expect(url).toContain('https://fly.storage.tigris.dev/inspect-photos/orgs/o1/photos/x.jpg');
    expect(url).toContain('X-Amz-Signature=');
    expect(url).toContain('X-Amz-Credential=tid_ARealLookingAccessKey');
  });

  it.each([
    ['S3_ACCESS_KEY_ID', 'CHANGE_ME'],
    ['S3_SECRET_ACCESS_KEY', 'CHANGE_ME'],
    ['S3_SECRET_ACCESS_KEY', 'change_me'],
    ['S3_ACCESS_KEY_ID', '${{ Bucket.ACCESS_KEY }}'],
    ['S3_BUCKET', 'CHANGE_ME'],
    ['S3_ENDPOINT', 'https://<your-endpoint>'],
  ])('rejects a placeholder %s (%p) with a clear BadRequestException', (key, value) => {
    const service = makeService({ [key]: value });
    expect(() => service.presignUpload('k')).toThrow(BadRequestException);
    expect(() => service.presignUpload('k')).toThrow(/Object storage is not configured/);
    expect(() => service.presignUpload('k')).toThrow(new RegExp(key));
    // Downloads must fail identically — a broken GET URL is just as useless.
    expect(() => service.presignDownload('k')).toThrow(BadRequestException);
  });

  it('rejects a malformed S3_ENDPOINT as a config error, not a bare TypeError', () => {
    const service = makeService({ S3_ENDPOINT: 'not-a-url' });
    expect(() => service.presignUpload('k')).toThrow(BadRequestException);
    expect(() => service.presignUpload('k')).toThrow(/S3_ENDPOINT is not a valid URL/);
  });

  it('rejects a non-http S3_ENDPOINT scheme', () => {
    const service = makeService({ S3_ENDPOINT: 's3://inspect-photos' });
    expect(() => service.presignUpload('k')).toThrow(/S3_ENDPOINT must be an http\(s\) URL/);
  });

  it('still rejects empty credentials and names the missing var', () => {
    const service = makeService({ S3_ACCESS_KEY_ID: '', S3_SECRET_ACCESS_KEY: '' });
    expect(() => service.presignUpload('k')).toThrow(
      /Object storage is not configured \(set S3_ACCESS_KEY_ID \/ S3_SECRET_ACCESS_KEY\)/,
    );
  });

  it('never mints a URL for placeholder credentials (the whole point of INS-060)', () => {
    const service = makeService({ S3_ACCESS_KEY_ID: 'CHANGE_ME' });
    let url: string | null = null;
    try {
      url = service.presignUpload('k');
    } catch {
      /* expected */
    }
    expect(url).toBeNull();
  });
});

describe('StorageService.isConfigured + boot-time warning (INS-060)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('is true for a real configuration and false for a placeholder one', () => {
    expect(makeService().isConfigured()).toBe(true);
    expect(makeService({ S3_SECRET_ACCESS_KEY: 'CHANGE_ME' }).isConfigured()).toBe(false);
    expect(makeService({ S3_ACCESS_KEY_ID: '' }).isConfigured()).toBe(false);
  });

  it('warns loudly at boot when storage is unusable', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    makeService({ S3_ACCESS_KEY_ID: 'CHANGE_ME' }).onModuleInit();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/S3_ACCESS_KEY_ID still holds a placeholder value/);
  });

  it('stays quiet at boot when storage looks real', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    makeService().onModuleInit();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('StorageService keys', () => {
  it('scopes a report PDF key by org and report id', () => {
    expect(makeService().keyForReportPdf('org1', 'rep1')).toBe('orgs/org1/reports/rep1.pdf');
  });

  it('keeps the report PDF key deterministic so a re-render overwrites itself', () => {
    const service = makeService();
    expect(service.keyForReportPdf('org1', 'rep1')).toBe(service.keyForReportPdf('org1', 'rep1'));
  });

  it('sanitizes a hostile photo extension', () => {
    expect(makeService().keyForPhoto('o', 'i', '../../etc/passwd')).toMatch(
      /^orgs\/o\/inspections\/i\/photos\/[0-9a-f-]+\.jpg$/,
    );
  });
});

describe('StorageService.putObject (INS-003 server-side upload)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('PUTs the bytes to the presigned URL with the right content type', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, status: 200, statusText: 'OK' }));
    global.fetch = fetchMock as never;

    const bytes = Buffer.from('%PDF-1.7 fake');
    await makeService().putObject('orgs/org1/reports/rep1.pdf', bytes, 'application/pdf');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/inspect-photos/orgs/org1/reports/rep1.pdf');
    expect(url).toContain('X-Amz-Signature=');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/pdf');
    expect(Buffer.from(init.body as Uint8Array).toString()).toBe('%PDF-1.7 fake');
  });

  it('throws with the storage response detail on a non-2xx', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: async () => '<Error>AccessDenied</Error>',
    })) as never;

    await expect(makeService().putObject('k', Buffer.from('x'))).rejects.toThrow(
      /403 Forbidden.*AccessDenied/s,
    );
  });

  it('refuses to upload at all when storage is unconfigured', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as never;
    await expect(
      makeService({ S3_SECRET_ACCESS_KEY: 'CHANGE_ME' }).putObject('k', Buffer.from('x')),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
