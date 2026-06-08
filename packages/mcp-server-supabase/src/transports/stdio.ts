#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSupabaseApiPlatform } from '../platform/api-platform.js';
import { createSupabaseMcpServer } from '../server.js';
import { parseStdioCliArgs, writeCliExit } from './stdio-cli.js';

async function main() {
  const cli = parseStdioCliArgs();
  if (cli.type === 'exit') {
    writeCliExit(cli);
  }

  const { accessToken, projectId, readOnly, apiUrl, features } = cli.options;

  if (!accessToken) {
    console.error(
      'Please provide a personal access token (PAT) with the --access-token flag or set the SUPABASE_ACCESS_TOKEN environment variable'
    );
    process.exit(1);
  }

  const platform = createSupabaseApiPlatform({
    accessToken,
    apiUrl,
  });

  const server = createSupabaseMcpServer({
    platform,
    projectId,
    readOnly,
    features,
  });

  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch(console.error);
