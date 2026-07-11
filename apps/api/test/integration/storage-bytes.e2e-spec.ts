/**
 * INS-023 — the real photo BYTE path: presigned PUT of actual bytes to object
 * storage (MinIO locally/CI, S3 in prod), then registering the photo with the
 * true sha256 of those bytes. This is the one loop step the metadata-only smoke
 * loop never exercised.
 *
 * The suite probes S3_ENDPOINT first and SKIPS (loudly) when object storage is
 * unreachable, so the DB-only local run stays green; CI starts MinIO and runs it
 * for real.
 */
import { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  ApiClient,
  apiClient,
  bootApp,
  createOrgWithOwner,
  createWorkspace,
  expect2xx,
  loginAdmin,
  runTag,
} from './support';

async function probeEndpoint(endpoint: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    // Any HTTP response (even 403/404) proves the endpoint is reachable.
    await fetch(endpoint, { method: 'GET', signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

describe('Photo byte upload via presigned URL (integration)', () => {
  let app: INestApplication;
  let client: ApiClient;
  let storageUp = false;
  let endpoint = '';
  const tag = runTag('bytes');

  beforeAll(async () => {
    app = await bootApp();
    client = apiClient(app);
    endpoint = process.env.S3_ENDPOINT ?? 'http://localhost:9000';
    storageUp = await probeEndpoint(endpoint);
    if (!storageUp) {
      // eslint-disable-next-line no-console
      console.warn(
        `[storage-bytes] SKIPPED — object storage unreachable at ${endpoint}. ` +
          'Start MinIO (docker-compose.dev.yml) or run in CI to exercise the byte path.',
      );
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('PUTs real bytes to the presigned URL and registers the photo with their true hash', async () => {
    if (!storageUp) return; // skipped — see beforeAll warning

    const adminToken = await loginAdmin(client);
    const org = await createOrgWithOwner(client, adminToken, tag);
    const ws = await createWorkspace(client, org.ownerToken, tag);

    const inspection = expect2xx(
      await client.post('/inspections', {
        token: org.ownerToken,
        body: { poId: ws.poId, loopPresetId: ws.presetId, lotSize: 500, clientRequestId: `bytes-${tag}` },
      }),
      'POST /inspections',
    );
    const loopId = inspection.loops?.[0]?.id;

    const presign = expect2xx(
      await client.post(`/inspections/${inspection.id}/populate/photos/presign`, {
        token: adminToken,
        body: { ext: 'jpg' },
      }),
      'populate presign',
    );

    // Real bytes (a fake JPEG payload is fine — the contract is bytes+hash, not codec).
    const bytes = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]), // JPEG SOI/APP0 magic
      Buffer.from(`e2e byte upload ${tag}`, 'utf8'),
    ]);
    const put = await fetch(presign.uploadUrl, { method: 'PUT', body: bytes });
    expect(put.status).toBeGreaterThanOrEqual(200);
    expect(put.status).toBeLessThan(300);

    const contentHash = createHash('sha256').update(bytes).digest('hex');
    const photo = expect2xx(
      await client.post(`/inspections/${inspection.id}/populate/photos`, {
        token: adminToken,
        body: {
          storageKey: presign.storageKey,
          contentHash,
          inspectionLoopId: loopId,
          clientRequestId: `bytes-photo-${tag}`,
        },
      }),
      'populate register photo (real bytes)',
    );
    expect(photo.id).toBeTruthy();
    expect(photo.contentHash).toBe(contentHash);
  });
});
