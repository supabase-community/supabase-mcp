import { readFile } from 'fs/promises';
import { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

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

export default defineConfig({
  plugins: [sqlLoaderPlugin()],
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    testTimeout: 30_000, // PGlite can take a while to initialize
  },
});
