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

  // The AS issuer is the Management API origin: `https://api.supabase.com`
  // (prod) or `https://api.supabase.green` (staging) via `--api-url`.
  const oauthIssuer = () =>
    new URL(apiUrl ?? 'https://api.supabase.com').origin;

  const parsePort = (flag: string, value: string) => {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      console.error(`Invalid ${flag} value: ${value}`);
      process.exit(1);
    }
    return port;
  };

  if (doLogout) {
    const issuer = oauthIssuer();
    const callbackPort = parsePort('--oauth-callback-port', cliCallbackPort);
    const removed = await logout({
      issuer,
      callbackPort,
      store: createFileStore(),
    });
    console.log(
      removed
        ? `Signed out of ${issuer}; session removed from ${DEFAULT_OAUTH_STORE_PATH}`
        : `No stored OAuth session for ${issuer} in ${DEFAULT_OAUTH_STORE_PATH}`
    );
    process.exit(0);
  }

  if (oauth && !http) {
    console.error('--oauth requires --http');
    process.exit(1);
  }

  if (http) {
    if (cliAccessToken !== undefined) {
      console.error(
        '--access-token is not used with --http: the client sends the PAT per request in the Authorization header'
      );
      process.exit(1);
    }

    const port = parsePort('--port', cliPort);

    let accessToken: (() => Promise<string>) | undefined;
    if (oauth) {
      if (oauthStore !== 'memory' && oauthStore !== 'file') {
        console.error(
          `Invalid --oauth-store value: ${oauthStore} (expected memory or file)`
        );
        process.exit(1);
      }
      const tokenSource = await login({
        issuer: oauthIssuer(),
        callbackPort: parsePort('--oauth-callback-port', cliCallbackPort),
        store: oauthStore === 'file' ? createFileStore() : createMemoryStore(),
      });
      accessToken = tokenSource.accessToken;
    }

    const entry = await startLocalHttpEntry({
      port,
      projectId,
      readOnly,
      apiUrl,
      contentApiUrl,
      features,
      accessToken,
    });

    console.log(formatBanner(entry.url, { oauth }));

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
