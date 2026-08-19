import type {
  CallToolResult,
  Implementation,
  InputRequiredResult,
  ListToolsResult,
  Server,
  Tool as McpTool,
} from '@modelcontextprotocol/server';
import { z } from 'zod/v4';

import {
  normalizeToolRequestContext,
  sanitizeToolPolicyTelemetry,
  type ToolPolicy,
  type ToolPolicyTelemetry,
  type ToolRequestContext,
  type ToolRequestInputs,
} from './tool-policy.js';
import { enumerateError } from './resource-handlers.js';

export type Annotations = NonNullable<
  ListToolsResult['tools'][number]['annotations']
>;

export type PropCallback<T> = () => T | Promise<T>;
export type Prop<T> = T | PropCallback<T>;

export type Tool<
  Params extends z.ZodObject<any> = z.ZodObject<any>,
  // MCP spec restricts outputSchema to type "object" at the root level:
  // https://modelcontextprotocol.io/specification/2025-11-25/schema#tool-outputschema
  OutputSchema extends z.ZodObject<any> = z.ZodObject<any>,
  Resolution = never,
  EffectiveParams = z.infer<Params>,
> = {
  description: Prop<string>;
  annotations?: Annotations;
  parameters: Params;
  /** Values merged into arguments before validation and policy resolution. */
  inject?: Partial<EffectiveParams>;
  outputSchema: OutputSchema;
  /** If true, excludes the tool from `tools/list` while keeping it callable via `tools/call`. */
  hidden?: boolean;
  /** Contextual discovery filter. */
  visible?: (ctx: ToolRequestContext) => boolean;
  policy?: ToolPolicy<EffectiveParams, Resolution>;
  execute(
    params: EffectiveParams,
    ...resolution: [Resolution] extends [never] ? [] : [Resolution]
  ): Promise<z.infer<OutputSchema>>;
  /** Renders the tool result as MCP text content. Defaults to `JSON.stringify`. */
  formatResult?: (result: z.infer<OutputSchema>) => string;
};

/** Tool definition accepted by `tool()`. */
export type ToolInput<
  Params extends z.ZodObject<any> = z.ZodObject<any>,
  OutputSchema extends z.ZodObject<any> = z.ZodObject<any>,
  Resolution = never,
  EffectiveParams = z.infer<Params>,
> = Tool<Params, OutputSchema, Resolution, EffectiveParams>;

/**
 * Defines a tool while preserving its generic inference.
 */
export function tool<
  Params extends z.ZodObject<any>,
  OutputSchema extends z.ZodObject<any>,
  Resolution = never,
  EffectiveParams = z.infer<Params>,
>(
  tool: ToolInput<Params, OutputSchema, Resolution, EffectiveParams>
): Tool<Params, OutputSchema, Resolution, EffectiveParams> {
  return tool;
}

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
export type ToolPolicyCallDetails = {
  name: string;
  clientInfo?: Implementation;
  formElicitation: boolean;
  durationMs: number;
  telemetry: ToolPolicyTelemetry;
};

export type ToolCallCallback = (details: ToolCallDetails) => void;
export type ToolPolicyCallCallback = (
  details: ToolPolicyCallDetails
) => void | Promise<void>;

type RegisteredTool = Tool<z.ZodObject<any>, z.ZodObject<any>, any, any>;
type RegisteredTools = Record<string, RegisteredTool>;

type RegisterToolHandlersOptions = {
  server: Server;
  getTools: () => Promise<RegisteredTools>;
  toolRequestInputs?: ToolRequestInputs;
  onToolCall?: ToolCallCallback;
  onToolPolicyCall?: ToolPolicyCallCallback;
};

type PolicyResolution =
  | { type: 'result'; result: CallToolResult | InputRequiredResult }
  | { type: 'execute'; resolution: unknown };

function prepareArguments(
  tool: RegisteredTool,
  rawArguments: Record<string, unknown>,
  context: ToolRequestContext
): Record<string, unknown> {
  const normalizedArguments =
    tool.policy?.normalizeArguments?.(rawArguments, context) ?? rawArguments;
  const clientParameters =
    tool.policy?.inputSchema?.(tool.parameters, context) ?? tool.parameters;
  const clientArguments = clientParameters
    .strict()
    .parse(normalizedArguments) as Record<string, unknown>;
  const effectiveArguments = tool.inject
    ? {
        ...clientArguments,
        ...tool.inject,
      }
    : clientArguments;
  return effectiveArguments;
}

function getAdvertisedOutputSchema(
  tool: RegisteredTool,
  context: ToolRequestContext
) {
  if (
    context.era === 'legacy' &&
    context.formDeliveryAvailable &&
    !context.formElicitation
  ) {
    return undefined;
  }

  const outputSchema =
    tool.policy?.outputSchema?.(tool.outputSchema, context) ??
    tool.outputSchema;
  return z.toJSONSchema(outputSchema, { target: 'draft-7' });
}

async function resolvePolicy({
  tool,
  toolName,
  effectiveArguments,
  context,
  advertisedOutputSchema,
  server,
  onToolPolicyCall,
}: {
  tool: RegisteredTool;
  toolName: string;
  effectiveArguments: Record<string, unknown>;
  context: ToolRequestContext;
  advertisedOutputSchema: Record<string, unknown> | undefined;
  server: Server;
  onToolPolicyCall?: ToolPolicyCallCallback;
}): Promise<PolicyResolution> {
  if (!tool.policy) {
    return { type: 'execute', resolution: undefined };
  }

  const policyStartedAt = performance.now();
  const decision = await tool.policy.resolve(effectiveArguments, context);
  const durationMs = performance.now() - policyStartedAt;

  try {
    await onToolPolicyCall?.({
      name: toolName,
      clientInfo: context.clientInfo,
      formElicitation: context.formElicitation,
      durationMs,
      telemetry: {
        ...sanitizeToolPolicyTelemetry(decision.telemetry),
        formSupportReason: context.formSupportReason,
      },
    });
  } catch (error) {
    // Don't fail the tool call if the callback fails
    console.error('Failed to run tool policy callback', error);
  }

  if (decision.type === 'result') {
    return {
      type: 'result',
      result:
        'resultType' in decision.result
          ? decision.result
          : server.projectCallToolResult(
              decision.result,
              advertisedOutputSchema
            ),
    };
  }

  return { type: 'execute', resolution: decision.resolution };
}

async function executeTool({
  tool,
  toolName,
  effectiveArguments,
  resolution,
  onToolCall,
}: {
  tool: RegisteredTool;
  toolName: string;
  effectiveArguments: Record<string, unknown>;
  resolution: unknown;
  onToolCall?: ToolCallCallback;
}) {
  // Policy-free tools keep the existing one-argument execute call.
  const executeResult = tool.policy
    ? tool.execute(effectiveArguments, resolution)
    : (tool.execute as (args: Record<string, unknown>) => Promise<unknown>)(
        effectiveArguments
      );
  const result = await executeResult
    .then((data: unknown) => ({ success: true as const, data }))
    .catch((error) => ({ success: false as const, error }));

  try {
    onToolCall?.({
      name: toolName,
      arguments: effectiveArguments,
      annotations: tool.annotations,
      ...result,
    });
  } catch (error) {
    // Don't fail the tool call if the callback fails
    console.error('Failed to run tool callback', error);
  }

  if (!result.success) {
    throw result.error;
  }
  return result.data;
}

function formatToolResult(
  tool: RegisteredTool,
  result: Record<string, unknown>
) {
  return tool.formatResult ? tool.formatResult(result) : JSON.stringify(result);
}

function projectToolResult(
  server: Server,
  tool: RegisteredTool,
  result: unknown,
  advertisedOutputSchema: Record<string, unknown> | undefined
) {
  if (result == null) {
    return server.projectCallToolResult(
      { content: [] },
      advertisedOutputSchema
    );
  }

  const structuredContent = result as Record<string, unknown>;
  return server.projectCallToolResult(
    {
      structuredContent,
      content: [
        {
          type: 'text',
          text: formatToolResult(tool, structuredContent),
        },
      ],
    },
    advertisedOutputSchema
  );
}

export function registerToolHandlers({
  server,
  getTools,
  toolRequestInputs,
  onToolCall,
  onToolPolicyCall,
}: RegisterToolHandlersOptions) {
  server.setRequestHandler(
    'tools/list',
    async (_request, serverContext): Promise<ListToolsResult> => {
      const tools = await getTools();
      const context = normalizeToolRequestContext(
        serverContext,
        toolRequestInputs ?? { formDeliveryAvailable: false },
        server.getClientCapabilities()
      );
      const visibleTools = Object.entries(tools).filter(
        ([, tool]) => !tool.hidden && tool.visible?.(context) !== false
      );

      return {
        tools: await Promise.all(
          visibleTools.map(async ([name, tool]) => {
            const parameters =
              tool.policy?.inputSchema?.(tool.parameters, context) ??
              tool.parameters;
            const inputSchema = z.toJSONSchema(parameters, {
              target: 'draft-7',
            });
            const outputSchema = getAdvertisedOutputSchema(tool, context);

            return {
              name,
              description:
                typeof tool.description === 'function'
                  ? await tool.description()
                  : tool.description,
              annotations: tool.annotations,
              // Casting the same as the SDK does:
              // https://github.com/modelcontextprotocol/typescript-sdk/blob/fb07af810b51003c338dc4885a9e42f54519f9af/src/server/mcp.ts#L154
              inputSchema: inputSchema as McpTool['inputSchema'],
              ...(outputSchema === undefined
                ? {}
                : {
                    outputSchema: outputSchema as McpTool['outputSchema'],
                  }),
            };
          })
        ),
      } satisfies ListToolsResult;
    }
  );

  server.setRequestHandler('tools/call', async (request, serverContext) => {
    const context = normalizeToolRequestContext(
      serverContext,
      toolRequestInputs ?? { formDeliveryAvailable: false },
      server.getClientCapabilities()
    );

    try {
      const tools = await getTools();
      const toolName = request.params.name;

      if (!(toolName in tools)) {
        throw new Error('tool not found');
      }

      const selectedTool = tools[toolName];
      if (!selectedTool) {
        throw new Error('tool not found');
      }

      const effectiveArguments = prepareArguments(
        selectedTool,
        request.params.arguments ?? {},
        context
      );
      const advertisedOutputSchema = getAdvertisedOutputSchema(
        selectedTool,
        context
      );
      const policyResolution = await resolvePolicy({
        tool: selectedTool,
        toolName,
        effectiveArguments,
        context,
        advertisedOutputSchema,
        server,
        onToolPolicyCall,
      });

      if (policyResolution.type === 'result') {
        return policyResolution.result;
      }

      const result = await executeTool({
        tool: selectedTool,
        toolName,
        effectiveArguments,
        resolution: policyResolution.resolution,
        onToolCall,
      });
      return projectToolResult(
        server,
        selectedTool,
        result,
        advertisedOutputSchema
      );
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
