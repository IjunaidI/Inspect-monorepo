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
