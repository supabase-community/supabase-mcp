import { defineWorkspace } from 'vitest/config';
import { textLoaderPlugin } from './test/plugins/text-loader.ts';

export default defineWorkspace([
  {
    plugins: [textLoaderPlugin('.sql')],
    test: {
      name: 'unit:node',
      include: ['src/**/*.{test,spec}.ts'],
      setupFiles: ['./test/setup/node.ts'],
      testTimeout: 30_000, // PGlite can take a while to initialize
      provide: {
        'msw-on-unhandled-request': 'error',
      },
    },
    optimizeDeps: {
      exclude: ['@deno/eszip', '@electric-sql/pglite'],
    },
  },
  {
    plugins: [textLoaderPlugin('.sql')],
    test: {
      name: 'unit:browser',
      include: ['src/**/*.{test,spec}.ts'],
      setupFiles: ['./test/setup/browser.ts'],
      testTimeout: 30_000, // PGlite can take a while to initialize
      provide: {
        'msw-on-unhandled-request': 'error',
      },
      browser: {
        enabled: true,
        provider: 'playwright',
        headless: true,
        screenshotFailures: false,
        instances: [
          { browser: 'chromium' },
          { browser: 'firefox' },
          { browser: 'webkit' },
        ],
      },
    },
    optimizeDeps: {
      exclude: ['@deno/eszip', '@electric-sql/pglite'],
    },
  },
  {
    plugins: [textLoaderPlugin('.sql')],
    test: {
      name: 'e2e',
      include: ['test/**/*.e2e.ts'],
      setupFiles: [
        './test/setup/node.ts',
        './test/setup/env.ts',
        './test/setup/extensions.ts',
      ],
      testTimeout: 60_000,
      provide: {
        // e2e tests need to make real API requests to an LLM, so bypass unhandled requests
        'msw-on-unhandled-request': 'bypass',
      },
    },
    optimizeDeps: {
      exclude: ['@deno/eszip', '@electric-sql/pglite'],
    },
  },
]);
