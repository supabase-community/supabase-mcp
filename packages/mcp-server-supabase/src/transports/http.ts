import { createMcpHandler } from '@modelcontextprotocol/server';

import {
  createSupabaseMcpServer,
  type SupabaseMcpServerOptions,
} from '../server.js';

// Modern protocol only: created with `legacy: 'reject'`, so a client that
// speaks just the 2025-era protocol gets an HTTP 400 instead of being served.
export function createSupabaseMcpHandler(options: SupabaseMcpServerOptions) {
  return createMcpHandler(() => createSupabaseMcpServer(options), {
    legacy: 'reject',
  });
}
