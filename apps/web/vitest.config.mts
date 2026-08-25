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
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['{lib,components,app}/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
});
