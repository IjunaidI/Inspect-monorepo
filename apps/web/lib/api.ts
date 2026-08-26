import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getToken } from 'next-auth/jwt';
import { ApiError, createApiClient, type AuthContext } from '@inspect/api-client';
import { refreshApiAccessToken } from './auth';
import { getAssumedOrgId } from './admin-org';
import type {
  AllowedDefectDto,
  AqlPreviewDto,
  AqlResultDto,
  CompanyDto,
  CompanyGuestDto,
  CompanyKind,
  CreatedOrgDto,
  CycleStateDto,
  DashboardSummaryDto,
  DefectCatalogDto,
  DefectCatalogItemDto,
  DefectInstanceDto,
  GuestReportDto,
  GuestReportPhotoDto,
  InspectionDto,
  InspectionLoopItemDto,
  InvitationDto,
  InvitationLookupDto,
  LoopPresetDetailDto,
  LoopPresetDto,
  MeasurementDto,
  MeasurementFieldDto,
  OrganizationDto,
  PhotoDto,
  PresetItemDto,
  PresignResultDto,
  ProductDto,
  PurchaseOrderDto,
  QaDecisionCountsDto,
  QualityMetricsDto,
  ReportDto,
  ReportListItemDto,
  UserDto,
  VerifyResultDto,
} from '@inspect/shared-types';

const API_URL = process.env.INSPECT_API_URL ?? 'http://localhost:3000';

/**
 * The console's API layer (INS-086 Phase 1).
 *
 * HTTP now lives in `@inspect/api-client`, shared with the mobile app. What
 * stays here is everything that is genuinely Next-specific: reading the
 * encrypted NextAuth cookie, the Platform-Admin org-assumption cookie, and
 * `loadOrFallback`'s demo-data + redirect policy.
 */

/** Re-exported so the ~47 call sites importing it from here keep working. */
export { ApiError };

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
 * landing right at expiry still authenticates instead of 401-ing. The renewal is
 * in-memory only: Auth.js discards Set-Cookie outside middleware, so
 * middleware.ts stays the one place that persists a rotated token. On refresh
 * failure we send the stale token and let the API return 401.
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
 * The injected auth provider (`.claude/rules/wire-contract.md`).
 *
 * Resolves the bearer token and, for a verified Platform Admin operating inside
 * an assumed org, the X-Org-Id selector (INS-079) — from ONE decryption of the
 * NextAuth JWT. The role check is defense-in-depth (the API guard ignores the
 * header for anyone else regardless) against a stale `inspect_admin_org` cookie
 * surviving into a different session on a shared browser. Deliberately NOT
 * consulted by the public helpers — those are unauthenticated by contract, and
 * the client enforces that rather than trusting each call site.
 */
async function nextAuthContext(): Promise<AuthContext> {
  const jwt = await readSessionJwt();
  const token = await accessTokenFrom(jwt);
  const orgId = jwt?.role === 'PLATFORM_ADMIN' ? await getAssumedOrgId() : null;
  return { token, orgId };
}

const client = createApiClient({ baseUrl: API_URL, auth: nextAuthContext });

/**
 * Unauthenticated GET — for public endpoints (guest portal, verify, invite
 * lookup). Throws ApiError on non-2xx so callers can branch on the HTTP status
 * (e.g. 404 unknown invite vs 410 consumed/expired). Network failures still
 * surface as fetch's TypeError — distinct from an API-level error.
 */
export const apiGetPublic = <T,>(path: string): Promise<T> => client.getPublic<T>(path);

/** Unauthenticated POST — for public endpoints (accept invitation). */
export const apiPostPublic = <T,>(path: string, body?: unknown): Promise<T> =>
  client.postPublic<T>(path, body);

/**
 * Server-side GET against the NestJS API with the session bearer token.
 * Always no-store (live data) — pages that use it are dynamic.
 */
export const apiGet = <T,>(path: string): Promise<T> => client.get<T>(path);

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
 *
 * Deliberately NOT in `@inspect/api-client`: both behaviours are console-only.
 * Mobile has no demo-preview mode and, by spec decision D1, no Platform Admin
 * mode — so it has no /admin/orgs to redirect to.
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

/**
 * Server-side mutations against the NestJS API with the session bearer token.
 * Use from Server Actions / route handlers. Sends `body` as JSON when provided;
 * surfaces the API's error message via `ApiError`; returns `undefined` for an
 * empty/204 response.
 */
export const apiPost = <T,>(path: string, body?: unknown): Promise<T> => client.post<T>(path, body);
export const apiPut = <T,>(path: string, body?: unknown): Promise<T> => client.put<T>(path, body);
export const apiPatch = <T,>(path: string, body?: unknown): Promise<T> => client.patch<T>(path, body);
export const apiDelete = <T,>(path: string, body?: unknown): Promise<T> => client.del<T>(path, body);

// ── Wire shapes (INS-086 Phase 1) ────────────────────────────────────────────
// These live in `@inspect/shared-types` so the API, the console and the mobile
// app share one declaration. The `Api*` names are kept as aliases: ~47 call
// sites read them, and renaming would be churn without benefit. What matters is
// that each shape is declared exactly once.
//
// INS-055 — `ApiCompany` is the unified counterparty, replacing ApiBuyer +
// ApiSupplier: one row that can act as the client on one PO and the factory on
// another, carrying BOTH the ex-Buyer branding fields and the ex-Supplier
// address/GPS fields. Trade role is never read from here — it lives on the
// PurchaseOrder/Inspection/Report edge.
export type ApiProduct = ProductDto;
export type ApiCompany = CompanyDto;
export type ApiCompanyGuest = CompanyGuestDto;
export type ApiCompanyKind = CompanyKind;

export type ApiQaDecisionCounts = QaDecisionCountsDto;
export type ApiQualityMetrics = QualityMetricsDto;
export type ApiDashboardSummary = DashboardSummaryDto;
export type ApiLoopPreset = LoopPresetDto;
export type ApiMeasurementField = MeasurementFieldDto;
export type ApiAllowedDefect = AllowedDefectDto;
export type ApiPresetItem = PresetItemDto;
export type ApiLoopPresetDetail = LoopPresetDetailDto;
export type ApiDefectCatalog = DefectCatalogDto;
export type ApiUser = UserDto;
export type ApiAqlResult = AqlResultDto;
export type ApiInspection = InspectionDto;
export type ApiPurchaseOrder = PurchaseOrderDto;
export type AqlPreview = AqlPreviewDto;
export type PresignResult = PresignResultDto;
export type ApiPhoto = PhotoDto;
export type ApiDefectCatalogItem = DefectCatalogItemDto;
export type ApiDefectInstance = DefectInstanceDto;
export type ApiMeasurement = MeasurementDto;
export type ApiInspectionLoopItem = InspectionLoopItemDto;
export type ApiCycleState = CycleStateDto;
export type ApiReport = ReportDto;
export type ApiReportListItem = ReportListItemDto;
export type ApiVerifyResult = VerifyResultDto;
export type ApiGuestReportPhoto = GuestReportPhotoDto;
export type ApiGuestReport = GuestReportDto;
export type ApiInvitation = InvitationDto;
export type ApiInvitationLookup = InvitationLookupDto;
export type ApiOrganization = OrganizationDto;
export type ApiCreatedOrg = CreatedOrgDto;

// Already `Input`-suffixed, which is the package's own convention for request
// bodies (cf. CreateCompanyInput) — re-exported rather than aliased.
export type {
  RegisterPhotoInput,
  RetakePhotoInput,
  AddDefectInput,
  AddMeasurementInput,
} from '@inspect/shared-types';
