#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { parseArgs } from 'node:util';
import { createPostgrestMcpServer } from './server.js';

async function main() {
  const {
    values: { apiUrl, apiKey, schema },
  } = parseArgs({
    options: {
      apiUrl: {
        type: 'string',
      },
      apiKey: {
        type: 'string',
      },
      schema: {
        type: 'string',
      },
    },
  });

  if (!apiUrl) {
    console.error('Please provide a base URL with the --apiUrl flag');
    process.exit(1);
  }

  if (!schema) {
    console.error('Please provide a schema with the --schema flag');
    process.exit(1);
  }

  const server = createPostgrestMcpServer({
    apiUrl,
    apiKey,
    schema,
  });

  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch(console.error);
