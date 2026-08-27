# apps/web — Next.js 15 App Router console

Port **3001** (hardcoded in the `dev`/`start` scripts). React 19, NextAuth v5, Tailwind, shadcn/ui. The
domain invariants in the repo-root `CLAUDE.md` are binding here — this file covers stack convention only.

## Commands

`pnpm web dev` · `build` · `type-check`. Talks to the API at `INSPECT_API_URL`;
falls back to demo data when the API is unreachable.

> **Vitest since [INS-082](../../docs/future/BACKLOG.md)** — `pnpm web test` (38 tests across
> `lib/api.test.ts`, `lib/roles.test.ts` and `components/inspect/tokens.test.ts`), picked up by root
> `pnpm test`. It exists because `tsc` cannot catch a behaviour change in `lib/api.ts`. **Its first 32 tests
> were the acceptance instrument for the Phase 1 extraction and passed through it unchanged**; if one goes
> red during a refactor it has found a real regression in the role gate or `loadOrFallback`'s branch table —
> it is not a test to update.
>
> ⚠️ The config aliases `@inspect/*` to package **source**, so this suite cannot see a stale `dist` — and
> equally cannot see a **missing** workspace dependency. `pnpm type-check` is the wiring gate, not this.

## Architecture

- **Routing** — screens under `app/(console)/` plus `app/{login,invite,portal,report,logout,r}/`.
  `(console)` is a route group (shared shell layout), not a URL segment.
- **Reads are Server Components; writes are Server Actions.** The API bearer token stays server-side.
- **Auth** — NextAuth Credentials (`lib/auth.ts`) POSTs to the API `/auth/login`, then GETs `/auth/me`. The
  API remains the canonical RBAC authority; UI role checks are convenience only.
- **Data layer** — HTTP lives in `@inspect/api-client` since [INS-086](../../docs/future/BACKLOG.md) Phase 1.
  `lib/api.ts` is now the **Next adapter**: it builds the injected auth provider (one JWE decrypt yielding
  both the bearer token and `X-Org-Id`), wraps the client as `apiGet`/`apiPost/Put/Patch/Delete`/
  `apiGetPublic`/`apiPostPublic`, and keeps `loadOrFallback` — whose demo fallback and `/admin/orgs` redirect
  are console-only. Wire types are aliases onto `@inspect/shared-types`; **declare no new DTO here.**
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

What **does** cross already lives in `@inspect/{shared-types,api-client,domain,design-tokens}` as of
[INS-086](../../docs/future/BACKLOG.md) Phase 1: the wire DTOs, the palette and severity/role maps, the role
hierarchy, and every HTTP call site **except** the login/refresh/me exchange in `lib/auth.ts`
([INS-088](../../docs/future/BACKLOG.md), still open — it is edge-runtime coupled via `middleware.ts`).

`components/inspect/tokens.ts` and `lib/roles.ts` still exist, but they now compose or re-export rather than
own: `tokens.ts` adds only the Next font CSS variables and `mono` as `CSSProperties`; `roles.ts` keeps only
`apiRoleToRoleKey`, which maps a role onto a badge key and is therefore presentation.

When a rule moves into a shared package, **this app is re-pointed at it in the same change**. Never let
mobile fork a copy.
