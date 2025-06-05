import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolResultSchema,
  type CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  createMcpServer,
  resource,
  resources,
  resourceTemplate,
  tool,
} from './server.js';
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
  async function callTool(params: CallToolRequest['params']) {
    const output = await client.callTool(params);
    const { content } = CallToolResultSchema.parse(output);
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
