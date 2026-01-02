/**
 * Type-safe parsing utilities for MCP tool calls and results using discriminated unions.
 *
 * Usage:
 * ```typescript
 * const registry = {
 *   execute_sql: {
 *     inputSchema: executeSqlInputSchema,
 *     outputSchema: executeSqlOutputSchema,
 *   },
 * } satisfies ToolRegistry;
 *
 * const parsed = parseToolCall(toolCall, registry);
 * if (parsed.name === 'execute_sql') {
 *   console.log(parsed.input.query); // Typed input
 * }
 *
 * const result = parseToolResult(toolResult, registry);
 * if (result.name === 'execute_sql') {
 *   console.log(result.input.query);   // Typed input
 *   console.log(result.output.result); // Typed output
 * }
 * ```
 */

import type { z } from 'zod';

export type ToolRegistry = Record<
  string,
  {
    inputSchema: z.ZodObject<any>;
    outputSchema: z.ZodObject<any>;
  }
>;

export type ParsedToolCall<TRegistry extends ToolRegistry> = {
  [K in keyof TRegistry]: {
    name: K;
    input: z.infer<TRegistry[K]['inputSchema']>;
  };
}[keyof TRegistry];

export type ParsedToolResult<TRegistry extends ToolRegistry> = {
  [K in keyof TRegistry]: {
    name: K;
    input: z.infer<TRegistry[K]['inputSchema']>;
    output: z.infer<TRegistry[K]['outputSchema']>;
  };
}[keyof TRegistry];

export function parseToolCall<TRegistry extends ToolRegistry>(
  toolCall: { toolName: string; input: unknown },
  registry: TRegistry
): ParsedToolCall<TRegistry> {
  const toolName = toolCall.toolName;
  const toolDef = registry[toolName];

  if (!toolDef) {
    throw new Error(`Tool "${toolName}" not found in registry`);
  }

  const validatedInput = toolDef.inputSchema.parse(toolCall.input);

  return {
    name: toolName,
    input: validatedInput,
  } as ParsedToolCall<TRegistry>;
}

export function parseToolResult<TRegistry extends ToolRegistry>(
  toolResult: { toolName: string; input: unknown; output: unknown },
  registry: TRegistry
): ParsedToolResult<TRegistry> {
  const toolName = toolResult.toolName;
  const toolDef = registry[toolName];

  if (!toolDef) {
    throw new Error(`Tool "${toolName}" not found in registry`);
  }

  const validatedInput = toolDef.inputSchema.parse(toolResult.input);
  const validatedOutput = toolDef.outputSchema.parse(toolResult.output);

  return {
    name: toolName,
    input: validatedInput,
    output: validatedOutput,
  } as ParsedToolResult<TRegistry>;
}
