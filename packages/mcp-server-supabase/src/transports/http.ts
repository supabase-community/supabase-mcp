import { createServer } from 'node:http';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';

import { createSupabaseApiPlatform } from '../platform/api-platform.js';
import {
  createSupabaseMcpServer,
  type SupabaseMcpServerOptions,
} from '../server.js';
import { parseList } from './util.js';

// Modern protocol only: created with `legacy: 'reject'`, so a client that
// speaks just the 2025-era protocol gets an HTTP 400 instead of being served.
export function createSupabaseMcpHandler(options: SupabaseMcpServerOptions) {
  return createMcpHandler(() => createSupabaseMcpServer(options), {
    legacy: 'reject',
  });
}

// Same query params as the hosted endpoint.
const querySchema = z.object({
  project_ref: z.string().optional(),
  read_only: z.stringbool().default(false),
  features: z
    .string()
    .transform((value) => parseList(value))
    .optional(),
});

export type ServeHttpOptions = {
  port: number;
  apiUrl?: string;
  contentApiUrl?: string;
};

/** Local dev server shaped like the hosted endpoint. Bodies are buffered. */
export function serveHttp({ port, apiUrl, contentApiUrl }: ServeHttpOptions) {
  createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    const accessToken = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];

    if (!accessToken) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error:
            'Missing `Authorization: Bearer <personal access token>` header',
        })
      );
      return;
    }

    const query = querySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!query.success) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: z.prettifyError(query.error) }));
      return;
    }

    const options: SupabaseMcpServerOptions = {
      platform: createSupabaseApiPlatform({ accessToken, apiUrl }),
      projectId: query.data.project_ref,
      readOnly: query.data.read_only,
      features: query.data.features,
      contentApiUrl,
    };
    // Uses the SDK default `legacy: 'stateless'` so 2025-era clients are
    // served too, unlike `createSupabaseMcpHandler` above.
    // https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/createMcpHandler.ts#L146-L157
    const handler = createMcpHandler(() => createSupabaseMcpServer(options));
    res.on('close', () => {
      handler.close().catch(console.error);
    });

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      for (const v of Array.isArray(value) ? value : [value]) {
        if (v !== undefined) headers.append(key, v);
      }
    }

    const response = await handler.fetch(
      new Request(url, { method: req.method, headers, body })
    );

    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  }).listen(port, () => {
    console.error(`Supabase MCP server on http://localhost:${port}/mcp`);
  });
}
