import { auth } from './auth';

const API_URL = process.env.INSPECT_API_URL ?? 'http://localhost:3000';

/** Current session's API access token (server-side only). */
export async function apiToken(): Promise<string | null> {
  const session = (await auth()) as unknown as { accessToken?: string } | null;
  return session?.accessToken ?? null;
}

/**
 * Server-side GET against the NestJS API with the session bearer token.
 * Always no-store (live data) — pages that use it are dynamic.
 */
export async function apiGet<T>(path: string): Promise<T> {
  const token = await apiToken();
  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store'
  });
  if (!res.ok) {
    throw new Error(`API GET ${path} failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

/**
 * Load live data from the API, falling back to design demo data when the API is
 * unreachable or the caller is unauthenticated (keeps previews working offline).
 * Returns `{ data, live }` so the UI can badge the source if it wants.
 */
export async function loadOrFallback<T>(path: string, fallback: T): Promise<{ data: T; live: boolean }> {
  try {
    const data = await apiGet<T>(path);
    return { data, live: true };
  } catch {
    return { data: fallback, live: false };
  }
}

// ── Response shapes (subset of the Prisma models the screens read) ──
export interface ApiBuyer {
  id: string;
  name: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
}
export interface ApiSupplier {
  id: string;
  name: string;
  address?: string | null;
  gps?: unknown;
}
export interface ApiLoopPreset {
  id: string;
  name: string;
  version: number;
  description?: string | null;
  isArchived: boolean;
  _count?: { steps: number };
}
export interface ApiUser {
  id: string;
  email: string;
  name: string;
  role: 'INSPECTOR' | 'QA_MANAGER' | 'ORG_OWNER' | 'PLATFORM_ADMIN';
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'DEACTIVATED';
  lastLoginAt?: string | null;
}
