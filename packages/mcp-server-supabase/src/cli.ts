#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

import packageJson from '../package.json' with { type: 'json' };
import { createSupabaseApiPlatform } from './platform/api-platform.js';
import { createSupabaseMcpServer } from './server.js';
import { startLocalHttpEntry } from './transports/local-http-entry.js';
import {
  createFileStore,
  createMemoryStore,
  DEFAULT_OAUTH_STORE_PATH,
  login,
  logout,
} from './transports/oauth-client.js';
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
      ['oauth']: oauth,
      ['oauth-store']: oauthStore,
      ['oauth-callback-port']: cliCallbackPort,
      ['logout']: doLogout,
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
      ['oauth']: {
        type: 'boolean',
        default: false,
      },
      ['oauth-store']: {
        type: 'string',
        default: 'memory',
      },
      ['oauth-callback-port']: {
        type: 'string',
        default: '3112',
      },
      ['logout']: {
        type: 'boolean',
        default: false,
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

  // The AS issuer is the Management API origin, so --api-url selects prod or staging.
  const oauthIssuer = () =>
    new URL(apiUrl ?? 'https://api.supabase.com').origin;

  if (doLogout) {
    const issuer = oauthIssuer();
    const removed = await logout({
      issuer,
      callbackPort: Number(cliCallbackPort),
      store: createFileStore(),
    });
    console.log(
      removed
        ? `Signed out of ${issuer}; session removed from ${DEFAULT_OAUTH_STORE_PATH}`
        : `No stored OAuth session for ${issuer} in ${DEFAULT_OAUTH_STORE_PATH}`
    );
    process.exit(0);
  }

  if (http) {
    let accessToken: (() => Promise<string>) | undefined;
    if (oauth) {
      const tokenSource = await login({
        issuer: oauthIssuer(),
        callbackPort: Number(cliCallbackPort),
        store: oauthStore === 'file' ? createFileStore() : createMemoryStore(),
      });
      accessToken = tokenSource.accessToken;
    }
    const entry = await startLocalHttpEntry({
      port: Number(cliPort),
      apiUrl,
      contentApiUrl,
      accessToken,
    });
    console.error(`Supabase MCP server listening on ${entry.url}`);
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

  // `serveStdio` reports transport startup and out-of-band wire errors only
  // through `onerror`, and swallows them otherwise, so this keeps the stderr
  // output the previous awaited `server.connect()` got from `main().catch`.
  serveStdio(
    () =>
      createSupabaseMcpServer({
        platform,
        projectId,
        readOnly,
        features,
        contentApiUrl,
      }),
    { onerror: console.error }
  );
}

main().catch(console.error);
