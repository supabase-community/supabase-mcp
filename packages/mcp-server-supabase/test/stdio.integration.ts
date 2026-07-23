import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { LoggingMessageNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import gqlmin from 'gqlmin';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, test } from 'vitest';
import {
  ACCESS_TOKEN,
  contentApiMockSchema,
  MCP_CLIENT_NAME,
  MCP_CLIENT_VERSION,
} from './mocks.js';

type SetupOptions = {
  accessToken?: string;
  projectId?: string;
  readOnly?: boolean;
  contentApiUrl?: string;
  env?: Record<string, string>;
};

async function setup(options: SetupOptions = {}) {
  const {
    accessToken = ACCESS_TOKEN,
    projectId,
    readOnly,
    contentApiUrl,
    env,
  } = options;

  const client = new Client(
    {
      name: MCP_CLIENT_NAME,
      version: MCP_CLIENT_VERSION,
    },
    {
      capabilities: {},
    }
  );

  client.setNotificationHandler(LoggingMessageNotificationSchema, (message) => {
    const { level, data } = message.params;
    if (level === 'error') {
      console.error(data);
    } else {
      console.log(data);
    }
  });

  const command = 'node';
  const args = ['dist/transports/stdio.js'];

  if (accessToken) {
    args.push('--access-token', accessToken);
  }

  if (projectId) {
    args.push('--project-ref', projectId);
  }

  if (readOnly) {
    args.push('--read-only');
  }

  if (contentApiUrl) {
    args.push('--content-api-url', contentApiUrl);
  }

  const clientTransport = new StdioClientTransport({
    command,
    args,
    env: env
      ? { ...(process.env as Record<string, string>), ...env }
      : undefined,
  });

  await client.connect(clientTransport);

  return { client, clientTransport };
}

/**
 * Local HTTP stub standing in for the docs Content API, so the spawned
 * stdio process (a separate OS process, out of reach of msw) has a real
 * endpoint to hit. Answers the `{ schema }` query with the shared mock
 * schema and counts every request it receives.
 */
async function createContentApiStub() {
  const hits: URL[] = [];

  const server: Server = createServer((req, res) => {
    hits.push(new URL(req.url ?? '/', 'http://127.0.0.1'));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: { schema: contentApiMockSchema } }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to bind content API stub');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('stdio', () => {
  test('server connects and lists tools', async () => {
    const { client } = await setup();

    const { tools } = await client.listTools();

    expect(tools.length).toBeGreaterThan(0);
  });

  test('missing access token fails', async () => {
    const setupPromise = setup({ accessToken: null as any });

    await expect(setupPromise).rejects.toThrow('MCP error -32000');
  });
});

describe('stdio content-api-url', () => {
  const stubs: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(stubs.splice(0).map((stub) => stub.close()));
  });

  test('--content-api-url routes content API traffic to the given URL', async () => {
    const stub = await createContentApiStub();
    stubs.push(stub);

    const { client } = await setup({ contentApiUrl: stub.url });

    const { tools } = await client.listTools();
    const searchDocsTool = tools.find((tool) => tool.name === 'search_docs');

    expect(stub.hits.length).toBeGreaterThan(0);

    // The schema embedded in the tool description round-trips from the
    // stub, proving the flag reached the content API client.
    expect(searchDocsTool?.description).toContain(gqlmin(contentApiMockSchema));
  });

  test('SUPABASE_CONTENT_API_URL env var is the fallback', async () => {
    const stub = await createContentApiStub();
    stubs.push(stub);

    const { client } = await setup({
      env: { SUPABASE_CONTENT_API_URL: stub.url },
    });

    await client.listTools();

    expect(stub.hits.length).toBeGreaterThan(0);
  });

  test('--content-api-url wins over SUPABASE_CONTENT_API_URL', async () => {
    const flagStub = await createContentApiStub();
    const envStub = await createContentApiStub();
    stubs.push(flagStub, envStub);

    const { client } = await setup({
      contentApiUrl: flagStub.url,
      env: { SUPABASE_CONTENT_API_URL: envStub.url },
    });

    await client.listTools();

    expect(flagStub.hits.length).toBeGreaterThan(0);
    expect(envStub.hits.length).toBe(0);
  });
});
