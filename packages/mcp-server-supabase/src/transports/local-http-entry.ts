import { createHash, randomBytes } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { toNodeHandler } from '@modelcontextprotocol/node';
import {
  CLIENT_INFO_META_KEY,
  hostHeaderValidationResponse,
  isJsonContentType,
  isLegacyRequest,
  localhostAllowedHostnames,
  PROTOCOL_VERSION_META_KEY,
} from '@modelcontextprotocol/server';

import { createSupabaseApiPlatform } from '../platform/api-platform.js';
import { parseFeatureGroups } from '../util.js';
import { createSupabaseMcpHandler } from './http.js';

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

const MAX_REQUEST_BODY_BYTES = 4 * 1024 * 1024;

// The body cap is entry-owned: the SDK's `toWebRequest` collects a request body
// unbounded when no `parsedBody` is passed (@modelcontextprotocol/node
// dist/index.mjs:350-355), so the entry reads and caps the stream first.
async function readJsonBody(
  req: IncomingMessage,
  res: ServerResponse
): Promise<{ handled: true } | { handled: false; parsedBody: unknown }> {
  const chunks: Buffer[] = [];
  let bodyBytes = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const buffer = chunk as Buffer;
    bodyBytes += buffer.length;
    if (bodyBytes > MAX_REQUEST_BODY_BYTES) {
      req.resume();
      res.writeHead(413, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'payload too large' }));
      return { handled: true };
    }
    chunks.push(buffer);
  }
  // Empty and non-JSON bodies pass through unparsed; the SDK answers 415 for a
  // non-JSON content-type before it reads any body.
  if (chunks.length === 0 || !isJsonContentType(req.headers['content-type'])) {
    return { handled: false, parsedBody: undefined };
  }
  try {
    return {
      handled: false,
      parsedBody: JSON.parse(Buffer.concat(chunks).toString()),
    };
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32700, message: 'Parse error' },
        id: null,
      })
    );
    return { handled: true };
  }
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
  // Signs the cost-confirmation request state for this process; a restart
  // invalidates in-flight elicitations, which is the intended scope.
  const requestStateKey = randomBytes(32);

  const listener = toNodeHandler(
    {
      fetch: async (request, { parsedBody } = {}) => {
        const rejected = hostHeaderValidationResponse(
          request,
          allowedHostnames
        );
        if (rejected) return rejected;

        if (new URL(request.url).pathname !== LOCAL_HTTP_PATH) {
          return Response.json({ error: 'not found' }, { status: 404 });
        }

        const accessToken = bearerToken(request);
        if (!accessToken) {
          return Response.json(
            { error: 'missing bearer token' },
            { status: 401 }
          );
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
          {
            platform,
            projectId,
            readOnly,
            features,
            contentApiUrl,
            costConfirmation: {
              requestStateKey,
              // PAT mode can serve several clients with different PATs in one
              // process, so the principal is the bearer's hash.
              // #404 (--oauth) switches this to a per-process principal; the token refreshes, the principal must not.
              principal: createHash('sha256').update(accessToken).digest('hex'),
              enabledTools: ['create_project', 'create_branch'],
            },
          },
          { legacy: 'stateless', onerror: console.error }
        );
        request.signal.addEventListener('abort', () => handler.close(), {
          once: true,
        });
        return handler.fetch(request, { parsedBody });
      },
    },
    { onerror: console.error }
  );

  const server = createServer(async (req, res) => {
    try {
      const body = await readJsonBody(req, res);
      if (body.handled) return;
      await listener(req, res, body.parsedBody);
    } catch (error) {
      // A client dropping mid-upload rejects the body read outside the SDK's
      // error handling; without this the process dies on the rejection.
      console.error(error);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal error' }));
      } else {
        res.destroy();
      }
    }
  });

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
  return `Supabase MCP server (--http) listening on ${url}

Add to .mcp.json (Claude Code expands \${SUPABASE_ACCESS_TOKEN} at connect time):
{
  "mcpServers": {
    "supabase-local": {
      "type": "http",
      "url": "${url}",
      "headers": { "Authorization": "Bearer \${SUPABASE_ACCESS_TOKEN}" }
    }
  }
}
Modern form-capable clients see cost confirmations as elicitations; legacy (2025-era) clients keep get_cost / confirm_cost. Requests log their era on stderr.`;
}
