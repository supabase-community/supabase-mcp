import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    testTimeout: 30_000, // PGlite can take a while to initialize
  },
});
