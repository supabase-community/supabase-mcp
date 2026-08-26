import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  Server,
} from '@modelcontextprotocol/server';
import type {
  ClientCapabilities,
  Implementation,
  ListResourcesResult,
  ListResourceTemplatesResult,
  ListToolsResult,
  Tool as McpTool,
  ReadResourceResult,
  ServerCapabilities,
  ServerContext,
  ServerOptions,
} from '@modelcontextprotocol/server';
import { z } from 'zod/v4';

import type { ExtractParams } from './types.js';
import type {
  ToolPolicy,
  ToolPolicyTelemetry,
  ToolRequestContext,
} from './tool-policy.js';
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
  // MCP spec restricts outputSchema to type "object" at the root level:
  // https://modelcontextprotocol.io/specification/2025-11-25/schema#tool-outputschema
  OutputSchema extends z.ZodObject<any> = z.ZodObject<any>,
  Resolution = never,
> = {
  description: Prop<string>;
  annotations?: Annotations;
  parameters: Params;
  outputSchema: OutputSchema;
  /**
   * If true, excludes the tool from `tools/list` while keeping it callable via
   * `tools/call`. A function decides the same thing per request, from the
   * normalized request context.
   *
   * The function runs inside `tools/list`, once per tool, and must not throw:
   * a throw fails the whole discovery response, not just this entry.
   */
  hidden?: boolean | ((ctx: ToolRequestContext) => boolean);
  /**
   * Pre-execution policy consulted for discovery schemas, argument
   * normalization, and the decision to execute or answer directly.
   */
  policy?: ToolPolicy<z.infer<Params>, Resolution>;
  execute(
    params: z.infer<Params>,
    ...resolution: [Resolution] extends [never] ? [] : [Resolution]
  ): Promise<z.infer<OutputSchema>>;
  /**
   * Renders the tool result as MCP text content.
   *
   * Defaults to `JSON.stringify`, which keeps the text content a
   * single-encoded rendering of the business result. Setting it never
   * changes discovery bytes and never decides whether `structuredContent`
   * is emitted.
   *
   * It is skipped on a request whose policy suppressed structured results
   * via `policy.outputSchema` returning `undefined`, because that request
   * reproduces the whole pre-normalization result. On a policy-free tool it
   * always applies: setting it there is an explicit authoring choice,
   * unrelated to suppression.
   */
  formatResult?: (result: z.infer<OutputSchema>) => string;
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
export function tool<
  Params extends z.ZodObject<any>,
  OutputSchema extends z.ZodObject<any>,
  Resolution = never,
>(tool: Tool<Params, OutputSchema, Resolution>) {
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

/** Safe, product-neutral report of one pre-execution policy decision. */
type ToolPolicyCallDetails = {
  /** Name of the tool whose policy produced the decision. */
  name: string;
  /**
   * Whether the decision short-circuited business execution.
   *
   * `'rejected'` is this package's own outcome for a decision it could not
   * recognize, never the policy's raw string. On `'rejected'` the
   * policy-reported `telemetry.outcome` is unreliable by construction, so
   * this label is the authoritative one.
   */
  decision: 'execute' | 'result' | 'rejected';
  /** Wall-clock duration of policy resolution, in milliseconds. */
  durationMs: number;
  /** Client identity, when the request carried it. */
  clientInfo?: Implementation;
  /**
   * Allowlisted telemetry reported by the policy.
   *
   * Partial because types erase at runtime: a policy written in plain
   * JavaScript can omit the required identity fields, and the record then
   * carries only what survived the allowlist.
   */
  telemetry: Partial<ToolPolicyTelemetry>;
};

export type InitCallback = (initData: InitData) => void | Promise<void>;
export type ToolCallCallback = (details: ToolCallDetails) => void;
type ToolPolicyCallCallback = (
  details: ToolPolicyCallDetails
) => void | Promise<void>;
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
   * Optional instructions describing how to use the server and its features.
   *
   * This can be used by clients to improve the LLM's understanding of available
   * tools, resources, etc. It can be thought of like a "hint" to the model.
   * For example, this information MAY be added to the system prompt.
   */
  instructions?: string;

  /**
   * Callback for after a tool is called.
   */
  onToolCall?: ToolCallCallback;

  /**
   * Callback for each pre-execution policy decision. Receives allowlisted
   * telemetry only; a failure here never changes a tool result.
   *
   * The callback is not awaited. Its completion is not ordered before the
   * response, and on serving paths that stop work once the response is sent
   * it is not guaranteed to run to completion at all. A failing or slow sink
   * never changes or delays the tool result.
   */
  onToolPolicyCall?: ToolPolicyCallCallback;

  /**
   * Multi-round-trip request-state integrity hook, forwarded unchanged to the
   * SDK server.
   *
   * The SDK owns the option shape, when `verify` runs, what a resolved value
   * means, and the JSON-RPC error a rejection produces. This package adds one
   * typed pass-through and no behavior of its own.
   */
  requestState?: ServerOptions['requestState'];

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
  tools?: Prop<Record<string, Tool<any, any, any>>>;
};

/**
 * The result shape one request gets. Discovery and the call path resolve this
 * once per request from the same function, so they always agree.
 */
type RequestResultShape =
  /** Policy-free: pre-normalization bytes, with `formatResult` still applied. */
  | { kind: 'plain' }
  /** Policy suppressed this request: the base result, `formatResult` skipped. */
  | { kind: 'suppressed' }
  /** Structured results advertised and emitted against this schema. */
  | { kind: 'normalized'; outputSchema: z.ZodType };

/**
 * Decides whether a request carries structured results.
 *
 * Structured results follow the policy seam: `policy.outputSchema` is the
 * only hook that can contextualize an advertised output schema, so a
 * policy-free tool never advertises. A policy that defines the hook decides
 * per request and can suppress; a policy without one always normalizes.
 */
function resolveResultShape(
  tool: Tool<any, any, any>,
  ctx: ToolRequestContext
): RequestResultShape {
  if (!tool.policy) {
    return { kind: 'plain' };
  }

  if (!tool.policy.outputSchema) {
    return { kind: 'normalized', outputSchema: tool.outputSchema };
  }

  const outputSchema = tool.policy.outputSchema(tool.outputSchema, ctx);

  return outputSchema === undefined
    ? { kind: 'suppressed' }
    : { kind: 'normalized', outputSchema };
}

/**
 * Resolves the input schema one request advertises and enforces.
 *
 * `tools/list` and `tools/call` both resolve it here, from the same hook
 * call and in the same strict form, so the advertised schema and the schema
 * strict parsing enforces cannot disagree. A hook returning a loose or
 * catchall object still advertises and rejects unknown keys: strictness at
 * this seam belongs to the server, not to the policy.
 */
function resolveParameters(
  tool: Tool<any, any, any>,
  ctx: ToolRequestContext
): z.ZodObject<any> {
  return (
    tool.policy?.inputSchema?.(tool.parameters, ctx) ?? tool.parameters
  ).strict();
}

/**
 * Renders one `tools/list` entry for one request.
 */
async function describeTool(
  name: string,
  tool: Tool<any, any, any>,
  ctx: ToolRequestContext
): Promise<ListToolsResult['tools'][number]> {
  const inputSchema = z.toJSONSchema(resolveParameters(tool, ctx), {
    target: 'draft-7',
  });
  const entry = {
    name,
    description:
      typeof tool.description === 'function'
        ? await tool.description()
        : tool.description,
    annotations: tool.annotations,
    // Casting the same as the SDK does:
    // https://github.com/modelcontextprotocol/typescript-sdk/blob/fb07af810b51003c338dc4885a9e42f54519f9af/src/server/mcp.ts#L154
    inputSchema: inputSchema as McpTool['inputSchema'],
  };

  // A request advertises only when the shared decision normalizes it: a
  // policy-free tool never does, and a policy can suppress per request.
  // Suppressed and policy-free entries keep the discovery bytes they had
  // before structured results existed.
  const shape = resolveResultShape(tool, ctx);

  if (shape.kind !== 'normalized') {
    return entry;
  }

  return {
    ...entry,
    outputSchema: z.toJSONSchema(shape.outputSchema, {
      target: 'draft-7',
    }) as McpTool['outputSchema'],
  };
}

/**
 * Derives the product-neutral request context from SDK-owned metadata.
 * Called once per `tools/list` and `tools/call`, so every policy hook and
 * visibility filter in one request sees the same facts.
 */
function normalizeToolRequestContext(
  requestContext: ServerContext,
  server: Server
): ToolRequestContext {
  const envelope = requestContext.mcpReq.envelope as
    | Record<string, unknown>
    | undefined;

  return {
    server: requestContext,
    // The per-request `_meta` envelope exists only on the modern revision.
    era:
      envelope?.[PROTOCOL_VERSION_META_KEY] === undefined ? 'legacy' : 'modern',
    // The modern per-request envelope is authoritative. The legacy path
    // carries no envelope, so fall back to what initialization captured.
    clientInfo:
      (envelope?.[CLIENT_INFO_META_KEY] as Implementation | undefined) ??
      server.getClientVersion(),
    clientCapabilities:
      (envelope?.[CLIENT_CAPABILITIES_META_KEY] as
        | ClientCapabilities
        | undefined) ?? server.getClientCapabilities(),
  };
}

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
      instructions: options.instructions,
      requestState: options.requestState,
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
      'resources/list',
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
      'resources/templates/list',
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
      'resources/read',
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
      'tools/list',
      async (_request, serverContext): Promise<ListToolsResult> => {
        const tools = await getTools();
        const context = normalizeToolRequestContext(serverContext, server);
        const visibleTools = Object.entries(tools).filter(
          ([, tool]) =>
            !(typeof tool.hidden === 'function'
              ? tool.hidden(context)
              : tool.hidden)
        );

        return {
          tools: await Promise.all(
            visibleTools.map(([name, tool]) =>
              describeTool(name, tool, context)
            )
          ),
        } satisfies ListToolsResult;
      }
    );

    server.setRequestHandler('tools/call', async (request, serverContext) => {
      const context = normalizeToolRequestContext(serverContext, server);

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

        const rawArguments = request.params.arguments ?? {};
        // Check for the hook, not for a nullish result: a policy that
        // normalizes arguments away must not silently fall back to the raw
        // arguments, which strict parsing would then reject.
        const normalizedArguments = tool.policy?.normalizeArguments
          ? tool.policy.normalizeArguments(rawArguments, context)
          : rawArguments;
        // Already strict, and the exact schema discovery advertised.
        const args = resolveParameters(tool, context).parse(
          normalizedArguments
        ) as Record<string, unknown>;

        // Resolved once per request, before the policy runs, so the hook
        // cannot observe anything `resolve` changed and discovery and the
        // call path can never disagree.
        const shape = resolveResultShape(tool, context);

        let resolution: unknown;
        if (tool.policy) {
          const policyStartedAt = performance.now();
          const decision = await tool.policy.resolve(args, context);
          const durationMs = performance.now() - policyStartedAt;

          // Guard first, then narrow, so the audit record is built from a
          // recognized decision instead of whatever the policy returned.
          // Types erase at runtime: a plain JavaScript policy or a cast can
          // return a nullish value, a non-object, or an unknown `type`, and
          // all three are unrecognizable the same way.
          const rawDecision = decision as
            | { type?: unknown; telemetry?: ToolPolicyTelemetry }
            | null
            | undefined;
          const recognized =
            typeof decision === 'object' &&
            decision !== null &&
            (decision.type === 'execute' || decision.type === 'result')
              ? decision
              : undefined;

          // Fire-and-forget, exactly once per request and after narrowing, so
          // every outcome reaches the sink under a label this package owns.
          // The callback is an audit sink that the JSDoc promises cannot
          // change the result, so a slow or never-settling one must not stall
          // the request. `Promise.resolve().then` also captures a synchronous
          // throw from a plain JavaScript callback.
          void Promise.resolve()
            .then(() =>
              options.onToolPolicyCall?.({
                name: toolName,
                decision: recognized?.type ?? 'rejected',
                clientInfo: context.clientInfo,
                durationMs,
                telemetry: safeToolPolicyTelemetry(rawDecision?.telemetry),
              })
            )
            .catch((error) => {
              // Don't fail the tool call if the callback fails
              console.error('Failed to run tool policy callback', error);
            });

          if (!recognized) {
            // Fail closed instead of falling through and executing the
            // guarded tool with no resolution. The throw lands in this
            // handler's catch, which is how a policy that throws already
            // behaves.
            throw new Error(
              `Unrecognized tool policy decision type: ${String(rawDecision?.type)}`
            );
          }

          switch (recognized.type) {
            case 'execute':
              resolution = recognized.resolution;
              break;
            case 'result':
              return recognized.result;
          }
        }

        const executeWithCallback = async () => {
          // Policy-free tools keep the existing one-argument execute call.
          const executeResult = tool.policy
            ? tool.execute(args, resolution)
            : (
                tool.execute as (
                  args: Record<string, unknown>
                ) => Promise<unknown>
              )(args);
          // Wrap success or error in a result value
          const res = await executeResult
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

        const result = await executeWithCallback();

        if (result == null) {
          return { content: [] };
        }

        const structuredContent = result as Record<string, unknown>;
        // A suppressed request reproduces the whole pre-normalization result,
        // which means the default single-encoded text: `formatResult` is
        // skipped. Policy-free and normalized requests both apply it.
        const text =
          shape.kind !== 'suppressed' && tool.formatResult
            ? tool.formatResult(structuredContent)
            : JSON.stringify(structuredContent);

        if (shape.kind !== 'normalized') {
          return { content: [{ type: 'text', text }] };
        }

        return {
          structuredContent,
          content: [{ type: 'text', text }],
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

  return server;
}

/**
 * Copies only the allowlisted scalar telemetry fields.
 *
 * `ToolPolicyTelemetry` is a compile-time contract and types erase at
 * runtime, so a policy that spreads a wider object, or any policy written in
 * plain JavaScript, could otherwise push raw arguments or request state into
 * a telemetry sink. Widening the allowlist means changing both the type and
 * this function.
 *
 * A decision missing the object entirely (again, a plain JavaScript policy or
 * a cast) yields empty telemetry rather than a `TypeError`, which would
 * otherwise drop the audit record and log it as a callback failure.
 */
function safeToolPolicyTelemetry(
  telemetry: ToolPolicyTelemetry | undefined
): Partial<ToolPolicyTelemetry> {
  if (!telemetry || typeof telemetry !== 'object') {
    return {};
  }

  const safe: Partial<ToolPolicyTelemetry> = {};

  if (typeof telemetry.interactionId === 'string') {
    safe.interactionId = telemetry.interactionId;
  }

  if (typeof telemetry.authorityPath === 'string') {
    safe.authorityPath = telemetry.authorityPath;
  }

  if (typeof telemetry.outcome === 'string') {
    safe.outcome = telemetry.outcome;
  }

  if (typeof telemetry.reason === 'string') {
    safe.reason = telemetry.reason;
  }

  if (typeof telemetry.policyId === 'string') {
    safe.policyId = telemetry.policyId;
  }

  if (typeof telemetry.policyVersion === 'number') {
    safe.policyVersion = telemetry.policyVersion;
  }

  return safe;
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
