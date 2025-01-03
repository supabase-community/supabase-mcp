import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { processSql, renderHttp } from '@supabase/sql-to-rest';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { version } from '../package.json';
import { ensureNoTrailingSlash, ensureTrailingSlash } from './util.js';

export type PostgrestMcpServerOptions = {
  apiUrl: string;
  apiKey?: string;
  schema: string;
};

export default class PostgrestMcpServer extends Server {
  readonly #apiUrl: string;
  readonly #apiKey?: string;
  readonly #schema: string;
  readonly #tools = {
    postgrestRequest: {
      description: 'Performs HTTP request against the PostgREST API',
      parameters: z.object({
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
        path: z.string(),
        body: z.record(z.unknown()).optional(),
      }),
      execute: async <Body>({
        method,
        path,
        body,
      }: {
        method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
        path: string;
        body?: Body;
      }) => {
        const url = new URL(`${this.#apiUrl}${path}`);

        const response = await fetch(url, {
          method,
          headers: this.#getHeaders(method),
          body: body ? JSON.stringify(body) : undefined,
        });

        return await response.json();
      },
    },
    sqlToRest: {
      description:
        'Converts SQL query to a PostgREST API request (method, path)',
      parameters: z.object({
        sql: z.string(),
      }),
      execute: async ({ sql }: { sql: string }) => {
        const statement = await processSql(sql);
        const request = await renderHttp(statement);

        return {
          method: request.method,
          path: request.fullPath,
        };
      },
    },
  };

  constructor(options: PostgrestMcpServerOptions) {
    super(
      {
        name: 'supabase/postgrest',
        version,
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    this.#apiUrl = ensureNoTrailingSlash(options.apiUrl);
    this.#apiKey = options.apiKey;
    this.#schema = options.schema;

    this.setRequestHandler(ListResourcesRequestSchema, async () => {
      const openApiSpec = await this.#fetchOpenApiSpec();

      const resources = Object.keys(openApiSpec.paths)
        .filter((path) => path !== '/')
        .map((path) => {
          const name = path.split('/').pop();
          const pathValue = openApiSpec.paths[path];
          const description = pathValue.get?.summary;

          return {
            uri: new URL(`${path}/spec`, `postgrest://${this.#schema}`).href,
            name: `"${name}" OpenAPI path spec`,
            description,
            mimeType: 'application/json',
          };
        });

      return {
        resources,
      };
    });

    this.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const openApiSpec = await this.#fetchOpenApiSpec();

      const resourceUrl = new URL(request.params.uri);

      const pathComponents = resourceUrl.pathname.split('/');
      const specLiteral = pathComponents.pop();
      const pathName = pathComponents.pop();

      if (specLiteral !== 'spec') {
        throw new Error('invalid resource uri');
      }

      const pathSpec = openApiSpec.paths[`/${pathName}`];

      if (!pathSpec) {
        throw new Error('path not found');
      }

      return {
        contents: [
          {
            uri: request.params.uri,
            mimeType: 'application/json',
            text: JSON.stringify(pathSpec),
          },
        ],
      };
    });

    this.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = Object.entries(this.#tools).map(
        ([name, { description, parameters }]) => {
          return {
            name,
            description,
            inputSchema: zodToJsonSchema(parameters),
          };
        }
      );

      return {
        tools,
      };
    });

    this.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tools = this.#tools;
      const toolName = request.params.name as keyof typeof tools;

      if (!(toolName in this.#tools)) {
        throw new Error('tool not found');
      }

      const tool = this.#tools[toolName];
      const args = tool.parameters.parse(request.params.arguments);

      if (!args) {
        throw new Error('missing arguments');
      }

      const result = await tool.execute(args as any);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
      };
    });
  }

  async #fetchOpenApiSpec() {
    const response = await fetch(ensureTrailingSlash(this.#apiUrl), {
      headers: this.#getHeaders(),
    });

    return (await response.json()) as any;
  }

  #getHeaders(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET') {
    const schemaHeader =
      method === 'GET' ? 'accept-profile' : 'content-profile';

    const headers: HeadersInit = {
      'content-type': 'application/json',
      prefer: 'return=representation',
      [schemaHeader]: this.#schema,
    };

    if (this.#apiKey) {
      headers.apikey = this.#apiKey;
      headers.authorization = `Bearer ${this.#apiKey}`;
    }

    return headers;
  }
}
