import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      reporter: ['text', 'lcov'],
      reportsDirectory: 'test/coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [...configDefaults.coverage.exclude!, 'src/stdio.ts'],
    },
  },
});
