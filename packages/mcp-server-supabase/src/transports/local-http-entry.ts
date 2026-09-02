import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  CLIENT_INFO_META_KEY,
  hostHeaderValidationResponse,
  isLegacyRequest,
  localhostAllowedHostnames,
  PROTOCOL_VERSION_META_KEY,
} from '@modelcontextprotocol/server';

import { createSupabaseApiPlatform } from '../platform/api-platform.js';
import { parseFeatureGroups } from '../util.js';
import { createSupabaseMcpHandler } from './http.js';
import { toNodeListener } from './node-bridge.js';

export type LocalHttpEntryOptions = {
  port: number;
  projectId?: string;
  readOnly?: boolean;
  apiUrl?: string;
  contentApiUrl?: string;
  features?: string[];
  /** Destination for the per-request era line. Defaults to `console.error`. */
  log?: (line: string) => void;
};

export type LocalHttpEntry = {
  url: string;
  close: () => Promise<void>;
};

export const LOCAL_HTTP_HOST = '127.0.0.1';
export const LOCAL_HTTP_PATH = '/mcp';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function bearerToken(request: Request): string | undefined {
  const header = request.headers.get('authorization');
  if (!header) return undefined;
  const [scheme, token, ...rest] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== 'bearer' || !token || rest.length > 0) {
    return undefined;
  }
  return token;
}

type Envelope = {
  method?: unknown;
  params?: {
    _meta?: Record<string, unknown>;
    clientInfo?: unknown;
  };
};

function implementationName(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { name, version } = value as { name?: unknown; version?: unknown };
  if (typeof name !== 'string') return undefined;
  return typeof version === 'string' ? `${name}/${version}` : name;
}

/** Client name from the modern envelope's `_meta`, else from a legacy `initialize`, else `unknown`. */
export function describeClient(parsedBody: unknown): {
  client: string;
  protocolVersion?: string;
} {
  const messages = Array.isArray(parsedBody) ? parsedBody : [parsedBody];
  let client: string | undefined;
  let protocolVersion: string | undefined;
  for (const message of messages as Envelope[]) {
    if (typeof message !== 'object' || message === null) continue;
    const meta = message.params?._meta;
    client ??= implementationName(meta?.[CLIENT_INFO_META_KEY]);
    if (typeof meta?.[PROTOCOL_VERSION_META_KEY] === 'string') {
      protocolVersion ??= meta[PROTOCOL_VERSION_META_KEY] as string;
    }
    if (message.method === 'initialize') {
      client ??= implementationName(message.params?.clientInfo);
    }
  }
  return { client: client ?? 'unknown', protocolVersion };
}

export async function startLocalHttpEntry(
  options: LocalHttpEntryOptions
): Promise<LocalHttpEntry> {
  const {
    port,
    projectId,
    readOnly,
    apiUrl,
    contentApiUrl,
    features,
    log = console.error,
  } = options;
  const allowedHostnames = localhostAllowedHostnames();

  const server = createServer(
    toNodeListener(async (request, parsedBody) => {
      const rejected = hostHeaderValidationResponse(request, allowedHostnames);
      if (rejected) return rejected;

      if (new URL(request.url).pathname !== LOCAL_HTTP_PATH) {
        return json(404, { error: 'not found' });
      }

      const accessToken = bearerToken(request);
      if (!accessToken) {
        return json(401, { error: 'missing bearer token' });
      }

      const legacy = await isLegacyRequest(request, parsedBody);
      const { client, protocolVersion } = describeClient(parsedBody);
      log(
        legacy
          ? `[mcp-http] legacy client=${client} (elicitations unavailable on the legacy path)`
          : `[mcp-http] modern ${protocolVersion ?? 'unknown'} client=${client}`
      );

      const platform = createSupabaseApiPlatform({ accessToken, apiUrl });
      if (features) {
        parseFeatureGroups(platform, features);
      }
      const handler = createSupabaseMcpHandler(
        { platform, projectId, readOnly, features, contentApiUrl },
        { legacy: 'stateless', onerror: console.error }
      );
      request.signal.addEventListener('abort', () => handler.close(), {
        once: true,
      });
      return handler.fetch(request, { parsedBody });
    })
  );

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, LOCAL_HTTP_HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const { port: boundPort } = server.address() as AddressInfo;
  return {
    url: `http://${LOCAL_HTTP_HOST}:${boundPort}${LOCAL_HTTP_PATH}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        if (!server.listening) return resolve();
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

export function formatBanner(url: string) {
  return [
    `Supabase MCP server (--http) listening on ${url}`,
    '',
    'Add to .mcp.json (Claude Code expands ${SUPABASE_ACCESS_TOKEN} at connect time):',
    '{',
    '  "mcpServers": {',
    '    "supabase-local": {',
    '      "type": "http",',
    `      "url": "${url}",`,
    '      "headers": { "Authorization": "Bearer ${SUPABASE_ACCESS_TOKEN}" }',
    '    }',
    '  }',
    '}',
    'Legacy (2025-era) clients are served without elicitations. Requests log their era on stderr.',
  ].join('\n');
}
