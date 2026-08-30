# @inspect/mobile — the Inspect field app

Expo SDK 57 (expo-router, React Native 0.86) app for inspectors and QA managers.
[INS-086](../../docs/future/BACKLOG.md) Phase 2: login + a read-only inspections list.
The screen-by-screen state lives in
[docs/reference/screen-migration-map.md](../../docs/reference/screen-migration-map.md);
the porting procedure is the `migrate-screen` skill, and the rules are
[.claude/rules/migration-discipline.md](../../.claude/rules/migration-discipline.md).

## Run

```sh
# from the repo root — the API must be reachable from the device:
EXPO_PUBLIC_INSPECT_API_URL=http://<lan-address>:3000 pnpm --filter @inspect/mobile start
```

`EXPO_PUBLIC_*` vars are inlined at bundle time. Until [INS-090](../../docs/future/BACKLOG.md)
lands a reachable HTTPS origin, a physical device needs the dev machine's LAN address —
`localhost` only resolves on an emulator.

## What lives where

- **HTTP + the credential exchange** — `@inspect/api-client` (`login`/`me`/`refresh`,
  `decodeJwtExp`). This app supplies only the SecureStore-backed `AuthProvider`
  (`src/lib/session.ts`). Never add a `fetch` call site.
- **Wire DTOs** — `@inspect/shared-types`. Declare no DTO here.
- **Role hierarchy** — `@inspect/domain`. **Colours/severity/role maps** —
  `@inspect/design-tokens`, composed into `StyleSheet` (the package is CSS-free by design).
- `orgId` is always null on mobile: org assumption is Platform-Admin-only and the app has
  no Platform Admin mode (decision D1). `/admin/orgs`, `/portal` and `/r/[token]` are
  permanently web-only.

## Toolchain notes (verified 2026-08-31)

- SDK 57 supports pnpm's **isolated** installs — no `nodeLinker: hoisted`, and no
  hand-written `metro.config.js` (monorepo Metro config is automatic since SDK 52; adding
  one is the bug, not the fix).
- React is pinned **once, at the root** (`pnpm.overrides`: react 19.2.3) — RN 0.86 requires
  it exactly, and two `@types/react` in the workspace broke the console's type-check via
  pnpm's hidden hoist until the pin.
- Metro consumes the shared packages' CJS `dist/` fine (plan decision D1) — verified by
  `expo export`. Rebuild a shared package (`pnpm build:api` / root `pnpm type-check`)
  before expecting a change to appear.
