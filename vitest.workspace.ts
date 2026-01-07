import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'mcp-utils',
      root: './packages/mcp-utils',
      include: ['src/**/*.{test,spec}.ts'],
    },
  },
  {
    test: {
      name: 'mcp-server-postgrest',
      root: './packages/mcp-server-postgrest',
      include: ['src/**/*.{test,spec}.ts'],
    },
  },
  {
    test: {
      name: 'mcp-server-supabase',
      root: './packages/mcp-server-supabase',
      include: ['src/**/*.{test,spec}.ts', 'test/e2e/**/*.e2e.ts', 'test/**/*.integration.ts'],
    },
  },
]);
