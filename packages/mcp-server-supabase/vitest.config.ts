import { readFile } from 'fs/promises';
import { Plugin } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';

function sqlLoaderPlugin(): Plugin {
  return {
    name: 'sql-loader',
    async transform(code, id) {
      if (id.endsWith('.sql')) {
        const textContent = await readFile(id, 'utf8');
        return `export default ${JSON.stringify(textContent)};`;
      }
      return code;
    },
  };
}

function textLoaderPlugin(): Plugin {
  return {
    name: 'text-loader',
    async transform(code, id) {
      if (id.endsWith('.text')) {
        const textContent = await readFile(id, 'utf8');
        return `export default ${JSON.stringify(textContent)};`;
      }
      return code;
    },
  };
}

export default defineConfig({
  plugins: [sqlLoaderPlugin(), textLoaderPlugin()],
  test: {
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 30_000, // PGlite can take a while to initialize
    coverage: {
      reporter: ['text', 'lcov'],
      reportsDirectory: 'test/coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [...configDefaults.coverage.exclude!, 'src/stdio.ts'],
    },
  },
});
