import { createMcpHandler } from '@modelcontextprotocol/server';

import {
  createSupabaseMcpServer,
  type SupabaseMcpServerOptions,
} from '../server.js';

export function createSupabaseMcpHandler(options: SupabaseMcpServerOptions) {
  return createMcpHandler(() => createSupabaseMcpServer(options), {
    legacy: 'reject',
  });
}
