// @ts-check
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

/**
 * ESLint 9 flat config for the API (INS-048).
 *
 * Replaces `.eslintrc.js`, which ESLint 9 no longer reads — lint had been
 * failing repo-wide (exit 2) and was therefore commented out of CI.
 *
 * Deliberately NOT type-aware: `@typescript-eslint`'s `recommended` set needs no
 * type information, and wiring `parserOptions.project` would both slow lint down
 * and force every file to belong to a tsconfig `include` (the `test/` tree does
 * not). `tsc --noEmit` already covers what type-aware rules would add here.
 */
export default [
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'prisma/**', 'scripts/**', '*.mjs'],
  },
  {
    files: ['{src,test}/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      prettier: prettierPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...prettierConfig.rules,
      'prettier/prettier': 'error',
      // Carried over from .eslintrc.js — the house style this codebase was
      // written in. Explicit return types and `any` bans would flag hundreds of
      // existing lines and turn the first lint run into a rewrite.
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      // A leading underscore is this codebase's existing "deliberately unused"
      // marker (destructured `_omit` to drop a field, ignored `_args` in a mock).
      // Honour the convention rather than rewriting those call sites.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Test bootstrapping legitimately reaches for `require` (supertest's CJS
    // export). Confining the exemption to the test tree keeps it off src/.
    files: ['test/**/*.ts', 'src/**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
