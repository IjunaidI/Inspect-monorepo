/**
 * INS-023 — the real photo BYTE path: presigned PUT of actual bytes to object
 * storage (MinIO locally/CI, S3 in prod), then registering the photo with the
 * true sha256 of those bytes. This is the one loop step the metadata-only smoke
 * loop never exercised.
 *
 * The suite probes S3_ENDPOINT + the target bucket first and SKIPS (loudly)
 * when storage is unreachable OR the bucket is missing, so a DB-only local run
 * stays green even with a bucket-less MinIO up. Set REQUIRE_STORAGE=1 (CI does)
 * to turn that skip into a hard failure — otherwise a storage/bucket setup
 * regression would silently drop INS-023 coverage while CI stays green.
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

interface StorageProbe {
  usable: boolean;
  reason: string;
}

async function probeStorage(
  endpoint: string,
  bucket: string,
): Promise<StorageProbe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    // Path-style bucket URL; 200/403 => treat as usable. NOTE: managed
    // S3-compatible endpoints answer 403 AccessDenied for ANY bucket name,
    // existing or not (verified against Tigris), so this probe cannot prove
    // existence there — a wrong S3_BUCKET surfaces later as a failing presigned
    // PUT, not as a skip. 404 is the MinIO-shaped "endpoint up but NO bucket"
    // signal (what CI runs against); treat that as unusable rather than letting
    // the test fail hard on a half-set-up local stack.
    const res = await fetch(`${endpoint.replace(/\/+$/, '')}/${bucket}`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (res.status === 404) {
      return {
        usable: false,
        reason: `bucket "${bucket}" not found at ${endpoint} (MinIO: create it, e.g. aws --endpoint-url ${endpoint} s3 mb s3://${bucket})`,
      };
    }
    return { usable: true, reason: 'ok' };
  } catch {
    return {
      usable: false,
      reason: `object storage unreachable at ${endpoint}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

describe('Photo byte upload via presigned URL (integration)', () => {
  let app: INestApplication;
  let client: ApiClient;
  let storageUp = false;
  const tag = runTag('bytes');

  beforeAll(async () => {
    app = await bootApp();
    client = apiClient(app);
    const endpoint = process.env.S3_ENDPOINT ?? 'http://localhost:9000';
    const bucket = process.env.S3_BUCKET ?? 'inspect-photos';
    const probe = await probeStorage(endpoint, bucket);
    storageUp = probe.usable;
    if (!storageUp) {
      if (process.env.REQUIRE_STORAGE === '1') {
        throw new Error(
          `REQUIRE_STORAGE=1 but the byte path cannot run: ${probe.reason}`,
        );
      }

      console.warn(
        `[storage-bytes] SKIPPED — ${probe.reason}. ` +
          'Point S3_* at reachable object storage (a managed S3-compatible bucket, or local MinIO via docker-compose.dev.yml plus bucket creation) to exercise the byte path.',
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
        body: {
          poId: ws.poId,
          loopPresetId: ws.presetId,
          lotSize: 500,
          clientRequestId: `bytes-${tag}`,
        },
      }),
      'POST /inspections',
    );
    const loopId = inspection.items?.[0]?.id;

    const presign = expect2xx(
      await client.post(
        `/inspections/${inspection.id}/populate/photos/presign`,
        {
          token: adminToken,
          body: { ext: 'jpg' },
        },
      ),
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
          inspectionLoopItemId: loopId,
          cycleIndex: 0,
          clientRequestId: `bytes-photo-${tag}`,
        },
      }),
      'populate register photo (real bytes)',
    );
    expect(photo.id).toBeTruthy();
    expect(photo.contentHash).toBe(contentHash);

    // INS-049: the inspection detail decorates the photo with a presigned GET
    // viewUrl, and fetching it returns the EXACT uploaded bytes.
    const detail = expect2xx(
      await client.get(`/inspections/${inspection.id}`, {
        token: org.ownerToken,
      }),
      'GET /inspections/:id (viewUrl)',
    );
    const detailPhoto = detail.items
      ?.flatMap(
        (l: { photos?: Array<{ id: string; viewUrl?: string | null }> }) =>
          l.photos ?? [],
      )
      .find((p: { id: string }) => p.id === photo.id);
    expect(detailPhoto?.viewUrl).toBeTruthy();
    const download = await fetch(detailPhoto.viewUrl);
    expect(download.status).toBe(200);
    const downloaded = Buffer.from(await download.arrayBuffer());
    expect(createHash('sha256').update(downloaded).digest('hex')).toBe(
      contentHash,
    );
  });
});
