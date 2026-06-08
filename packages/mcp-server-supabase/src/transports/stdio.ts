#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import packageJson from '../../package.json' with { type: 'json' };
import { createSupabaseApiPlatform } from '../platform/api-platform.js';
import { createSupabaseMcpServer } from '../server.js';
import { parseStdioCliArgs } from './stdio-cli.js';
import { parseList } from './util.js';

const { version } = packageJson;

async function main() {
  const cli = parseStdioCliArgs(process.argv.slice(2), version);

  if (cli.action === 'exit') {
    if (cli.stdout) {
      process.stdout.write(cli.stdout);
    }
    if (cli.stderr) {
      process.stderr.write(cli.stderr);
    }
    process.exit(cli.exitCode);
  }

  const accessToken = cli.cliAccessToken ?? process.env.SUPABASE_ACCESS_TOKEN;

  if (!accessToken) {
    console.error(
      'Please provide a personal access token (PAT) with the --access-token flag or set the SUPABASE_ACCESS_TOKEN environment variable'
    );
    process.exit(1);
  }

  const features = cli.cliFeatures ? parseList(cli.cliFeatures) : undefined;

  const platform = createSupabaseApiPlatform({
    accessToken,
    apiUrl: cli.apiUrl,
  });

  const server = createSupabaseMcpServer({
    platform,
    projectId: cli.projectId,
    readOnly: cli.readOnly,
    features,
  });

  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch(console.error);
