#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { parseArgs } from 'node:util';
import packageJson from '../package.json' with { type: 'json' };
import { createSupabaseMcpServer } from './server.js';

const { version } = packageJson;

async function main() {
  const {
    values: {
      ['access-token']: cliAccessToken,
      ['read-only']: readOnly,
      ['api-url']: apiUrl,
      ['version']: showVersion,
    },
  } = parseArgs({
    options: {
      ['access-token']: {
        type: 'string',
      },
      ['read-only']: {
        type: 'boolean',
        default: false,
      },
      ['api-url']: {
        type: 'string',
      },
      ['version']: {
        type: 'boolean',
      },
    },
  });

  if (showVersion) {
    console.log(version);
    process.exit(0);
  }

  // Use access token from CLI argument or environment variable
  const accessToken = cliAccessToken ?? process.env.SUPABASE_ACCESS_TOKEN;

  if (!accessToken) {
    console.error(
      'Please provide a personal access token (PAT) with the --access-token flag or set the SUPABASE_ACCESS_TOKEN environment variable'
    );
    process.exit(1);
  }

  const server = createSupabaseMcpServer({
    platform: {
      accessToken,
      apiUrl,
    },
    readOnly,
  });

  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch(console.error);
