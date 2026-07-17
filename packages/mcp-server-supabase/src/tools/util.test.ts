import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  CallToolResultSchema,
  type CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer, StreamTransport } from '@supabase/mcp-utils';
import { describe, expect, test } from 'vitest';
import { z } from 'zod/v4';
import { MCP_CLIENT_NAME, MCP_CLIENT_VERSION } from '../../test/mocks.js';
import { injectableTool } from './util.js';

/**
 * Sets up an MCP client and server for testing a set of tools.
 */
async function setup(tools: Record<string, ReturnType<typeof injectableTool>>) {
  const clientTransport = new StreamTransport();
  const serverTransport = new StreamTransport();

  clientTransport.readable.pipeTo(serverTransport.writable);
  serverTransport.readable.pipeTo(clientTransport.writable);

  const client = new Client(
    { name: MCP_CLIENT_NAME, version: MCP_CLIENT_VERSION },
    { capabilities: {} }
  );

  const server = createMcpServer({
    name: 'test-server',
    version: '0.0.0',
    tools,
  });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  /**
   * Calls a tool with the given parameters.
   *
   * Wrapper around the `client.callTool` method to handle the response and errors.
   */
  async function callTool(params: CallToolRequest['params']) {
    const output = await client.callTool(params);
    const { content } = CallToolResultSchema.parse(output);
    const [textContent] = content;

    if (!textContent || textContent.type !== 'text') {
      throw new Error('tool result content is not text');
    }

    const result = JSON.parse(textContent.text);

    if (output.isError) {
      throw new Error(result.error.message);
    }

    return result;
  }

  return { client, callTool };
}

describe('injectableTool', () => {
  test('hidden propagates to tools/list when no parameters are injected, but tool remains callable', async () => {
    const { client, callTool } = await setup({
      visible_tool: injectableTool({
        description: 'A visible tool',
        annotations: {
          title: 'Visible tool',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
        parameters: z.object({ foo: z.string() }),
        outputSchema: z.object({ value: z.string() }),
        execute: async ({ foo }) => ({ value: foo }),
      }),
      hidden_tool: injectableTool({
        description: 'A hidden tool',
        hidden: true,
        annotations: {
          title: 'Hidden tool',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
        parameters: z.object({ foo: z.string() }),
        outputSchema: z.object({ value: z.string() }),
        execute: async ({ foo }) => ({ value: foo }),
      }),
    });

    const { tools } = await client.listTools();
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toContain('visible_tool');
    expect(toolNames).not.toContain('hidden_tool');

    await expect(
      callTool({ name: 'hidden_tool', arguments: { foo: 'bar' } })
    ).resolves.toEqual({ value: 'bar' });
  });

  test('hidden propagates to tools/list when parameters are injected, but tool remains callable', async () => {
    const { client, callTool } = await setup({
      hidden_tool: injectableTool({
        description: 'A hidden tool',
        hidden: true,
        annotations: {
          title: 'Hidden tool',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
        parameters: z.object({ project_id: z.string(), foo: z.string() }),
        outputSchema: z.object({ value: z.string() }),
        inject: { project_id: 'abc' },
        execute: async ({ foo }) => ({ value: foo }),
      }),
    });

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).not.toContain('hidden_tool');

    await expect(
      callTool({ name: 'hidden_tool', arguments: { foo: 'bar' } })
    ).resolves.toEqual({ value: 'bar' });
  });
});
