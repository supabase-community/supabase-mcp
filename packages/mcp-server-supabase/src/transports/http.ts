import { createMcpHandler } from '@modelcontextprotocol/server';

import {
  createSupabaseMcpServer,
  type SupabaseMcpServerOptions,
} from '../server.js';

export type SupabaseMcpHandlerOptions = {
  legacy?: 'stateless' | 'reject';
  onerror?: (error: Error) => void;
};

// Modern protocol only: created with `legacy: 'reject'`, so a client that
// speaks just the 2025-era protocol gets an HTTP 400 instead of being served.
// The local HTTP entry passes `legacy: 'stateless'` to serve those clients
// without elicitations; hosted keeps the default.
export function createSupabaseMcpHandler(
  options: SupabaseMcpServerOptions,
  handlerOptions: SupabaseMcpHandlerOptions = {}
) {
  return createMcpHandler(() => createSupabaseMcpServer(options), {
    legacy: handlerOptions.legacy ?? 'reject',
    onerror: handlerOptions.onerror,
  });
}
