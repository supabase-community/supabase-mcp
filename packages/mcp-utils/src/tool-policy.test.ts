import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import {
  CLIENT_CAPABILITIES_META_KEY,
  createMcpHandler,
  PROTOCOL_VERSION_META_KEY,
  type ClientCapabilities,
  type ServerContext,
} from '@modelcontextprotocol/server';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod/v4';

import { createMcpServer, tool } from './server.js';
import { normalizeToolRequestContext } from './tool-policy.js';
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

function acceptTelemetry(_telemetry: ToolPolicyTelemetry): void {}

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

  test.each([
    {
      name: 'legacy uses initialized capabilities on a supported path',
      metadata: undefined,
      formDeliveryAvailable: true,
      expectedEra: 'legacy',
      expectedFormElicitation: true,
      expectedReason: 'available',
    },
    {
      name: 'legacy serving path still takes precedence',
      metadata: undefined,
      formDeliveryAvailable: false,
      expectedEra: 'legacy',
      expectedFormElicitation: false,
      expectedReason: 'serving_path',
    },
    {
      name: 'modern ignores initialized capabilities',
      metadata: {
        [PROTOCOL_VERSION_META_KEY]: MODERN_PROTOCOL_VERSION,
        [CLIENT_CAPABILITIES_META_KEY]: {},
      },
      formDeliveryAvailable: true,
      expectedEra: 'modern',
      expectedFormElicitation: false,
      expectedReason: 'capability',
    },
  ])(
    '$name',
    ({
      metadata,
      formDeliveryAvailable,
      expectedEra,
      expectedFormElicitation,
      expectedReason,
    }) => {
      const server = {
        mcpReq: { envelope: metadata },
      } as unknown as ServerContext;
      const context = normalizeToolRequestContext(
        server,
        { formDeliveryAvailable },
        { elicitation: {} }
      );

      expect(context).toMatchObject({
        era: expectedEra,
        formElicitation: expectedFormElicitation,
        formSupportReason: expectedReason,
      });
    }
  );
});

test('telemetry type rejects nested objects and undeclared fields', () => {
  acceptTelemetry({ interactionId: 'safe-id', policyVersion: 1 });
  acceptTelemetry({
    // @ts-expect-error nested telemetry values are not allowed
    interactionId: { raw: 'state' },
  });
  acceptTelemetry({
    // @ts-expect-error telemetry fields must use the closed allowlist
    continuationState: 'raw-state',
  });
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

    await client.callTool({
      name: 'observed',
      arguments: { value: 'sensitive argument' },
    });

    expect(onToolPolicyCall).toHaveBeenCalledTimes(1);
    const callbackPayload = onToolPolicyCall.mock.calls[0]?.[0];
    expect(callbackPayload).not.toHaveProperty('arguments');
    expect(callbackPayload).toEqual({
      name: 'observed',
      clientInfo: { name: 'policy-test-client', version: '1.2.3' },
      formElicitation: true,
      durationMs: expect.any(Number),
      telemetry: { ...telemetry, formSupportReason: 'available' },
    });
  });

  test('sanitizes widened telemetry before invoking the callback', async () => {
    const onToolPolicyCall = vi.fn();
    const widenedTelemetry = {
      outcome: 'kept',
      continuationState: 'raw-state-material',
    };
    const client = await setupFetchFixture({
      capabilities: {},
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
              telemetry: widenedTelemetry,
            }),
          },
          execute: async ({ value }) => ({ value }),
        }),
      },
    });

    await client.callTool({
      name: 'observed',
      arguments: { value: 'ok' },
    });

    const callbackPayload = onToolPolicyCall.mock.calls[0]?.[0];
    expect(callbackPayload.telemetry).toEqual({
      outcome: 'kept',
      formSupportReason: 'capability',
    });
    expect(callbackPayload.telemetry).not.toHaveProperty('continuationState');
  });

  test.each([
    {
      name: 'adds the context reason when policy telemetry omits it',
      policyTelemetry: { outcome: 'missing' },
    },
    {
      name: 'overrides a conflicting policy telemetry reason',
      policyTelemetry: {
        outcome: 'wrong',
        formSupportReason: 'available',
      },
    },
  ])('$name', async ({ policyTelemetry }) => {
    const onToolPolicyCall = vi.fn();
    const client = await setupFetchFixture({
      capabilities: { elicitation: { form: {} } },
      formDeliveryAvailable: true,
      optOut: true,
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
              telemetry: policyTelemetry,
            }),
          },
          execute: async ({ value }) => ({ value }),
        }),
      },
    });

    await client.callTool({
      name: 'observed',
      arguments: { value: 'ok' },
    });

    const callbackPayload = onToolPolicyCall.mock.calls[0]?.[0];
    expect(callbackPayload.telemetry).toEqual({
      outcome: policyTelemetry.outcome,
      formSupportReason: 'opt_out',
    });
  });
});
