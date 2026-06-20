/**
 * INS-001 end-to-end smoke driver.
 *
 * Walks the full inspection loop against a RUNNING API (no test framework), proving
 * every DB-bound path returns 2xx and the signed report verifies:
 *
 *   admin login -> create org -> accept owner invite -> owner login
 *   -> buyer/supplier/product/PO/loop-preset (workspace CRUD)
 *   -> create inspection
 *   -> (Platform Admin) populate: presign + register photo + assign loop + tag defect + measure
 *   -> submit (AQL evaluate) -> QA decision (PASS) -> generate signed report
 *   -> public verify-by-token -> owner fetch report -> buyer-guest magic-link fetch
 *
 * Two principals are required by design: org-scoped steps run as the ORG_OWNER,
 * the populate step runs as the cross-tenant PLATFORM_ADMIN (orgId derived from
 * the inspection). See docs/in-progress/plans/2026-06-20-ins-001-stand-up-and-verify.md.
 *
 * Usage:  node apps/api/scripts/smoke-loop.mjs
 *   SMOKE_BASE_URL          (default http://localhost:3000)
 *   BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD
 *     (falls back to parsing the repo-root .env so a local run is zero-config;
 *      nothing secret is committed in this file)
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:3000';

function loadAdminCreds() {
  let email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  let password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (email && password) return { email, password };
  try {
    const here = dirname(fileURLToPath(import.meta.url)); // apps/api/scripts
    const envPath = resolve(here, '../../../.env'); // repo root
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
      if (!m) continue;
      if (m[1] === 'BOOTSTRAP_ADMIN_EMAIL' && !email) email = m[2];
      if (m[1] === 'BOOTSTRAP_ADMIN_PASSWORD' && !password) password = m[2];
    }
  } catch {
    /* ignore — surfaced below if still missing */
  }
  return { email, password };
}

async function req(method, path, { token, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (res.status < 200 || res.status >= 300) {
    const detail = typeof data === 'string' ? data : JSON.stringify(data);
    const err = new Error(`${method} ${path} -> ${res.status}: ${detail}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

let n = 0;
const ok = (msg) => console.log(`  ✓ [${String(++n).padStart(2, '0')}] ${msg}`);
function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function main() {
  const { email: adminEmail, password: adminPassword } = loadAdminCreds();
  assert(adminEmail && adminPassword, 'BOOTSTRAP_ADMIN_EMAIL/PASSWORD not found (env or root .env)');

  const stamp = Date.now();
  const ownerEmail = `owner+${stamp}@smoke.local`;
  const ownerPassword = `SmokeOwner!${stamp}`;
  console.log(`\nINS-001 smoke loop against ${BASE}  (run ${stamp})\n`);

  // 1. Platform Admin login
  const adminLogin = await req('POST', '/auth/login', {
    body: { email: adminEmail, password: adminPassword },
  });
  const adminToken = adminLogin.accessToken;
  assert(adminToken, 'admin accessToken issued');
  ok(`admin login (${adminEmail})`);

  const me = await req('GET', '/auth/me', { token: adminToken });
  assert(me.role === 'PLATFORM_ADMIN' && me.orgId == null, 'admin is PLATFORM_ADMIN with null orgId');
  ok(`admin /auth/me -> ${me.role}, orgId=${me.orgId}`);

  // 2. Create org (+ auto Org Owner invitation)
  const created = await req('POST', '/admin/orgs', {
    token: adminToken,
    body: { name: `Smoke Inspection Co ${stamp}`, type: 'INSPECTION_COMPANY', ownerEmail },
  });
  const orgId = created.org.id;
  const inviteToken = created.invitation.token;
  assert(orgId && inviteToken, 'org created + invitation token returned');
  ok(`org created id=${orgId}, invite role=${created.invitation.role}`);

  // 3. Accept invite -> Org Owner user
  const owner = await req('POST', '/invitations/accept', {
    body: { token: inviteToken, password: ownerPassword, name: 'Smoke Owner' },
  });
  assert(owner.role === 'ORG_OWNER' && owner.status === 'ACTIVE', 'owner created ACTIVE/ORG_OWNER');
  ok(`invite accepted -> user ${owner.email} (${owner.role})`);

  // 4. Org Owner login
  const ownerLogin = await req('POST', '/auth/login', {
    body: { email: ownerEmail, password: ownerPassword },
  });
  const ownerToken = ownerLogin.accessToken;
  assert(ownerToken, 'owner accessToken issued');
  ok('owner login');

  // 5. Workspace CRUD (org-scoped, owner)
  const buyer = await req('POST', '/buyers', { token: ownerToken, body: { name: `Smoke Buyer ${stamp}` } });
  ok(`buyer ${buyer.id}`);
  const supplier = await req('POST', '/suppliers', { token: ownerToken, body: { name: `Smoke Supplier ${stamp}` } });
  ok(`supplier ${supplier.id}`);
  const product = await req('POST', '/products', { token: ownerToken, body: { styleNumber: `STYLE-${stamp}` } });
  ok(`product ${product.id}`);
  const po = await req('POST', '/purchase-orders', {
    token: ownerToken,
    body: { poNumber: `PO-${stamp}`, buyerId: buyer.id, supplierId: supplier.id, productId: product.id, totalQuantity: 1000 },
  });
  ok(`purchase order ${po.id}`);

  // 5b. Pick a MINOR catalog defect (deterministic PASS); fall back to custom.
  const catalog = await req('GET', '/defect-catalog', { token: ownerToken });
  const minorDefect = Array.isArray(catalog) ? catalog.find((d) => d.defaultSeverity === 'MINOR') : null;
  ok(`defect catalog: ${Array.isArray(catalog) ? catalog.length : 0} entries${minorDefect ? `, using MINOR "${minorDefect.name}"` : ' (no MINOR -> custom)'}`);

  // 5c. Loop preset (one zone, allowing the MINOR defect if present)
  const preset = await req('POST', '/loop-presets', {
    token: ownerToken,
    body: {
      name: `Smoke Loop ${stamp}`,
      aqlLevel: 'II',
      steps: [
        {
          zoneName: 'Front',
          requiredShotCount: 1,
          measurementFields: [{ label: 'Length', unit: 'cm' }],
          allowedDefectCatalogIds: minorDefect ? [minorDefect.id] : [],
        },
      ],
    },
  });
  assert(preset.id, 'loop preset created');
  ok(`loop preset ${preset.id} v${preset.version}`);

  // 6. Create inspection (lotSize 1000 -> code J; computes sampling)
  const inspection = await req('POST', '/inspections', {
    token: ownerToken,
    body: { poId: po.id, loopPresetId: preset.id, lotSize: 1000, clientRequestId: `smoke-${stamp}` },
  });
  const inspectionId = inspection.id;
  const loopId = inspection.loops?.[0]?.id;
  assert(inspectionId && loopId, 'inspection + at least one loop created');
  ok(`inspection ${inspectionId} status=${inspection.status}, loop=${loopId}`);
  assert(inspection.computedSampling?.sampleSizeCodeLetter === 'J', `code letter J (got ${inspection.computedSampling?.sampleSizeCodeLetter})`);
  ok(`computed sampling: letter=${inspection.computedSampling.sampleSizeCodeLetter}, n=${inspection.computedSampling.sampleSize}`);

  // 7. Populate — PLATFORM ADMIN principal (cross-tenant; orgId derived from inspection)
  const presign = await req('POST', `/inspections/${inspectionId}/populate/photos/presign`, {
    token: adminToken,
    body: { ext: 'jpg' },
  });
  assert(presign.storageKey && presign.uploadUrl, 'presign returned storageKey + uploadUrl');
  ok(`presign storageKey=${presign.storageKey}`);

  const contentHash = createHash('sha256').update(`smoke-photo-${stamp}`).digest('hex');
  const photo = await req('POST', `/inspections/${inspectionId}/populate/photos`, {
    token: adminToken,
    body: { storageKey: presign.storageKey, contentHash, inspectionLoopId: loopId, clientRequestId: `photo-${stamp}` },
  });
  assert(photo.id, 'photo registered (metadata-only, no S3 byte upload)');
  ok(`photo ${photo.id} source=${photo.source}`);

  await req('PATCH', `/inspections/${inspectionId}/populate/photos/${photo.id}/loop`, {
    token: adminToken,
    body: { inspectionLoopId: loopId },
  });
  ok('photo assigned to loop');

  const defectBody = minorDefect
    ? { defectCatalogId: minorDefect.id, inspectionLoopId: loopId, photoIds: [photo.id], notes: 'smoke' }
    : { customText: 'Loose thread (smoke)', severity: 'MINOR', inspectionLoopId: loopId, photoIds: [photo.id] };
  const defect = await req('POST', `/inspections/${inspectionId}/populate/defects`, { token: adminToken, body: defectBody });
  assert(defect.severity === 'MINOR', `defect tagged MINOR (got ${defect.severity})`);
  ok(`defect ${defect.id} severity=${defect.severity}`);

  const measurement = await req('POST', `/inspections/${inspectionId}/populate/measurements`, {
    token: adminToken,
    body: { inspectionLoopId: loopId, label: 'Length', recordedValue: '42.0', unit: 'cm' },
  });
  assert(measurement.id, 'measurement recorded');
  ok(`measurement ${measurement.id}`);

  // 8. Submit -> AQL evaluate (owner)
  const submitted = await req('POST', `/inspections/${inspectionId}/submit`, {
    token: ownerToken,
    body: { deviceId: 'smoke-device', gps: { lat: 0, lng: 0 } },
  });
  assert(submitted.status === 'SUBMITTED', `status SUBMITTED (got ${submitted.status})`);
  assert(submitted.aqlResult?.systemRecommendation === 'PASS', `AQL recommendation PASS (got ${submitted.aqlResult?.systemRecommendation})`);
  ok(`submitted -> ${submitted.status}, AQL=${submitted.aqlResult.systemRecommendation}`);

  // 9. QA decision PASS -> APPROVED (owner)
  const decided = await req('POST', `/inspections/${inspectionId}/decision`, {
    token: ownerToken,
    body: { decision: 'PASS', remarks: 'smoke pass' },
  });
  assert(decided.status === 'APPROVED', `status APPROVED (got ${decided.status})`);
  ok(`decision PASS -> ${decided.status}`);

  // 10. Generate signed report (owner)
  const report = await req('POST', `/inspections/${inspectionId}/report`, { token: ownerToken });
  assert(report.id && report.verificationToken && report.signature, 'report has id + verificationToken + signature');
  ok(`report ${report.id} status=${report.status}, token=${report.verificationToken}`);

  // 11. Public verify-by-token (no auth) — the buyer-independent trust anchor
  const verify = await req('GET', `/reports/verify/${report.verificationToken}`);
  assert(verify.valid === true && verify.hashMatches === true && verify.signatureValid === true, `report verifies (got ${JSON.stringify(verify)})`);
  ok(`public verify -> valid=${verify.valid}, hashMatches=${verify.hashMatches}, signatureValid=${verify.signatureValid}`);

  // 12. Owner fetch report (org-scoped)
  const fetched = await req('GET', `/reports/${report.id}`, { token: ownerToken });
  assert(fetched.id === report.id, 'owner can fetch the report');
  ok('owner fetched report');

  // 13. Buyer-guest magic-link: issue token (owner) + public fetch
  const guestRes = await req('POST', `/buyers/${buyer.id}/guests`, {
    token: ownerToken,
    body: { email: `guest+${stamp}@smoke.local` },
  });
  const guestToken = guestRes.token;
  assert(guestToken, 'buyer guest token issued');
  ok(`buyer guest ${guestRes.guest.id}`);

  const guestReports = await req('GET', `/guest/reports?token=${encodeURIComponent(guestToken)}`);
  assert(Array.isArray(guestReports) && guestReports.some((r) => r.id === report.id), `guest sees the report (got ${Array.isArray(guestReports) ? guestReports.length : 'non-array'})`);
  ok(`guest magic-link fetch -> ${guestReports.length} report(s), includes ours`);

  console.log(`\n✅ ALL ${n} STEPS PASSED — full loop is live end-to-end.`);
  console.log(`   org=${orgId} inspection=${inspectionId} report=${report.id}\n`);
}

main().catch((err) => {
  console.error(`\n❌ SMOKE FAILED at step ${n + 1}: ${err.message}\n`);
  process.exit(1);
});
