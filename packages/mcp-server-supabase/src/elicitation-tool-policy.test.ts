import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import {
  createMcpHandler,
  inputRequired,
  type ElicitResult,
  type McpHttpHandler,
} from '@modelcontextprotocol/server';
import { createMcpServer, StreamTransport, tool } from '@supabase/mcp-utils';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod/v4';

import { createElicitationToolPolicy } from './elicitation-tool-policy.js';

const MODERN_PROTOCOL_VERSION = '2026-07-28';
const CLASSIC_PROTOCOL_VERSION = '2025-06-18';
const MCP_ENDPOINT = new URL('https://mcp.test');
const telemetry = {
  policyId: 'fixture-policy',
  policyVersion: 1,
  outcome: 'allowed',
};
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

async function connectClient(
  protocolVersion: string,
  handler: McpHttpHandler,
  capabilities: Record<string, unknown> = {}
) {
  const transport = new StreamableHTTPClientTransport(MCP_ENDPOINT, {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  });
  const client = new Client(
    { name: 'elicitation-policy-fixture', version: '0.0.0' },
    {
      capabilities,
      supportedProtocolVersions: [protocolVersion],
      versionNegotiation:
        protocolVersion === MODERN_PROTOCOL_VERSION
          ? { mode: { pin: protocolVersion } }
          : { mode: 'legacy' },
    }
  );

  await client.connect(transport);
  cleanups.push(
    () => client.close(),
    () => handler.close()
  );
  return client;
}

describe('createElicitationToolPolicy', () => {
  test('carries form and elicitUrl shapes through mcp-utils and returns re-entry transport values', async () => {
    const elicitationRequests: unknown[] = [];
    const rounds: unknown[] = [];
    const handler = createMcpHandler(
      () =>
        createMcpServer({
          name: 'elicitation-policy-fixture',
          version: '0.0.0',
          requestState: {
            verify: async (state) => {
              expect(state).toBe('fixture-state');
              return { verified: true };
            },
          },
          tools: {
            guarded: tool({
              description: 'Guarded',
              parameters: z.object({ value: z.string() }),
              outputSchema: z.object({ value: z.string() }),
              policy: createElicitationToolPolicy<
                { value: string },
                { verified: boolean },
                undefined
              >({
                async resolve(_params, _ctx, round) {
                  rounds.push(round);
                  if (round.requestState === undefined) {
                    return {
                      type: 'inputRequired',
                      inputRequests: {
                        confirm: inputRequired.elicit({
                          message: 'Confirm the action',
                          requestedSchema: {
                            type: 'object',
                            properties: {},
                          },
                        }),
                        handoff: inputRequired.elicitUrl({
                          message: 'Complete the handoff',
                          url: 'https://example.com/handoff',
                        }),
                      },
                      requestState: 'fixture-state',
                      telemetry,
                    };
                  }

                  return {
                    type: 'execute',
                    resolution: undefined,
                    telemetry,
                  };
                },
              }),
              execute: async ({ value }) => ({ value }),
            }),
          },
        }),
      { legacy: 'reject' }
    );
    const client = await connectClient(MODERN_PROTOCOL_VERSION, handler, {
      elicitation: { form: {}, url: {} },
    });
    client.setRequestHandler('elicitation/create', async (request) => {
      elicitationRequests.push(request.params);
      return { action: 'accept' } satisfies ElicitResult;
    });

    const result = await client.callTool({
      name: 'guarded',
      arguments: { value: 'done' },
    });

    expect(elicitationRequests).toEqual(
      expect.arrayContaining([
        {
          mode: 'form',
          message: 'Confirm the action',
          requestedSchema: { type: 'object', properties: {} },
        },
        {
          mode: 'url',
          message: 'Complete the handoff',
          url: 'https://example.com/handoff',
        },
      ])
    );
    expect(rounds).toHaveLength(2);
    expect(rounds[0]).toStrictEqual({
      requestState: undefined,
      inputResponses: undefined,
    });
    expect(rounds[1]).toStrictEqual({
      requestState: { verified: true },
      inputResponses: {
        confirm: { action: 'accept' },
        handoff: { action: 'accept' },
      },
    });
    expect(result.structuredContent).toStrictEqual({ value: 'done' });
  });

  test('the enabled legacyShim default re-enters while classic lane selection keeps confirm_cost', async () => {
    const elicit = vi.fn(async () => ({ action: 'accept' as const }));
    const shimRounds: unknown[] = [];
    const server = createMcpServer({
      name: 'classic-policy-fixture',
      version: '0.0.0',
      tools: {
        create_project: tool({
          description: 'Create project',
          parameters: z.object({
            name: z.string(),
            confirm_cost: z.boolean().optional(),
          }),
          outputSchema: z.object({ name: z.string() }),
          policy: createElicitationToolPolicy<
            { name: string; confirm_cost?: boolean },
            unknown,
            undefined
          >({
            inputSchema: (schema, ctx) => {
              expect(ctx.era).toBe('legacy');
              return schema;
            },
            async resolve(params, ctx) {
              expect(ctx.era).toBe('legacy');
              expect(params.confirm_cost).toBe(true);
              return {
                type: 'execute',
                resolution: undefined,
                telemetry,
              };
            },
          }),
          execute: async ({ name }) => ({ name }),
        }),
        shim_probe: tool({
          description: 'Probe the SDK legacy shim',
          parameters: z.object({ value: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          policy: createElicitationToolPolicy<
            { value: string },
            string,
            undefined
          >({
            async resolve(_params, _ctx, round) {
              shimRounds.push(round);
              if (round.requestState === undefined) {
                return {
                  type: 'inputRequired',
                  inputRequests: {
                    confirm: inputRequired.elicit({
                      message: 'Confirm the shim round',
                      requestedSchema: {
                        type: 'object',
                        properties: {},
                      },
                    }),
                  },
                  requestState: 'classic-shim-state',
                  telemetry,
                };
              }

              return {
                type: 'execute',
                resolution: undefined,
                telemetry,
              };
            },
          }),
          execute: async ({ value }) => ({ value }),
        }),
      },
    });
    const clientTransport = new StreamTransport();
    const serverTransport = new StreamTransport();
    clientTransport.readable.pipeTo(serverTransport.writable);
    serverTransport.readable.pipeTo(clientTransport.writable);
    const client = new Client(
      { name: 'classic-policy-fixture', version: '0.0.0' },
      {
        capabilities: { elicitation: {} },
        supportedProtocolVersions: [CLASSIC_PROTOCOL_VERSION],
        versionNegotiation: { mode: 'legacy' },
      }
    );
    client.setRequestHandler('elicitation/create', elicit);
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    const result = await client.callTool({
      name: 'create_project',
      arguments: { name: 'classic', confirm_cost: true },
    });

    expect(tools.tools[0]?.inputSchema).toMatchObject({
      properties: { confirm_cost: { type: 'boolean' } },
    });
    expect(result.content).toStrictEqual([
      { type: 'text', text: JSON.stringify({ name: 'classic' }) },
    ]);
    expect(elicit).not.toHaveBeenCalled();

    const shimResult = await client.callTool({
      name: 'shim_probe',
      arguments: { value: 're-entered' },
    });

    expect(shimRounds).toStrictEqual([
      { requestState: undefined, inputResponses: undefined },
      {
        requestState: 'classic-shim-state',
        inputResponses: { confirm: { action: 'accept' } },
      },
    ]);
    expect(elicit).toHaveBeenCalledTimes(1);
    expect(shimResult.structuredContent).toStrictEqual({ value: 're-entered' });
  });
});
