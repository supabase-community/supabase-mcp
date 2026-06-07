#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { parseArgs } from 'node:util';
import packageJson from '../../package.json' with { type: 'json' };
import { createSupabaseApiPlatform } from '../platform/api-platform.js';
import { createSupabaseMcpServer } from '../server.js';
import { parseList } from './util.js';

const { version } = packageJson;

const helpText = `Usage: mcp-server-supabase [options]

Options:
  --access-token <token>  Supabase personal access token
  --project-ref <ref>     Supabase project ref
  --read-only             Restrict the server to read-only tools
  --api-url <url>         Supabase API URL
  --features <features>   Comma-separated feature list
  --version               Print version information
  -h, --help              Print this help message`;

function parseCliArgs() {
  try {
    return parseArgs({
      options: {
        ['access-token']: {
          type: 'string',
        },
        ['project-ref']: {
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
        ['features']: {
          type: 'string',
        },
        help: {
          type: 'boolean',
          short: 'h',
        },
      },
    }).values;
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
      console.error(helpText);
      process.exit(1);
    }

    throw error;
  }
}

async function main() {
  const {
    ['access-token']: cliAccessToken,
    ['project-ref']: projectId,
    ['read-only']: readOnly,
    ['api-url']: apiUrl,
    ['version']: showVersion,
    ['features']: cliFeatures,
    help: showHelp,
  } = parseCliArgs();

  if (showHelp) {
    console.log(helpText);
    process.exit(0);
  }

  if (showVersion) {
    console.log(version);
    process.exit(0);
  }

  const accessToken = cliAccessToken ?? process.env.SUPABASE_ACCESS_TOKEN;

  if (!accessToken) {
    console.error(
      'Please provide a personal access token (PAT) with the --access-token flag or set the SUPABASE_ACCESS_TOKEN environment variable'
    );
    process.exit(1);
  }

  const features = cliFeatures ? parseList(cliFeatures) : undefined;

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
