import { CompaniesController, companyLogoPrefix } from './companies.controller';

/**
 * INS-072 (carried to INS-055) — company logos are stored as DURABLE object keys
 * and presigned at RENDER time. These specs pin the two properties that keep
 * that safe:
 *   1. the key handed to the client is always inside the caller's org namespace;
 *   2. `logoViewUrl` never signs a key outside that namespace — otherwise the
 *      decoration is a signing oracle over another tenant's objects — while
 *      legacy absolute URLs keep rendering.
 */
function makeController(
  overrides: Partial<
    Record<'presignUpload' | 'presignDownload', jest.Mock>
  > = {},
) {
  const presignUpload =
    overrides.presignUpload ??
    jest.fn((key: string) => `https://s3.test/${key}?X-Amz-Signature=put`);
  const presignDownload =
    overrides.presignDownload ??
    jest.fn((key: string) => `https://s3.test/${key}?X-Amz-Signature=get`);
  const companies = {
    list: jest.fn(async () => [] as unknown[]),
    get: jest.fn(async () => ({ id: 'c1', logoUrl: null as string | null })),
  };

  const controller = new CompaniesController(
    companies as any,
    { presignUpload, presignDownload } as any,
  );
  return { controller, companies, presignUpload, presignDownload };
}

const USER = {
  userId: 'u1',
  orgId: 'orgA',
  role: 'ORG_OWNER' as const,
  actingAsOrgId: null,
};

describe('CompaniesController logo presign (INS-072)', () => {
  it('mints a key inside the caller org namespace and returns a PUT url', () => {
    const { controller, presignUpload } = makeController();

    const out = controller.presign(USER as any, { ext: 'PNG' });
    expect(out.storageKey.startsWith(companyLogoPrefix('orgA'))).toBe(true);
    expect(out.storageKey).toMatch(
      /^orgs\/orgA\/companies\/[0-9a-f-]{36}\.png$/,
    );
    expect(presignUpload).toHaveBeenCalledWith(out.storageKey);
    expect(out.uploadUrl).toContain(out.storageKey);
    expect(out.method).toBe('PUT');
  });

  it('falls back to a safe extension for junk input', () => {
    const { controller } = makeController();

    const out = controller.presign(USER as any, { ext: '../../etc/passwd' });
    expect(out.storageKey).toMatch(
      /^orgs\/orgA\/companies\/[0-9a-f-]{36}\.png$/,
    );
  });
});

describe('CompaniesController logoViewUrl decoration (INS-072)', () => {
  async function getWithLogo(logoUrl: string | null, overrides = {}) {
    const ctx = makeController(overrides);
    ctx.companies.get = jest.fn(async () => ({ id: 'c1', logoUrl }));

    const out: any = await ctx.controller.get(USER as any, 'c1');
    return { out, ...ctx };
  }

  it('presigns a key in this org namespace at read time', async () => {
    const key = `${companyLogoPrefix('orgA')}abc.png`;
    const { out, presignDownload } = await getWithLogo(key);
    expect(presignDownload).toHaveBeenCalledWith(key);
    expect(out.logoViewUrl).toBe(`https://s3.test/${key}?X-Amz-Signature=get`);
    // The durable key stays the persisted value — never the short-lived URL.
    expect(out.logoUrl).toBe(key);
  });

  it('never signs a crafted foreign-org key', async () => {
    const { out, presignDownload } = await getWithLogo(
      'orgs/orgB/companies/secret.png',
    );
    expect(out.logoViewUrl).toBeNull();
    expect(presignDownload).not.toHaveBeenCalled();
  });

  it('never signs a key outside the companies namespace', async () => {
    const { out, presignDownload } = await getWithLogo(
      'orgs/orgA/inspections/x/photos/p.jpg',
    );
    expect(out.logoViewUrl).toBeNull();
    expect(presignDownload).not.toHaveBeenCalled();
  });

  it('echoes a legacy absolute URL verbatim (no data migration needed)', async () => {
    const { out, presignDownload } = await getWithLogo(
      'https://cdn.example.com/acme.png',
    );
    expect(out.logoViewUrl).toBe('https://cdn.example.com/acme.png');
    expect(presignDownload).not.toHaveBeenCalled();
  });

  it('is null when there is no logo at all', async () => {
    const { out } = await getWithLogo(null);
    expect(out.logoViewUrl).toBeNull();
  });

  it('degrades to null when storage is unconfigured instead of failing the read', async () => {
    const presignDownload = jest.fn(() => {
      throw new Error('Object storage is not configured');
    });
    const { out } = await getWithLogo(`${companyLogoPrefix('orgA')}abc.png`, {
      presignDownload,
    });
    expect(out.logoViewUrl).toBeNull();
  });

  it('decorates every list row too (the directory renders from it)', async () => {
    const { controller, companies } = makeController();
    companies.list = jest.fn(async () => [
      { id: 'c1', logoUrl: `${companyLogoPrefix('orgA')}one.png` },
      { id: 'c2', logoUrl: 'orgs/orgB/companies/two.png' },
      { id: 'c3', logoUrl: null },
    ]);

    const rows: any[] = await controller.list(USER as any, {});
    expect(rows.map((r) => r.logoViewUrl)).toEqual([
      `https://s3.test/${companyLogoPrefix('orgA')}one.png?X-Amz-Signature=get`,
      null,
      null,
    ]);
  });
});
