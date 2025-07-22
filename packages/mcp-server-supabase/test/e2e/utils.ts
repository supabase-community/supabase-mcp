import { anthropic } from '@ai-sdk/anthropic';
import { StreamTransport } from '@supabase/mcp-utils';
import { experimental_createMCPClient as createMCPClient } from 'ai';
import { createSupabaseMcpServer } from '../../src/index.js';
import { createSupabaseApiPlatform } from '../../src/platform/api-platform.js';
import { ACCESS_TOKEN, API_URL, MCP_CLIENT_NAME } from '../mocks.js';

const DEFAULT_TEST_MODEL = 'claude-3-7-sonnet-20250219';

type SetupOptions = {
  projectId?: string;
};

/**
 * Sets up an MCP client and server for testing.
 */
export async function setup({ projectId }: SetupOptions = {}) {
  const clientTransport = new StreamTransport();
  const serverTransport = new StreamTransport();

  clientTransport.readable.pipeTo(serverTransport.writable);
  serverTransport.readable.pipeTo(clientTransport.writable);

  const platform = createSupabaseApiPlatform({
    apiUrl: API_URL,
    accessToken: ACCESS_TOKEN,
  });

  const server = createSupabaseMcpServer({
    platform,
    projectId,
  });

  await server.connect(serverTransport);

  const client = await createMCPClient({
    name: MCP_CLIENT_NAME,
    transport: clientTransport,
  });

  return { client, clientTransport, server, serverTransport };
}

/**
 * Gets the default model for testing, with the ability to override.
 */
export function getTestModel(modelId?: string) {
  return anthropic(modelId ?? DEFAULT_TEST_MODEL);
}
