import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type ServerCapabilities,
} from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';
import type {
  ExpandRecursively,
  ExtractNotification,
  ExtractParams,
  ExtractRequest,
  ExtractResult,
} from './types.js';
import { assertValidUri, matchUriTemplate } from './util.js';

export type Scheme = string;

export type Resource<Uri extends string = string, Result = unknown> = {
  uri: Uri;
  name: string;
  description?: string;
  mimeType?: string;
  read(
    uri: `${Scheme}://${Uri}`,
    params: {
      [Param in ExtractParams<Uri>]: string;
    }
  ): Promise<Result>;
};

export type Tool<
  Params extends z.ZodTypeAny = z.ZodTypeAny,
  Result = unknown,
> = {
  description: string;
  parameters: Params;
  execute(params: z.infer<Params>): Promise<Result>;
};

/**
 * Helper function to define an MCP resource while preserving type information.
 */
export function resource<Uri extends string, Result>(
  uri: Uri,
  resource: Omit<Resource<Uri, Result>, 'uri'>
) {
  return {
    uri,
    ...resource,
  };
}

/**
 * Helper function to define a JSON resource while preserving type information.
 */
export function jsonResource<Uri extends string, Result>(
  uri: Uri,
  resource: Omit<Resource<Uri, Result>, 'uri' | 'mimeType'>
) {
  return {
    uri,
    mimeType: 'application/json' as const,
    ...resource,
  };
}

/**
 * Helper function to define a list of resources that share a common URI scheme.
 */
export function resources<Scheme extends string>(
  scheme: Scheme,
  resources: Resource[]
): Resource<`${Scheme}://${string}`>[] {
  return resources.map((resource) => {
    const url = new URL(resource.uri, `${scheme}://`);
    const uri = decodeURI(url.href) as `${Scheme}://${typeof resource.uri}`;

    return {
      ...resource,
      uri,
    };
  });
}

/**
 * Helper function to create a JSON resource response.
 */
export function jsonResourceResponse<Uri extends string, Response>(
  uri: Uri,
  response: Response
) {
  return {
    uri,
    mimeType: 'application/json',
    text: JSON.stringify(response),
  };
}

/**
 * Helper function to define an MCP tool while preserving type information.
 */
export function tool<Params extends z.ZodTypeAny, Result>(
  tool: Tool<Params, Result>
) {
  return tool;
}

export type McpServerOptions = {
  name: string;
  version: string;
  resources?: Resource<string, unknown>[];
  tools?: Record<string, Tool>;
};

/**
 * Creates an MCP server with the given options.
 *
 * Simplifies the process of creating an MCP server by providing a high-level
 * API for defining resources and tools.
 */
export function createMcpServer(options: McpServerOptions) {
  const capabilities: ServerCapabilities = {};

  if (options.resources) {
    capabilities.resources = {};
  }

  if (options.tools) {
    capabilities.tools = {};
  }

  const server = new Server(
    {
      name: options.name,
      version: options.version,
    },
    {
      capabilities,
    }
  );

  if (options.resources) {
    const resources = options.resources;
    const resourceList = resources.map(
      ({ uri, name, description, mimeType }) => {
        return {
          uri,
          name,
          description,
          mimeType,
        };
      }
    );
    const resourceUris = resources.map(({ uri }) => assertValidUri(uri));

    server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
      return {
        resources: resourceList,
      };
    });

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const match = matchUriTemplate(request.params.uri, resourceUris);

      if (!match) {
        throw new Error('resource not found');
      }

      const resource = resources.find((r) => r.uri === match.uri);

      if (!resource) {
        throw new Error('resource not found');
      }

      const result = await resource.read(
        request.params.uri as `${string}://${string}`,
        match.params
      );

      const contents = Array.isArray(result) ? result : [result];

      return {
        contents,
      };
    });
  }

  if (options.tools) {
    const tools = options.tools;
    const toolList = Object.entries(tools).map(
      ([name, { description, parameters }]) => {
        return {
          name,
          description,
          inputSchema: zodToJsonSchema(parameters),
        };
      }
    );

    type Tools = typeof tools;
    type ToolName = keyof Tools;
    type Tool = Tools[ToolName];

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: toolList,
      };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name as ToolName;

      if (!(toolName in tools)) {
        throw new Error('tool not found');
      }

      const tool = tools[toolName];

      if (!tool) {
        throw new Error('tool not found');
      }

      const args = request.params.arguments as z.infer<Tool['parameters']>;

      if (!args) {
        throw new Error('missing arguments');
      }

      try {
        const result = await tool.execute(args);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text:
                error && typeof error === 'object' && 'message' in error
                  ? error.message
                  : JSON.stringify(error),
            },
          ],
        };
      }
    });
  }

  // Expand types recursively for better intellisense
  type Request = ExpandRecursively<ExtractRequest<typeof server>>;
  type Notification = ExpandRecursively<ExtractNotification<typeof server>>;
  type Result = ExpandRecursively<ExtractResult<typeof server>>;

  return server as Server<Request, Notification, Result>;
}
