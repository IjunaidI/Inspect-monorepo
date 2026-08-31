import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Mobile's first test runner (INS-086 Phase 3). It deliberately covers ONLY the
 * pure capture core (`src/lib/capture-core.ts`) — no React Native, no Expo, no
 * jest-expo machinery. The impure shell stays thin enough to be verified by
 * type-check + expo export + the on-device pass, the same split the API uses
 * for its pure domain core.
 *
 * Like apps/web, `@inspect/*` aliases to package SOURCE so a stale `dist`
 * cannot fake a green run (and, like there, tsc — not this suite — is the
 * wiring gate).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@inspect/shared-types': fileURLToPath(
        new URL('../../packages/shared-types/src/index.ts', import.meta.url),
      ),
      '@inspect/domain': fileURLToPath(new URL('../../packages/domain/src/index.ts', import.meta.url)),
      '@inspect/api-client': fileURLToPath(
        new URL('../../packages/api-client/src/index.ts', import.meta.url),
      ),
      '@inspect/design-tokens': fileURLToPath(
        new URL('../../packages/design-tokens/src/index.ts', import.meta.url),
      ),
    },
  },
});
