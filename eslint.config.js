// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', 'corpus/**', 'fixtures/generated/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  prettier,
  {
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Browser workbench: React hooks rules and browser globals.
    files: ['apps/web/**/*.{ts,tsx,js}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // Not e2e/: Playwright fixtures take a `use` callback that is not a React hook.
    files: ['apps/web/src/**/*.{ts,tsx}', 'apps/web/test/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
  },
  {
    files: ['**/test/**/*.{ts,tsx}', 'apps/web/e2e/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    // Core must run unchanged in Node, the browser and a Web Worker:
    // no DOM, no React, no audio stack, no Node built-ins, no Cloudflare APIs.
    files: ['packages/core/src/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*'], message: 'Core must not depend on Node built-ins.' },
            {
              group: ['react', 'react-*', 'tone', 'cloudflare', '@cloudflare/*'],
              message: 'Core must not depend on browser/UI/platform packages.',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'fetch', 'process'],
    },
  },
);
