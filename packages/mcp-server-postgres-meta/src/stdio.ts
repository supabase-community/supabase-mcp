#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { parseArgs } from 'node:util';
import { PostgresQuerier } from './queriers/postgres/index.js';
import { createPostgresMetaMcpServer } from './server.js';

async function main() {
  const {
    values: { connection },
  } = parseArgs({
    options: {
      connection: {
        type: 'string',
      },
    },
  });

  if (!connection) {
    console.error(
      'Please provide a Postgres connection URI with the --connection flag'
    );
    process.exit(1);
  }

  const querier = new PostgresQuerier({
    connection,
  });

  const server = createPostgresMetaMcpServer({
    querier,
  });

  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch(console.error);
