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
  type ReadResourceResult,
  type ServerCapabilities,
  type ListToolsResult,
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
export type Annotations = NonNullable<
  ListToolsResult['tools'][number]['annotations']
>;

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
  Params extends z.ZodObject<any> = z.ZodObject<any>,
  Result = unknown,
> = {
  description: Prop<string>;
  annotations?: Annotations;
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
export function tool<Params extends z.ZodObject<any>, Result>(
  tool: Tool<Params, Result>
) {
  return tool;
}

export type InitData = {
  clientInfo: Implementation;
  clientCapabilities: ClientCapabilities;
};

type ToolCallBaseDetails = {
  name: string;
  arguments: Record<string, unknown>;
  annotations?: Annotations;
};

type ToolCallSuccessDetails = ToolCallBaseDetails & {
  success: true;
  data: unknown;
};

type ToolCallErrorDetails = ToolCallBaseDetails & {
  success: false;
  error: unknown;
};

export type ToolCallDetails = ToolCallSuccessDetails | ToolCallErrorDetails;

export type InitCallback = (initData: InitData) => void | Promise<void>;
export type ToolCallCallback = (details: ToolCallDetails) => void;
export type PropCallback<T> = () => T | Promise<T>;
export type Prop<T> = T | PropCallback<T>;

export type McpServerOptions = {
  /**
   * The name of the MCP server. This will be sent to the client as part of
   * the initialization process.
   */
  name: string;

  /**
   * The title of the MCP server. This is a human-readable name that can be
   * displayed in the client UI.
   *
   * If not provided, the name will be used as the title.
   */
  title?: string;

  /**
   * The version of the MCP server. This will be sent to the client as part of
   * the initialization process.
   */
  version: string;

  /**
   * Callback for when initialization has fully completed with the client.
   */
  onInitialize?: InitCallback;

  /**
   * Callback for after a tool is called.
   */
  onToolCall?: ToolCallCallback;

  /**
   * Resources to be served by the server. These can be defined as a static
   * object or as a function that dynamically returns the object synchronously
   * or asynchronously.
   *
   * If defined as a function, the function will be called whenever the client
   * asks for the list of resources or reads a resource. This allows for dynamic
   * resources that can change after the server has started.
   */
  resources?: Prop<
    (Resource<string, unknown> | ResourceTemplate<string, unknown>)[]
  >;

  /**
   * Tools to be served by the server. These can be defined as a static object
   * or as a function that dynamically returns the object synchronously or
   * asynchronously.
   *
   * If defined as a function, the function will be called whenever the client
   * asks for the list of tools or invokes a tool. This allows for dynamic tools
   * that can change after the server has started.
   */
  tools?: Prop<Record<string, Tool>>;
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
      title: options.title,
      version: options.version,
    },
    {
      capabilities,
    }
  );

  async function getResources() {
    if (!options.resources) {
      throw new Error('resources not available');
    }

    return typeof options.resources === 'function'
      ? await options.resources()
      : options.resources;
  }

  async function getTools() {
    if (!options.tools) {
      throw new Error('tools not available');
    }

    return typeof options.tools === 'function'
      ? await options.tools()
      : options.tools;
  }

  server.oninitialized = async () => {
    const clientInfo = server.getClientVersion();
    const clientCapabilities = server.getClientCapabilities();

    if (!clientInfo) {
      throw new Error('client info not available after initialization');
    }

    if (!clientCapabilities) {
      throw new Error('client capabilities not available after initialization');
    }

    const initData: InitData = {
      clientInfo,
      clientCapabilities,
    };

    await options.onInitialize?.(initData);
  };

  if (options.resources) {
    server.setRequestHandler(
      ListResourcesRequestSchema,
      async (): Promise<ListResourcesResult> => {
        const allResources = await getResources();
        return {
          resources: allResources
            .filter((resource) => 'uri' in resource)
            .map(({ uri, name, description, mimeType }) => {
              return {
                uri,
                name,
                description,
                mimeType,
              };
            }),
        };
      }
    );

    server.setRequestHandler(
      ListResourceTemplatesRequestSchema,
      async (): Promise<ListResourceTemplatesResult> => {
        const allResources = await getResources();
        return {
          resourceTemplates: allResources
            .filter((resource) => 'uriTemplate' in resource)
            .map(({ uriTemplate, name, description, mimeType }) => {
              return {
                uriTemplate,
                name,
                description,
                mimeType,
              };
            }),
        };
      }
    );

    server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request): Promise<ReadResourceResult> => {
        try {
          const allResources = await getResources();
          const { uri } = request.params;

          const resources = allResources.filter(
            (resource) => 'uri' in resource
          );
          const resource = resources.find((resource) =>
            compareUris(resource.uri, uri)
          );

          if (resource) {
            const result = await resource.read(uri as `${string}://${string}`);

            const contents = Array.isArray(result) ? result : [result];

            return {
              contents,
            };
          }

          const resourceTemplates = allResources.filter(
            (resource) => 'uriTemplate' in resource
          );
          const resourceTemplateUris = resourceTemplates.map(
            ({ uriTemplate }) => assertValidUri(uriTemplate)
          );

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

          const result = await resourceTemplate.read(
            uri as `${string}://${string}`,
            templateMatch.params
          );

          const contents = Array.isArray(result) ? result : [result];

          return {
            contents,
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
          } as any;
        }
      }
    );
  }

  if (options.tools) {
    server.setRequestHandler(
      ListToolsRequestSchema,
      async (): Promise<ListToolsResult> => {
        const tools = await getTools();

        return {
          tools: await Promise.all(
            Object.entries(tools).map(
              async ([name, { description, annotations, parameters }]) => {
                const inputSchema = zodToJsonSchema(parameters);

                if (!('properties' in inputSchema)) {
                  throw new Error('tool parameters must be a ZodObject');
                }

                return {
                  name,
                  description:
                    typeof description === 'function'
                      ? await description()
                      : description,
                  annotations,
                  inputSchema,
                };
              }
            )
          ),
        } satisfies ListToolsResult;
      }
    );

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const tools = await getTools();
        const toolName = request.params.name;

        if (!(toolName in tools)) {
          throw new Error('tool not found');
        }

        const tool = tools[toolName];

        if (!tool) {
          throw new Error('tool not found');
        }
        const args = tool.parameters
          .strict()
          .parse(request.params.arguments ?? {});

        const executeWithCallback = async (tool: Tool) => {
          // Wrap success or error in a result value
          const res = await tool
            .execute(args)
            .then((data: unknown) => ({ success: true as const, data }))
            .catch((error) => ({ success: false as const, error }));

          try {
            options.onToolCall?.({
              name: toolName,
              arguments: args,
              annotations: tool.annotations,
              ...res,
            });
          } catch (error) {
            // Don't fail the tool call if the callback fails
            console.error('Failed to run tool callback', error);
          }

          // Unwrap result
          if (!res.success) {
            throw res.error;
          }
          return res.data;
        };

        const result = await executeWithCallback(tool);

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
