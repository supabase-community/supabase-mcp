#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

import packageJson from '../package.json' with { type: 'json' };
import { createSupabaseApiPlatform } from './platform/api-platform.js';
import { createSupabaseMcpServer } from './server.js';
import {
  formatBanner,
  startLocalHttpEntry,
} from './transports/local-http-entry.js';
import { parseList } from './transports/util.js';
import { parseFeatureGroups } from './util.js';

const { version } = packageJson;

async function main() {
  const {
    values: {
      ['access-token']: cliAccessToken,
      ['project-ref']: projectId,
      ['read-only']: readOnly,
      ['api-url']: apiUrl,
      ['content-api-url']: cliContentApiUrl,
      ['version']: showVersion,
      ['features']: cliFeatures,
      ['http']: http,
      ['port']: cliPort,
    },
  } = parseArgs({
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
      ['content-api-url']: {
        type: 'string',
      },
      ['version']: {
        type: 'boolean',
      },
      ['features']: {
        type: 'string',
      },
      ['http']: {
        type: 'boolean',
        default: false,
      },
      ['port']: {
        type: 'string',
        default: '3111',
      },
    },
  });

  if (showVersion) {
    console.log(version);
    process.exit(0);
  }

  const features = cliFeatures ? parseList(cliFeatures) : undefined;

  const contentApiUrl =
    cliContentApiUrl ?? process.env.SUPABASE_CONTENT_API_URL;

  if (http) {
    if (cliAccessToken !== undefined) {
      console.error(
        '--access-token is not used with --http: the client sends the PAT per request in the Authorization header'
      );
      process.exit(1);
    }

    const port = Number(cliPort);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      console.error(`Invalid --port value: ${cliPort}`);
      process.exit(1);
    }

    const entry = await startLocalHttpEntry({
      port,
      projectId,
      readOnly,
      apiUrl,
      contentApiUrl,
      features,
    });

    console.log(formatBanner(entry.url));

    const shutdown = () => {
      entry.close().then(
        () => process.exit(0),
        (error) => {
          console.error(error);
          process.exit(1);
        }
      );
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    return;
  }

  const accessToken = cliAccessToken ?? process.env.SUPABASE_ACCESS_TOKEN;

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

  if (features) {
    parseFeatureGroups(platform, features);
  }

  const options = {
    platform,
    projectId,
    readOnly,
    features,
    contentApiUrl,
  };

  // `serveStdio` reports transport startup and out-of-band wire errors only
  // through `onerror`, and swallows them otherwise, so this keeps the stderr
  // output the previous awaited `server.connect()` got from `main().catch`.
  serveStdio(() => createSupabaseMcpServer(options), {
    onerror: console.error,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
