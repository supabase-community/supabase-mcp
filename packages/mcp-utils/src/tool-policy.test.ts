import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import {
  createMcpHandler,
  type ClientCapabilities,
} from '@modelcontextprotocol/server';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod/v4';

import { createMcpServer, type McpServerOptions, tool } from './server.js';
import { StreamTransport } from './stream-transport.js';
import type {
  ToolPolicy,
  ToolPolicyDecision,
  ToolPolicyTelemetry,
  ToolRequestContext,
} from './tool-policy.js';

// https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/
const MODERN_PROTOCOL_VERSION = '2026-07-28';
const MCP_ENDPOINT = new URL('https://mcp.test');

const telemetry: ToolPolicyTelemetry = { outcome: 'allowed' };

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

/**
 * Connects a client that negotiates the modern protocol revision, so the
 * server sees the per-request `_meta` envelope.
 */
async function setupModernClient(
  options: Omit<McpServerOptions, 'name' | 'version'>,
  capabilities: ClientCapabilities = {}
) {
  const handler = createMcpHandler(
    () =>
      createMcpServer({
        name: 'policy-test-server',
        version: '0.0.0',
        ...options,
      }),
    { legacy: 'reject' }
  );
  const transport = new StreamableHTTPClientTransport(MCP_ENDPOINT, {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  });
  const client = new Client(
    { name: 'policy-test-client', version: '1.2.3' },
    {
      capabilities,
      versionNegotiation: { mode: { pin: MODERN_PROTOCOL_VERSION } },
    }
  );

  await client.connect(transport);
  cleanups.push(
    () => client.close(),
    () => handler.close()
  );

  return client;
}

/**
 * Connects a client over the legacy in-process transport, which carries no
 * per-request `_meta` envelope.
 */
async function setupLegacyClient(
  options: Omit<McpServerOptions, 'name' | 'version'>
) {
  const server = createMcpServer({
    name: 'policy-test-server',
    version: '0.0.0',
    ...options,
  });
  const clientTransport = new StreamTransport();
  const serverTransport = new StreamTransport();

  clientTransport.readable.pipeTo(serverTransport.writable);
  serverTransport.readable.pipeTo(clientTransport.writable);

  const client = new Client(
    { name: 'policy-test-client', version: '1.2.3' },
    { capabilities: {} }
  );

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return client;
}

describe('tool request context', () => {
  test('a modern request carries the SDK-owned era, client info and capabilities', async () => {
    const contexts: ToolRequestContext[] = [];
    const client = await setupModernClient(
      {
        tools: {
          capture: tool({
            description: 'Capture',
            parameters: z.object({ value: z.string() }),
            outputSchema: z.object({ value: z.string() }),
            policy: {
              resolve: async (_params, ctx) => {
                contexts.push(ctx);
                return { type: 'execute', resolution: undefined, telemetry };
              },
            },
            execute: async ({ value }) => ({ value }),
          }),
        },
      },
      { elicitation: {} }
    );

    await client.callTool({ name: 'capture', arguments: { value: 'ok' } });

    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.era).toBe('modern');
    expect(contexts[0]?.clientInfo).toEqual({
      name: 'policy-test-client',
      version: '1.2.3',
    });
    expect(contexts[0]?.clientCapabilities).toMatchObject({ elicitation: {} });
    expect(contexts[0]?.server.mcpReq).toBeDefined();
  });

  test('a legacy request falls back to the metadata captured at initialization', async () => {
    const contexts: ToolRequestContext[] = [];
    const client = await setupLegacyClient({
      tools: {
        capture: tool({
          description: 'Capture',
          parameters: z.object({ value: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          policy: {
            resolve: async (_params, ctx) => {
              contexts.push(ctx);
              return { type: 'execute', resolution: undefined, telemetry };
            },
          },
          execute: async ({ value }) => ({ value }),
        }),
      },
    });

    await client.callTool({ name: 'capture', arguments: { value: 'ok' } });

    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.era).toBe('legacy');
    expect(contexts[0]?.clientInfo).toEqual({
      name: 'policy-test-client',
      version: '1.2.3',
    });
    expect(contexts[0]?.clientCapabilities).toEqual({});
  });
});

describe('pre-execution tool policy', () => {
  test('discovery applies contextual visibility and policy schemas', async () => {
    const policy: ToolPolicy<{ value: string }, undefined> = {
      inputSchema: (schema, ctx) =>
        ctx.era === 'modern'
          ? schema.extend({ confirmation: z.string() })
          : schema,
      outputSchema: (schema, ctx) =>
        ctx.era === 'modern'
          ? schema.extend({ confirmed: z.boolean() })
          : schema,
      resolve: async () => ({
        type: 'execute',
        resolution: undefined,
        telemetry,
      }),
    };
    const tools = {
      contextual: tool({
        description: 'Contextual',
        parameters: z.object({ value: z.string() }),
        outputSchema: z.object({ value: z.string() }),
        hidden: (ctx) => ctx.era !== 'modern',
        policy,
        execute: async ({ value }) => ({ value }),
      }),
    };

    const modernClient = await setupModernClient({ tools });
    const legacyClient = await setupLegacyClient({ tools });

    const modernDiscovery = await modernClient.listTools();
    const legacyDiscovery = await legacyClient.listTools();

    expect(modernDiscovery.tools[0]?.inputSchema).toHaveProperty(
      'properties.confirmation'
    );
    expect(modernDiscovery.tools[0]?.outputSchema).toHaveProperty(
      'properties.confirmed'
    );
    expect(legacyDiscovery.tools).toEqual([]);
  });

  test('normalizeArguments runs before strict parsing', async () => {
    const execute = vi.fn(async ({ value }: { value: string }) => ({ value }));
    const client = await setupModernClient({
      tools: {
        normalized: tool({
          description: 'Normalized',
          parameters: z.object({ value: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          policy: {
            normalizeArguments: (raw) => {
              const { legacy: _legacy, ...rest } = raw as Record<
                string,
                unknown
              >;
              return rest;
            },
            resolve: async () => ({
              type: 'execute',
              resolution: undefined,
              telemetry,
            }),
          },
          execute,
        }),
      },
    });

    const accepted = await client.callTool({
      name: 'normalized',
      arguments: { value: 'ok', legacy: true },
    });
    const rejected = await client.callTool({
      name: 'normalized',
      arguments: { value: 'no', unknown: true },
    });

    expect(accepted.isError).not.toBe(true);
    expect(rejected.isError).toBe(true);
    // Only the normalized call reaches execution; the unknown field is fatal.
    // A tool with a policy always receives the resolution as its second
    // argument, `undefined` here.
    expect(execute.mock.calls).toEqual([[{ value: 'ok' }, undefined]]);
  });

  test('a result decision short-circuits business execution', async () => {
    const execute = vi.fn();
    const client = await setupModernClient({
      tools: {
        guarded: tool({
          description: 'Guarded',
          parameters: z.object({ value: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          policy: {
            // The request is normalized, so it advertises an output schema.
            // A terminal result on a normalized request must be one the
            // protocol exempts from `structuredContent`: an error here.
            // This package never synthesizes structured content for it.
            resolve: async () => ({
              type: 'result',
              result: {
                isError: true,
                content: [
                  {
                    type: 'text' as const,
                    text: 'Not permitted: request approval before retrying.',
                  },
                ],
              },
              telemetry,
            }),
          },
          execute,
        }),
      },
    });

    const result = await client.callTool({
      name: 'guarded',
      arguments: { value: 'ignored' },
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        type: 'text',
        text: 'Not permitted: request approval before retrying.',
      },
    ]);
    expect(result.structuredContent).toBeUndefined();
  });

  test('a result decision on a suppressed request stays content-only', async () => {
    const execute = vi.fn();
    const client = await setupModernClient({
      tools: {
        guarded: tool({
          description: 'Guarded',
          parameters: z.object({ value: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          policy: {
            // Suppressed: the request advertises no output schema, so a
            // content-only terminal result is the shape its discovery entry
            // promised.
            outputSchema: () => undefined,
            resolve: async () => ({
              type: 'result',
              result: {
                content: [{ type: 'text' as const, text: 'intercepted' }],
              },
              telemetry,
            }),
          },
          execute,
        }),
      },
    });

    const discovery = await client.listTools();

    expect(discovery.tools[0]?.outputSchema).toBeUndefined();

    const result = await client.callTool({
      name: 'guarded',
      arguments: { value: 'ignored' },
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result.content).toEqual([{ type: 'text', text: 'intercepted' }]);
    expect(result.structuredContent).toBeUndefined();
  });

  test('an unrecognized decision type fails closed', async () => {
    const execute = vi.fn();
    const client = await setupModernClient({
      tools: {
        guarded: tool({
          description: 'Guarded',
          parameters: z.object({ value: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          policy: {
            // A policy written in plain JavaScript, or one casting its
            // decision, can return a type this package does not recognize.
            resolve: async () =>
              ({
                type: 'deny',
                telemetry,
              }) as unknown as ToolPolicyDecision<undefined>,
          },
          execute,
        }),
      },
    });

    const result = await client.callTool({
      name: 'guarded',
      arguments: { value: 'ignored' },
    });

    // Fail closed: the guarded tool never runs and the caller gets an error.
    expect(result.isError).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });

  test('an execute decision hands the parsed arguments and the resolution to execute', async () => {
    const execute = vi.fn(async ({ value }: { value: string }) => ({ value }));
    const resolve = vi.fn(async () => ({
      type: 'execute' as const,
      resolution: { grant: 'approved' },
      telemetry,
    }));
    const client = await setupModernClient({
      tools: {
        guarded: tool({
          description: 'Guarded',
          parameters: z.object({
            value: z.string(),
            flag: z.boolean().default(false),
          }),
          outputSchema: z.object({ value: z.string() }),
          policy: { resolve },
          execute,
        }),
      },
    });

    await client.callTool({ name: 'guarded', arguments: { value: 'input' } });

    // Defaults are applied by strict parsing before the policy sees them.
    expect(resolve).toHaveBeenCalledWith(
      { value: 'input', flag: false },
      expect.anything()
    );
    expect(execute).toHaveBeenCalledWith(
      { value: 'input', flag: false },
      { grant: 'approved' }
    );
  });

  test('a policy-free tool still executes with exactly one argument', async () => {
    const execute = vi.fn(async ({ value }: { value: string }) => ({ value }));
    const client = await setupModernClient({
      tools: {
        plain: tool({
          description: 'Plain',
          parameters: z.object({ value: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          execute,
        }),
      },
    });

    await client.callTool({ name: 'plain', arguments: { value: 'ok' } });

    expect(execute).toHaveBeenCalledWith({ value: 'ok' });
  });

  test('policy resolution runs after parsing and before business execution', async () => {
    const order: string[] = [];
    const client = await setupModernClient({
      tools: {
        ordered: tool({
          description: 'Ordered',
          parameters: z.object({ value: z.string() }).refine((parsed) => {
            order.push('parse');
            return parsed.value.length > 0;
          }) as unknown as z.ZodObject<{ value: z.ZodString }>,
          outputSchema: z.object({ value: z.string() }),
          policy: {
            resolve: async () => {
              order.push('resolve');
              return { type: 'execute', resolution: undefined, telemetry };
            },
          },
          execute: async ({ value }) => {
            order.push('execute');
            return { value };
          },
        }),
      },
    });

    await client.callTool({ name: 'ordered', arguments: { value: 'ok' } });

    expect(order).toEqual(['parse', 'resolve', 'execute']);
  });

  test('a field outside the allowlist never reaches the policy callback', async () => {
    const onToolPolicyCall = vi.fn();
    const client = await setupModernClient({
      onToolPolicyCall,
      tools: {
        leaky: tool({
          description: 'Leaky',
          parameters: z.object({ value: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          policy: {
            resolve: async (params) => ({
              type: 'execute',
              resolution: undefined,
              // A policy compiled from plain JavaScript, or one spreading a
              // wider object, can carry fields the type does not allow.
              telemetry: {
                outcome: 'allowed',
                rawArguments: params,
                token: 'super-secret',
              } as ToolPolicyTelemetry,
            }),
          },
          execute: async ({ value }) => ({ value }),
        }),
      },
    });

    await client.callTool({ name: 'leaky', arguments: { value: 'ok' } });

    expect(onToolPolicyCall).toHaveBeenCalledWith(
      expect.objectContaining({ telemetry: { outcome: 'allowed' } })
    );
  });

  test('the policy callback receives only the allowlisted telemetry fields', async () => {
    const onToolPolicyCall = vi.fn();
    const client = await setupModernClient({
      onToolPolicyCall,
      tools: {
        observed: tool({
          description: 'Observed',
          parameters: z.object({ secret: z.string() }),
          outputSchema: z.object({ secret: z.string() }),
          policy: {
            resolve: async () => ({
              type: 'execute',
              resolution: undefined,
              telemetry: {
                interactionId: 'interaction-1',
                authorityPath: 'test-authority',
                outcome: 'allowed',
                reason: 'internal-reason',
                policyId: 'test-policy',
                policyVersion: 2,
              },
            }),
          },
          execute: async ({ secret }) => ({ secret }),
        }),
      },
    });

    await client.callTool({
      name: 'observed',
      arguments: { secret: 'do-not-log-me' },
    });

    // An exact call tuple: raw arguments never reach the telemetry callback.
    expect(onToolPolicyCall.mock.calls).toEqual([
      [
        {
          name: 'observed',
          decision: 'execute',
          clientInfo: { name: 'policy-test-client', version: '1.2.3' },
          durationMs: expect.any(Number),
          telemetry: {
            interactionId: 'interaction-1',
            authorityPath: 'test-authority',
            outcome: 'allowed',
            reason: 'internal-reason',
            policyId: 'test-policy',
            policyVersion: 2,
          },
        },
      ],
    ]);
  });

  test('a failing policy callback cannot change the tool result', async () => {
    const onToolPolicyCall = vi.fn(async () => {
      throw new Error('callback failed');
    });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const client = await setupModernClient({
      onToolPolicyCall,
      tools: {
        observed: tool({
          description: 'Observed',
          parameters: z.object({ value: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          policy: {
            resolve: async () => ({
              type: 'execute',
              resolution: undefined,
              telemetry,
            }),
          },
          execute: async ({ value }) => ({ value }),
        }),
      },
    });

    const result = await client.callTool({
      name: 'observed',
      arguments: { value: 'ok' },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ value: 'ok' });
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to run tool policy callback',
      expect.any(Error)
    );
    consoleError.mockRestore();
  });

  test('a decision without telemetry still records an audit call', async () => {
    const onToolPolicyCall = vi.fn();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const client = await setupModernClient({
      onToolPolicyCall,
      tools: {
        observed: tool({
          description: 'Observed',
          parameters: z.object({ value: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          policy: {
            // A plain JavaScript policy can omit the telemetry object.
            resolve: async () =>
              ({
                type: 'execute',
                resolution: undefined,
              }) as unknown as ToolPolicyDecision<undefined>,
          },
          execute: async ({ value }) => ({ value }),
        }),
      },
    });

    const result = await client.callTool({
      name: 'observed',
      arguments: { value: 'ok' },
    });

    expect(result.structuredContent).toEqual({ value: 'ok' });
    expect(onToolPolicyCall).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'execute', telemetry: {} })
    );
    // The audit record survives: no sanitizer `TypeError` misattributed to
    // the callback.
    expect(consoleError).not.toHaveBeenCalledWith(
      'Failed to run tool policy callback',
      expect.any(Error)
    );
    consoleError.mockRestore();
  });
});
