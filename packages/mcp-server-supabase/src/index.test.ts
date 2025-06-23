import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamTransport } from '@supabase/mcp-utils';
import { describe, expect, test } from 'vitest';
import {
  ACCESS_TOKEN,
  API_URL,
  MCP_CLIENT_NAME,
  MCP_CLIENT_VERSION,
} from '../test/mocks.js';
import { createSupabaseApiPlatform, createSupabaseMcpServer } from './index.js';

type SetupOptions = {
  accessToken?: string;
  projectId?: string;
  readOnly?: boolean;
  features?: string[];
};

async function setup(options: SetupOptions = {}) {
  const { accessToken = ACCESS_TOKEN, projectId, readOnly, features } = options;
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

  const platform = createSupabaseApiPlatform({
    apiUrl: API_URL,
    accessToken,
  });

  const server = createSupabaseMcpServer({
    platform,
    projectId,
    readOnly,
    features,
  });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, clientTransport, server, serverTransport };
}

describe('index', () => {
  test('index.ts exports a working server', async () => {
    const { client } = await setup();

    const { tools } = await client.listTools();

    expect(tools.length).toBeGreaterThan(0);
  });
});
