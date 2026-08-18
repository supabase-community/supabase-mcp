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

import { createMcpServer, tool } from './server.js';
import type {
  ToolPolicy,
  ToolRequestContext,
  ToolPolicyTelemetry,
} from './tool-policy.js';

const MODERN_PROTOCOL_VERSION = '2026-07-28';
const MCP_ENDPOINT = new URL('https://mcp.test');
const cleanups: Array<() => Promise<void>> = [];

const telemetry: ToolPolicyTelemetry = {
  outcome: 'test',
};

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
  vi.restoreAllMocks();
});

async function setupFetchFixture({
  capabilities,
  formDeliveryAvailable,
  optOut,
  tools,
  onToolPolicyCall,
}: {
  capabilities: ClientCapabilities;
  formDeliveryAvailable: boolean;
  optOut?: boolean;
  tools: Parameters<typeof createMcpServer>[0]['tools'];
  onToolPolicyCall?: Parameters<typeof createMcpServer>[0]['onToolPolicyCall'];
}) {
  const handler = createMcpHandler(
    () =>
      createMcpServer({
        name: 'policy-test-server',
        version: '0.0.0',
        toolRequestInputs: { formDeliveryAvailable, optOut },
        tools,
        onToolPolicyCall,
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
  cleanups.push(() => client.close(), () => handler.close());

  return client;
}

function contextCapturingTool(contexts: ToolRequestContext[]) {
  return tool({
    description: 'Capture normalized context',
    parameters: z.object({ value: z.string() }),
    outputSchema: z.object({ value: z.string() }),
    policy: {
      resolve: async (params, ctx) => {
        contexts.push(ctx);
        return { type: 'execute' as const, resolution: undefined, telemetry };
      },
    },
    execute: async (params) => params,
  });
}

describe('normalized tool request context', () => {
  test.each([
    {
      name: 'declared form capability on a supported serving path',
      capabilities: { elicitation: { form: {} } },
      formDeliveryAvailable: true,
      expected: true,
      reason: 'available',
    },
    {
      name: 'empty elicitation capability on a supported serving path',
      capabilities: { elicitation: {} },
      formDeliveryAvailable: true,
      expected: true,
      reason: 'available',
    },
    {
      name: 'declared form capability on an unsupported serving path',
      capabilities: { elicitation: { form: {} } },
      formDeliveryAvailable: false,
      expected: false,
      reason: 'serving_path',
    },
    {
      name: 'opt-out on a supported form serving path',
      capabilities: { elicitation: { form: {} } },
      formDeliveryAvailable: true,
      optOut: true,
      expected: false,
      reason: 'opt_out',
    },
    {
      name: 'URL-only capability',
      capabilities: { elicitation: { url: {} } },
      formDeliveryAvailable: true,
      expected: false,
      reason: 'capability',
    },
    {
      name: 'URL-only capability on an unsupported serving path',
      capabilities: { elicitation: { url: {} } },
      formDeliveryAvailable: false,
      expected: false,
      reason: 'serving_path',
    },
    {
      name: 'absent elicitation capability',
      capabilities: {},
      formDeliveryAvailable: true,
      expected: false,
      reason: 'capability',
    },
    {
      name: 'absent elicitation capability on an unsupported serving path',
      capabilities: {},
      formDeliveryAvailable: false,
      expected: false,
      reason: 'serving_path',
    },
  ])(
    '$name',
    async ({
      capabilities,
      formDeliveryAvailable,
      optOut,
      expected,
      reason,
    }) => {
      const contexts: ToolRequestContext[] = [];
      const client = await setupFetchFixture({
        capabilities: capabilities as ClientCapabilities,
        formDeliveryAvailable,
        optOut,
        tools: { capture: contextCapturingTool(contexts) },
      });

      await client.callTool({ name: 'capture', arguments: { value: 'ok' } });

      expect(contexts).toHaveLength(1);
      expect(contexts[0]).toMatchObject({
        era: 'modern',
        clientInfo: { name: 'policy-test-client', version: '1.2.3' },
        formElicitation: expected,
        formSupportReason: reason,
      });
    }
  );
});

describe('pre-execution tool policy', () => {
  test('a result decision bypasses execute and reports callback failures', async () => {
    const execute = vi.fn();
    const onToolPolicyCall = vi.fn(async () => {
      throw new Error('callback failed');
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = await setupFetchFixture({
      capabilities: {},
      formDeliveryAvailable: true,
      onToolPolicyCall,
      tools: {
        guarded: tool({
          description: 'Guarded tool',
          parameters: z.object({ value: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          policy: {
            resolve: async () => ({
              type: 'result' as const,
              result: { content: [{ type: 'text' as const, text: 'intercepted' }] },
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
    expect(result.content).toEqual([{ type: 'text', text: 'intercepted' }]);
    expect(onToolPolicyCall).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to run tool policy callback',
      expect.any(Error)
    );
  });

  test('an execute decision passes exactly effective arguments and resolution', async () => {
    const execute = vi.fn(async () => ({ value: 'done' }));
    const resolve = vi.fn(async () => ({
      type: 'execute' as const,
      resolution: { authority: 'form' as const },
      telemetry,
    }));
    const client = await setupFetchFixture({
      capabilities: { elicitation: { form: {} } },
      formDeliveryAvailable: true,
      tools: {
        guarded: tool({
          description: 'Guarded tool',
          parameters: z.object({ value: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          inject: { project_id: 'project-ref' },
          policy: { resolve },
          execute,
        }),
      },
    });

    await client.callTool({ name: 'guarded', arguments: { value: 'input' } });

    const effectiveArgs = { value: 'input', project_id: 'project-ref' };
    expect(resolve).toHaveBeenCalledWith(effectiveArgs, expect.any(Object));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(effectiveArgs, { authority: 'form' });
  });

  test('discovery uses contextual visibility and policy schemas', async () => {
    const policy: ToolPolicy<{ value: string }, undefined> = {
      inputSchema: (schema, ctx) =>
        ctx.formElicitation ? schema.extend({ confirmation: z.string() }) : schema,
      outputSchema: (schema, ctx) =>
        ctx.formElicitation ? schema.extend({ confirmed: z.boolean() }) : schema,
      resolve: async () => ({
        type: 'execute',
        resolution: undefined,
        telemetry,
      }),
    };
    const makeTools = () => ({
      contextual: tool({
        description: 'Contextual tool',
        parameters: z.object({ value: z.string() }),
        outputSchema: z.object({ value: z.string() }),
        visible: (ctx) => ctx.formElicitation,
        policy,
        execute: async ({ value }) => ({ value }),
      }),
    });
    const capableClient = await setupFetchFixture({
      capabilities: { elicitation: { form: {} } },
      formDeliveryAvailable: true,
      tools: makeTools(),
    });
    const incapableClient = await setupFetchFixture({
      capabilities: {},
      formDeliveryAvailable: true,
      tools: makeTools(),
    });

    const capableTools = await capableClient.listTools();
    const incapableTools = await incapableClient.listTools();

    expect(capableTools.tools[0]?.inputSchema).toHaveProperty(
      'properties.confirmation'
    );
    expect(capableTools.tools[0]?.outputSchema).toHaveProperty(
      'properties.confirmed'
    );
    expect(incapableTools.tools).toEqual([]);
  });

  test('normalizeArguments removes one legacy field before strict parsing', async () => {
    const execute = vi.fn(async ({ value }: { value: string }) => ({ value }));
    const client = await setupFetchFixture({
      capabilities: {},
      formDeliveryAvailable: true,
      tools: {
        normalized: tool({
          description: 'Normalized tool',
          parameters: z.object({ value: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          policy: {
            normalizeArguments: (raw) => {
              const { legacy: _legacy, ...rest } = raw as Record<string, unknown>;
              return rest;
            },
            resolve: async () => ({
              type: 'execute' as const,
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
      arguments: { value: 'no', legacy: true, other: true },
    });

    expect(accepted.isError).not.toBe(true);
    expect(rejected.isError).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test('reports every policy decision without wrapping business execution', async () => {
    const onToolPolicyCall = vi.fn();
    const execute = vi.fn(async ({ value }: { value: string }) => ({ value }));
    const client = await setupFetchFixture({
      capabilities: { elicitation: { form: {} } },
      formDeliveryAvailable: true,
      onToolPolicyCall,
      tools: {
        observed: tool({
          description: 'Observed tool',
          parameters: z.object({ value: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          policy: {
            resolve: async () => ({
              type: 'execute' as const,
              resolution: undefined,
              telemetry,
            }),
          },
          execute,
        }),
      },
    });

    await client.callTool({ name: 'observed', arguments: { value: 'ok' } });

    expect(onToolPolicyCall).toHaveBeenCalledTimes(1);
    expect(onToolPolicyCall).toHaveBeenCalledWith({
      name: 'observed',
      arguments: { value: 'ok' },
      clientInfo: { name: 'policy-test-client', version: '1.2.3' },
      formElicitation: true,
      durationMs: expect.any(Number),
      telemetry,
    });
  });
});
