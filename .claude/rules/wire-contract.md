---
paths:
  - "packages/shared-types/**"
  - "packages/api-client/**"
  - "packages/domain/**"
  - "packages/design-tokens/**"
  - "apps/web/lib/api.ts"
---

# The wire contract

`@inspect/shared-types` is the **single source of truth** for every type that crosses the network — for the
API, the web console, and the mobile app alike.

## Rules

- **Never redeclare a DTO or enum that belongs in `shared-types`.** If a type describes something sent over
  HTTP or stored in a JSON column, it lives in `packages/shared-types/src/` and is imported. Redeclaring it
  locally is how the console and the API drifted in the first place ([INS-008](../../docs/future/BACKLOG.md)).
- **No runtime dependencies in `shared-types`.** It is consumed by a NestJS server, a Next.js server and a
  React Native bundle. Anything Node-only or DOM-only breaks one of the three.
- **Enums are a `as const` tuple plus a derived union**, not a TypeScript `enum` — so they can be iterated
  at runtime and shared without importing the Prisma client. Follow the existing shape in `src/enums.ts`.
- **`api-client` owns HTTP, not auth.** It takes an injected token provider and a base URL. It must never
  read a cookie, `next/headers`, `expo-secure-store`, or any other platform-specific source directly — each
  app supplies its own provider. This is what keeps the web console's server-side-only token model
  ([INS-045](../../docs/future/BACKLOG.md)) intact while mobile uses the Keychain.
- **`api-client` throws `ApiError` carrying the HTTP status**, never a bare `Error`. Callers branch on
  status (404 vs. 409 vs. 410) and that distinction is load-bearing across the product — see the invite
  state machine and the filled-slot 409.

- **A DTO must describe what the API actually SENDS, not what seems reasonable.** `apiGet<T>(path)` *asserts*
  a shape rather than checking one, so a wrong field name is invisible to `tsc`, to `next build` and to every
  suite — it just reads `undefined` forever. Five shipped that way before this rule existed, three of them
  user-visible: a reports column that was always an em-dash, a populate screen where **no catalog defect
  could be tagged at all**, and a "signed by" that was always blank.
  `apps/api/src/common/wire-contract.spec.ts` now enforces this: every DTO field must exist on the Prisma
  model it describes, every DTO must be either mapped to a model or explicitly declared computed, and any
  genuine decoration (`viewUrl`, `_count`, `cycleState`) needs an entry with a reason. It does **not** check
  nested shapes, omitted `select`s, or types — see the note at the top of that file.

## Verifying a change

After touching either package, both apps must still type-check:

```
pnpm type-check
```

`turbo.json`'s `type-check` task carries `dependsOn: ["^build"]`, so the package builds before either app
checks against it.
