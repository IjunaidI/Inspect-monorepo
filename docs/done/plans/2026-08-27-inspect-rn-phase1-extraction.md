# INS-086 Phase 1 — Shared-Package Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the console's platform-free layer into `@inspect/design-tokens`, `@inspect/domain` and
`@inspect/api-client`, and re-point `apps/web` at all three — with the console behaving **identically**.

**Architecture:** Approach A (spec §2). The three new packages join `@inspect/shared-types` under
`packages/`, all four built to `dist/` by `tsc` exactly like the existing one. `apps/web` keeps its current
module paths — `@/components/inspect/tokens`, `@/lib/roles`, `@/lib/api` — but those files stop *owning*
logic and become thin platform adapters over the packages. That is what keeps the diff at four files instead
of ninety-two, and it is what lets the existing 32 Vitest tests keep pointing at the same modules and act as
the acceptance instrument. The one genuinely new abstraction is `createApiClient({ baseUrl, auth })`: the
HTTP layer stops reaching into `next/headers` / `next-auth/jwt` itself and instead receives an **injected
auth provider**, which is precisely the seam that lets mobile supply a SecureStore-backed one in Phase 2.

**Tech Stack:** pnpm 9 workspaces + Turborepo · TypeScript 5.7 (strict) · Vitest 4 · Next 15 · NextAuth v5

**Spec:** [../specs/2026-08-26-inspect-react-native-migration-design.md](../../in-progress/specs/2026-08-26-inspect-react-native-migration-design.md)
(§2.1 the packages · §2.2 what is deliberately not shared · §4.4 the re-point rule · §6 phase table · §9 open questions)

**Backlog item:** [INS-086](../../future/BACKLOG.md) · **Path-scoped rule that governs two of these packages:**
[`.claude/rules/wire-contract.md`](../../../.claude/rules/wire-contract.md)

---

## Global Constraints

- **Phase 1 is extraction ONLY.** No mobile code, no `apps/mobile/`, no Expo dependency enters the tree.
- **The acceptance is "no behavioural change."** `pnpm web test` must stay **32 passing / 2 files**. A red
  test is a real regression, **never** a test to update. If a test must change, stop and escalate.
- **The re-point rule (spec §4.4) is non-negotiable:** when logic moves into a package, `apps/web` is
  re-pointed at it **in the same commit**. Never leave a second copy behind.
- **`api-client` owns HTTP, not auth** (`wire-contract.md`). It must never read a cookie, `next/headers`,
  `expo-secure-store`, or any other platform-specific source. It takes an injected provider and a base URL.
- **`api-client` throws `ApiError` carrying the HTTP status**, never a bare `Error`. Callers branch on
  status (404 vs 409 vs 410) and that distinction is load-bearing across the product.
- **No runtime dependencies in a shared package** beyond other `@inspect/*` packages. All three are consumed
  by a Next.js server today and a React Native bundle later; anything Node-only or DOM-only breaks one.
- **Packages build to `dist/`** (`main: dist/index.js`, `types: dist/index.d.ts`) exactly like
  `@inspect/shared-types`. See Decision D1 for why, and for the vitest alias that removes the stale-`dist` trap.
- **Every commit message ends with the INS id**, e.g. `(INS-086)`.
- **Run the API suites in band:** `apps/api/node_modules/.bin/jest --runInBand`. Root `pnpm test` OOMs under
  Jest's parallel workers on this machine ([INS-085](../../future/BACKLOG.md)).
- **`pnpm` 9.15.9 is on PATH directly.** Do not use `npx -y pnpm@9.12.0` (V8 fatal crash), and note
  `pnpm --filter @inspect/api exec jest` reports "Command jest not found".

### Baseline to preserve (measured 2026-08-27 on `8e8e190`)

| Gate | Command | Baseline |
|---|---|---|
| Web unit | `pnpm web test` | **32 passing / 2 files**, ~0.5s |
| API unit | `apps/api/node_modules/.bin/jest --runInBand` | **634 passing / 41 suites**, exit 0 |
| Types | `pnpm type-check` | clean, 4 tasks |
| Lint | `pnpm lint` | 0 errors |
| Build | `pnpm build` | 3 tasks |

After this plan, `pnpm type-check` covers **7** tasks and `pnpm build` **6** — the three new packages join.

---

## Decisions taken in Phase 1

These were open when the plan was written. They are recorded here because spec §9 explicitly defers two of
them to "Phase 1, with the code in front of you", and because an executor will otherwise re-litigate them.

**D1 — Packages build to `dist/`; vitest is aliased to `src/`.** The spec (§2.1) suggests source-as-entry
(`main: ./src/index.ts`). Reality vetoes it for this repo: `@inspect/shared-types` is consumed by the NestJS
API, whose Jest config has `rootDir: "src"` and no `transformIgnorePatterns` override, so a TypeScript entry
inside `node_modules` would not be transformed and **634 API tests would break** in a phase whose stated
acceptance is "boring". Rather than run two entry conventions side by side, all packages keep the proven
`dist` shape. The real cost of `dist` — a stale build silently passing tests — is removed exactly where it is
dangerous by aliasing `@inspect/*` to package **source** in `apps/web/vitest.config.mts`. The acceptance
instrument therefore always tests the code you just wrote; Next and Nest consume `dist` as they do today.
Revisit for Metro in Phase 2, where source-as-entry has an actual payoff.

**D2 — `@inspect/domain` gets `roleAtLeast` and `initialsFrom`, not `apiRoleToRoleKey`.** The first two are
platform-free rules mobile needs verbatim. `apiRoleToRoleKey` maps an API role onto a **badge colour key**
(`RoleKey`, which lives in design-tokens) — that is presentation, and it stays in `apps/web/lib/roles.ts`.
Putting it in domain would force domain to depend on design-tokens, inverting the layering.

**D3 — `@inspect/domain` does NOT absorb `apps/api/src/inspections/cycle-state.ts`** (closes spec §9's open
question). The console never computes cycle state: it reads `inspection.cycleState` straight off the API
response (`populate-workspace.tsx:81`), and mobile will do the same. There is no duplication to remove, so
moving it would buy nothing and would make the API depend on a workspace package it does not need.

**D4 — the API IS re-pointed at `@inspect/domain` (Task 5).** `apps/api/src/auth/rbac.ts` holds a
near-duplicate `ROLE_RANK` table. Leaving it would violate spec §4.4's requirement that each migration
*reduce* total logic, so the phase carries it. This is the reason D1's `dist` packaging is not optional:
the NestJS build and its Jest both consume `@inspect/domain` through `node_modules`.
*(Originally scoped out of Phase 1 to protect 634 API tests; the human partner chose to include it, so the
task below front-loads a full API-suite run as its gate.)*

**D5 — the 34 `Api*` response interfaces move to `@inspect/shared-types` (Task 4).** They belong there by
`wire-contract.md`'s own rule — "if a type describes something sent over HTTP … it lives in
`packages/shared-types/src/`" — and today `apps/web/lib/api.ts` is the single declaration of the entire wire
shape, which no second client can reach. They are renamed to the established `XxxDto` convention with
`export type ApiX = XxxDto` aliases kept in web, exactly as INS-055 did for `ProductDto` / `CompanyDto`, so
none of the ~47 call sites change.

**D7 — a live defect found while reading those DTOs, fixed in Task 4.** `ApiReportListItem` declares
`buyer?: { id; name } | null`, but `reports.service.ts:595` selects `clientCompany`. The field is optional,
so `tsc` never complained — and `app/(console)/reports/page.tsx:57` renders `r.buyer?.name ?? '—'`, meaning
**the reports list has shown an em-dash in its client column for every row since INS-055 shipped**. Renaming
the DTO field turns the stale read into a compile error, which is the fix's own proof.

**D6 — two deliberate, documented behaviour widenings in `api-client`.** Both make a *crash* into a defined
value; neither changes any currently-working call:
1. `apiPostPublic` throws `ApiError` instead of a bare `Error`. Its only caller
   (`app/invite/actions.ts:21`) branches on `e instanceof Error`, which `ApiError` satisfies, and the message
   is byte-identical. This is required by `wire-contract.md`.
2. All methods — GET included — now parse the response body tolerantly (`204` → `undefined`, empty body →
   `undefined`). Today only the write path does; `apiGet` calls `res.json()` unconditionally and would throw
   on a 204. Every response that works today returns the identical value.

---

## File Structure

### New — `packages/design-tokens/`
| File | Responsibility |
|---|---|
| `package.json` | Manifest, mirroring `shared-types` (no runtime deps). |
| `tsconfig.json` | Mirrors `shared-types`: CommonJS, composite, `outDir: dist`. |
| `src/index.ts` | The platform-free palette, font **stacks** (no CSS variables), and the `severity` / `roles` maps with their key types. |

### New — `packages/domain/`
| File | Responsibility |
|---|---|
| `package.json` | Manifest; depends on `@inspect/shared-types`; devDepends on `vitest`. |
| `tsconfig.json` | Mirrors `shared-types`. |
| `src/roles.ts` | `ROLE_RANK`, `roleAtLeast` — the additive hierarchy, fail-closed. |
| `src/text.ts` | `initialsFrom` — avatar initials from a name or email. |
| `src/index.ts` | Barrel. |
| `src/roles.test.ts` | Unit tests for the hierarchy incl. the fail-closed branch. |
| `src/text.test.ts` | Unit tests for initials. |

### New — `packages/api-client/`
| File | Responsibility |
|---|---|
| `package.json` | Manifest; devDepends on `vitest`. |
| `tsconfig.json` | Mirrors `shared-types`. |
| `src/errors.ts` | `ApiError` — the one error class every caller branches on. |
| `src/client.ts` | `createApiClient({ baseUrl, auth })` — headers, body encoding, error decoding. No platform imports. |
| `src/index.ts` | Barrel. |
| `src/client.test.ts` | Unit tests proving the client works with **zero** Next mocks. |

### Modified — `apps/web/`
| File | Change |
|---|---|
| `package.json` | Add the three workspace deps. |
| `vitest.config.mts` | Alias `@inspect/*` → package `src` (D1). |
| `components/inspect/tokens.ts` | Stops owning values; re-exports the package and composes the two **web-only** CSS derivations (`ui.font`, `mono`). Dead `defectLibrary` deleted. |
| `components/inspect/tokens.test.ts` | **New** — pins the composed values so "no visual change" is a checked claim. |
| `lib/roles.ts` | Re-exports `roleAtLeast as apiRoleAtLeast` + `initialsFrom` from domain; keeps `apiRoleToRoleKey` (D2). |
| `lib/api.ts` | Transport deleted (Task 3); becomes the Next adapter that builds the auth provider and wraps the client. The 34 `Api*` interfaces become one-line aliases (Task 4). Only `loadOrFallback` and the session-cookie plumbing stay as real code. |
| `app/(console)/reports/page.tsx:57` | `r.buyer?.name` → `r.clientCompany?.name` (D7). |

### Modified — `packages/shared-types/` and `apps/api/`
| File | Change |
|---|---|
| `packages/shared-types/src/api-dtos.ts` | **New** — the 34 response/input shapes lifted out of the console, under `XxxDto` names. |
| `packages/shared-types/src/index.ts` | Export the new module. |
| `apps/api/src/auth/rbac.ts` | `ROLE_RANK` re-pointed at `@inspect/domain`; `hasAtLeast` kept as the strict-typed wrapper (D4). |
| `apps/api/package.json` | Add the `@inspect/domain` workspace dependency. |

**Not moved, and why:** `loadOrFallback` stays in `apps/web`. Its two behaviours — falling back to design
demo data, and redirecting an un-assumed Platform Admin to `/admin/orgs` — are console-only: mobile has no
demo-preview mode and, by decision D1 of the spec, no Platform Admin mode at all, so there is no `/admin/orgs`
to redirect to. Pushing it into the package would mean injecting a `redirect` hook to serve one consumer.

---

## A note on TDD in a pure refactor

Three of the four tasks move existing, working code. For those, "write a failing test first" would mean
writing a test that fails only because you have not yet broken anything — which is theatre. The honest
discipline for a refactor is the **characterization test**: written against current behaviour, **verified
green before the refactor**, and required to still be green after. Each such step below says so explicitly
and tells you to run it *before* editing the source.

Genuinely new code — the `api-client` and `domain` package suites — gets real RED-first TDD.

---

## Task 1: `@inspect/design-tokens` + re-point the console

The smallest, lowest-risk package, done first because it proves the whole packaging pipeline — manifest,
tsconfig, turbo build order, the vitest alias, the workspace dependency — on a payload that cannot
misbehave at runtime.

**Files:**
- Create: `packages/design-tokens/package.json`
- Create: `packages/design-tokens/tsconfig.json`
- Create: `packages/design-tokens/src/index.ts`
- Create: `apps/web/components/inspect/tokens.test.ts`
- Modify: `apps/web/components/inspect/tokens.ts` (whole file)
- Modify: `apps/web/package.json` (dependencies)
- Modify: `apps/web/vitest.config.mts` (resolve.alias)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `@inspect/design-tokens` exporting `palette` (12 colour tokens, `as const`), `fontStack: string`,
  `monoFontStack: string`, `severity: Record<SeverityKey, {key,label,abbr,fg,bg,dot}>`,
  `roles: Record<RoleKey, {label,fg,bg}>`, and the types `SeverityKey = 'critical'|'major'|'minor'`,
  `RoleKey = 'inspector'|'qa'|'owner'|'platform'`.
  `apps/web/components/inspect/tokens.ts` keeps its **exact current export surface** minus `defectLibrary`:
  `ui`, `mono`, `severity`, `roles`, `SeverityKey`, `RoleKey`, `aqlPlan`.

- [ ] **Step 1: Create the branch**

```bash
git checkout main
git checkout -b ins-086-phase1-extraction
```

- [ ] **Step 2: Write the characterization test for the composed tokens**

This is the "no visual change" claim made checkable. `ui.font` and `mono.fontFamily` are the two values the
refactor actually recomposes from parts, so they are asserted as exact strings.

Create `apps/web/components/inspect/tokens.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { ui, mono, severity, roles } from './tokens';

/**
 * Characterization tests for the design tokens (INS-086 Phase 1).
 *
 * The palette moved to `@inspect/design-tokens` and the two web-only CSS
 * derivations — the Next font variables — are now composed here from the
 * package's raw stacks. `tsc` cannot see a wrong colour or a mangled font
 * stack, and neither can a build. These values are asserted verbatim.
 */
describe('ui palette', () => {
  test('keeps every hex value it had before extraction', () => {
    expect(ui).toMatchObject({
      bg: '#F6F8FA',
      panel: '#FFFFFF',
      ink: '#0B1220',
      sub: '#5B6573',
      faint: '#9AA3AE',
      line: '#E5E9EF',
      lineSoft: '#F0F3F7',
      fill: '#FAFBFC',
      accent: '#037BF4',
      accentSoft: '#F0F8FF',
      danger: '#B42318',
      assumeBg: '#7C2D12',
    });
  });

  test('puts the Next font CSS variable first, ahead of the shared stack', () => {
    // A dropped `var(--font-sans)` silently falls back to system Inter and
    // changes every screen's metrics without failing a build.
    expect(ui.font).toBe('var(--font-sans), Inter, -apple-system, system-ui, sans-serif');
  });
});

describe('mono', () => {
  test('keeps the font variable and tabular numerics', () => {
    // Tabular numerics are why IDs and timestamps line up in every table.
    expect(mono).toEqual({
      fontFamily: 'var(--font-mono), "JetBrains Mono", ui-monospace, monospace',
      fontVariantNumeric: 'tabular-nums',
    });
  });
});

describe('severity and role maps', () => {
  test('severity carries all three classes with their report colours', () => {
    expect(severity.critical).toEqual({ key: 'critical', label: 'Critical', abbr: 'Crit', fg: '#B42318', bg: '#FBEAEA', dot: '#D14343' });
    expect(severity.major).toEqual({ key: 'major', label: 'Major', abbr: 'Maj', fg: '#B5791A', bg: '#FAF1E2', dot: '#D99A20' });
    expect(severity.minor).toEqual({ key: 'minor', label: 'Minor', abbr: 'Min', fg: '#475467', bg: '#EFF2F6', dot: '#8A93A1' });
  });

  test('critical severity and the destructive action share one red', () => {
    // tokens.ts documents this coupling; if they drift, "danger" stops meaning
    // "critical" to the eye on the report.
    expect(severity.critical.fg).toBe(ui.danger);
  });

  test('roles covers all four badge keys', () => {
    expect(Object.keys(roles).sort()).toEqual(['inspector', 'owner', 'platform', 'qa']);
    expect(roles.platform).toEqual({ label: 'Platform Admin', fg: '#B5791A', bg: '#FAF1E2' });
  });
});
```

- [ ] **Step 3: Run it against the UNCHANGED source and verify it is GREEN**

Run: `pnpm web test`
Expected: **36 passing / 3 files.** This is a characterization test — green now is the point. If it is red,
you have mistyped a value; fix the *test* to match `tokens.ts`, not the other way round, and only at this step.

- [ ] **Step 4: Create the package manifest**

Create `packages/design-tokens/package.json`:

```json
{
  "name": "@inspect/design-tokens",
  "version": "0.0.1",
  "private": true,
  "description": "Platform-free Inspect design tokens (console, future mobile).",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "type-check": "tsc -p tsconfig.json --noEmit",
    "clean": "rimraf dist .turbo"
  }
}
```

- [ ] **Step 5: Create the package tsconfig**

Create `packages/design-tokens/tsconfig.json` — identical to `packages/shared-types/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "Node",
    "declaration": true,
    "composite": true,
    "outDir": "dist",
    "rootDir": "src",
    "tsBuildInfoFile": "dist/.tsbuildinfo"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 6: Write the package source**

Create `packages/design-tokens/src/index.ts`:

```ts
/**
 * Inspect design tokens — platform-free (INS-086 Phase 1).
 *
 * Ported verbatim out of `apps/web/components/inspect/tokens.ts`. Refined B2B
 * console: a single #037BF4 accent per screen, 1px hairlines (no shadows), warm
 * gray canvas, Inter body + JetBrains Mono on numbers/IDs/timestamps only.
 *
 * What is DELIBERATELY not here: anything expressed as CSS. `var(--font-sans)`
 * is a Next font-loader variable and `CSSProperties` is a DOM type — React
 * Native has neither. This module exports raw values and font STACKS; each
 * platform composes its own presentation form from them. See
 * `apps/web/components/inspect/tokens.ts` for the web composition.
 */

/** The colour tokens. Never hardcode one of these hexes at a call site. */
export const palette = {
  bg: '#F6F8FA',
  panel: '#FFFFFF',
  ink: '#0B1220',
  sub: '#5B6573',
  faint: '#9AA3AE',
  line: '#E5E9EF',
  lineSoft: '#F0F3F7',
  fill: '#FAFBFC',
  accent: '#037BF4',
  accentSoft: '#F0F8FF',
  /** Destructive-action red — the same hue as `severity.critical.fg`, on purpose. */
  danger: '#B42318',
  /** Platform-Admin org-assumption banner background (INS-079). */
  assumeBg: '#7C2D12',
} as const;

/** Body font stack, WITHOUT any platform font-variable prefix. */
export const fontStack = 'Inter, -apple-system, system-ui, sans-serif';

/** Monospace stack for numbers, IDs and timestamps. */
export const monoFontStack = '"JetBrains Mono", ui-monospace, monospace';

export type SeverityKey = 'critical' | 'major' | 'minor';

/** Defect-class presentation. `fg`/`bg` tint chips; `dot` is the list marker. */
export const severity: Record<
  SeverityKey,
  { key: SeverityKey; label: string; abbr: string; fg: string; bg: string; dot: string }
> = {
  critical: { key: 'critical', label: 'Critical', abbr: 'Crit', fg: '#B42318', bg: '#FBEAEA', dot: '#D14343' },
  major: { key: 'major', label: 'Major', abbr: 'Maj', fg: '#B5791A', bg: '#FAF1E2', dot: '#D99A20' },
  minor: { key: 'minor', label: 'Minor', abbr: 'Min', fg: '#475467', bg: '#EFF2F6', dot: '#8A93A1' },
};

export type RoleKey = 'inspector' | 'qa' | 'owner' | 'platform';

/** Role badge presentation. Display only — the API is the RBAC authority. */
export const roles: Record<RoleKey, { label: string; fg: string; bg: string }> = {
  inspector: { label: 'Inspector', fg: '#475467', bg: '#EFF2F6' },
  qa: { label: 'QA Manager', fg: '#1457A3', bg: '#EAF3FB' },
  owner: { label: 'Org Owner', fg: '#5B45B0', bg: '#F1EEFB' },
  platform: { label: 'Platform Admin', fg: '#B5791A', bg: '#FAF1E2' },
};
```

- [ ] **Step 7: Add the workspace dependency and the vitest alias**

In `apps/web/package.json`, add to `dependencies` (keep the list alphabetical — it goes first, before
`@inspect/shared-types`):

```json
    "@inspect/design-tokens": "workspace:^",
```

Replace `apps/web/vitest.config.mts` entirely:

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Vitest for the console (INS-082).
 *
 * `environment: 'node'` on purpose — the modules under test (`lib/api.ts`,
 * `lib/roles.ts`) are server-side. A jsdom environment is added alongside this
 * one when the first component test lands, not before.
 *
 * `.mts` so Vite loads it as ESM. `resolve.tsconfigPaths` reads the `@/*`
 * aliases straight from tsconfig.json — Vite supports this natively, so no
 * path-resolution plugin is needed.
 *
 * INS-086 Phase 1: the `@inspect/*` aliases point at package SOURCE, not the
 * built `dist/`. Those packages ship `main: dist/index.js` for Next and Nest,
 * and a stale `dist` would let this suite pass against code that no longer
 * exists — the one failure mode that would make it useless as the extraction's
 * acceptance instrument. Aliasing to `src` means the tests always exercise what
 * you just wrote.
 */
const pkg = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      '@inspect/design-tokens': pkg('design-tokens'),
      '@inspect/domain': pkg('domain'),
      '@inspect/api-client': pkg('api-client'),
      '@inspect/shared-types': pkg('shared-types'),
    },
  },
  test: {
    environment: 'node',
    include: ['{lib,components,app}/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
});
```

> The `domain` and `api-client` aliases are written now and point at files Tasks 2 and 3 create. Vite
> resolves aliases lazily — an alias to a not-yet-existing path is inert until something imports it — so this
> is safe, and it keeps the config from being edited three times.

Install so pnpm links the new workspace package:

```bash
pnpm install
```

- [ ] **Step 8: Re-point the console at the package**

Replace `apps/web/components/inspect/tokens.ts` entirely:

```ts
import type { CSSProperties } from 'react';
import { palette, fontStack, monoFontStack } from '@inspect/design-tokens';

/**
 * The console's view of the design tokens (INS-086 Phase 1).
 *
 * The values live in `@inspect/design-tokens`, shared with the future mobile
 * app. This module adds only what is genuinely web-only: the Next font-loader
 * CSS variables, and `mono` as a DOM `CSSProperties` object. Everything else is
 * re-exported unchanged, so the ~37 call sites that import from here are
 * untouched by the extraction.
 */

export { severity, roles } from '@inspect/design-tokens';
export type { SeverityKey, RoleKey } from '@inspect/design-tokens';

/**
 * `var(--font-sans)` is injected by Next's font loader in `app/layout.tsx` and
 * must come FIRST — the shared stack is the fallback behind it.
 */
export const ui = {
  ...palette,
  font: `var(--font-sans), ${fontStack}`,
} as const;

/** Mono style — JetBrains Mono with tabular numerics. */
export const mono: CSSProperties = {
  fontFamily: `var(--font-mono), ${monoFontStack}`,
  fontVariantNumeric: 'tabular-nums',
};

/** Demo AQL plan (internally consistent with the tested ISO 2859-1 engine: L=200@2.5→10/11). */
export const aqlPlan = {
  level: 'II',
  lot: 3200,
  codeLetter: 'L',
  sampleSize: 200,
  classes: [
    { sev: 'critical' as const, aql: '0', ac: 0, re: 1 },
    { sev: 'major' as const, aql: '2.5', ac: 10, re: 11 },
    { sev: 'minor' as const, aql: '4.0', ac: 14, re: 15 },
  ],
};
```

> **`defectLibrary` is deleted, not moved.** `grep -rn defectLibrary apps/web` returns zero call sites — it
> was dead demo data. `aqlPlan` has 3 live call sites and stays here: it is demo fallback content, not a
> design token, and it does not belong in a package mobile will import.

- [ ] **Step 9: Verify the console is unchanged**

```bash
pnpm web test
pnpm type-check
pnpm lint
```

Expected: **36 passing / 3 files**; type-check clean across **5** tasks (the new package joins);
lint 0 errors. If `aqlPlan`'s `sev` typing errors at a call site, the `as const` on each class entry is what
preserves the old `SeverityKey` literal type — check you kept it.

- [ ] **Step 10: Verify the package builds standalone**

```bash
pnpm build
```

Expected: 4 tasks, all successful — the packages build before `apps/web` because `turbo.json`'s `build` task
carries `dependsOn: ["^build"]`.

- [ ] **Step 11: Commit**

```bash
git add packages/design-tokens apps/web/components/inspect/tokens.ts apps/web/components/inspect/tokens.test.ts apps/web/package.json apps/web/vitest.config.mts pnpm-lock.yaml
git commit -m "feat(design-tokens): extract the palette into a shared package (INS-086)"
```

---

## Task 2: `@inspect/domain` + re-point the console

**Files:**
- Create: `packages/domain/package.json`
- Create: `packages/domain/tsconfig.json`
- Create: `packages/domain/src/roles.ts`
- Create: `packages/domain/src/text.ts`
- Create: `packages/domain/src/index.ts`
- Create: `packages/domain/src/roles.test.ts`
- Create: `packages/domain/src/text.test.ts`
- Modify: `apps/web/lib/roles.ts` (whole file)
- Modify: `apps/web/package.json` (dependencies)

**Interfaces:**
- Consumes: `@inspect/shared-types` — `UserRole`, `InvitableRole`.
- Produces: `@inspect/domain` exporting
  `ROLE_RANK: Readonly<Record<UserRole, number>>`,
  `roleAtLeast(role: string | undefined, min: InvitableRole): boolean`,
  `initialsFrom(label: string): string`.
  `apps/web/lib/roles.ts` keeps its **exact current export surface**: `apiRoleToRoleKey`, `initialsFrom`,
  `apiRoleAtLeast`.

- [ ] **Step 1: Create the package manifest**

Create `packages/domain/package.json`:

```json
{
  "name": "@inspect/domain",
  "version": "0.0.1",
  "private": true,
  "description": "Platform-free Inspect domain rules (console, future mobile).",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "type-check": "tsc -p tsconfig.json --noEmit",
    "clean": "rimraf dist .turbo"
  },
  "dependencies": {
    "@inspect/shared-types": "workspace:^"
  },
  "devDependencies": {
    "vitest": "^4.1.11"
  }
}
```

- [ ] **Step 2: Create the package tsconfig**

Create `packages/domain/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "Node",
    "declaration": true,
    "composite": true,
    "outDir": "dist",
    "rootDir": "src",
    "tsBuildInfoFile": "dist/.tsbuildinfo"
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"]
}
```

> `exclude` keeps the test files out of `dist/` — otherwise `tsc` emits them and `vitest` is a
> runtime-missing import for any consumer of the built package.

- [ ] **Step 3: Install so the workspace link exists**

```bash
pnpm install
```

- [ ] **Step 4: Write the failing tests for the role hierarchy**

Create `packages/domain/src/roles.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { ROLE_RANK, roleAtLeast } from './roles';

/**
 * The additive role hierarchy (spec §4): INSPECTOR < QA_MANAGER < ORG_OWNER <
 * PLATFORM_ADMIN, each inheriting everything below.
 *
 * This is a convenience gate for hiding UI, never an authorization decision —
 * the API is the authority. But a wrong answer still renders operator controls
 * that will 403, so the fail-closed branch is the one that matters most: an
 * unknown role must be treated as no role, never as a match.
 */
describe('roleAtLeast', () => {
  test('a role meets its own floor', () => {
    expect(roleAtLeast('INSPECTOR', 'INSPECTOR')).toBe(true);
    expect(roleAtLeast('QA_MANAGER', 'QA_MANAGER')).toBe(true);
    expect(roleAtLeast('ORG_OWNER', 'ORG_OWNER')).toBe(true);
  });

  test('a higher role clears a lower floor', () => {
    expect(roleAtLeast('QA_MANAGER', 'INSPECTOR')).toBe(true);
    expect(roleAtLeast('ORG_OWNER', 'QA_MANAGER')).toBe(true);
    expect(roleAtLeast('PLATFORM_ADMIN', 'INSPECTOR')).toBe(true);
  });

  test('a lower role does not clear a higher floor', () => {
    expect(roleAtLeast('INSPECTOR', 'QA_MANAGER')).toBe(false);
    expect(roleAtLeast('QA_MANAGER', 'ORG_OWNER')).toBe(false);
  });

  test('an unrecognized role fails closed', () => {
    expect(roleAtLeast('SUPERUSER', 'INSPECTOR')).toBe(false);
    expect(roleAtLeast('', 'INSPECTOR')).toBe(false);
  });

  test('a missing role fails closed', () => {
    expect(roleAtLeast(undefined, 'INSPECTOR')).toBe(false);
  });

  test('the rank table matches the API authority in apps/api/src/auth/rbac.ts', () => {
    // If these ever disagree, the console hides controls the API allows, or
    // shows controls it refuses. Kept as an explicit assertion because the two
    // tables are still separate code (INS-089).
    expect(ROLE_RANK).toEqual({
      INSPECTOR: 1,
      QA_MANAGER: 2,
      ORG_OWNER: 3,
      PLATFORM_ADMIN: 4,
    });
  });
});
```

- [ ] **Step 5: Run it and verify it FAILS**

Run: `pnpm --filter @inspect/domain test`
Expected: FAIL — `Failed to resolve import "./roles"`.

- [ ] **Step 6: Implement the role rules**

Create `packages/domain/src/roles.ts`:

```ts
import type { InvitableRole, UserRole } from '@inspect/shared-types';

/**
 * The additive role hierarchy (spec §4), shared by every client.
 *
 * This MIRRORS `apps/api/src/auth/rbac.ts`, which stays the authority — the API
 * makes the real decision on every request. What lives here is the client-side
 * convenience gate that decides whether to render a control at all. Unifying the
 * two tables is INS-089; until then `roles.test.ts` asserts they agree.
 */
export const ROLE_RANK: Readonly<Record<UserRole, number>> = {
  INSPECTOR: 1,
  QA_MANAGER: 2,
  ORG_OWNER: 3,
  PLATFORM_ADMIN: 4,
};

/**
 * True when `role` meets or exceeds `min`.
 *
 * Takes a loose `string | undefined` on purpose: the value comes off a session
 * object and may be absent or unrecognized. Anything not in the table ranks 0
 * and therefore clears no floor — fail closed, never fail open.
 */
export function roleAtLeast(role: string | undefined, min: InvitableRole): boolean {
  return ((ROLE_RANK as Record<string, number>)[role ?? ''] ?? 0) >= ROLE_RANK[min];
}
```

- [ ] **Step 7: Run and verify the role tests PASS**

Run: `pnpm --filter @inspect/domain test`
Expected: 6 passing.

- [ ] **Step 8: Write the failing test for initials**

Create `packages/domain/src/text.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { initialsFrom } from './text';

describe('initialsFrom', () => {
  test('takes the first letter of the first two words', () => {
    expect(initialsFrom('Jane Doe')).toBe('JD');
  });

  test('ignores the domain of an email address', () => {
    expect(initialsFrom('jane.doe@example.com')).toBe('JD');
  });

  test('treats dots, underscores, hyphens and spaces as separators', () => {
    expect(initialsFrom('jane_doe')).toBe('JD');
    expect(initialsFrom('jane-doe')).toBe('JD');
    expect(initialsFrom('jane.doe')).toBe('JD');
  });

  test('returns a single initial when there is only one word', () => {
    expect(initialsFrom('Jane')).toBe('J');
  });

  test('never returns an empty string', () => {
    // An empty avatar is a rendering hole; '?' is the deliberate floor.
    expect(initialsFrom('')).toBe('?');
  });
});
```

- [ ] **Step 9: Run it and verify it FAILS**

Run: `pnpm --filter @inspect/domain test`
Expected: FAIL — `Failed to resolve import "./text"`.

- [ ] **Step 10: Implement it and add the barrel**

Create `packages/domain/src/text.ts`:

```ts
/** Two-letter initials from a name or an email local-part, for avatars. */
export function initialsFrom(label: string): string {
  const base = label.replace(/@.*/, '');
  const parts = base.split(/[.\s_-]+/).filter(Boolean);
  const a = parts[0]?.[0] ?? base[0] ?? '?';
  const b = parts[1]?.[0] ?? '';
  return (a + b).toUpperCase();
}
```

Create `packages/domain/src/index.ts`:

```ts
/**
 * `@inspect/domain` — platform-free rules shared by the console and the mobile
 * app (INS-086 Phase 1). No I/O, no React, no platform imports.
 */
export { ROLE_RANK, roleAtLeast } from './roles';
export { initialsFrom } from './text';
```

- [ ] **Step 11: Run and verify all package tests PASS**

Run: `pnpm --filter @inspect/domain test`
Expected: 11 passing / 2 files.

- [ ] **Step 12: Re-point the console**

Add to `apps/web/package.json` `dependencies`:

```json
    "@inspect/domain": "workspace:^",
```

Replace `apps/web/lib/roles.ts` entirely:

```ts
import type { RoleKey } from '@/components/inspect/tokens';

/**
 * The console's role helpers (INS-086 Phase 1).
 *
 * The hierarchy check and the initials helper are platform-free and now live in
 * `@inspect/domain`; they are re-exported here so the ~8 call sites that import
 * from this module are untouched. `apiRoleAtLeast` keeps its name for the same
 * reason.
 *
 * `apiRoleToRoleKey` stays: it maps an API role onto a BADGE key from the design
 * tokens, which is presentation, not domain. Putting it in `@inspect/domain`
 * would make the domain layer depend on the design layer.
 */
export { initialsFrom, roleAtLeast as apiRoleAtLeast } from '@inspect/domain';

export function apiRoleToRoleKey(role?: string): RoleKey {
  switch (role) {
    case 'PLATFORM_ADMIN':
      return 'platform';
    case 'ORG_OWNER':
      return 'owner';
    case 'QA_MANAGER':
      return 'qa';
    default:
      return 'inspector';
  }
}
```

- [ ] **Step 13: Run the install and the full console gate**

```bash
pnpm install
pnpm web test
pnpm type-check
pnpm lint
```

Expected: web **36 passing / 3 files** (`lib/roles.test.ts` still green — it imports `./roles`, which now
re-exports; that is the proof the console is unchanged). type-check clean across **6** tasks, lint 0 errors.

- [ ] **Step 14: Commit**

```bash
git add packages/domain apps/web/lib/roles.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(domain): extract the role hierarchy and initials helper (INS-086)"
```

---

## Task 3: `@inspect/api-client` + turn `lib/api.ts` into the Next adapter

The task the whole phase exists for. The HTTP layer stops reaching into `next/headers`, `next-auth/jwt` and
`next/navigation` and instead receives an **injected auth provider** — the seam mobile needs.

**Files:**
- Create: `packages/api-client/package.json`
- Create: `packages/api-client/tsconfig.json`
- Create: `packages/api-client/src/errors.ts`
- Create: `packages/api-client/src/client.ts`
- Create: `packages/api-client/src/index.ts`
- Create: `packages/api-client/src/client.test.ts`
- Modify: `apps/web/lib/api.ts:1-251` (everything above the `Api*` response shapes)
- Modify: `apps/web/package.json` (dependencies)

**Interfaces:**
- Consumes: nothing from Tasks 1–2.
- Produces: `@inspect/api-client` exporting
  `class ApiError extends Error { status: number; path: string; body?: unknown }`,
  `interface AuthContext { token?: string | null; orgId?: string | null }`,
  `type AuthProvider = () => Promise<AuthContext>`,
  `interface ApiClientOptions { baseUrl: string; auth?: AuthProvider }`,
  `interface ApiClient { get, post, put, patch, del, getPublic, postPublic }` (each
  `<T>(path: string, body?: unknown) => Promise<T>`; `get`/`getPublic` take no body),
  `function createApiClient(options: ApiClientOptions): ApiClient`.
  `apps/web/lib/api.ts` keeps its **exact current export surface**: `ApiError`, `apiToken`, `apiGetPublic`,
  `apiPostPublic`, `apiGet`, `loadOrFallback`, `apiPost`, `apiPut`, `apiPatch`, `apiDelete`, and all 34
  `Api*` / input types.

- [ ] **Step 1: Create the manifest and tsconfig**

Create `packages/api-client/package.json`:

```json
{
  "name": "@inspect/api-client",
  "version": "0.0.1",
  "private": true,
  "description": "Dependency-free Inspect API client with an injected auth provider (console, future mobile).",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "type-check": "tsc -p tsconfig.json --noEmit",
    "clean": "rimraf dist .turbo"
  },
  "devDependencies": {
    "vitest": "^4.1.11"
  }
}
```

Create `packages/api-client/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "Node",
    "lib": ["ES2022", "DOM"],
    "declaration": true,
    "composite": true,
    "outDir": "dist",
    "rootDir": "src",
    "tsBuildInfoFile": "dist/.tsbuildinfo"
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"]
}
```

> `lib` includes `DOM` **only** for the `fetch`/`Response`/`RequestInit` type declarations. No DOM API is
> called — `fetch` is a global in Node 20+, in Next, and in React Native alike.

```bash
pnpm install
```

- [ ] **Step 2: Write the failing tests for the client**

Create `packages/api-client/src/client.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createApiClient } from './client';
import { ApiError } from './errors';

/**
 * Unit tests for the shared API client (INS-086 Phase 1).
 *
 * The whole point of this suite is what it does NOT mock: there is no
 * `next/headers`, no `next-auth/jwt`, no cookie. The client takes an injected
 * auth provider, so it is testable — and usable — with no framework at all.
 * Compare `apps/web/lib/api.test.ts`, whose mock preamble is the coupling this
 * package exists to remove.
 */
const fetchMock = vi.fn();
const BASE = 'https://api.test';

const headersOf = (call = 0) =>
  (fetchMock.mock.calls[call]?.[1]?.headers ?? {}) as Record<string, string>;
const urlOf = (call = 0) => fetchMock.mock.calls[call]?.[0] as string;
const initOf = (call = 0) => (fetchMock.mock.calls[call]?.[1] ?? {}) as RequestInit;

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('request shape', () => {
  test('prefixes the base URL and sends no auth headers without a provider', async () => {
    const api = createApiClient({ baseUrl: BASE });
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await api.get('/companies');

    expect(urlOf()).toBe('https://api.test/companies');
    expect(headersOf()).not.toHaveProperty('Authorization');
  });

  test('attaches the injected bearer token', async () => {
    const api = createApiClient({ baseUrl: BASE, auth: async () => ({ token: 'tok-1' }) });
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await api.get('/companies');

    expect(headersOf().Authorization).toBe('Bearer tok-1');
  });

  test('attaches X-Org-Id only when the provider supplies one', async () => {
    const withOrg = createApiClient({ baseUrl: BASE, auth: async () => ({ token: 't', orgId: 'org_1' }) });
    const withoutOrg = createApiClient({ baseUrl: BASE, auth: async () => ({ token: 't', orgId: null }) });
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await withOrg.get('/companies');
    await withoutOrg.get('/companies');

    expect(headersOf(0)['X-Org-Id']).toBe('org_1');
    expect(headersOf(1)).not.toHaveProperty('X-Org-Id');
  });

  test('never sends auth headers on the public helpers, even with a provider configured', async () => {
    // The guest portal and the public verify page are unauthenticated BY
    // CONTRACT. Leaking a bearer token onto them would widen what an
    // unauthenticated URL can reach.
    const api = createApiClient({ baseUrl: BASE, auth: async () => ({ token: 't', orgId: 'org_1' }) });
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await api.getPublic('/guest/reports?token=t');
    await api.postPublic('/invitations/accept', { token: 't' });

    expect(headersOf(0)).not.toHaveProperty('Authorization');
    expect(headersOf(0)).not.toHaveProperty('X-Org-Id');
    expect(headersOf(1)).not.toHaveProperty('Authorization');
    expect(headersOf(1)).not.toHaveProperty('X-Org-Id');
  });

  test('sends Content-Type and a JSON body only when there is a body', async () => {
    const api = createApiClient({ baseUrl: BASE });
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await api.post('/companies', { name: 'Acme' });
    await api.del('/companies/1');

    expect(headersOf(0)['Content-Type']).toBe('application/json');
    expect(initOf(0).body).toBe('{"name":"Acme"}');
    expect(headersOf(1)).not.toHaveProperty('Content-Type');
    expect(initOf(1).body).toBeUndefined();
  });

  test('uses the HTTP method the helper names', async () => {
    const api = createApiClient({ baseUrl: BASE });
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await api.post('/x');
    await api.put('/x');
    await api.patch('/x');
    await api.del('/x');

    expect([initOf(0).method, initOf(1).method, initOf(2).method, initOf(3).method])
      .toEqual(['POST', 'PUT', 'PATCH', 'DELETE']);
  });
});

describe('responses', () => {
  test('returns the parsed body', async () => {
    const api = createApiClient({ baseUrl: BASE });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'c1' }), { status: 200 }));

    await expect(api.get('/companies/c1')).resolves.toEqual({ id: 'c1' });
  });

  test('returns undefined on 204 and on an empty body', async () => {
    const api = createApiClient({ baseUrl: BASE });
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));

    await expect(api.del('/companies/c1')).resolves.toBeUndefined();
    await expect(api.get('/companies/c1')).resolves.toBeUndefined();
  });
});

describe('errors', () => {
  test('throws ApiError carrying the status, the path and the parsed body', async () => {
    const api = createApiClient({ baseUrl: BASE });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'Gone', code: 'CONSUMED' }), { status: 410 }),
    );

    // 404 (unknown invite) vs 410 (consumed) drive different UI — the status
    // must survive, not collapse into a generic Error.
    const err = await api.getPublic('/invitations/abc').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 410,
      path: '/invitations/abc',
      message: 'Gone',
      body: { message: 'Gone', code: 'CONSUMED' },
    });
  });

  test('joins a validation-array message', async () => {
    const api = createApiClient({ baseUrl: BASE });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: ['name required', 'email invalid'] }), { status: 400 }),
    );

    await expect(api.post('/companies', {})).rejects.toThrow('name required, email invalid');
  });

  test('falls back to a generated message on a non-JSON error body', async () => {
    const api = createApiClient({ baseUrl: BASE });
    fetchMock.mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 502 }));

    // A proxy's HTML error page must not surface as a JSON parse failure.
    const err = await api.get('/companies').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('API GET /companies failed: 502');
    expect(err.status).toBe(502);
  });

  test('names the method in the fallback message', async () => {
    const api = createApiClient({ baseUrl: BASE });
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));

    await expect(api.patch('/companies/c1', {})).rejects.toThrow('API PATCH /companies/c1 failed: 500');
  });

  test('a public POST throws ApiError too, not a bare Error', async () => {
    // wire-contract.md: the client throws ApiError, never a bare Error, so
    // every caller can branch on status.
    const api = createApiClient({ baseUrl: BASE });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: 'Expired' }), { status: 410 }));

    await expect(api.postPublic('/invitations/accept', {})).rejects.toBeInstanceOf(ApiError);
  });
});
```

- [ ] **Step 3: Run and verify it FAILS**

Run: `pnpm --filter @inspect/api-client test`
Expected: FAIL — `Failed to resolve import "./client"`.

- [ ] **Step 4: Implement the error class**

Create `packages/api-client/src/errors.ts`:

```ts
/**
 * Thrown by every client method on a non-2xx response.
 *
 * Carries the HTTP status because callers branch on it and that branching is
 * load-bearing across the product: 404 (unknown invite) vs 410 (consumed) drive
 * different screens, and the filled-slot 409 is what tells populate to offer a
 * retake instead of a second upload.
 */
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
```

- [ ] **Step 5: Implement the client**

Create `packages/api-client/src/client.ts`:

```ts
import { ApiError } from './errors';

/**
 * What the host application knows about the caller at request time.
 *
 * Both values are resolved TOGETHER by one provider call on purpose: on web
 * they come from a single decryption of the NextAuth JWE cookie, and splitting
 * them into two hooks would double that work on every request.
 */
export interface AuthContext {
  token?: string | null;
  /** Platform-Admin org assumption (INS-079). Omitted for every other caller. */
  orgId?: string | null;
}

export type AuthProvider = () => Promise<AuthContext>;

export interface ApiClientOptions {
  /** Origin of the Inspect API, with no trailing slash. */
  baseUrl: string;
  /**
   * Resolves the caller's credentials. Injected, never read from the
   * environment: web supplies a NextAuth-cookie reader that keeps the token
   * server-side (INS-045), mobile a SecureStore-backed one. The client itself
   * must never touch a cookie, `next/headers` or `expo-secure-store`.
   */
  auth?: AuthProvider;
}

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string, body?: unknown): Promise<T>;
  /** Unauthenticated GET — guest portal, public verify, invitation lookup. */
  getPublic<T>(path: string): Promise<T>;
  /** Unauthenticated POST — accept invitation. */
  postPublic<T>(path: string, body?: unknown): Promise<T>;
}

/** The API's error message: a string, a validation array, or '' when absent. */
function messageFrom(body: unknown): string {
  const m = (body as { message?: unknown } | null)?.message;
  return Array.isArray(m) ? m.join(', ') : typeof m === 'string' ? m : '';
}

/**
 * Tolerant body decode. A 204 and an empty 200 both mean "no content" — the
 * write paths have always relied on this, and reads get it too so a
 * no-content response is a value rather than a JSON parse crash.
 */
async function decode<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? (JSON.parse(text) as T) : (undefined as T));
}

export function createApiClient({ baseUrl, auth }: ApiClientOptions): ApiClient {
  async function send<T>(
    method: string,
    path: string,
    opts: { body?: unknown; authenticated: boolean },
  ): Promise<T> {
    const hasBody = opts.body !== undefined;
    const ctx: AuthContext = opts.authenticated && auth ? await auth() : {};
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {}),
        ...(ctx.orgId ? { 'X-Org-Id': ctx.orgId } : {}),
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      },
      body: hasBody ? JSON.stringify(opts.body) : undefined,
      // Live data always. Next honours this; React Native ignores it harmlessly.
      cache: 'no-store',
    });

    if (!res.ok) {
      let parsed: unknown;
      try {
        parsed = await res.json();
      } catch {
        /* non-JSON error body — a proxy's HTML page, or nothing at all */
      }
      throw new ApiError(
        res.status,
        path,
        messageFrom(parsed) || `API ${method} ${path} failed: ${res.status}`,
        parsed,
      );
    }
    return decode<T>(res);
  }

  return {
    get: (path) => send('GET', path, { authenticated: true }),
    post: (path, body) => send('POST', path, { body, authenticated: true }),
    put: (path, body) => send('PUT', path, { body, authenticated: true }),
    patch: (path, body) => send('PATCH', path, { body, authenticated: true }),
    del: (path, body) => send('DELETE', path, { body, authenticated: true }),
    getPublic: (path) => send('GET', path, { authenticated: false }),
    postPublic: (path, body) => send('POST', path, { body, authenticated: false }),
  };
}
```

> **`method: 'GET'` is now explicit** where the old `apiGet` omitted it. `fetch` defaults to `GET`, so the
> request on the wire is identical — but `apps/web/lib/api.test.ts` asserts only on headers, never on
> `init.method`, so nothing there depends on its absence. Confirm that in Step 8 rather than assuming it.

- [ ] **Step 6: Add the barrel**

Create `packages/api-client/src/index.ts`:

```ts
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
```

- [ ] **Step 7: Run and verify the package tests PASS**

Run: `pnpm --filter @inspect/api-client test`
Expected: 13 passing / 1 file.

- [ ] **Step 8: Re-point the console**

Add to `apps/web/package.json` `dependencies`:

```json
    "@inspect/api-client": "workspace:^",
```

Then in `apps/web/lib/api.ts`, replace **lines 1 through 251** — everything from the first `import` down to
and including the `apiDelete` line, i.e. everything above the `// ── Response shapes …` comment — with the
block below. **Leave every `Api*` interface from that comment to the end of the file exactly as it is** —
they move in Task 4, and keeping the two changes in separate commits is what makes either one reviewable:

```ts
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getToken } from 'next-auth/jwt';
import { ApiError, createApiClient, type AuthContext } from '@inspect/api-client';
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
 * Components, Server Actions, Route Handlers). Returns null when unauthenticated.
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
 * The injected auth provider (`wire-contract.md`).
 *
 * Resolves the bearer token and, for a verified Platform Admin operating inside
 * an assumed org, the X-Org-Id selector (INS-079) — from ONE decryption of the
 * NextAuth JWT. The role check is defense-in-depth (the API guard ignores the
 * header for anyone else regardless) against a stale `inspect_admin_org` cookie
 * surviving into a different session on a shared browser.
 */
async function nextAuthContext(): Promise<AuthContext> {
  const jwt = await readSessionJwt();
  const token = await accessTokenFrom(jwt);
  const orgId = jwt?.role === 'PLATFORM_ADMIN' ? await getAssumedOrgId() : null;
  return { token, orgId };
}

const client = createApiClient({ baseUrl: API_URL, auth: nextAuthContext });

/** Unauthenticated GET — guest portal, public verify, invitation lookup. */
export const apiGetPublic = <T>(path: string): Promise<T> => client.getPublic<T>(path);
/** Unauthenticated POST — accept invitation. */
export const apiPostPublic = <T>(path: string, body?: unknown): Promise<T> => client.postPublic<T>(path, body);
/** Server-side GET with the session bearer token. Always no-store (live data). */
export const apiGet = <T>(path: string): Promise<T> => client.get<T>(path);

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
 * Server-side mutations with the session bearer token. Use from Server Actions /
 * route handlers. Surfaces the API's error message via `ApiError`; returns
 * `undefined` for an empty/204 response.
 */
export const apiPost = <T>(path: string, body?: unknown): Promise<T> => client.post<T>(path, body);
export const apiPut = <T>(path: string, body?: unknown): Promise<T> => client.put<T>(path, body);
export const apiPatch = <T>(path: string, body?: unknown): Promise<T> => client.patch<T>(path, body);
export const apiDelete = <T>(path: string, body?: unknown): Promise<T> => client.del<T>(path, body);
```

- [ ] **Step 9: Run the console's suite — the acceptance gate for the whole phase**

```bash
pnpm install
pnpm web test
```

Expected: **36 passing / 3 files.** All 20 `lib/api.test.ts` tests must pass **unchanged**. They are the
instrument; if one is red, the extraction changed behaviour. Do not edit the test — find the difference.

Two failures to expect if you got something subtly wrong, and what they mean:
- *"expected undefined to be 'Bearer …'"* — the auth provider is not being awaited, or `authenticated: false`
  leaked onto `get`.
- *"NEXT_REDIRECT never thrown"* — `ApiError` is being imported from two places, so `instanceof` fails.
  Check that `apps/web/lib/api.ts` re-exports the package's class rather than declaring its own.

- [ ] **Step 10: Full gate**

```bash
pnpm type-check
pnpm lint
pnpm build
```

Expected: type-check clean across **7** tasks, lint 0 errors, build **6** tasks.

- [ ] **Step 11: Commit**

```bash
git add packages/api-client apps/web/lib/api.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(api-client): extract HTTP behind an injected auth provider (INS-086)"
```

---

## Task 4: Move the 34 wire DTOs into `@inspect/shared-types` (D5) — and fix the `buyer` defect (D7)

`apps/web/lib/api.ts` is currently the single declaration of the entire wire shape. That is a direct
violation of `.claude/rules/wire-contract.md` ("if a type describes something sent over HTTP … it lives in
`packages/shared-types/src/`") and it is unreachable for any second client.

**Files:**
- Create: `packages/shared-types/src/api-dtos.ts`
- Modify: `packages/shared-types/src/index.ts`
- Modify: `apps/web/lib/api.ts` (everything from `// ── Response shapes …` to EOF)
- Modify: `apps/web/app/(console)/reports/page.tsx:57`

**Interfaces:**
- Consumes: the existing `packages/shared-types/src/enums.ts` unions (`DefectSeverity`, `DefectScope`,
  `UserRole`, `UserStatus`, `AqlClassOutcome`, `DefectClass`, `QaDecision`, `OrgType`, `InvitableRole`).
- Produces: 34 exported types from `@inspect/shared-types`, listed in the rename table below.
  `apps/web/lib/api.ts` keeps every `Api*` name as an alias, so its export surface is unchanged.

- [ ] **Step 1: Create `packages/shared-types/src/api-dtos.ts`**

Move the block from `apps/web/lib/api.ts` — from the `// ── Response shapes …` comment to end of file —
into the new file **verbatim, including every doc comment**, with exactly these mechanical changes:

1. **Rename** each declaration per the table below, and update every internal cross-reference
   (`ApiDashboardSummary` references `ApiQaDecisionCounts`; `ApiLoopPresetDetail extends ApiLoopPreset` and
   references `ApiPresetItem` / `ApiMeasurementField` / `ApiAllowedDefect`; `ApiInspection` references
   `ApiAqlResult` / `ApiInspectionLoopItem` / `ApiMeasurement` / `ApiCycleState`; `ApiInspectionLoopItem`
   references `ApiPhoto` / `ApiDefectInstance`; `ApiGuestReport` references `ApiGuestReportPhoto`;
   `ApiCreatedOrg` references `ApiOrganization`).
2. **Drop the four alias lines** — `ApiProduct`, `ApiCompany`, `ApiCompanyGuest`, `ApiCompanyKind`. Those
   already point at `ProductDto` / `CompanyDto` / `CompanyGuestDto` / `CompanyKind` in this package; they
   stay in `apps/web/lib/api.ts` where they are, alongside the 34 new aliases.
3. **Change the import** at the top of the new file from `@inspect/shared-types` to relative paths:
   `import type { … } from './enums';` and `import type { GpsPoint } from './json-contracts';` if needed.
4. **Fix `ReportListItemDto`'s stale field (D7):** `buyer?: { id: string; name: string } | null;` becomes
   `clientCompany?: { id: string; name: string } | null;`. Give it the comment
   `/** INS-055: the API selects clientCompany — `buyer` was a stale name that silently rendered '—'. */`

| In `apps/web/lib/api.ts` | In `@inspect/shared-types` |
|---|---|
| `ApiQaDecisionCounts` | `QaDecisionCountsDto` |
| `ApiQualityMetrics` | `QualityMetricsDto` |
| `ApiDashboardSummary` | `DashboardSummaryDto` |
| `ApiLoopPreset` | `LoopPresetDto` |
| `ApiMeasurementField` | `MeasurementFieldDto` |
| `ApiAllowedDefect` | `AllowedDefectDto` |
| `ApiPresetItem` | `PresetItemDto` |
| `ApiLoopPresetDetail` | `LoopPresetDetailDto` |
| `ApiDefectCatalog` | `DefectCatalogDto` |
| `ApiUser` | `UserDto` |
| `ApiAqlResult` | `AqlResultDto` |
| `ApiInspection` | `InspectionDto` |
| `ApiPurchaseOrder` | `PurchaseOrderDto` |
| `AqlPreview` | `AqlPreviewDto` |
| `PresignResult` | `PresignResultDto` |
| `RegisterPhotoInput` | `RegisterPhotoInput` *(unchanged — `Input` is already the package convention, cf. `CreateCompanyInput`)* |
| `RetakePhotoInput` | `RetakePhotoInput` *(unchanged)* |
| `AddDefectInput` | `AddDefectInput` *(unchanged)* |
| `AddMeasurementInput` | `AddMeasurementInput` *(unchanged)* |
| `ApiPhoto` | `PhotoDto` |
| `ApiDefectCatalogItem` | `DefectCatalogItemDto` |
| `ApiDefectInstance` | `DefectInstanceDto` |
| `ApiMeasurement` | `MeasurementDto` |
| `ApiInspectionLoopItem` | `InspectionLoopItemDto` |
| `ApiCycleState` | `CycleStateDto` |
| `ApiReport` | `ReportDto` |
| `ApiReportListItem` | `ReportListItemDto` |
| `ApiVerifyResult` | `VerifyResultDto` |
| `ApiGuestReportPhoto` | `GuestReportPhotoDto` |
| `ApiGuestReport` | `GuestReportDto` |
| `ApiInvitation` | `InvitationDto` |
| `ApiInvitationLookup` | `InvitationLookupDto` |
| `ApiOrganization` | `OrganizationDto` |
| `ApiCreatedOrg` | `CreatedOrgDto` |

> `DefectCatalogDto` (a catalog row: `scope`, `isArchived`) and `DefectCatalogItemDto` (a populate-screen
> row: `severity`, `category`) are **different shapes with confusingly similar names**. Keep them distinct;
> do not merge them in passing.

Head the file with:

```ts
/**
 * Wire DTOs for the API's response and request shapes (INS-086 Phase 1).
 *
 * Lifted out of `apps/web/lib/api.ts`, which was the single declaration of the
 * entire wire contract and therefore unreachable for any second client. The
 * console keeps every `Api*` name as a one-line alias, so no call site moved.
 *
 * These describe what the API actually sends — not the Prisma models. Where the
 * two differ (a `select` narrowing a relation, a decorated `viewUrl`), the wire
 * shape wins, because that is what a client can rely on.
 */
```

- [ ] **Step 2: Export it from the package barrel**

Append to `packages/shared-types/src/index.ts`:

```ts
export * from './api-dtos';
```

- [ ] **Step 3: Replace the block in `apps/web/lib/api.ts` with aliases**

Delete everything from `// ── Response shapes …` to end of file and replace with a single import plus the
alias block. Keep the four existing aliases in place and add the 34 new ones. Head the block with:

```ts
// ── Wire shapes (INS-086 Phase 1) ────────────────────────────────────────────
// These live in `@inspect/shared-types` so the API, the console and the mobile
// app share one declaration. The `Api*` names are kept as aliases: ~47 call
// sites read them, and renaming is churn without benefit. What matters is that
// each shape is declared exactly once.
export type ApiQaDecisionCounts = QaDecisionCountsDto;
```

…and so on for every row of the table. The four types whose name is unchanged
(`RegisterPhotoInput`, `RetakePhotoInput`, `AddDefectInput`, `AddMeasurementInput`) are re-exported rather
than aliased:

```ts
export type { RegisterPhotoInput, RetakePhotoInput, AddDefectInput, AddMeasurementInput } from '@inspect/shared-types';
```

Then prune the now-unused type imports from the file's `@inspect/shared-types` import list — `lint` will
flag any that are left over, since the DTO bodies that referenced `DefectSeverity`, `DefectScope`,
`UserRole`, `UserStatus`, `AqlClassOutcome`, `DefectClass`, `QaDecision` and `OrgType` have moved.

- [ ] **Step 4: Build the package and let `tsc` find the D7 defect**

```bash
pnpm --filter @inspect/shared-types build
pnpm type-check
```

Expected: **exactly one error**, at `app/(console)/reports/page.tsx:57` —
`Property 'buyer' does not exist on type 'ApiReportListItem'`. That error IS the bug report: the console has
been reading a field the API never sends.

- [ ] **Step 5: Fix the stale read**

In `apps/web/app/(console)/reports/page.tsx`, line 57:

```tsx
              <span>{r.clientCompany?.name ?? '—'}</span>
```

- [ ] **Step 6: Full gate**

```bash
pnpm type-check
pnpm lint
pnpm web test
pnpm build
```

Expected: type-check clean, lint 0 errors, web **36 passing / 3 files**, build 6 tasks. The web suite does
not exercise `reports/page.tsx`, so the D7 fix is proven by `tsc` plus the visual check in the close-out.

- [ ] **Step 7: Commit**

```bash
git add packages/shared-types apps/web/lib/api.ts "apps/web/app/(console)/reports/page.tsx"
git commit -F - <<'MSG'
refactor(shared-types): move the 34 wire DTOs out of the console (INS-086)

Also fixes a live defect the move exposed: ApiReportListItem declared `buyer`
while the API selects `clientCompany`, so the reports list rendered an em-dash
in its client column for every row since INS-055. The field was optional, so
tsc could not see it until the DTO was corrected.
MSG
```

---

## Task 5: Re-point the API at `@inspect/domain` (D4)

Spec §4.4 requires each migration to **reduce** total logic. Task 2 moved the console's rank table into a
package; this removes the API's duplicate so the hierarchy exists once.

**Files:**
- Modify: `apps/api/package.json` (dependencies)
- Modify: `apps/api/src/auth/rbac.ts`

**Interfaces:**
- Consumes: `@inspect/domain` — `ROLE_RANK`.
- Produces: `apps/api/src/auth/rbac.ts` keeps its **exact current export surface**: `type Role`,
  `ROLE_RANK`, `hasAtLeast(userRole: Role, requiredRole: Role): boolean`, `isPlatformAdmin(role: Role)`.
  ~40 API call sites read `Role`; none of them change.

- [ ] **Step 1: Record the pre-change API baseline**

```bash
cd apps/api && node_modules/.bin/jest --runInBand 2>&1 | tail -5
```

Expected: **634 passing / 41 suites, exit 0.** Write the number down — Step 5 compares against it, and a
drift of even one test means this task broke something.

- [ ] **Step 2: Add the workspace dependency**

In `apps/api/package.json` `dependencies`, immediately after `@inspect/shared-types`:

```json
    "@inspect/domain": "workspace:^",
```

```bash
pnpm install
pnpm --filter @inspect/domain build
```

> The build is required, not optional: the API's Jest resolves `@inspect/domain` through the
> `node_modules` symlink to `main: dist/index.js`, and `ts-jest` will not transform TypeScript found inside
> `node_modules`. This is decision D1 in action.

- [ ] **Step 3: Re-point `rbac.ts`**

Replace `apps/api/src/auth/rbac.ts` entirely:

```ts
import { ROLE_RANK } from '@inspect/domain';
import type { UserRole } from '@inspect/shared-types';

/**
 * Additive role hierarchy (spec §4): each higher role inherits everything below.
 *
 * INSPECTOR < QA_MANAGER < ORG_OWNER < PLATFORM_ADMIN.
 *
 * INS-086 Phase 1: the rank table itself now lives in `@inspect/domain`, shared
 * with the console and the mobile app, so the hierarchy is declared exactly once
 * (spec §4.4 — every migration must reduce total logic). This module stays the
 * API's authority: it is what `RolesGuard` calls, and it keeps the strict
 * `Role`-typed signature that ~40 call sites depend on, where the shared helper
 * deliberately takes a loose `string | undefined` for client-side session data.
 *
 * `Role` is an alias of `UserRole` from `@inspect/shared-types` (INS-008). The
 * local name is kept because ~40 call sites read it, and renaming would be churn
 * without benefit — what matters is that the members are declared once.
 */
export type Role = UserRole;

export { ROLE_RANK };

/** True if `userRole` meets or exceeds `requiredRole` in the additive hierarchy. */
export function hasAtLeast(userRole: Role, requiredRole: Role): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[requiredRole];
}

/** The only cross-tenant principal (spec §2/§4). */
export function isPlatformAdmin(role: Role): boolean {
  return role === 'PLATFORM_ADMIN';
}
```

- [ ] **Step 4: Prove the duplicate is gone**

```bash
grep -rn "INSPECTOR: 1" apps/api/src packages/
```

Expected: exactly **one** match, in `packages/domain/src/roles.ts`.

- [ ] **Step 5: Run the API suite and compare to Step 1**

```bash
cd apps/api && node_modules/.bin/jest --runInBand 2>&1 | tail -5
```

Expected: **634 passing / 41 suites, exit 0** — byte-identical to Step 1. `rbac.spec.ts` must pass
**unchanged**; it is the characterization test for this move.

- [ ] **Step 6: Prove the API still builds and boots its type graph**

```bash
pnpm type-check
pnpm build
pnpm lint
```

Expected: type-check clean (7 tasks), build 6 tasks, lint 0 errors. `nest build` compiling clean is what
proves the `dist` resolution works outside Jest too.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/auth/rbac.ts apps/api/package.json pnpm-lock.yaml
git commit -m "refactor(api): read the role hierarchy from @inspect/domain (INS-086)"
```

---

## Task 6: Verify, document, close out

**Files:**
- Modify: `docs/STATUS.md` (header entry, Tests section, Infra pillar row, Active work block)
- Modify: `docs/future/BACKLOG.md` (INS-086 status note; new INS-088, INS-089)
- Modify: `docs/reference/screen-migration-map.md` (Phase 1 note, if it carries a phase column)
- Modify: `CLAUDE.md` (repository layout — the three packages are real now)
- Modify: `.claude/rules/wire-contract.md` (paths glob covers the new packages)
- Move: `docs/in-progress/plans/2026-08-27-inspect-rn-phase1-extraction.md` → `docs/done/plans/`

- [ ] **Step 1: Run every gate from a clean build**

```bash
pnpm clean && pnpm install && pnpm build
pnpm type-check
pnpm lint
pnpm web test
pnpm --filter @inspect/domain test
pnpm --filter @inspect/api-client test
apps/api/node_modules/.bin/jest --runInBand --config apps/api/package.json --rootDir apps/api/src
```

Record the **actual** numbers. Expected: web 36/3, domain 11/2, api-client 13/1, api unit 634/41 unchanged
(nothing in this phase touches `apps/api`), type-check 7 tasks, lint 0, build 6 tasks.

- [ ] **Step 2: Prove the packages are genuinely platform-free**

```bash
grep -rn "next/\|next-auth\|expo-\|react-native\|document\.\|window\." packages/api-client/src packages/domain/src packages/design-tokens/src
```

Expected: **no matches.** A hit means a platform import leaked into a shared package and Phase 2 will fail on
it. (`.claude/rules/wire-contract.md` states this as a rule; this is the check that enforces it.)

- [ ] **Step 3: Prove no logic was left behind (the re-point rule, spec §4.4)**

```bash
grep -n "ROLE_RANK\|#037BF4\|Bearer \${" apps/web/lib/*.ts apps/web/components/inspect/tokens.ts
```

Expected: **no matches.** Each hit is a second copy of something a package now owns — exactly the drift
§4.4 exists to prevent.

- [ ] **Step 4: Update `docs/future/BACKLOG.md`**

No new items are filed — the two candidates (DTO relocation, duplicate rank table) were folded into this
phase as Tasks 4 and 5 rather than deferred. Instead:

- **[INS-008](../../future/BACKLOG.md)** (the shared-types contract): append a dated note that the sweep is
  now complete — the 34 wire DTOs joined the enums and counterparty DTOs, so `apps/web/lib/api.ts` declares
  no wire shape of its own. If its status is still `in-progress`, this is what closes it; verify against its
  stated acceptance rather than assuming.
- **[INS-086](../../future/BACKLOG.md)**: see Step 5.
- Check whether any open item's `evidence` line still points at `apps/web/lib/api.ts` for a type that has
  moved, and correct the reference. A backlog item citing a line that no longer exists is how the
  "Needs a human" note went stale for three weeks.

- [ ] **Step 5: Flip INS-086's status note**

In `docs/future/BACKLOG.md`, append to INS-086's `- status:` line a dated note recording that **Phase 1 is
done** — the three packages exist, `apps/web` is re-pointed at all three, the console's 32 characterization
tests passed unchanged, and Phase 2 (Expo skeleton) is now the next phase. Name the two follow-ups the phase
deliberately deferred (INS-088, INS-089) so the next reader does not mistake them for oversights.

- [ ] **Step 6: Update `CLAUDE.md`**

Two edits in the **Repository layout** section:
1. `packages/shared-types/` — drop "**Built but not yet wired into either app — see INS-008**"; it is wired
   into both. Say what it is: the wire contract, consumed by the API and the console.
2. The "**Planned (React Native migration, INS-086) — do not assume these exist yet**" paragraph currently
   lists `packages/{api-client,domain,design-tokens}` as not existing. They exist now. Move them out of that
   paragraph into the real layout list with a one-line description each, and leave `apps/mobile/` as the only
   remaining planned item.

- [ ] **Step 7: Widen the wire-contract rule's path glob**

In `.claude/rules/wire-contract.md`, the front-matter `paths:` block names `packages/api-client/**` but not
the other two new packages. Add them so the rule loads when they are edited:

```yaml
paths:
  - "packages/shared-types/**"
  - "packages/api-client/**"
  - "packages/domain/**"
  - "packages/design-tokens/**"
  - "apps/web/lib/api.ts"
```

- [ ] **Step 8: Update `docs/STATUS.md`**

- **Header entry:** replace the `Last verified` line with 2026-08-27 and write the INS-086 Phase 1 entry —
  what shipped, the **measured** gate numbers from Step 1 (not the ones predicted in this plan), the two
  deliberate widenings from D6, and the decisions D1–D5 in one or two sentences each. Demote the INS-055
  entry to "Prior entry".
- **Carry the ⚠️ gaps forward.** The four unverified items in the INS-055 entry are still unverified — no
  manual console pass, no curated dev-DB workspace, CI never run on Linux, and the PO picker ranking
  (INS-087). Phase 1 does not touch any of them, and this phase **adds unpushed commits to the same pile**.
  Restate them rather than letting them scroll into a prior entry.
- **Tests section:** update the web bullet to 36/3 and add a bullet for the two new package suites.
- **Infra & CI pillar row:** `@inspect/shared-types` is no longer "built but unlinked"; the row should now
  describe four packages, three of them new.
- **Active work:** replace the "▶️ NEXT SESSION STARTS HERE" block with **Phase 2** — the Expo skeleton,
  whose acceptance (spec §6) is one read-only screen running on a physical device via EAS. Note that Phase 2
  is the moment to revisit D1 (source-as-entry for Metro), and that [INS-002](../../future/BACKLOG.md)
  credential rotation is user-side and gates EAS/app-store credentials.

- [ ] **Step 9: Verify the docs are internally consistent**

```bash
grep -c "INS-0" docs/STATUS.md
grep -n "INS-088\|INS-089" docs/future/BACKLOG.md
```

Then confirm every `INS-NNN` referenced in STATUS exists as a heading in BACKLOG, and that relative links
resolve. A broken link in STATUS is how the "Needs a human" note went stale for three weeks.

- [ ] **Step 10: Move the plan to `done/` and commit**

```bash
git mv docs/in-progress/plans/2026-08-27-inspect-rn-phase1-extraction.md docs/done/plans/
git add -A
git commit -F - <<'MSG'
docs: close INS-086 Phase 1 — three shared packages, web re-pointed (INS-086)

Records the measured gates, decisions D1-D6, and the two follow-ups the phase
deliberately deferred (INS-088 DTO relocation, INS-089 duplicate role table).
MSG
```

- [ ] **Step 11: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill. It verifies the suite, then offers merge / PR /
keep — the integration decision belongs to the human partner. Note `main` already carries **10 unpushed
commits** from INS-055, so a merge here makes it more; that is a state to report, not to silently resolve.

---

## Self-review

**Spec coverage.** §2.1's three packages — Tasks 1, 2, 3. §2.2 (no shared UI) — nothing in this plan moves a
component; `mono` and `ui.font` stay in `apps/web` precisely because they are CSS. §4.4's re-point rule —
every task re-points `apps/web` in the same commit, and Task 4 Step 3 greps for leftovers. §6's Phase 1 row
("extraction only, web re-pointed and proven unchanged") — Task 3 Step 9 is the proof, and no task adds
mobile code. §8's testing note ("`@inspect/domain` is pure and unit-tested with no DB") — Task 2 Steps 4–11.
§9's two open questions — answered as D3 (cycle-state stays in the API) and, for the mobile test strategy,
untouched because it is explicitly a Phase 3 decision.

**Beyond the spec's Phase 1 row, by explicit choice:** the DTO relocation (D5, Task 4) and the API's
duplicate rank table (D4, Task 5). Both were drafted as deferrals and the human partner chose to include
them, so the phase is no longer a pure `apps/web` refactor — Task 5 in particular touches the API's auth
core, which is why it brackets itself with a before-and-after run of all 634 API tests.

**Deliberately not covered:** source-as-entry packaging (D1 → revisit in Phase 2, where Metro gives it a
payoff), and the four ⚠️ gaps carried in STATUS from INS-055 — no manual console pass, no curated dev-DB
workspace, CI never run on Linux, and the PO picker ranking ([INS-087](../../future/BACKLOG.md)). Task 6
Step 8 restates them rather than letting them scroll away.

**Known imprecision an executor must resolve rather than trust:** the API unit-test command in Task 4 Step 1
is written from the repo's Jest config rather than from a run; if `--config apps/api/package.json` misbehaves,
run it as `cd apps/api && node_modules/.bin/jest --runInBand`. The predicted task counts for `pnpm
type-check` (7) and `pnpm build` (6) assume turbo picks up all three new packages' scripts — verify, and if
the real numbers differ, record the real ones in STATUS.

---

## Execution record (2026-08-27)

All six tasks executed inline, in order, on branch `ins-086-phase1-extraction`. Six commits.

**Where the plan was wrong, and what actually happened:**

- **Test counts.** The plan predicted "36 passing / 3 files" for the web suite. The real number is **38** —
  the plan miscounted its own six new token assertions against a 32-test baseline. Every other predicted
  count was right: domain 11/2, api-client 13/1, api unit 634/41, build 6 tasks. `pnpm type-check` runs
  **10** tasks, not the predicted 7, because turbo counts each package's `build` **and** `type-check`.
- **The vitest alias masked a missing dependency.** `@inspect/api-client` was absent from
  `apps/web/package.json` and the web suite passed anyway, because the alias resolves `@inspect/*` to source
  regardless of what is declared. `tsc` / `next build` are the wiring gate; the suite is not. Recorded in
  the root and `apps/web` `CLAUDE.md`.
- **The api-client suite's first run failed 4/13 on a test-authoring bug**, not a client bug:
  `mockResolvedValue(new Response(...))` hands the *same* object to every call, and a `Response` body can
  only be read once, so every multi-request test died on "Body has already been read". Fixed with a
  `replyWith()` helper that builds a fresh Response per call. Worth knowing:
  `apps/web/lib/api.test.ts` has the same pattern and survives only because its one two-call test asserts
  solely on `status`, which the fallback path still produces.
- **The D7 defect behaved exactly as predicted** — one `tsc` error, at `reports/page.tsx:57`, the moment the
  corrected DTO landed.
- **Task 6 Step 3's "no logic left behind" grep found a real one:** `apps/web/lib/auth.ts` still hand-rolls
  the login / refresh / me exchange, including its own `Authorization` header. Not folded in — it is
  edge-runtime coupled through `middleware.ts` — and filed as **INS-088**, which blocks Phase 2.

**Integration suite — not green, and not attributable to this phase.** A full `--runInBand` run took
**805 seconds** and reported **129 passed / 18 failed across 5 suites**, the failures being `$connect()`
refusals at `PrismaService.onModuleInit` plus short audit-row counts in the INS-012 concurrency spec.
Re-running `audit-chain.e2e-spec.ts` alone produced **3 failures, then 6, then 0, with no code change
between runs**, and the same spec passed on `main`. That is non-determinism against a contended remote dev
database, not a regression — 16 suites each booting their own Nest app + Prisma client against Railway.
**CI, which runs against containerized Postgres, is the honest read here and has still never run** (see
STATUS's carried-forward gaps).
