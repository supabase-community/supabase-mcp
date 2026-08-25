import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import type { CallToolRequestParams } from '@modelcontextprotocol/client';
import { createMcpHandler, inputRequired } from '@modelcontextprotocol/server';
import type { Server, ServerOptions } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod/v4';

import {
  createMcpServer,
  type McpServerOptions,
  resource,
  resources,
  resourceTemplate,
  tool,
  type Tool,
  type ToolPolicy,
} from './index.js';
import { StreamTransport } from './stream-transport.js';

export const MCP_CLIENT_NAME = 'test-client';
export const MCP_CLIENT_VERSION = '0.1.0';

type SetupOptions = {
  server: Server;
};

/**
 * Sets up an MCP client and server for testing.
 */
async function setup(options: SetupOptions) {
  const { server } = options;
  const clientTransport = new StreamTransport();
  const serverTransport = new StreamTransport();

  clientTransport.readable.pipeTo(serverTransport.writable);
  serverTransport.readable.pipeTo(clientTransport.writable);

  const client = new Client(
    {
      name: MCP_CLIENT_NAME,
      version: MCP_CLIENT_VERSION,
    },
    {
      capabilities: {},
    }
  );

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  /**
   * Calls a tool with the given parameters.
   *
   * Wrapper around the `client.callTool` method to handle the response and errors.
   */
  async function callTool(params: CallToolRequestParams) {
    const output = await client.callTool(params);
    const { content } = output;
    const [textContent] = content;

    if (!textContent) {
      return undefined;
    }

    if (textContent.type !== 'text') {
      throw new Error('tool result content is not text');
    }

    if (textContent.text === '') {
      throw new Error('tool result content is empty');
    }

    const result = JSON.parse(textContent.text);

    if (output.isError) {
      throw new Error(result.error.message);
    }

    return result;
  }

  return { client, clientTransport, callTool, server, serverTransport };
}

// https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/
const MODERN_PROTOCOL_VERSION = '2026-07-28';
const MCP_ENDPOINT = new URL('https://mcp.test');
const telemetry = {
  policyId: 'test-policy',
  policyVersion: 1,
  outcome: 'allowed',
};
const cleanups: Array<() => Promise<void>> = [];

/**
 * A policy that always proceeds. Attaching any policy is what opts a tool
 * into structured results, so this is the minimal opted-in configuration.
 */
const passThroughPolicy: ToolPolicy<{ value: string }, undefined> = {
  resolve: async () => ({
    type: 'execute',
    resolution: undefined,
    telemetry,
  }),
};

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

/**
 * Connects a client on the modern revision, the serving path that carries the
 * per-request `_meta` envelope and the multi-round-trip `requestState`
 * vocabulary.
 */
async function setupModernClient(
  options: Omit<McpServerOptions, 'name' | 'version'>
) {
  const handler = createMcpHandler(
    () =>
      createMcpServer({
        name: 'test-server',
        version: '0.0.0',
        ...options,
      }),
    { legacy: 'reject' }
  );
  const transport = new StreamableHTTPClientTransport(MCP_ENDPOINT, {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  });
  const client = new Client(
    { name: MCP_CLIENT_NAME, version: MCP_CLIENT_VERSION },
    {
      capabilities: {},
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

describe('tools', () => {
  test('parameter set to default value when omitted by caller', async () => {
    const server = createMcpServer({
      name: 'test-server',
      version: '0.0.0',
      tools: {
        search: tool({
          description: 'Search text',
          parameters: z.object({
            query: z.string(),
            caseSensitive: z.boolean().default(false),
          }),
          outputSchema: z.object({
            query: z.string(),
            caseSensitive: z.boolean(),
          }),
          execute: async (args) => {
            return args;
          },
        }),
      },
    });

    const { callTool } = await setup({ server });

    // Call the tool without the optional parameter
    const result = await callTool({
      name: 'search',
      arguments: {
        query: 'hello',
      },
    });

    expect(result).toEqual({
      query: 'hello',
      caseSensitive: false,
    });
  });

  test('tool callback is called for success and errors', async () => {
    const onToolCall = vi.fn();

    const server = createMcpServer({
      name: 'test-server',
      version: '0.0.0',
      onToolCall,
      tools: {
        good_tool: tool({
          description: 'A tool that always succeeds',
          annotations: {
            title: 'Good tool',
            readOnlyHint: true,
          },
          parameters: z.object({ foo: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          execute: async ({ foo }) => {
            return { value: foo };
          },
        }),
        bad_tool: tool({
          description: 'A tool that always fails',
          annotations: {
            title: 'Bad tool',
            readOnlyHint: true,
          },
          parameters: z.object({ foo: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          execute: async ({ foo }) => {
            throw new Error('Failure: ' + foo);
          },
        }),
      },
    });

    const { callTool } = await setup({ server });

    const goodToolPromise = callTool({
      name: 'good_tool',
      arguments: { foo: 'bar' },
    });

    await expect(goodToolPromise).resolves.toEqual({ value: 'bar' });
    expect(onToolCall).toHaveBeenLastCalledWith({
      name: 'good_tool',
      arguments: { foo: 'bar' },
      annotations: {
        title: 'Good tool',
        readOnlyHint: true,
      },
      success: true,
      data: { value: 'bar' },
    });

    const badToolPromise = callTool({
      name: 'bad_tool',
      arguments: { foo: 'bar' },
    });

    await expect(badToolPromise).rejects.toThrow('Failure: bar');
    expect(onToolCall).toHaveBeenLastCalledWith({
      name: 'bad_tool',
      arguments: { foo: 'bar' },
      annotations: {
        title: 'Bad tool',
        readOnlyHint: true,
      },
      success: false,
      error: expect.any(Error),
    });
  });

  test("tool callback error doesn't fail the tool call", async () => {
    const onToolCall = vi.fn(() => {
      throw new Error('Tool callback failed');
    });

    const server = createMcpServer({
      name: 'test-server',
      version: '0.0.0',
      onToolCall,
      tools: {
        good_tool: tool({
          description: 'A tool that always succeeds',
          annotations: {
            title: 'Good tool',
            readOnlyHint: true,
          },
          parameters: z.object({ foo: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          execute: async ({ foo }) => {
            return { value: foo };
          },
        }),
      },
    });

    const { callTool } = await setup({ server });

    const goodToolPromise = callTool({
      name: 'good_tool',
      arguments: { foo: 'bar' },
    });

    await expect(goodToolPromise).resolves.toEqual({ value: 'bar' });
    expect(onToolCall.mock.results[0]?.type).toBe('throw');
  });

  test('hidden tool is excluded from tools/list but still callable via tools/call', async () => {
    const server = createMcpServer({
      name: 'test-server',
      version: '0.0.0',
      tools: {
        visible_tool: tool({
          description: 'A visible tool',
          parameters: z.object({ foo: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          execute: async ({ foo }) => {
            return { value: foo };
          },
        }),
        hidden_tool: tool({
          description: 'A hidden tool',
          hidden: true,
          parameters: z.object({ foo: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          execute: async ({ foo }) => {
            return { value: foo };
          },
        }),
      },
    });

    const { client, callTool } = await setup({ server });

    const { tools } = await client.listTools();
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toEqual(['visible_tool']);
    expect(toolNames).not.toContain('hidden_tool');

    const result = await callTool({
      name: 'hidden_tool',
      arguments: { foo: 'bar' },
    });

    expect(result).toEqual({ value: 'bar' });
  });

  test('tools use draft-07 JSON Schema', async () => {
    const server = createMcpServer({
      name: 'test-server',
      version: '0.0.0',
      tools: {
        tool: tool({
          description: 'A tool that always succeeds',
          annotations: {
            title: 'Good tool',
            readOnlyHint: true,
          },
          parameters: z.object({ foo: z.string() }),
          outputSchema: z.object({ message: z.string() }),
          execute: async ({ foo }) => {
            return { message: foo };
          },
        }),
      },
    });

    const { client } = await setup({ server });

    const { tools } = await client.listTools();

    for (const tool of tools) {
      expect(tool.inputSchema['$schema']).toBe(
        'http://json-schema.org/draft-07/schema#'
      );
    }
  });
});

describe('structured tool results', () => {
  // Expressible exactly as it was before this package grew structured
  // results: no policy, no formatResult.
  const plainTools = () => ({
    fixture: tool({
      description: 'Fixture',
      parameters: z.object({ value: z.string() }),
      outputSchema: z.object({ value: z.string() }),
      execute: async ({ value }: { value: string }) => ({ value }),
    }),
  });

  const policyTools = (
    formatResult?: (result: { value: string }) => string
  ) => ({
    fixture: tool({
      description: 'Fixture',
      parameters: z.object({ value: z.string() }),
      outputSchema: z.object({ value: z.string() }),
      policy: passThroughPolicy,
      execute: async ({ value }: { value: string }) => ({ value }),
      ...(formatResult ? { formatResult } : {}),
    }),
  });

  // Both strings below were measured by running this exact fixture against
  // base fc54ea2's `server.ts`, not written by hand.
  const BASE_LEGACY_DISCOVERY =
    '{"tools":[{"name":"fixture","description":"Fixture","inputSchema":' +
    '{"type":"object","properties":{"value":{"type":"string"}},' +
    '"required":["value"],"$schema":"http://json-schema.org/draft-07/schema#",' +
    '"additionalProperties":false}}]}';
  const BASE_LEGACY_CALL =
    '{"content":[{"type":"text","text":"{\\"value\\":\\"hi\\"}"}]}';
  const BASE_MODERN_DISCOVERY =
    '{"_meta":{"io.modelcontextprotocol/serverInfo":{"name":"test-server",' +
    '"version":"0.0.0"}},"ttlMs":0,"cacheScope":"private","tools":[' +
    '{"name":"fixture","description":"Fixture","inputSchema":' +
    '{"$schema":"http://json-schema.org/draft-07/schema#","type":"object",' +
    '"properties":{"value":{"type":"string"}},"required":["value"],' +
    '"additionalProperties":false}}]}';
  const BASE_MODERN_CALL =
    '{"_meta":{"io.modelcontextprotocol/serverInfo":{"name":"test-server",' +
    '"version":"0.0.0"}},"content":[{"type":"text",' +
    '"text":"{\\"value\\":\\"hi\\"}"}]}';

  /**
   * A policy attached on every context that normalizes only the modern era,
   * suppressing structured results elsewhere. This is the shape PR C needs:
   * one policy, routed inside the policy.
   */
  const suppressingTools = () => ({
    fixture: tool({
      description: 'Fixture',
      parameters: z.object({ value: z.string() }),
      outputSchema: z.object({ value: z.string() }),
      policy: {
        outputSchema: (schema, ctx) =>
          ctx.era === 'modern' ? schema : undefined,
        resolve: passThroughPolicy.resolve,
      } satisfies ToolPolicy<{ value: string }, undefined>,
      execute: async ({ value }: { value: string }) => ({ value }),
      formatResult: ({ value }: { value: string }) => `PREFIX:${value}`,
    }),
  });

  test('a policy-free tool keeps base bytes on the legacy path', async () => {
    const server = createMcpServer({
      name: 'test-server',
      version: '0.0.0',
      tools: plainTools(),
    });

    const { client } = await setup({ server });

    expect(JSON.stringify(await client.listTools())).toBe(
      BASE_LEGACY_DISCOVERY
    );
    expect(
      JSON.stringify(
        await client.callTool({ name: 'fixture', arguments: { value: 'hi' } })
      )
    ).toBe(BASE_LEGACY_CALL);
  });

  test('a policy-free tool keeps base bytes on the modern path', async () => {
    const client = await setupModernClient({ tools: plainTools() });

    expect(JSON.stringify(await client.listTools())).toBe(
      BASE_MODERN_DISCOVERY
    );
    expect(
      JSON.stringify(
        await client.callTool({ name: 'fixture', arguments: { value: 'hi' } })
      )
    ).toBe(BASE_MODERN_CALL);
  });

  test('a policy advertises outputSchema and returns structuredContent with single-encoded text', async () => {
    const server = createMcpServer({
      name: 'test-server',
      version: '0.0.0',
      tools: policyTools(),
    });

    const { client } = await setup({ server });

    const { tools } = await client.listTools();
    expect(tools[0]?.outputSchema).toMatchObject({
      type: 'object',
      properties: { value: { type: 'string' } },
    });

    const result = await client.callTool({
      name: 'fixture',
      arguments: { value: 'hi' },
    });

    expect(result.structuredContent).toEqual({ value: 'hi' });
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify({ value: 'hi' }) },
    ]);
  });

  test('a policy without an output-schema hook normalizes on both paths', async () => {
    const legacyServer = createMcpServer({
      name: 'test-server',
      version: '0.0.0',
      tools: policyTools(),
    });

    const legacy = await setup({ server: legacyServer });
    const modern = await setupModernClient({ tools: policyTools() });

    for (const client of [legacy.client, modern]) {
      const { tools } = await client.listTools();
      expect(tools[0]?.outputSchema).toMatchObject({ type: 'object' });

      const result = await client.callTool({
        name: 'fixture',
        arguments: { value: 'hi' },
      });

      expect(result.structuredContent).toEqual({ value: 'hi' });
    }
  });

  test('an output-schema hook returning undefined restores the whole base result', async () => {
    const legacyServer = createMcpServer({
      name: 'test-server',
      version: '0.0.0',
      tools: suppressingTools(),
    });

    const legacy = await setup({ server: legacyServer });
    const modern = await setupModernClient({ tools: suppressingTools() });

    // Suppressed lane: byte-identical to the policy-free fixture's measured
    // base bytes, including `formatResult` being skipped, even though this
    // tool both attaches a policy and declares `formatResult`.
    expect(JSON.stringify(await legacy.client.listTools())).toBe(
      BASE_LEGACY_DISCOVERY
    );
    expect(
      JSON.stringify(
        await legacy.client.callTool({
          name: 'fixture',
          arguments: { value: 'hi' },
        })
      )
    ).toBe(BASE_LEGACY_CALL);

    // Normalized lane: same policy, same tool, structured results and the
    // tool's own `formatResult`.
    const modernDiscovery = await modern.listTools();
    expect(modernDiscovery.tools[0]?.outputSchema).toMatchObject({
      type: 'object',
      properties: { value: { type: 'string' } },
    });

    const modernResult = await modern.callTool({
      name: 'fixture',
      arguments: { value: 'hi' },
    });

    expect(modernResult.structuredContent).toEqual({ value: 'hi' });
    expect(modernResult.content).toEqual([{ type: 'text', text: 'PREFIX:hi' }]);
  });

  test('formatResult changes text only, never discovery or structuredContent', async () => {
    const plainServer = createMcpServer({
      name: 'test-server',
      version: '0.0.0',
      tools: policyTools(),
    });
    const formattedServer = createMcpServer({
      name: 'test-server',
      version: '0.0.0',
      tools: policyTools(({ value }) => `PREFIX:${value}`),
    });

    const plain = await setup({ server: plainServer });
    const formatted = await setup({ server: formattedServer });

    // Discovery is byte-identical with and without `formatResult`.
    expect(JSON.stringify(await formatted.client.listTools())).toBe(
      JSON.stringify(await plain.client.listTools())
    );

    const result = await formatted.client.callTool({
      name: 'fixture',
      arguments: { value: 'hi' },
    });

    expect(result.structuredContent).toEqual({ value: 'hi' });
    expect(result.content).toEqual([{ type: 'text', text: 'PREFIX:hi' }]);
  });

  test('formatResult on a policy-free tool still emits no structuredContent', async () => {
    const server = createMcpServer({
      name: 'test-server',
      version: '0.0.0',
      tools: {
        fixture: tool({
          description: 'Fixture',
          parameters: z.object({ value: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          execute: async ({ value }) => ({ value }),
          formatResult: ({ value }) => `PREFIX:${value}`,
        }),
      },
    });

    const { client } = await setup({ server });

    // Discovery still carries no `outputSchema` key.
    expect(JSON.stringify(await client.listTools())).toBe(
      BASE_LEGACY_DISCOVERY
    );

    const result = await client.callTool({
      name: 'fixture',
      arguments: { value: 'hi' },
    });

    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toEqual([{ type: 'text', text: 'PREFIX:hi' }]);
  });

  test('a null tool result produces no content', async () => {
    const server = createMcpServer({
      name: 'test-server',
      version: '0.0.0',
      tools: {
        empty: tool({
          description: 'Empty',
          parameters: z.object({}),
          outputSchema: z.object({}),
          execute: async () => null as unknown as Record<string, never>,
        }),
      },
    });

    const { client } = await setup({ server });

    const result = await client.callTool({ name: 'empty', arguments: {} });

    expect(result.content).toEqual([]);
    expect(result.structuredContent).toBeUndefined();
  });
});

describe('SDK request state pass-through', () => {
  test('the verifier runs before dispatch and its value reaches the handler', async () => {
    const order: string[] = [];
    let round = 0;
    // Typed as the whole SDK option object, so narrowing it to `verify` or
    // republishing its fields would fail to compile.
    const requestState: ServerOptions['requestState'] = {
      verify: async (state) => {
        order.push(`verify:${state}`);
        return { approved: true };
      },
    };
    const client = await setupModernClient({
      requestState,
      tools: {
        guarded: tool({
          description: 'Guarded',
          parameters: z.object({ value: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          policy: {
            resolve: async (_params, ctx) => {
              round += 1;
              order.push(
                `resolve:${round}:${JSON.stringify(ctx.server.mcpReq.requestState())}`
              );

              if (round === 1) {
                return {
                  type: 'result',
                  result: inputRequired({ requestState: 'minted-state' }),
                  telemetry,
                };
              }

              return { type: 'execute', resolution: undefined, telemetry };
            },
          },
          execute: async ({ value }) => ({ value }),
        }),
      },
    });

    const result = await client.callTool({
      name: 'guarded',
      arguments: { value: 'hi' },
    });

    expect(order).toEqual([
      'resolve:1:undefined',
      'verify:minted-state',
      'resolve:2:{"approved":true}',
    ]);
    expect(result.structuredContent).toEqual({ value: 'hi' });
  });

  test('verifier rejection propagates the SDK-owned -32602 and skips the handler', async () => {
    const resolve = vi.fn(async () => ({
      type: 'result' as const,
      result: inputRequired({ requestState: 'minted-state' }),
      telemetry,
    }));
    const client = await setupModernClient({
      requestState: {
        verify: async () => {
          throw new Error('bad signature');
        },
      },
      tools: {
        guarded: tool({
          description: 'Guarded',
          parameters: z.object({ value: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          policy: { resolve },
          execute: async ({ value }) => ({ value }),
        }),
      },
    });

    const call = client.callTool({
      name: 'guarded',
      arguments: { value: 'hi' },
    });

    // The SDK owns the code, the frozen message, and the reason. This package
    // neither wraps nor translates them.
    await expect(call).rejects.toMatchObject({
      code: -32602,
      message: 'Invalid or expired requestState',
      data: { reason: 'invalid_request_state' },
    });
    // Only the first round reached the handler.
    expect(resolve.mock.calls).toHaveLength(1);
  });
});

describe('public package surface', () => {
  test('a tool with no formatResult and no policy stays assignable', async () => {
    // Mirrors how consumers wrap `Tool` today, without going through the
    // `tool()` helper: no `formatResult`, no policy, one-argument `execute`.
    const consumerTool: Tool<
      z.ZodObject<{ value: z.ZodString }>,
      z.ZodObject<{ value: z.ZodString }>
    > = {
      description: 'Consumer',
      parameters: z.object({ value: z.string() }),
      outputSchema: z.object({ value: z.string() }),
      execute: async ({ value }) => ({ value }),
    };

    const server = createMcpServer({
      name: 'test-server',
      version: '0.0.0',
      tools: { consumer: consumerTool },
    });

    const { callTool } = await setup({ server });

    await expect(
      callTool({ name: 'consumer', arguments: { value: 'hi' } })
    ).resolves.toEqual({ value: 'hi' });
  });
});

describe('resources helper', () => {
  test('should add scheme to resource URIs', () => {
    const output = resources('my-scheme', [
      resource('/schemas', {
        name: 'schemas',
        description: 'Postgres schemas',
        read: async () => [],
      }),
      resourceTemplate('/schemas/{schema}', {
        name: 'schema',
        description: 'Postgres schema',
        read: async () => [],
      }),
    ]);

    const outputUris = output.map((resource) =>
      'uri' in resource ? resource.uri : resource.uriTemplate
    );

    expect(outputUris).toEqual([
      'my-scheme:///schemas',
      'my-scheme:///schemas/{schema}',
    ]);
  });

  test('should not overwrite existing scheme in resource URIs', () => {
    const output = resources('my-scheme', [
      resource('/schemas', {
        name: 'schemas',
        description: 'Postgres schemas',
        read: async () => [],
      }),
      resourceTemplate('/schemas/{schema}', {
        name: 'schema',
        description: 'Postgres schema',
        read: async () => [],
      }),
    ]);

    const outputUris = output.map((resource) =>
      'uri' in resource ? resource.uri : resource.uriTemplate
    );

    expect(outputUris).toEqual([
      'my-scheme:///schemas',
      'my-scheme:///schemas/{schema}',
    ]);
  });
});
