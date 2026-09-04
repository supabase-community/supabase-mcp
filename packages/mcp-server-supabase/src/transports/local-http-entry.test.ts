import {
  Client,
  isInputRequiredResult,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import type {
  CallToolResult,
  InputRequiredResult,
} from '@modelcontextprotocol/client';
import { http, passthrough } from 'msw';
import type { SetupServer } from 'msw/node';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  ACCESS_TOKEN,
  API_URL,
  createOrganization,
  createProject,
  MCP_CLIENT_NAME,
  MCP_CLIENT_VERSION,
  mockBranches,
  setupMockApis,
} from '../../test/mocks.js';
import {
  type LocalHttpEntry,
  startLocalHttpEntry,
} from './local-http-entry.js';

// https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/
const MODERN_PROTOCOL_VERSION = '2026-07-28';
const AUTH_HEADERS = { Authorization: `Bearer ${ACCESS_TOKEN}` };

let mockServer!: SetupServer;
let entry!: LocalHttpEntry;
let logLines!: string[];
const cleanups: Array<() => Promise<void>> = [];

beforeEach(async () => {
  mockServer = setupMockApis();
  logLines = [];
  entry = await startLocalHttpEntry({
    port: 0,
    apiUrl: API_URL,
    log: (line) => logLines.push(line),
  });
  // msw intercepts every fetch in-process; let traffic to the entry hit the real socket.
  mockServer.use(
    http.all(`${new URL(entry.url).origin}/*`, () => passthrough())
  );
});

afterEach(async () => {
  try {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
  } finally {
    await entry.close();
    mockServer.close();
  }
});

async function connect(mode: 'legacy' | { pin: string }) {
  const transport = new StreamableHTTPClientTransport(
    new URL(`${entry.url}?read_only=true`),
    { requestInit: { headers: AUTH_HEADERS } }
  );
  const client = new Client(
    { name: MCP_CLIENT_NAME, version: MCP_CLIENT_VERSION },
    { capabilities: {}, versionNegotiation: { mode } }
  );
  await client.connect(transport);
  cleanups.push(() => client.close());
  return client;
}

describe('startLocalHttpEntry', () => {
  test('serves a modern client pinned to 2026-07-28 including a read-only tool call', async () => {
    const client = await connect({ pin: MODERN_PROTOCOL_VERSION });

    const { tools } = await client.listTools();
    expect(client.getProtocolEra()).toBe('modern');
    expect(tools.map((tool) => tool.name)).toContain('list_projects');

    const result = await client.callTool({
      name: 'search_docs',
      arguments: {
        graphql_query:
          '{ searchDocs(query: "typescript") { nodes { title href } } }',
      },
    });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify({ result: { dummy: true } }) },
    ]);
  });

  test('serves a legacy 2025-era client through initialize and tools/list', async () => {
    const client = await connect('legacy');

    const { tools } = await client.listTools();
    expect(client.getProtocolEra()).toBe('legacy');
    expect(tools.map((tool) => tool.name)).toContain('list_projects');
  });

  test('logs one line per request', async () => {
    const legacy = await connect('legacy');
    await legacy.listTools();
    const modern = await connect({ pin: MODERN_PROTOCOL_VERSION });
    await modern.listTools();

    const client = `${MCP_CLIENT_NAME}/${MCP_CLIENT_VERSION}`;
    expect(logLines).toContainEqual(
      expect.stringMatching(
        /^2025-\d\d-\d\d  initialize\s+test-client\/1\.0\.0$/
      )
    );
    expect(logLines).toContain(
      `${MODERN_PROTOCOL_VERSION}  ${'tools/list'.padEnd(28)}  ${client}`
    );
    expect(logLines.every((line) => !line.includes(ACCESS_TOKEN))).toBe(true);
  });

  test('rejects a request without a bearer token with 401 and no WWW-Authenticate', async () => {
    const response = await fetch(entry.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: 'missing bearer token',
    });
  });

  describe('cost confirmation', () => {
    let writable!: LocalHttpEntry;
    let writableLogLines!: string[];

    beforeEach(async () => {
      writableLogLines = [];
      writable = await startLocalHttpEntry({
        port: 0,
        apiUrl: API_URL,
        log: (line) => writableLogLines.push(line),
      });
      mockServer.use(
        http.all(`${new URL(writable.url).origin}/*`, () => passthrough())
      );
      cleanups.push(() => writable.close());
    });

    async function connectWritable(
      mode: 'legacy' | { pin: string },
      capabilities: ConstructorParameters<typeof Client>[1] = {
        capabilities: {},
      }
    ) {
      const transport = new StreamableHTTPClientTransport(
        new URL(`${writable.url}?features=account,branching`),
        { requestInit: { headers: AUTH_HEADERS } }
      );
      const client = new Client(
        { name: MCP_CLIENT_NAME, version: MCP_CLIENT_VERSION },
        { ...capabilities, versionNegotiation: { mode } }
      );
      await client.connect(transport);
      cleanups.push(() => client.close());
      return client;
    }

    async function createBranchingProject() {
      const org = await createOrganization({
        name: 'My Org',
        plan: 'free',
        allowed_release_channels: ['ga'],
      });
      const project = await createProject({
        name: 'Project 1',
        region: 'us-east-1',
        organization_id: org.id,
      });
      project.status = 'ACTIVE_HEALTHY';
      return project;
    }

    test('a modern form-capable client receives a create_branch cost elicitation', async () => {
      const client = await connectWritable(
        { pin: MODERN_PROTOCOL_VERSION },
        {
          capabilities: { elicitation: { form: {} } },
          inputRequired: { autoFulfill: false },
        }
      );
      const project = await createBranchingProject();

      const result = (await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'create_branch',
            arguments: { project_id: project.id, name: 'feature' },
          },
        },
        { allowInputRequired: true }
      )) as CallToolResult | InputRequiredResult;

      if (!isInputRequiredResult(result)) {
        throw new Error('expected an input_required result');
      }
      expect(result.inputRequests?.confirm_cost).toMatchObject({
        method: 'elicitation/create',
        params: { mode: 'form' },
      });
      expect(result.requestState).toBeTruthy();
      expect(mockBranches.size).toBe(0);
      expect(writableLogLines.at(-1)).toBe(
        `${MODERN_PROTOCOL_VERSION}  ${'tools/call create_branch'.padEnd(28)}  ${MCP_CLIENT_NAME}/${MCP_CLIENT_VERSION}`
      );
    });
  });
});
