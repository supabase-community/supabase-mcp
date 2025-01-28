import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: [
      'src/index.ts',
      'src/stdio.ts',
      'src/queriers/postgres/index.ts',
      'src/queriers/management-api/index.ts',
      'src/queriers/pglite/index.ts',
    ],
    format: ['cjs', 'esm'],
    outDir: 'dist',
    sourcemap: true,
    dts: true,
    minify: true,
    splitting: true,
  },
]);
