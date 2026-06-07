#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { parseArgs } from 'node:util';
import packageJson from '../../package.json' with { type: 'json' };
import { createSupabaseApiPlatform } from '../platform/api-platform.js';
import { createSupabaseMcpServer } from '../server.js';
import { parseList } from './util.js';

const { version } = packageJson;

async function main() {
  let values: {
    ['access-token']?: string;
    ['project-ref']?: string;
    ['read-only']?: boolean;
    ['api-url']?: string;
    ['version']?: boolean;
    ['help']?: boolean;
    ['features']?: string;
  };

  try {
    ({ values } = parseArgs({
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
        ['help']: {
          type: 'boolean',
          short: 'h',
        },
        ['features']: {
          type: 'string',
        },
      },
    }));
  } catch (error) {
    if (isParseArgsError(error)) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const {
    ['access-token']: cliAccessToken,
    ['project-ref']: projectId,
    ['read-only']: readOnly,
    ['api-url']: apiUrl,
    ['version']: showVersion,
    ['help']: showHelp,
    ['features']: cliFeatures,
  } = values;

  if (showHelp) {
    printHelp();
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

function printHelp() {
  console.log(`Usage: mcp-server-supabase [options]

Options:
  --access-token <token>  Supabase personal access token
  --project-ref <ref>     Scope the server to a project ref
  --read-only             Prevent write operations
  --api-url <url>         Supabase API URL
  --features <list>       Comma-separated feature list
  --version               Print the package version
  -h, --help              Display help`);
}

function isParseArgsError(error: unknown): error is Error & { code: string } {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION'
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
