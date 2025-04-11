import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type ClientCapabilities,
  type Implementation,
  type ListResourcesResult,
  type ListResourceTemplatesResult,
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
import { assertValidUri, compareUris, matchUriTemplate } from './util.js';

export type Scheme = string;

export type Resource<Uri extends string = string, Result = unknown> = {
  uri: Uri;
  name: string;
  description?: string;
  mimeType?: string;
  read(uri: `${Scheme}://${Uri}`): Promise<Result>;
};

export type ResourceTemplate<Uri extends string = string, Result = unknown> = {
  uriTemplate: Uri;
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
): Resource<Uri, Result> {
  return {
    uri,
    ...resource,
  };
}

/**
 * Helper function to define an MCP resource with a URI template while preserving type information.
 */
export function resourceTemplate<Uri extends string, Result>(
  uriTemplate: Uri,
  resource: Omit<ResourceTemplate<Uri, Result>, 'uriTemplate'>
): ResourceTemplate<Uri, Result> {
  return {
    uriTemplate,
    ...resource,
  };
}

/**
 * Helper function to define a JSON resource while preserving type information.
 */
export function jsonResource<Uri extends string, Result>(
  uri: Uri,
  resource: Omit<Resource<Uri, Result>, 'uri' | 'mimeType'>
): Resource<Uri, Result> {
  return {
    uri,
    mimeType: 'application/json' as const,
    ...resource,
  };
}

/**
 * Helper function to define a JSON resource with a URI template while preserving type information.
 */
export function jsonResourceTemplate<Uri extends string, Result>(
  uriTemplate: Uri,
  resource: Omit<ResourceTemplate<Uri, Result>, 'uriTemplate' | 'mimeType'>
): ResourceTemplate<Uri, Result> {
  return {
    uriTemplate,
    mimeType: 'application/json' as const,
    ...resource,
  };
}

/**
 * Helper function to define a list of resources that share a common URI scheme.
 */
export function resources<Scheme extends string>(
  scheme: Scheme,
  resources: (Resource | ResourceTemplate)[]
): (
  | Resource<`${Scheme}://${string}`>
  | ResourceTemplate<`${Scheme}://${string}`>
)[] {
  return resources.map((resource) => {
    if ('uri' in resource) {
      const url = new URL(resource.uri, `${scheme}://`);
      const uri = decodeURI(url.href) as `${Scheme}://${typeof resource.uri}`;

      return {
        ...resource,
        uri,
      };
    }

    const url = new URL(resource.uriTemplate, `${scheme}://`);
    const uriTemplate = decodeURI(
      url.href
    ) as `${Scheme}://${typeof resource.uriTemplate}`;

    return {
      ...resource,
      uriTemplate,
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
  resources?: (Resource<string, unknown> | ResourceTemplate<string, unknown>)[];
  tools?: Record<string, Tool>;
  onInitialize?: (
    clientInfo: Implementation,
    clientCapabilities: ClientCapabilities
  ) => void;
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

  server.oninitialized = () => {
    const clientInfo = server.getClientVersion();
    const clientCapabilities = server.getClientCapabilities();

    if (!clientInfo) {
      throw new Error('client info not available after initialization');
    }

    if (!clientCapabilities) {
      throw new Error('client capabilities not available after initialization');
    }

    options.onInitialize?.(clientInfo, clientCapabilities);
  };

  if (options.resources) {
    const allResources = options.resources;
    const resources = allResources.filter((resource) => 'uri' in resource);
    const resourceTemplates = allResources.filter(
      (resource) => 'uriTemplate' in resource
    );
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
    const resourceTemplateList = resourceTemplates.map(
      ({ uriTemplate, name, description, mimeType }) => {
        return {
          uriTemplate,
          name,
          description,
          mimeType,
        };
      }
    );

    const resourceTemplateUris = resourceTemplateList.map(({ uriTemplate }) =>
      assertValidUri(uriTemplate)
    );

    async function readResource(uri: string) {
      const resource = resources.find((resource) =>
        compareUris(resource.uri, uri)
      );

      if (resource) {
        return await resource.read(uri as `${string}://${string}`);
      }

      const templateMatch = matchUriTemplate(uri, resourceTemplateUris);

      if (!templateMatch) {
        throw new Error('resource not found');
      }

      const resourceTemplate = resourceTemplates.find(
        (r) => r.uriTemplate === templateMatch.uri
      );

      if (!resourceTemplate) {
        throw new Error('resource not found');
      }

      return await resourceTemplate.read(
        uri as `${string}://${string}`,
        templateMatch.params
      );
    }

    server.setRequestHandler(
      ListResourcesRequestSchema,
      (): ListResourcesResult => {
        return {
          resources: resourceList,
        };
      }
    );

    server.setRequestHandler(
      ListResourceTemplatesRequestSchema,
      (): ListResourceTemplatesResult => {
        return {
          resourceTemplates: resourceTemplateList,
        };
      }
    );

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const result = await readResource(request.params.uri);
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

      const args = tool.parameters.parse(request.params.arguments ?? {});

      try {
        const result = await tool.execute(args);
        const content = result
          ? [{ type: 'text', text: JSON.stringify(result) }]
          : [];

        return {
          content,
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: enumerateError(error) }),
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

function enumerateError(error: unknown) {
  if (!error) {
    return error;
  }

  if (typeof error !== 'object') {
    return error;
  }

  const newError: Record<string, unknown> = {};

  const errorProps = ['name', 'message'] as const;

  for (const prop of errorProps) {
    if (prop in error) {
      newError[prop] = (error as Record<string, unknown>)[prop];
    }
  }

  return newError;
}
