import {
  createMcpServer,
  jsonResource,
  jsonResourceResponse,
  resources,
  tool,
} from '@supabase/mcp-utils';
import { processSql, renderHttp } from '@supabase/sql-to-rest';
import { z } from 'zod';
import { version } from '../package.json';
import { ensureNoTrailingSlash, ensureTrailingSlash } from './util.js';

export type PostgrestMcpServerOptions = {
  apiUrl: string;
  apiKey?: string;
  schema: string;
};

/**
 * Creates an MCP server for interacting with a PostgREST API.
 */
export function createPostgrestMcpServer(options: PostgrestMcpServerOptions) {
  const apiUrl = ensureNoTrailingSlash(options.apiUrl);
  const apiKey = options.apiKey;
  const schema = options.schema;

  function getHeaders(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET'
  ) {
    const schemaHeader =
      method === 'GET' ? 'accept-profile' : 'content-profile';

    const headers: HeadersInit = {
      'content-type': 'application/json',
      prefer: 'return=representation',
      [schemaHeader]: schema,
    };

    if (apiKey) {
      headers.apikey = apiKey;
      headers.authorization = `Bearer ${apiKey}`;
    }

    return headers;
  }

  return createMcpServer({
    name: 'supabase/postgrest',
    version,
    resources: resources('postgrest', [
      jsonResource('/spec', {
        name: 'OpenAPI spec',
        description: 'OpenAPI spec for the PostgREST API',
        async read(uri) {
          const response = await fetch(ensureTrailingSlash(apiUrl), {
            headers: getHeaders(),
          });

          const result = await response.json();
          return jsonResourceResponse(uri, result);
        },
      }),
    ]),
    tools: {
      postgrestRequest: tool({
        description: 'Performs an HTTP request against the PostgREST API',
        parameters: z.object({
          method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
          path: z.string(),
          body: z
            .union([
              z.record(z.string(), z.unknown()),
              z.array(z.record(z.string(), z.unknown())),
            ])
            .optional(),
        }),
        async execute({ method, path, body }) {
          const url = new URL(`${apiUrl}${path}`);

          const headers = getHeaders(method);

          if (method !== 'GET') {
            headers['content-type'] = 'application/json';
          }

          const response = await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
          });

          return await response.json();
        },
      }),
      sqlToRest: tool({
        description:
          'Converts SQL query to a PostgREST API request (method, path)',
        parameters: z.object({
          sql: z.string(),
        }),
        execute: async ({ sql }) => {
          const statement = await processSql(sql);
          const request = await renderHttp(statement);

          return {
            method: request.method,
            path: request.fullPath,
          };
        },
      }),
    },
  });
}
