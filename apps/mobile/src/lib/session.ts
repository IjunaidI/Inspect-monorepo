/**
 * The SecureStore-backed session — mobile's counterpart to the console's
 * `nextAuthContext()` in `apps/web/lib/api.ts`.
 *
 * This module owns exactly one thing: WHERE credentials live (Keychain /
 * Keystore via `expo-secure-store`). The exchange itself — login, me, refresh,
 * expiry decoding — is `@inspect/api-client` (INS-088) and is not re-implemented
 * here. Never add a second `fetch` call site.
 */
import { createApiClient, decodeJwtExp, DEFAULT_ACCESS_TTL_MS } from '@inspect/api-client';
import type { AuthContext, MeResult } from '@inspect/api-client';
import * as SecureStore from 'expo-secure-store';

import { API_URL } from './config';

const KEY_ACCESS = 'inspect.accessToken';
const KEY_REFRESH = 'inspect.refreshToken';
const KEY_EXPIRES = 'inspect.accessTokenExpires';
const KEY_IDENTITY = 'inspect.identity';

/** Same 60s early-refresh skew the console applies. */
const REFRESH_SKEW_MS = 60_000;

/**
 * Refresh the pair when the access token is inside the skew window. Falls back
 * to the stale token when refresh fails — `client.refresh()` never throws, and
 * the next request's 401 is the honest answer (the client's own contract).
 */
async function currentAccessToken(): Promise<string | null> {
  const token = await SecureStore.getItemAsync(KEY_ACCESS);
  if (!token) return null;

  const expiresRaw = await SecureStore.getItemAsync(KEY_EXPIRES);
  const expires = expiresRaw ? Number(expiresRaw) : null;
  if (expires && Date.now() < expires - REFRESH_SKEW_MS) return token;

  const refreshed = await client.refresh(await SecureStore.getItemAsync(KEY_REFRESH));
  if (!refreshed) return token;

  await SecureStore.setItemAsync(KEY_ACCESS, refreshed.accessToken);
  await SecureStore.setItemAsync(KEY_REFRESH, refreshed.refreshToken);
  await SecureStore.setItemAsync(KEY_EXPIRES, String(refreshed.accessTokenExpires));
  return refreshed.accessToken;
}

/**
 * `orgId` is always null on mobile: org assumption is Platform-Admin-only and
 * the app has no Platform Admin mode (decision D1). Never attach `X-Org-Id`.
 */
async function secureStoreAuthProvider(): Promise<AuthContext> {
  return { token: await currentAccessToken(), orgId: null };
}

/** The app's ONE api client. Every screen imports this, never `fetch`. */
export const client = createApiClient({
  baseUrl: API_URL,
  auth: secureStoreAuthProvider,
});

export interface Identity {
  userId?: string;
  email?: string;
  role?: string;
  orgName?: string | null;
}

/** Exchange credentials, persist the session. Throws `ApiError` when refused. */
export async function signIn(email: string, password: string): Promise<Identity> {
  const pair = await client.login(email, password);
  const me: MeResult = await client.me(pair.accessToken);

  const identity: Identity = {
    userId: me.userId,
    email: me.email,
    role: me.role,
    orgName: me.orgName ?? null,
  };
  await SecureStore.setItemAsync(KEY_ACCESS, pair.accessToken);
  await SecureStore.setItemAsync(KEY_REFRESH, pair.refreshToken);
  await SecureStore.setItemAsync(
    KEY_EXPIRES,
    String(decodeJwtExp(pair.accessToken) ?? Date.now() + DEFAULT_ACCESS_TTL_MS),
  );
  await SecureStore.setItemAsync(KEY_IDENTITY, JSON.stringify(identity));
  return identity;
}

export async function signOut(): Promise<void> {
  await Promise.all(
    [KEY_ACCESS, KEY_REFRESH, KEY_EXPIRES, KEY_IDENTITY].map((k) => SecureStore.deleteItemAsync(k)),
  );
}

export async function hasSession(): Promise<boolean> {
  return (await SecureStore.getItemAsync(KEY_ACCESS)) !== null;
}

export async function loadIdentity(): Promise<Identity | null> {
  const raw = await SecureStore.getItemAsync(KEY_IDENTITY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Identity;
  } catch {
    return null;
  }
}
