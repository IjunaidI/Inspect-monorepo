import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

/**
 * ESLint 9 flat config for the console (INS-048).
 *
 * Replaces `.eslintrc.json` + the `next lint` script, both of which are dead
 * ends: ESLint 9 no longer reads `.eslintrc`, and `next lint` is deprecated in
 * Next 15. Lint had been failing repo-wide and was commented out of CI.
 *
 * `eslint-config-next@15.5` still ships only legacy configs (`index.js`,
 * `core-web-vitals.js` — there is no flat export yet), so `FlatCompat` is the
 * supported bridge rather than a workaround.
 */
const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    ignores: ['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'node_modules/**'],
  },
  ...compat.extends('next/core-web-vitals'),
  {
    // Vitest globals are imported explicitly in this repo's tests, so no global
    // registration is needed — this block only relaxes rules that fight the
    // testing idiom.
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];

export default config;
