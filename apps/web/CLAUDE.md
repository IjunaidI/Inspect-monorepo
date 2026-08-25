# apps/web — Next.js 15 App Router console

Port **3001** (hardcoded in the `dev`/`start` scripts). React 19, NextAuth v5, Tailwind, shadcn/ui. The
domain invariants in the repo-root `CLAUDE.md` are binding here — this file covers stack convention only.

## Commands

`pnpm web dev` · `build` · `type-check`. Talks to the API at `INSPECT_API_URL`;
falls back to demo data when the API is unreachable.

> **No test runner yet** — the console is verified by `tsc` + `next build` only. Adding one is
> [INS-082](../../docs/future/BACKLOG.md), and it is a **blocking prerequisite** for the shared-package
> extraction, because `tsc` cannot catch a behaviour change in `lib/api.ts`.

## Architecture

- **Routing** — screens under `app/(console)/` plus `app/{login,invite,portal,report,logout,r}/`.
  `(console)` is a route group (shared shell layout), not a URL segment.
- **Reads are Server Components; writes are Server Actions.** The API bearer token stays server-side.
- **Auth** — NextAuth Credentials (`lib/auth.ts`) POSTs to the API `/auth/login`, then GETs `/auth/me`. The
  API remains the canonical RBAC authority; UI role checks are convenience only.
- **Data layer** — `lib/api.ts`: `apiGet`/`loadOrFallback` (live read with demo fallback),
  `apiPost/Put/Patch/Delete` + `ApiError`, and unauthenticated `apiGetPublic`/`apiPostPublic`.
- **The token lives only in the encrypted NextAuth cookie**, never on the session object
  ([INS-045](../../docs/future/BACKLOG.md)). `readSessionJwt()` detects the cookie name from the request
  because Auth.js derives the JWE salt from it — never assume the name, or the decrypt silently yields null.
- **`X-Org-Id`** is attached only for a verified `PLATFORM_ADMIN` operating inside an assumed org, and only
  in `apiGet`/`apiSend` — never on the public helpers, which are unauthenticated by contract.

## Design system

`components/inspect/` (`tokens.ts`, `shell.tsx`, `branded-report.tsx`) — Inter + JetBrains Mono, `#037BF4`
accent, 1px hairlines, no shadows. `components/ui/` is shadcn/Radix. **Do not introduce a second component
vocabulary.** Never hardcode a hex value that already exists in `tokens.ts` — notably `ui.danger` and
`ui.assumeBg`.

## What does NOT cross to React Native

Relevant when working alongside the mobile migration ([the design](../../docs/in-progress/specs/2026-08-26-inspect-react-native-migration-design.md)):

| Stays web-only | Why |
|---|---|
| Server Components, Server Actions | No RN equivalent |
| NextAuth, the JWE cookie, `next/headers` | Native uses Keychain/Keystore via `expo-secure-store` |
| Tailwind classes, shadcn, Radix | No DOM |
| `middleware.ts` | Edge-runtime routing |

What **does** cross: the `Api*` types, `tokens.ts` values, `lib/roles.ts`, and the HTTP call sites — which is
exactly what gets extracted into `@inspect/{shared-types,api-client,domain,design-tokens}`. When a rule moves
into a shared package, **this app is re-pointed at it in the same change**. Never let mobile fork a copy.
