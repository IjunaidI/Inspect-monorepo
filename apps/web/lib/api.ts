import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getToken } from 'next-auth/jwt';
import { refreshApiAccessToken } from './auth';
import { getAssumedOrgId } from './admin-org';
import type {
  AqlClassOutcome,
  CompanyDto,
  CompanyGuestDto,
  CompanyKind,
  DefectClass,
  DefectScope,
  DefectSeverity,
  InvitableRole,
  OrgType,
  ProductDto,
  QaDecision,
  UserRole,
  UserStatus,
} from '@inspect/shared-types';

const API_URL = process.env.INSPECT_API_URL ?? 'http://localhost:3000';

/** Thrown by all API helpers on a non-2xx response; carries the HTTP status. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── Session token access (INS-045) ──────────────────────────────────────────
// The API bearer token lives ONLY inside the encrypted (JWE) NextAuth cookie —
// it is no longer copied onto the session object, because NextAuth serves that
// object to the browser at GET /api/auth/session, where any XSS/extension/kiosk
// foothold could exfiltrate it and replay it against the API. Auth.js derives
// the JWE salt from the session cookie's NAME, and prefixes that name with
// `__Secure-` when the deployment URL is https — so the name has to be detected
// from the request, never assumed, or the decrypt silently yields null.
// Oversized sessions are split into `.0`, `.1`, … chunks; getToken reassembles.
const SESSION_COOKIE = 'authjs.session-token';
const SECURE_SESSION_COOKIE = `__Secure-${SESSION_COOKIE}`;
const SECURE_SESSION_COOKIE_RE = /(?:^|;\s*)__Secure-authjs\.session-token(?:\.\d+)?=/;

/** The subset of the NextAuth JWT this module needs. */
interface SessionJwt {
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpires?: number;
  role?: string;
}

/**
 * Decrypt the current request's NextAuth JWT, server-side. Uses `headers()`,
 * which is available in every context this module is called from (Server
 * Components, Server Actions, Route Handlers) — the same contexts `auth()`
 * required, so no call site loses reach. Returns null when unauthenticated.
 */
async function readSessionJwt(): Promise<SessionJwt | null> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) return null;
  const cookie = (await headers()).get('cookie');
  if (!cookie) return null;
  const secureCookie = SECURE_SESSION_COOKIE_RE.test(cookie);
  const cookieName = secureCookie ? SECURE_SESSION_COOKIE : SESSION_COOKIE;
  return (await getToken({
    req: { headers: { cookie } },
    secret,
    cookieName,
    salt: cookieName,
    secureCookie,
  })) as SessionJwt | null;
}

/**
 * The access token to send, renewed on the spot when it has expired — mirroring
 * the `jwt` callback in lib/auth.ts, same 60s clock-skew buffer, so a call
 * landing right at expiry still authenticates instead of 401-ing. As before this
 * change the renewal is in-memory only: Auth.js discards Set-Cookie outside
 * middleware, so middleware.ts stays the one place that persists a rotated token.
 * On refresh failure we send the stale token and let the API return 401, exactly
 * as the previous `session.accessToken` path did.
 */
async function accessTokenFrom(jwt: SessionJwt | null): Promise<string | null> {
  if (!jwt?.accessToken) return null;
  if (Date.now() < ((jwt.accessTokenExpires ?? 0) - 60_000)) return jwt.accessToken;
  const refreshed = await refreshApiAccessToken(jwt.refreshToken);
  return refreshed?.accessToken ?? jwt.accessToken;
}

/** Current session's API access token (server-side only). */
export async function apiToken(): Promise<string | null> {
  return accessTokenFrom(await readSessionJwt());
}

/**
 * Headers carrying the session token plus, for a verified Platform Admin
 * operating inside an assumed org, the X-Org-Id selector (INS-079). The role
 * check is defense-in-depth (the API guard ignores the header for anyone else
 * regardless) against a stale `inspect_admin_org` cookie surviving into a
 * different session on a shared browser (final review, finding 2) — reads the
 * one decrypted JWT already needed here for the bearer token, rather than a
 * second lookup. Deliberately NOT used by apiGetPublic/apiPostPublic — those are
 * unauthenticated by contract.
 */
async function authHeaders(): Promise<Record<string, string>> {
  const jwt = await readSessionJwt();
  const token = await accessTokenFrom(jwt);
  const orgId = jwt?.role === 'PLATFORM_ADMIN' ? await getAssumedOrgId() : null;
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(orgId ? { 'X-Org-Id': orgId } : {}),
  };
}

/**
 * Unauthenticated GET — for public endpoints (guest portal, verify, invite lookup).
 * Does NOT call auth(); safe to use from pages with no session.
 * Throws ApiError on non-2xx so callers can branch on the HTTP status
 * (e.g. 404 unknown invite vs 410 consumed/expired). Network failures still
 * surface as fetch's TypeError — distinct from an API-level error.
 */
export async function apiGetPublic<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: 'no-store' });
  if (!res.ok) {
    let detail = '';
    try {
      const parsed = await res.json() as { message?: unknown };
      const m = parsed.message;
      detail = Array.isArray(m) ? m.join(', ') : typeof m === 'string' ? m : '';
    } catch { /* non-JSON */ }
    throw new ApiError(res.status, path, detail || `API GET ${path} failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

/**
 * Unauthenticated POST — for public endpoints (accept invitation).
 */
export async function apiPostPublic<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) {
    let detail = '';
    try {
      const parsed = await res.json() as { message?: unknown };
      const m = parsed.message;
      detail = Array.isArray(m) ? m.join(', ') : typeof m === 'string' ? m : '';
    } catch { /* non-JSON */ }
    throw new Error(detail || `API POST ${path} failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Server-side GET against the NestJS API with the session bearer token.
 * Always no-store (live data) — pages that use it are dynamic.
 * Throws ApiError on non-2xx so callers can distinguish 401 from network errors.
 */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: await authHeaders(),
    cache: 'no-store'
  });
  if (!res.ok) {
    let detail = '';
    try {
      const parsed = await res.json() as { message?: unknown };
      const m = parsed.message;
      detail = Array.isArray(m) ? m.join(', ') : typeof m === 'string' ? m : '';
    } catch { /* non-JSON */ }
    throw new ApiError(res.status, path, detail || `API GET ${path} failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

/**
 * Load live data from the API, falling back to design demo data when the API is
 * unreachable or the caller is unauthenticated (keeps previews working offline).
 * Returns `{ data, live }` so the UI can badge the source if it wants.
 * Re-throws 401 and any other 403 — those are auth failures, not "API offline".
 * A 403 raised by the API's no-org-context guard (`requireOrgId`, INS-079) is
 * special-cased: it redirects an un-assumed Platform Admin to /admin/orgs here,
 * server-side, rather than re-throwing into app/(console)/error.tsx. Next.js
 * redacts Server Component error messages in production builds, so a client
 * error boundary cannot reliably pattern-match on `error.message` — this
 * function still has the real message, so it is the right place to act on it.
 */
export async function loadOrFallback<T>(path: string, fallback: T): Promise<{ data: T; live: boolean }> {
  try {
    const data = await apiGet<T>(path);
    return { data, live: true };
  } catch (e) {
    if (e instanceof ApiError && e.status === 403 && /organization context/i.test(e.message)) {
      redirect('/admin/orgs');
    }
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) throw e;
    return { data: fallback, live: false };
  }
}

type WriteMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Server-side mutation against the NestJS API with the session bearer token.
 * Use from Server Actions / route handlers (relies on `auth()`, which is server-only).
 * Sends `body` as JSON when provided; surfaces the API's error message via `ApiError`;
 * returns `undefined` for an empty/204 response.
 */
async function apiSend<T>(method: WriteMethod, path: string, body?: unknown): Promise<T> {
  const hasBody = body !== undefined;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(await authHeaders()),
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    },
    body: hasBody ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (!res.ok) {
    let parsed: unknown;
    let detail = '';
    try {
      parsed = await res.json();
      const m = (parsed as { message?: unknown })?.message;
      detail = Array.isArray(m) ? m.join(', ') : typeof m === 'string' ? m : '';
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, path, detail || `API ${method} ${path} failed: ${res.status}`, parsed);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? (JSON.parse(text) as T) : (undefined as T));
}

export const apiPost = <T>(path: string, body?: unknown): Promise<T> => apiSend<T>('POST', path, body);
export const apiPut = <T>(path: string, body?: unknown): Promise<T> => apiSend<T>('PUT', path, body);
export const apiPatch = <T>(path: string, body?: unknown): Promise<T> => apiSend<T>('PATCH', path, body);
export const apiDelete = <T>(path: string, body?: unknown): Promise<T> => apiSend<T>('DELETE', path, body);

// ── Response shapes (subset of the Prisma models the screens read) ──
/** Binding QA-call rollup (INS-068). PENDING = submitted, awaiting the QA decision. */
export interface ApiQaDecisionCounts {
  PASS: number;
  FAIL: number;
  HOLD: number;
  PENDING: number;
}

/**
 * Org quality metrics (INS-068). `dphu`/`passRate` are `null` — not 0 — until
 * there is something to divide by, so the tiles render "—" instead of NaN.
 */
export interface ApiQualityMetrics {
  decidedInspections: number;
  sampledUnits: number;
  defectsFound: number;
  /** Defects per hundred units: 100 × defectsFound / sampledUnits, 2dp. */
  dphu: number | null;
  /** 100 × PASS / (PASS + FAIL), 1dp. HOLD is unresolved and excluded. */
  passRate: number | null;
  /** PASS + FAIL — the passRate denominator. */
  verdicts: number;
  /** DPHU covers only the most recent bounded window of decided inspections. */
  truncated: boolean;
}

/** GET /dashboard/summary — org-scoped rollups for the console dashboard (INS-005, KPIs in INS-068). */
export interface ApiDashboardSummary {
  inspectionsByStatus: Record<string, number>;
  qaDecisionCounts: ApiQaDecisionCounts;
  quality: ApiQualityMetrics;
  /** INS-055: one unified counterparty count (was `buyers` + `suppliers`). */
  companies: number;
  products: number;
  purchaseOrders: number;
  reports: number;
}
/**
 * INS-008: these live in `@inspect/shared-types` so the API, the console and the
 * mobile app share one declaration. The `Api*` names are kept as aliases —
 * dozens of call sites read them, and renaming is churn without benefit. What
 * matters is that the shape is declared exactly once.
 */
export type ApiProduct = ProductDto;

/**
 * INS-055 — the unified counterparty, replacing ApiBuyer + ApiSupplier. One row
 * that can act as the client on one PO and the factory on another, so it carries
 * BOTH the ex-Buyer branding fields and the ex-Supplier address/GPS fields.
 * Trade role is never read from here — it lives on the PO/Inspection/Report edge.
 */
export type ApiCompany = CompanyDto;
export type ApiCompanyGuest = CompanyGuestDto;
export type ApiCompanyKind = CompanyKind;

export interface ApiLoopPreset {
  id: string;
  name: string;
  version: number;
  description?: string | null;
  aqlLevel?: string | null;
  isArchived: boolean;
  updatedAt?: string;
  /** INS-005 list aggregates — present on GET /loop-presets rows. */
  _count?: { items: number; inspections: number; defaultForCompanies: number };
}

export interface ApiMeasurementField {
  id: string;
  label: string;
  unit?: string | null;
  position: number;
}

/**
 * PresetStepAllowedDefect is a join row keyed by @@id([presetLoopStepId,
 * defectCatalogId]) — it has NO `id` column. Declaring one here made `ad.id`
 * type-check while being undefined at runtime, which silently produced
 * `key={undefined}` on every rendered chip.
 */
export interface ApiAllowedDefect {
  /** INS-081: the junction is loop-global; its PK is (loopPresetId, defectCatalogId) — there is no `id`. */
  loopPresetId: string;
  defectCatalogId: string;
  defectCatalog: {
    id: string;
    name: string;
    defaultSeverity: DefectSeverity;
  };
}

/** INS-081: one ordered capture point taking exactly one image. */
export interface ApiPresetItem {
  id: string;
  itemName: string;
  description?: string | null;
  referenceImageUrl?: string | null;
  position: number;
  /** Present on GET /loop-presets/:id — the key decorated with a short-lived view URL (INS-052). */
  referenceImage?: { key: string; viewUrl: string | null } | null;
}

export interface ApiLoopPresetDetail extends ApiLoopPreset {
  items: ApiPresetItem[];
  /** INS-081: both are LOOP-GLOBAL — defined once, not per item. */
  measurementFields: ApiMeasurementField[];
  allowedDefects: ApiAllowedDefect[];
}

export interface ApiDefectCatalog {
  id: string;
  name: string;
  defaultSeverity: DefectSeverity;
  scope: DefectScope;
  isArchived: boolean;
}
export interface ApiUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt?: string | null;
}
export interface ApiAqlResult {
  systemRecommendation: AqlClassOutcome;
  perClass: Record<DefectClass, { found: number; ac: number; re: number; outcome: AqlClassOutcome }>;
  qaDecision?: QaDecision | null;
  qaRemarks?: string | null;
}
export interface ApiInspection {
  id: string;
  status: string;
  /** Prisma enum (e.g. PRE_SHIPMENT) — render with underscores replaced. */
  inspectionType?: string;
  lotSize?: number | null;
  computedSampling?: { sampleSizeCodeLetter: string; sampleSize: number; perClass: Record<string, { aql: number; ac: number; re: number }> } | null;
  aqlResult?: ApiAqlResult | null;
  /**
   * INS-055: trade role lives on this EDGE, not on the company row — the same
   * company can be the client here and the factory on another inspection. The
   * factory edge stays optional, exactly as `supplier` was.
   */
  clientCompany?: { id: string; name: string; primaryColor?: string | null } | null;
  factoryCompany?: { id: string; name: string; gps?: { lat: number; lng: number } | null } | null;
  product?: { id: string; styleNumber: string } | null;
  purchaseOrder?: { id: string; poNumber: string } | null;
  /** Present on GET /inspections/:id (safe select: id/name/email). */
  assignedInspector?: { id: string; name: string | null; email: string } | null;
  createdAt?: string;
  /** INS-081: the loop's ordered single-image items, each carrying its photos. */
  items?: ApiInspectionLoopItem[];
  /** Per-unit measurement values (loop-global sheet). */
  measurements?: ApiMeasurement[];
  /** Server-computed completeness — the same rule submit() enforces. */
  cycleState?: ApiCycleState;
  /** Frozen at creation; carries the loop-global measurement sheet + defect tags. */
  loopPresetSnapshot?: {
    presetId: string;
    version: number;
    items: { position: number; itemName: string; description?: string; referenceImageUrl?: string }[];
    measurementFields: { label: string; unit?: string }[];
    allowedDefects: { defectCatalogId: string; name: string; severity: DefectSeverity }[];
  } | null;
  inspectorId?: string | null;
  /** Scalar FK on list rows (INS-057) — assignedInspector object only on GET /:id. */
  assignedInspectorId?: string | null;
  supersedesInspectionId?: string | null;
}
export interface ApiPurchaseOrder {
  id: string;
  poNumber: string;
  totalQuantity?: number | null;
  /** INS-055: a PO is explicitly two-party. Both are required on create. */
  clientCompany?: { id: string; name: string } | null;
  factoryCompany?: { id: string; name: string } | null;
  product?: { id: string; styleNumber: string } | null;
}
export interface AqlPreview {
  sampleSizeCodeLetter: string;
  sampleSize: number;
  perClass: Record<'critical' | 'major' | 'minor', { aql: number; ac: number; re: number }>;
}

// ── Populate API shapes ──
export interface PresignResult {
  storageKey: string;
  uploadUrl: string;
  method: 'PUT';
}

export interface RegisterPhotoInput {
  storageKey: string;
  contentHash: string;
  /** INS-081: every upload targets a slot — (loop item, cycle). Both required. */
  inspectionLoopItemId: string;
  cycleIndex: number;
  thumbnailKey?: string;
  capturedAt?: string;
  deviceId?: string;
  gps?: string;
  exif?: Record<string, unknown>;
  clientRequestId?: string;
}

/** INS-081: replace the bytes in an occupied slot, keeping the slot itself. */
export interface RetakePhotoInput {
  storageKey: string;
  contentHash: string;
}

export interface AddDefectInput {
  defectCatalogId?: string;
  customText?: string;
  severity?: DefectSeverity;
  /** INS-081: the tag list is loop-global, but the instance pins to a slot. */
  inspectionLoopItemId: string;
  cycleIndex: number;
  notes?: string;
  photoIds?: string[];
}

export interface AddMeasurementInput {
  /** INS-081: the sheet is loop-global and filled once per unit. */
  cycleIndex: number;
  label: string;
  recordedValue?: string;
  unit?: string;
  notes?: string;
}

export interface ApiPhoto {
  id: string;
  storageKey: string;
  contentHash?: string | null;
  inspectionLoopItemId: string;
  cycleIndex: number;
  capturedAt?: string | null;
  clientRequestId?: string | null;
  /** Short-lived presigned GET URL (INS-049) — present on GET /inspections/:id; null when presign fails. */
  viewUrl?: string | null;
}

export interface ApiDefectCatalogItem {
  id: string;
  name: string;
  severity: DefectSeverity;
  category?: string | null;
}

export interface ApiDefectInstance {
  id: string;
  severity: DefectSeverity;
  defectCatalog?: { id: string; name: string } | null;
  customText?: string | null;
  inspectionLoopItemId?: string | null;
  cycleIndex?: number | null;
  notes?: string | null;
}

export interface ApiMeasurement {
  id: string;
  label: string;
  recordedValue?: string | null;
  unit?: string | null;
  /** INS-081: a measurement belongs to a unit, not to a loop item. */
  cycleIndex: number;
}

export interface ApiInspectionLoopItem {
  id: string;
  /** Wire names are the Prisma-native columns (INS-064) — do NOT re-alias. */
  itemName: string;
  position: number;
  description?: string | null;
  referenceImageUrl?: string | null;
  photos?: ApiPhoto[];
  defects?: ApiDefectInstance[];
}

/**
 * INS-081: the server-computed cycle state. The console renders exactly the rule
 * the submit guard enforces — a divergence is how a half-shot unit would reach a
 * signed report, so this is never recomputed client-side.
 */
export interface ApiCycleState {
  completedCycles: number;
  partialCycles: { cycleIndex: number; missingItemIds: string[] }[];
  nextSlot: { cycleIndex: number; itemId: string } | null;
  totalPhotos: number;
}

export interface ApiReport {
  id: string;
  inspectionId: string;
  canonicalSnapshot?: Record<string, unknown> | null;
  contentHash?: string | null;
  signature?: string | null;
  pdfStorageKey?: string | null;
  generatedAt: string;
  generatedBy?: { id: string; name: string } | null;
}

/** GET /reports row (INS-062) — list metadata only, never canonicalSnapshot. */
export interface ApiReportListItem {
  id: string;
  inspectionId: string;
  status: string;
  generatedAt: string;
  contentHash?: string | null;
  pdfStorageKey?: string | null;
  verificationToken?: string | null;
  buyer?: { id: string; name: string } | null;
  inspection?: {
    status: string;
    purchaseOrder?: { poNumber: string } | null;
    product?: { styleNumber: string } | null;
  } | null;
}

export interface ApiVerifyResult {
  valid: boolean;
  hashMatches: boolean;
  signatureValid: boolean;
  reportId?: string | null;
  inspectionId?: string | null;
  generatedAt?: string | null;
}

/** Buyer-visible photo evidence on GET /guest/reports/:id (INS-049). */
export interface ApiGuestReportPhoto {
  id: string;
  contentHash?: string | null;
  inspectionLoopId?: string | null;
  viewUrl: string | null;
}

export interface ApiGuestReport {
  id: string;
  generatedAt: string;
  contentHash?: string | null;
  pdfStorageKey?: string | null;
  verificationToken?: string | null;
  canonicalSnapshot?: Record<string, unknown> | null;
  brandingSnapshot?: { logoUrl?: string | null; primaryColor?: string | null } | null;
  /** Present on the detail endpoint (GET /guest/reports/:id) only. */
  photos?: ApiGuestReportPhoto[];
}

export interface ApiInvitation {
  id: string;
  token: string;
  email: string;
  role: InvitableRole;
  expiresAt?: string;
  orgId: string;
  /** Whether the invitation email was actually delivered (MailService result). */
  emailSent?: boolean;
}

/** Public GET /invitations/:token — verified invite data (INS-054). 404 unknown; 410 consumed/expired. */
export interface ApiInvitationLookup {
  email: string;
  role: string;
  orgName: string | null;
  expiresAt: string;
}

/** GET /admin/orgs row (PLATFORM_ADMIN only). */
export interface ApiOrganization {
  id: string;
  name: string;
  type: OrgType;
  createdAt: string;
}

/** POST /admin/orgs — the org plus its first ORG_OWNER invitation. */
export interface ApiCreatedOrg {
  org: ApiOrganization;
  invitation: { token: string; email: string; role: string; expiresAt: string };
  emailSent: boolean;
}
