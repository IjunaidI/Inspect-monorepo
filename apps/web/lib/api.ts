import { auth } from './auth';

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

/** Current session's API access token (server-side only). */
export async function apiToken(): Promise<string | null> {
  const session = (await auth()) as unknown as { accessToken?: string } | null;
  return session?.accessToken ?? null;
}

/**
 * Unauthenticated GET — for public endpoints (guest portal, verify).
 * Does NOT call auth(); safe to use from pages with no session.
 */
export async function apiGetPublic<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`API GET ${path} failed: ${res.status}`);
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
  const token = await apiToken();
  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
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
 * Re-throws 401/403 — those are auth failures, not "API offline"; the layout
 * intercepts these before any page renders (see ConsoleLayout).
 */
export async function loadOrFallback<T>(path: string, fallback: T): Promise<{ data: T; live: boolean }> {
  try {
    const data = await apiGet<T>(path);
    return { data, live: true };
  } catch (e) {
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
  const token = await apiToken();
  const hasBody = body !== undefined;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
/** GET /dashboard/summary — org-scoped rollups for the console dashboard (INS-005). */
export interface ApiDashboardSummary {
  inspectionsByStatus: Record<string, number>;
  buyers: number;
  suppliers: number;
  products: number;
  purchaseOrders: number;
  reports: number;
}
export interface ApiBuyer {
  id: string;
  name: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  branding?: Record<string, unknown> | null;
  defaultLoopPresetId?: string | null;
  archivedAt?: string | null;
  updatedAt?: string;
  /** INS-005 list aggregates — present on GET /buyers rows. */
  _count?: { purchaseOrders: number; inspections: number; reports: number };
}
export interface ApiSupplier {
  id: string;
  name: string;
  address?: string | null;
  gps?: { lat: number; lng: number } | null;
  archivedAt?: string | null;
  updatedAt?: string;
  /** INS-005 list aggregates — present on GET /suppliers rows. */
  _count?: { purchaseOrders: number; inspections: number };
}
export interface ApiProduct {
  id: string;
  styleNumber: string;
  description?: string | null;
  archivedAt?: string | null;
  updatedAt?: string;
  /** INS-005 list aggregates — present on GET /products rows. */
  _count?: { purchaseOrders: number; inspections: number };
}
export interface ApiBuyerGuest {
  id: string;
  email: string;
  status: string;
  lastAccessAt: string | null;
  tokenExpiresAt: string;
  createdAt: string;
}
export interface ApiLoopPreset {
  id: string;
  name: string;
  version: number;
  description?: string | null;
  aqlLevel?: string | null;
  isArchived: boolean;
  updatedAt?: string;
  /** INS-005 list aggregates — present on GET /loop-presets rows. */
  _count?: { steps: number; inspections: number; defaultForBuyers: number };
}

export interface ApiMeasurementField {
  id: string;
  label: string;
  unit?: string | null;
  position: number;
}

export interface ApiAllowedDefect {
  id: string;
  defectCatalog: {
    id: string;
    name: string;
    defaultSeverity: 'CRITICAL' | 'MAJOR' | 'MINOR';
  };
}

export interface ApiPresetStep {
  id: string;
  zoneName: string;
  description?: string | null;
  referenceImageUrls: string[];
  requiredShotCount: number;
  position: number;
  measurementFields: ApiMeasurementField[];
  allowedDefects: ApiAllowedDefect[];
}

export interface ApiLoopPresetDetail extends ApiLoopPreset {
  steps: ApiPresetStep[];
}

export interface ApiDefectCatalog {
  id: string;
  name: string;
  defaultSeverity: 'CRITICAL' | 'MAJOR' | 'MINOR';
  scope: 'GLOBAL' | 'ORG';
  isArchived: boolean;
}
export interface ApiUser {
  id: string;
  email: string;
  name: string;
  role: 'INSPECTOR' | 'QA_MANAGER' | 'ORG_OWNER' | 'PLATFORM_ADMIN';
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'DEACTIVATED';
  lastLoginAt?: string | null;
}
export interface ApiAqlResult {
  systemRecommendation: 'PASS' | 'FAIL';
  perClass: Record<'critical' | 'major' | 'minor', { found: number; ac: number; re: number; outcome: 'PASS' | 'FAIL' }>;
  qaDecision?: 'PASS' | 'FAIL' | 'HOLD' | null;
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
  buyer?: { id: string; name: string; primaryColor?: string | null } | null;
  supplier?: { id: string; name: string; gps?: { lat: number; lng: number } | null } | null;
  product?: { id: string; styleNumber: string } | null;
  purchaseOrder?: { id: string; poNumber: string } | null;
  /** Present on GET /inspections/:id (safe select: id/name/email). */
  assignedInspector?: { id: string; name: string | null; email: string } | null;
  createdAt?: string;
  loops?: ApiInspectionLoop[];
  inspectorId?: string | null;
  supersedesInspectionId?: string | null;
}
export interface ApiPurchaseOrder {
  id: string;
  poNumber: string;
  totalQuantity?: number | null;
  buyer?: { id: string; name: string } | null;
  supplier?: { id: string; name: string } | null;
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
  inspectionLoopId?: string;
  thumbnailKey?: string;
  capturedAt?: string;
  deviceId?: string;
  gps?: string;
  exif?: Record<string, unknown>;
  clientRequestId?: string;
}

export interface AddDefectInput {
  defectCatalogId?: string;
  customText?: string;
  severity?: 'CRITICAL' | 'MAJOR' | 'MINOR';
  inspectionLoopId?: string;
  notes?: string;
  photoIds?: string[];
}

export interface AddMeasurementInput {
  inspectionLoopId: string;
  label: string;
  recordedValue?: string;
  unit?: string;
  notes?: string;
}

export interface ApiPhoto {
  id: string;
  storageKey: string;
  contentHash?: string | null;
  inspectionLoopId?: string | null;
  capturedAt?: string | null;
  clientRequestId?: string | null;
}

export interface ApiDefectCatalogItem {
  id: string;
  name: string;
  severity: 'CRITICAL' | 'MAJOR' | 'MINOR';
  category?: string | null;
}

export interface ApiDefectInstance {
  id: string;
  severity: 'CRITICAL' | 'MAJOR' | 'MINOR';
  defectCatalog?: { id: string; name: string } | null;
  customText?: string | null;
  inspectionLoopId?: string | null;
  notes?: string | null;
}

export interface ApiMeasurement {
  id: string;
  label: string;
  recordedValue?: string | null;
  unit?: string | null;
  inspectionLoopId?: string | null;
}

export interface ApiInspectionLoop {
  id: string;
  name: string;
  orderIndex: number;
  requiredPhotoCount?: number | null;
  photos?: ApiPhoto[];
  defects?: ApiDefectInstance[];
  measurements?: ApiMeasurement[];
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

export interface ApiVerifyResult {
  valid: boolean;
  hashMatches: boolean;
  signatureValid: boolean;
  reportId?: string | null;
  inspectionId?: string | null;
  generatedAt?: string | null;
}

export interface ApiGuestReport {
  id: string;
  generatedAt: string;
  contentHash?: string | null;
  pdfStorageKey?: string | null;
  verificationToken?: string | null;
  canonicalSnapshot?: Record<string, unknown> | null;
  brandingSnapshot?: { logoUrl?: string | null; primaryColor?: string | null } | null;
}

export interface ApiInvitation {
  id: string;
  token: string;
  email: string;
  role: 'INSPECTOR' | 'QA_MANAGER' | 'ORG_OWNER';
  expiresAt?: string;
  orgId: string;
  /** Whether the invitation email was actually delivered (MailService result). */
  emailSent?: boolean;
}
