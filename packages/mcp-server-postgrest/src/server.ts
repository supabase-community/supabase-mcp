import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
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
      }),
      execute: async ({
        method,
        path,
      }: {
        method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
        path: string;
      }) => {
        const url = new URL(`${this.#apiUrl}${path}`);

        const response = await fetch(url, {
          method,
          headers: this.#getHeaders(method),
        });

        return await response.json();
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
      const args = request.params.arguments as z.infer<
        (typeof tool)['parameters']
      >;

      if (!args) {
        throw new Error('missing arguments');
      }

      const result = await tool.execute(args);

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
    const headers: HeadersInit = {
      [method === 'GET' ? 'accept-profile' : 'content-profile']: this.#schema,
    };

    if (this.#apiKey) {
      headers.apikey = this.#apiKey;
      headers.authorization = `Bearer ${this.#apiKey}`;
    }

    return headers;
  }
}
