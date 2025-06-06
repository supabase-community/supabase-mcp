import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/transports/stdio.ts', 'src/platform/index.ts'],
    format: ['cjs', 'esm'],
    outDir: 'dist',
    sourcemap: true,
    dts: true,
    minify: true,
    splitting: true,
    loader: {
      '.sql': 'text',
    },
  },
]);
