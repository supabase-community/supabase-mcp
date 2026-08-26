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

const telemetry: ToolPolicyTelemetry = {
  policyId: 'test-policy',
  policyVersion: 1,
  outcome: 'allowed',
};

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
    const policy: ToolPolicy<
      { value: string },
      { era: ToolRequestContext['era'] }
    > = {
      inputSchema: (schema, ctx) =>
        ctx.era === 'modern'
          ? schema.extend({ confirmation: z.string() })
          : schema,
      outputSchema: (schema, ctx) =>
        ctx.era === 'modern'
          ? schema.extend({ confirmed: z.boolean() })
          : schema,
      // The resolution carries the era, so `execute` can satisfy the schema
      // this request advertised without re-deriving the context.
      resolve: async (_args, ctx) => ({
        type: 'execute',
        resolution: { era: ctx.era },
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
        execute: async ({ value }, { era }) =>
          era === 'modern' ? { value, confirmed: true } : { value },
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

    // The call path must resolve its input schema from the same hook, not
    // from `tool.parameters`: the hook-supplied `confirmation` key would
    // otherwise be rejected by strict parsing.
    const modernResult = await modernClient.callTool({
      name: 'contextual',
      arguments: { value: 'ok', confirmation: 'yes' },
    });

    expect(modernResult.structuredContent).toEqual({
      value: 'ok',
      confirmed: true,
    });

    // Hidden from `tools/list`, still alive via `tools/call`.
    const legacyResult = await legacyClient.callTool({
      name: 'contextual',
      arguments: { value: 'ok' },
    });

    expect(legacyResult.isError).not.toBe(true);
    expect(legacyResult.structuredContent).toEqual({ value: 'ok' });
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
    const onToolPolicyCall = vi.fn();
    const client = await setupModernClient({
      onToolPolicyCall,
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
    // The sink sees this package's own label, never the policy's raw string.
    expect(onToolPolicyCall).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'guarded', decision: 'rejected' })
    );
  });

  test('a nullish decision fails closed and still records an audit call', async () => {
    const execute = vi.fn();
    const onToolPolicyCall = vi.fn();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const client = await setupModernClient({
      onToolPolicyCall,
      tools: {
        guarded: tool({
          description: 'Guarded',
          parameters: z.object({ value: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          policy: {
            // A plain JavaScript policy can resolve to nothing at all.
            resolve: async () =>
              undefined as unknown as ToolPolicyDecision<undefined>,
          },
          execute,
        }),
      },
    });

    const result = await client.callTool({
      name: 'guarded',
      arguments: { value: 'ignored' },
    });

    expect(result.isError).toBe(true);
    expect(execute).not.toHaveBeenCalled();
    expect(onToolPolicyCall).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'guarded', decision: 'rejected' })
    );
    // The record is built before the throw, so nothing is misattributed to
    // the callback.
    expect(consoleError).not.toHaveBeenCalledWith(
      'Failed to run tool policy callback',
      expect.any(Error)
    );
    consoleError.mockRestore();
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
                ...telemetry,
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
      expect.objectContaining({ telemetry })
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
    // The record survives the missing telemetry object: the sanitizer
    // returns an empty allowlist instead of throwing.
    expect(onToolPolicyCall).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'execute', telemetry: {} })
    );
  });

  test('a never-settling policy callback cannot delay the tool result', async () => {
    const client = await setupModernClient({
      // The callback is not awaited, so a sink that never completes must not
      // hold the response.
      onToolPolicyCall: () => new Promise<void>(() => {}),
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

    expect(result.structuredContent).toEqual({ value: 'ok' });
  });
});

describe('policy schema contracts', () => {
  test('a loose input schema hook advertises the strict schema parsing enforces', async () => {
    const client = await setupModernClient({
      tools: {
        open: tool({
          description: 'Open',
          parameters: z.object({ value: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          policy: {
            // A hook is free to hand back a loose or catchall object. The
            // call path parses strictly either way, so discovery must not
            // advertise unknown keys as acceptable.
            inputSchema: (schema) => schema.loose(),
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

    const discovery = await client.listTools();

    expect(discovery.tools[0]?.inputSchema).toMatchObject({
      additionalProperties: false,
    });

    const result = await client.callTool({
      name: 'open',
      arguments: { value: 'ok', extra: 'rejected' },
    });

    expect(result.isError).toBe(true);
  });

  test('output that contradicts the advertised schema fails closed', async () => {
    const client = await setupModernClient({
      tools: {
        drifting: tool({
          description: 'Drifting',
          parameters: z.object({ value: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          policy: {
            outputSchema: (schema) => schema.extend({ confirmed: z.boolean() }),
            resolve: async () => ({
              type: 'execute',
              resolution: undefined,
              telemetry,
            }),
          },
          // Drifts from what this request advertised: `confirmed` is missing.
          execute: async ({ value }) =>
            ({ value }) as unknown as { value: string; confirmed: boolean },
        }),
      },
    });

    const result = await client.callTool({
      name: 'drifting',
      arguments: { value: 'ok' },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toEqual([
      { type: 'text', text: expect.stringContaining('confirmed') },
    ]);
  });

  test('a null result on a normalized request fails closed', async () => {
    const client = await setupModernClient({
      tools: {
        empty: tool({
          description: 'Empty',
          parameters: z.object({ value: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          policy: {
            resolve: async () => ({
              type: 'execute',
              resolution: undefined,
              telemetry,
            }),
          },
          // Reachable from plain JavaScript: the cast is only needed to get
          // past `execute`'s declared return type.
          execute: async () => null as unknown as { value: string },
        }),
      },
    });

    const result = await client.callTool({
      name: 'empty',
      arguments: { value: 'ok' },
    });

    expect(result.isError).toBe(true);
    expect(result.content).not.toEqual([]);
  });

  test('a scalar result on a normalized request fails closed', async () => {
    const client = await setupModernClient({
      tools: {
        scalar: tool({
          description: 'Scalar',
          parameters: z.object({ value: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          policy: {
            resolve: async () => ({
              type: 'execute',
              resolution: undefined,
              telemetry,
            }),
          },
          execute: async () => 7 as unknown as { value: string },
        }),
      },
    });

    const result = await client.callTool({
      name: 'scalar',
      arguments: { value: 'ok' },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });

  test('a non-object-rooted output schema fails the whole discovery response', async () => {
    const client = await setupModernClient({
      tools: {
        healthy: tool({
          description: 'Healthy',
          parameters: z.object({ value: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          execute: async ({ value }) => ({ value }),
        }),
        broken: tool({
          description: 'Broken',
          parameters: z.object({ value: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          policy: {
            // MCP restricts structured output to an object root, so this
            // resolved schema can never be advertised.
            outputSchema: () => z.string(),
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

    // The whole list fails, deliberately: an authoring error must not hide
    // behind a healthy neighbour entry.
    await expect(client.listTools()).rejects.toThrow(/broken/);
  });

  test('output the advertised schema only accepts after stripping fails closed', async () => {
    const client = await setupModernClient({
      tools: {
        leaky: tool({
          description: 'Leaky',
          parameters: z.object({ value: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          policy: {
            resolve: async () => ({
              type: 'execute',
              resolution: undefined,
              telemetry,
            }),
          },
          // A zod object strips undeclared keys and still reports success,
          // while the advertised JSON for that same schema says
          // `additionalProperties: false`. The extra key is mismatched
          // output, so it must be answered, not quietly removed.
          execute: async ({ value }) =>
            ({ value, extra: 'unadvertised' }) as unknown as {
              value: string;
            },
        }),
      },
    });

    const result = await client.callTool({
      name: 'leaky',
      arguments: { value: 'ok' },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toEqual([
      { type: 'text', text: expect.stringContaining('did not accept') },
    ]);
  });

  test('a conforming result is emitted exactly as execute returned it', async () => {
    const businessResult = { value: 'ok', count: 2 };
    const client = await setupModernClient({
      tools: {
        conforming: tool({
          description: 'Conforming',
          parameters: z.object({ value: z.string() }),
          outputSchema: z.object({ value: z.string(), count: z.number() }),
          policy: {
            resolve: async () => ({
              type: 'execute',
              resolution: undefined,
              telemetry,
            }),
          },
          execute: async () => businessResult,
        }),
      },
    });

    const result = await client.callTool({
      name: 'conforming',
      arguments: { value: 'ok' },
    });

    // The validation lane must be byte-transparent for a conforming result:
    // same keys, same order, same single-encoded text.
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.structuredContent)).toBe(
      JSON.stringify(businessResult)
    );
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify(businessResult) },
    ]);
  });

  test('a non-plain object on a normalized request fails closed', async () => {
    const client = await setupModernClient({
      tools: {
        dated: tool({
          description: 'Dated',
          parameters: z.object({ value: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          policy: {
            // A permissive resolved schema is what makes this reachable: a
            // `Date` parses here and then serializes to a JSON string, so
            // the advertised object root would be contradicted on the wire.
            outputSchema: () => z.unknown() as unknown as z.ZodType,
            resolve: async () => ({
              type: 'execute',
              resolution: undefined,
              telemetry,
            }),
          },
          execute: async () => new Date(0) as unknown as { value: string },
        }),
      },
    });

    const result = await client.callTool({
      name: 'dated',
      arguments: { value: 'ok' },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });

  test('a Map under a permissive output leaf fails closed', async () => {
    const client = await setupModernClient({
      tools: {
        mapping: tool({
          description: 'Mapping',
          parameters: z.object({ value: z.string() }),
          // A permissive leaf advertises `{}` and parses any value by
          // identity, so the root plain-object check never sees the `Map`.
          // JSON serializes it to `{}`, silently dropping its contents.
          outputSchema: z.object({ value: z.unknown() }),
          policy: {
            resolve: async () => ({
              type: 'execute',
              resolution: undefined,
              telemetry,
            }),
          },
          execute: async () =>
            ({ value: new Map([['a', 1]]) }) as unknown as { value: unknown },
        }),
      },
    });

    const result = await client.callTool({
      name: 'mapping',
      arguments: { value: 'ok' },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });

  test('an own `toJSON` property that replaces the root fails closed', async () => {
    const client = await setupModernClient({
      tools: {
        hijacking: tool({
          description: 'Hijacking',
          parameters: z.object({ value: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          policy: {
            // Loose keeps the extra key from being stripped, which is what
            // isolates the hazard: `toJSON` is an own data property, so the
            // prototype-exact root check passes it, and serialization then
            // replaces the whole object with a string.
            outputSchema: (schema) => schema.loose(),
            resolve: async () => ({
              type: 'execute',
              resolution: undefined,
              telemetry,
            }),
          },
          execute: async ({ value }) =>
            ({ value, toJSON: () => 'hijacked' }) as unknown as {
              value: string;
            },
        }),
      },
    });

    const result = await client.callTool({
      name: 'hijacking',
      arguments: { value: 'ok' },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });

  test('a loose output schema passes conforming extra keys through', async () => {
    const businessResult = { value: 'ok', extra: 1 };
    const client = await setupModernClient({
      tools: {
        spacious: tool({
          description: 'Spacious',
          parameters: z.object({ value: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          policy: {
            // The documented escape hatch: a tool that owes callers more
            // than it can declare advertises `additionalProperties: {}` and
            // keeps emitting the undeclared keys.
            outputSchema: (schema) => schema.loose(),
            resolve: async () => ({
              type: 'execute',
              resolution: undefined,
              telemetry,
            }),
          },
          execute: async () => businessResult as unknown as { value: string },
        }),
      },
    });

    const discovery = await client.listTools();

    expect(discovery.tools[0]?.outputSchema).toMatchObject({
      additionalProperties: {},
    });

    const result = await client.callTool({
      name: 'spacious',
      arguments: { value: 'ok' },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(businessResult);
  });
});
