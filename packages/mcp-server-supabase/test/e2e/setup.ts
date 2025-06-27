/// <reference types="../extensions.d.ts" />

import { anthropic } from '@ai-sdk/anthropic';
import { StreamTransport } from '@supabase/mcp-utils';
import { experimental_createMCPClient as createMCPClient } from 'ai';
import { setupServer, SetupServerApi } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { createSupabaseMcpServer } from '../../src/index.js';
import { createSupabaseApiPlatform } from '../../src/platform/api-platform.js';
import {
  ACCESS_TOKEN,
  API_URL,
  MCP_CLIENT_NAME,
  mockBranches,
  mockManagementApi,
  mockOrgs,
  mockProjects,
} from '../mocks.js';

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

export function setupTestEnvironment() {
  let server: SetupServerApi | null = null;

  beforeAll(() => {
    server = setupServer(...mockManagementApi);
    server.listen({ onUnhandledRequest: 'bypass' });
  });

  beforeEach(() => {
    mockOrgs.clear();
    mockProjects.clear();
    mockBranches.clear();
  });

  afterAll(() => {
    server?.close();
  });
}

/**
 * Gets the default model for testing, with the ability to override.
 */
export function getTestModel(modelId?: string) {
  return anthropic(modelId || DEFAULT_TEST_MODEL);
}
