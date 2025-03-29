#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { parseArgs } from 'node:util';
import { createSupabaseMcpServer } from './server.js';

async function main() {
  const {
    values: { ['access-token']: accessToken, ['api-url']: apiUrl },
  } = parseArgs({
    options: {
      ['access-token']: {
        type: 'string',
      },
      ['api-url']: {
        type: 'string',
      },
    },
  });

  if (!accessToken) {
    console.error(
      'Please provide a personal access token (PAT) with the --access-token flag'
    );
    process.exit(1);
  }

  const server = createSupabaseMcpServer({
    platform: {
      accessToken,
      apiUrl,
    },
  });

  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch(console.error);
