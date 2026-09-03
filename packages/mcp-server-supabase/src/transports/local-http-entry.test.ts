import { request as httpRequest } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  Client,
  isInputRequiredResult,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import type {
  CallToolResult,
  InputRequiredResult,
} from '@modelcontextprotocol/client';
import { http, HttpResponse, passthrough } from 'msw';
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
    readOnly: true,
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
  const transport = new StreamableHTTPClientTransport(new URL(entry.url), {
    requestInit: { headers: AUTH_HEADERS },
  });
  const client = new Client(
    { name: MCP_CLIENT_NAME, version: MCP_CLIENT_VERSION },
    { capabilities: {}, versionNegotiation: { mode } }
  );
  await client.connect(transport);
  cleanups.push(() => client.close());
  return client;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('startLocalHttpEntry', () => {
  test('returns the bound loopback url and never listens on import', () => {
    expect(entry.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(entry.url).not.toContain(':0/');
  });

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

  test('logs one era line per request with the client name', async () => {
    const legacy = await connect('legacy');
    await legacy.listTools();
    const modern = await connect({ pin: MODERN_PROTOCOL_VERSION });
    await modern.listTools();

    const client = `${MCP_CLIENT_NAME}/${MCP_CLIENT_VERSION}`;
    expect(logLines).toContain(
      `[mcp-http] legacy client=${client} (elicitations unavailable on the legacy path)`
    );
    expect(logLines).toContain(
      `[mcp-http] modern ${MODERN_PROTOCOL_VERSION} client=${client}`
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

  test('returns 404 for paths other than /mcp', async () => {
    const response = await fetch(new URL('/other', entry.url), {
      headers: AUTH_HEADERS,
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'not found' });
  });

  test('rejects a foreign Host header and accepts loopback hosts', async () => {
    const { port } = new URL(entry.url);
    // node:http, because fetch forbids overriding the Host header.
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'host-probe', version: '1.0.0' },
      },
    });
    const probe = (host: string) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = httpRequest(
          {
            host: '127.0.0.1',
            port,
            path: '/mcp',
            method: 'POST',
            headers: {
              ...AUTH_HEADERS,
              accept: 'application/json, text/event-stream',
              'content-type': 'application/json',
              host,
            },
          },
          (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => resolve({ status: res.statusCode!, body }));
          }
        );
        req.on('error', reject);
        req.end(body);
      });

    const rejected = await probe('evil.example');
    expect(rejected.status).toBe(403);
    expect(JSON.parse(rejected.body)).toMatchObject({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Invalid Host: evil.example',
      },
    });

    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`]) {
      const response = await probe(host);
      expect(response.status).toBe(200);
      const dataLine = response.body
        .split('\n')
        .find((line) => line.startsWith('data: '));
      if (!dataLine) throw new Error('expected an SSE data line');
      expect(JSON.parse(dataLine.slice('data: '.length))).toMatchObject({
        jsonrpc: '2.0',
        id: 1,
        result: { protocolVersion: expect.any(String) },
      });
    }
  });

  test('rejects request bodies larger than 4 MiB before calling the handler', async () => {
    const response = await new Promise<{ status: number; body: string }>(
      (resolve, reject) => {
        const req = httpRequest(
          entry.url,
          {
            method: 'POST',
            headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
          },
          (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => resolve({ status: res.statusCode!, body }));
          }
        );
        req.on('error', reject);
        req.write(Buffer.alloc(4 * 1024 * 1024 + 1));
        req.end(Buffer.alloc(1024 * 1024));
      }
    );

    expect(response.status).toBe(413);
    expect(JSON.parse(response.body)).toEqual({
      error: 'payload too large',
    });
    expect(logLines).toEqual([]);
  });

  test('answers malformed JSON with a -32700 parse error and non-JSON bodies with 415', async () => {
    const malformed = await fetch(entry.url, {
      method: 'POST',
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      body: '{',
    });
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Parse error' },
      id: null,
    });

    const plain = await fetch(entry.url, {
      method: 'POST',
      headers: { ...AUTH_HEADERS, 'content-type': 'text/plain' },
      body: 'hello',
    });
    expect(plain.status).toBe(415);
  });

  test('keeps serving after a client drops mid-upload', async () => {
    await new Promise<void>((resolve, reject) => {
      const req = httpRequest(entry.url, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
          'transfer-encoding': 'chunked',
        },
      });
      req.on('error', () => resolve());
      req.on('close', () => resolve());
      req.on('socket', (socket) => {
        socket.on('error', reject);
        req.write('{"jsonrpc":"2.0","id":1,', () => socket.destroy());
      });
    });
    // Real delay on purpose: the entry exposes no signal for the server-side
    // reset, and a crash surfaces as an unhandled rejection vitest reports.
    await sleep(50);

    const response = await fetch(entry.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBe(401);
  });

  test('rejects a browser Origin with 403 before auth or routing', async () => {
    const response = await fetch(entry.url, {
      method: 'POST',
      headers: {
        ...AUTH_HEADERS,
        'content-type': 'application/json',
        origin: 'https://evil.example',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: '2.0',
      error: { code: -32000 },
    });
  });

  test('OAuth mode attaches its token to Management API calls', async () => {
    const oauthEntry = await startLocalHttpEntry({
      port: 0,
      apiUrl: API_URL,
      readOnly: true,
      accessToken: async () => ACCESS_TOKEN,
      log: () => {},
    });
    cleanups.push(() => oauthEntry.close());
    mockServer.use(
      http.all(`${new URL(oauthEntry.url).origin}/*`, () => passthrough())
    );

    const transport = new StreamableHTTPClientTransport(
      new URL(oauthEntry.url)
    );
    let managementAuthorization: string | null = null;
    mockServer.use(
      http.get(`${API_URL}/v1/projects`, ({ request }) => {
        managementAuthorization = request.headers.get('authorization');
        return HttpResponse.json([]);
      })
    );
    const client = new Client(
      { name: MCP_CLIENT_NAME, version: MCP_CLIENT_VERSION },
      {
        capabilities: {},
        versionNegotiation: { mode: { pin: MODERN_PROTOCOL_VERSION } },
      }
    );
    await client.connect(transport);
    cleanups.push(() => client.close());

    const result = await client.callTool({
      name: 'list_projects',
      arguments: {},
    });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify({ projects: [] }) },
    ]);
    expect(managementAuthorization).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  test('close releases an in-flight request', async () => {
    const requestStarted = deferred();
    const releaseRequest = deferred();
    mockServer.use(
      http.get(`${API_URL}/v1/projects`, async () => {
        requestStarted.resolve();
        await releaseRequest.promise;
        return HttpResponse.json([]);
      })
    );
    const client = await connect({ pin: MODERN_PROTOCOL_VERSION });
    const callOutcome = client
      .callTool({ name: 'list_projects', arguments: {} })
      .then(
        () => ({ status: 'resolved' as const }),
        (error: unknown) => ({ status: 'rejected' as const, error })
      );

    try {
      await requestStarted.promise;
      await entry.close();

      await expect(callOutcome).resolves.toMatchObject({
        status: 'rejected',
      });
    } finally {
      releaseRequest.resolve();
    }
  });

  describe('cost confirmation', () => {
    let writable!: LocalHttpEntry;
    let writableLogLines!: string[];

    beforeEach(async () => {
      writableLogLines = [];
      writable = await startLocalHttpEntry({
        port: 0,
        apiUrl: API_URL,
        features: ['account', 'branching'],
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
        new URL(writable.url),
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
        `[mcp-http] modern ${MODERN_PROTOCOL_VERSION} client=${MCP_CLIENT_NAME}/${MCP_CLIENT_VERSION}`
      );
    });

    test('a legacy client keeps the get_cost / confirm_cost flow', async () => {
      const client = await connectWritable('legacy');
      const project = await createBranchingProject();

      const result = await client.callTool({
        name: 'create_branch',
        arguments: { project_id: project.id, name: 'feature' },
      });

      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        {
          type: 'text',
          text: JSON.stringify({
            error: {
              name: 'Error',
              message:
                'Cost confirmation ID does not match the expected cost of creating a branch.',
            },
          }),
        },
      ]);
      expect(mockBranches.size).toBe(0);
      // Stateless legacy serving only sees the client name on `initialize`.
      expect(writableLogLines.at(-1)).toMatch(
        /^\[mcp-http\] legacy client=.* \(elicitations unavailable on the legacy path\)$/
      );
    });
  });
});
