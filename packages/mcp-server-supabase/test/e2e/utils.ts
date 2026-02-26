import { anthropic } from '@ai-sdk/anthropic';
import { StreamTransport } from '@supabase/mcp-utils';
import { createMCPClient } from '@ai-sdk/mcp';
import {
  createSupabaseMcpServer,
  createToolSchemas,
  CURRENT_FEATURE_GROUPS,
} from '../../src/index.js';
import { createSupabaseApiPlatform } from '../../src/platform/api-platform.js';
import { ACCESS_TOKEN, API_URL, MCP_CLIENT_NAME } from '../mocks.js';

const DEFAULT_TEST_MODEL = 'claude-sonnet-4-6';

type ToolSchemas<ProjectScoped extends boolean> = ReturnType<
  typeof createToolSchemas<typeof CURRENT_FEATURE_GROUPS, ProjectScoped, false>
>;

type SetupResult<ProjectScoped extends boolean> = {
  client: Awaited<ReturnType<typeof createMCPClient>>;
  clientTransport: StreamTransport;
  server: ReturnType<typeof createSupabaseMcpServer>;
  serverTransport: StreamTransport;
  toolSchemas: ToolSchemas<ProjectScoped>;
};

/**
 * Sets up an MCP client and server for testing.
 */
export async function setup(options: {
  projectId: string;
}): Promise<SetupResult<true>>;
export async function setup(options?: {
  projectId?: never;
}): Promise<SetupResult<false>>;
export async function setup({
  projectId,
}: { projectId?: string } = {}): Promise<SetupResult<boolean>> {
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

  const toolSchemas = createToolSchemas({
    projectScoped: projectId !== undefined,
  });

  return { client, clientTransport, server, serverTransport, toolSchemas };
}

/**
 * Gets the default model for testing, with the ability to override.
 */
export function getTestModel(modelId?: string) {
  return anthropic(modelId ?? DEFAULT_TEST_MODEL);
}
