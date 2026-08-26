/**
 * `@inspect/api-client` — one dependency-free HTTP client for the Inspect API,
 * shared by the console and the mobile app (INS-086 Phase 1).
 *
 * It owns HTTP, not auth: credentials arrive through an injected provider so
 * the console can keep its bearer token server-side (INS-045) while mobile
 * reads the Keychain. See `.claude/rules/wire-contract.md`.
 */
export { ApiError } from './errors';
export { createApiClient } from './client';
export type { ApiClient, ApiClientOptions, AuthContext, AuthProvider } from './client';
