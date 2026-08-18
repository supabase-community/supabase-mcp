import { Client, type ClientCapabilities } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import gqlmin from 'gqlmin';
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, test } from 'vitest';
import {
  ACCESS_TOKEN,
  contentApiMockSchema,
  MCP_CLIENT_NAME,
  MCP_CLIENT_VERSION,
  MCP_SERVER_VERSION,
} from './mocks.js';

const execFileAsync = promisify(execFile);

type ProtocolEra = 'legacy' | 'modern';

type SetupOptions = {
  era?: ProtocolEra;
  accessToken?: string;
  projectId?: string;
  readOnly?: boolean;
  disableElicitations?: boolean;
  elicitationCapability?: 'absent' | 'empty' | 'form' | 'url';
  features?: string;
  contentApiUrl?: string;
  apiUrl?: string;
  env?: Record<string, string>;
  elicitationResponses?: Array<{
    action: 'accept' | 'decline' | 'cancel';
    content?: Record<string, string | number | boolean | string[]>;
  }>;
};

function assertStdioBuildIsFresh() {
  const buildPath = 'dist/transports/stdio.js';
  const newestSource = readdirSync('src', {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return { path, mtimeMs: statSync(path).mtimeMs };
    })
    .reduce((newest, source) =>
      source.mtimeMs > newest.mtimeMs ? source : newest
    );
  const buildMtimeMs = existsSync(buildPath)
    ? statSync(buildPath).mtimeMs
    : Number.NEGATIVE_INFINITY;

  expect(
    buildMtimeMs,
    `${buildPath} is missing or older than ${newestSource.path}; run \`pnpm build\`.`
  ).toBeGreaterThanOrEqual(newestSource.mtimeMs);
}

assertStdioBuildIsFresh();
function capabilitiesFor(
  mode: NonNullable<SetupOptions['elicitationCapability']>
): ClientCapabilities {
  switch (mode) {
    case 'empty':
      return { elicitation: {} };
    case 'form':
      return { elicitation: { form: {} } };
    case 'url':
      return { elicitation: { url: {} } };
    case 'absent':
      return {};
  }
}

async function setup(options: SetupOptions = {}) {
  const {
    accessToken = ACCESS_TOKEN,
    era = 'legacy',
    projectId,
    readOnly,
    disableElicitations,
    features,
    apiUrl,
    contentApiUrl,
    env,
    elicitationResponses,
  } = options;
  const elicitationCapability =
    options.elicitationCapability ?? (era === 'modern' ? 'form' : 'absent');

  const client = new Client(
    {
      name: MCP_CLIENT_NAME,
      version: MCP_CLIENT_VERSION,
    },
    {
      capabilities: capabilitiesFor(elicitationCapability),
      versionNegotiation:
        era === 'modern' ? { mode: { pin: '2026-07-28' } } : { mode: 'legacy' },
    }
  );

  if (elicitationResponses) {
    client.setRequestHandler('elicitation/create', async () => {
      const response = elicitationResponses.shift();
      if (!response) throw new Error('Missing elicitation response');
      return response;
    });
  }

  client.setNotificationHandler('notifications/message', (message) => {
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

  if (disableElicitations) {
    args.push('--disable-elicitations');
  }

  if (features) {
    args.push('--features', features);
  }

  if (apiUrl) {
    args.push('--api-url', apiUrl);
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
  const toolCalls: Array<Record<string, unknown>> = [];
  const send = clientTransport.send.bind(clientTransport);
  clientTransport.send = async (message) => {
    if (
      'method' in message &&
      message.method === 'tools/call' &&
      message.params
    ) {
      toolCalls.push(structuredClone(message.params));
    }
    await send(message);
  };

  await client.connect(clientTransport);

  return { client, clientTransport, toolCalls };
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

async function createManagementApiStub() {
  const hits: Array<{ method: string | undefined; url: URL }> = [];

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    hits.push({ method: req.method, url });
    res.setHeader('Content-Type', 'application/json');

    if (
      req.method === 'GET' &&
      url.pathname === '/v1/projects' &&
      url.search === ''
    ) {
      res.end(
        JSON.stringify([
          {
            id: 'abcdefghijklmnopqrst',
            ref: 'abcdefghijklmnopqrst',
            organization_id: 'tsrqponmlkjihgfedcba',
            organization_slug: 'tsrqponmlkjihgfedcba',
            name: 'Example project',
            region: 'us-east-1',
            created_at: '2024-01-02T03:04:05.000Z',
            status: 'ACTIVE_HEALTHY',
          },
        ])
      );
      return;
    }

    if (
      req.method === 'GET' &&
      url.pathname === '/v1/organizations/tsrqponmlkjihgfedcba'
    ) {
      res.end(
        JSON.stringify({
          id: 'tsrqponmlkjihgfedcba',
          name: 'Example organization',
          plan: 'pro',
          allowed_release_channels: ['ga'],
          opt_in_tags: [],
        })
      );
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/projects') {
      const body = JSON.parse(
        await new Promise<string>((resolve) => {
          let data = '';
          req.on('data', (chunk) => (data += chunk));
          req.on('end', () => resolve(data));
        })
      ) as {
        name: string;
        organization_slug: string;
        region: string;
      };
      res.end(
        JSON.stringify({
          id: 'created-project',
          ref: 'created-project',
          organization_id: body.organization_slug,
          organization_slug: body.organization_slug,
          name: body.name,
          region: body.region,
          created_at: '2026-08-18T00:00:00.000Z',
          status: 'COMING_UP',
        })
      );
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to bind management API stub');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('stdio', () => {
  const stubs: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(stubs.splice(0).map((stub) => stub.close()));
  });

  async function assertServerContract(era: ProtocolEra) {
    const managementApiStub = await createManagementApiStub();
    const contentApiStub = await createContentApiStub();
    stubs.push(managementApiStub, contentApiStub);

    const { client } = await setup({
      apiUrl: managementApiStub.url,
      contentApiUrl: contentApiStub.url,
      era,
    });

    try {
      const { tools } = await client.listTools();
      const toolResult = await client.callTool({
        name: 'list_projects',
        arguments: {},
      });

      const expectedTools = [
        'apply_migration',
        'create_branch',
        'create_project',
        'delete_branch',
        'deploy_edge_function',
        'execute_sql',
        'generate_typescript_types',
        'get_advisors',
        'get_cost',
        'get_edge_function',
        'get_organization',
        'get_project',
        'get_project_url',
        'get_publishable_keys',
        'list_branches',
        'list_edge_functions',
        'list_extensions',
        'list_migrations',
        'list_organizations',
        'list_projects',
        'list_tables',
        'merge_branch',
        'pause_project',
        'query_logs',
        'rebase_branch',
        'reset_branch',
        'restore_project',
        'search_docs',
      ];
      if (era === 'legacy') expectedTools.push('confirm_cost');
      expect(tools.map((tool) => tool.name).sort()).toEqual(
        expectedTools.sort()
      );
      expect(client.getServerVersion()).toEqual({
        name: 'supabase',
        title: 'Supabase',
        version: MCP_SERVER_VERSION,
      });
      expect(client.getServerCapabilities()).toEqual({
        tools: {},
      });
      const expectedToolContent = [
        {
          type: 'text',
          text: JSON.stringify({
            projects: [
              {
                id: 'abcdefghijklmnopqrst',
                ref: 'abcdefghijklmnopqrst',
                organization_id: 'tsrqponmlkjihgfedcba',
                organization_slug: 'tsrqponmlkjihgfedcba',
                name: 'Example project',
                region: 'us-east-1',
                created_at: '2024-01-02T03:04:05.000Z',
                status: 'ACTIVE_HEALTHY',
              },
            ],
          }),
        },
      ];

      const expectedMeta =
        era === 'modern'
          ? {
              _meta: {
                'io.modelcontextprotocol/serverInfo': {
                  name: 'supabase',
                  title: 'Supabase',
                  version: MCP_SERVER_VERSION,
                },
              },
            }
          : {};
      expect(Object.hasOwn(toolResult, '_meta')).toBe(era === 'modern');
      expect(toolResult).toEqual({
        ...expectedMeta,
        content: expectedToolContent,
        structuredContent: JSON.parse(expectedToolContent[0].text),
      });
      expect(
        managementApiStub.hits.map(({ method, url }) => ({
          method,
          pathname: url.pathname,
          search: url.search,
        }))
      ).toEqual([
        {
          method: 'GET',
          pathname: '/v1/projects',
          search: '',
        },
      ]);
      expect(contentApiStub.hits.length).toBeGreaterThan(0);
    } finally {
      await client.close();
    }
  }

  test.each<ProtocolEra>(['legacy', 'modern'])(
    'server connects and lists tools (%s)',
    assertServerContract
  );

  async function setupPaidProject(options: SetupOptions) {
    const managementApiStub = await createManagementApiStub();
    const contentApiStub = await createContentApiStub();
    stubs.push(managementApiStub, contentApiStub);
    const connection = await setup({
      ...options,
      apiUrl: managementApiStub.url,
      contentApiUrl: contentApiStub.url,
    });
    return { ...connection, managementApiStub };
  }

  const projectArguments = {
    name: 'Confirmed project',
    region: 'us-east-1',
    organization_id: 'tsrqponmlkjihgfedcba',
  };

  test('modern form mode accepts once and rejects same-process replay', async () => {
    const { client, managementApiStub, toolCalls } = await setupPaidProject({
      era: 'modern',
      elicitationResponses: [{ action: 'accept', content: { confirm: true } }],
    });

    try {
      const { tools } = await client.listTools();
      const result = await client.callTool({
        name: 'create_project',
        arguments: projectArguments,
      });
      const retry = toolCalls.find((call) => 'requestState' in call);

      expect(tools.map(({ name }) => name)).not.toContain('confirm_cost');
      expect(result.isError).not.toBe(true);
      expect(retry).toBeDefined();

      const replay = await client.request({
        method: 'tools/call',
        params: retry,
      });
      expect(replay.isError).toBe(true);
      expect(replay.content[0]).toMatchObject({
        type: 'text',
        text: expect.stringContaining('already used'),
      });
      expect(
        managementApiStub.hits.filter(
          ({ method, url }) =>
            method === 'POST' && url.pathname === '/v1/projects'
        )
      ).toHaveLength(1);
    } finally {
      await client.close();
    }
  });

  test('modern form mode declines without creating', async () => {
    const { client, managementApiStub } = await setupPaidProject({
      era: 'modern',
      elicitationResponses: [{ action: 'decline' }],
    });

    try {
      const result = await client.callTool({
        name: 'create_project',
        arguments: projectArguments,
      });

      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({ status: 'declined' });
      expect(
        managementApiStub.hits.some(
          ({ method, url }) =>
            method === 'POST' && url.pathname === '/v1/projects'
        )
      ).toBe(false);
    } finally {
      await client.close();
    }
  });

  test.each([
    ['legacy', 'empty'],
    ['modern', 'empty'],
  ] as const)(
    '%s stdio treats an %s elicitation declaration as form capable',
    async (era, elicitationCapability) => {
      const { client, managementApiStub } = await setupPaidProject({
        era,
        elicitationCapability,
        elicitationResponses: [
          { action: 'accept', content: { confirm: true } },
        ],
      });

      try {
        const { tools } = await client.listTools();
        const result = await client.callTool({
          name: 'create_project',
          arguments: projectArguments,
        });
        const createProject = tools.find(
          ({ name }) => name === 'create_project'
        );

        expect(tools.map(({ name }) => name)).not.toContain('confirm_cost');
        expect(createProject?.inputSchema).not.toHaveProperty(
          'properties.confirm_cost_id'
        );
        for (const tool of tools) {
          expect(tool.inputSchema).not.toHaveProperty(
            'properties.disable_elicitations'
          );
        }
        expect(result.isError).not.toBe(true);
        expect(
          managementApiStub.hits.filter(
            ({ method, url }) =>
              method === 'POST' && url.pathname === '/v1/projects'
          )
        ).toHaveLength(1);
      } finally {
        await client.close();
      }
    }
  );

  test('modern URL-only stdio keeps legacy confirmation behavior', async () => {
    const { client, managementApiStub } = await setupPaidProject({
      era: 'modern',
      elicitationCapability: 'url',
    });

    try {
      const { tools } = await client.listTools();
      const confirmation = await client.callTool({
        name: 'confirm_cost',
        arguments: {
          type: 'project',
          recurrence: 'monthly',
          amount: 10,
        },
      });
      const confirmationContent = confirmation.structuredContent;
      if (
        !confirmationContent ||
        typeof confirmationContent !== 'object' ||
        !('confirmation_id' in confirmationContent) ||
        typeof confirmationContent.confirmation_id !== 'string'
      ) {
        throw new Error('confirm_cost returned no confirmation ID');
      }
      const result = await client.callTool({
        name: 'create_project',
        arguments: {
          ...projectArguments,
          confirm_cost_id: confirmationContent.confirmation_id,
        },
      });

      expect(tools.map(({ name }) => name)).toContain('confirm_cost');
      for (const tool of tools) {
        expect(tool.inputSchema).not.toHaveProperty(
          'properties.disable_elicitations'
        );
      }
      expect(result.isError).not.toBe(true);
      expect(
        managementApiStub.hits.filter(
          ({ method, url }) =>
            method === 'POST' && url.pathname === '/v1/projects'
        )
      ).toHaveLength(1);
    } finally {
      await client.close();
    }
  });

  test('modern form mode reports deterministic expiry', async () => {
    const preload = [
      'const realNow=Date.now.bind(Date);',
      'let expired=false;',
      `process.stdin.on('data',chunk=>{if(chunk.includes('"inputResponses"'))expired=true});`,
      'Date.now=()=>realNow()+(expired?121000:0);',
    ].join('');
    const { client, managementApiStub } = await setupPaidProject({
      era: 'modern',
      elicitationResponses: [{ action: 'accept', content: { confirm: true } }],
      env: {
        NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(preload)}`,
      },
    });

    try {
      const result = await client.callTool({
        name: 'create_project',
        arguments: projectArguments,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]).toMatchObject({
        type: 'text',
        text: expect.stringContaining('expired'),
      });
      expect(
        managementApiStub.hits.some(
          ({ method, url }) =>
            method === 'POST' && url.pathname === '/v1/projects'
        )
      ).toBe(false);
    } finally {
      await client.close();
    }
  });

  test.each([
    ['legacy', false],
    ['modern', true],
  ] as const)(
    '%s stdio with opt-out=%s keeps legacy confirmation behavior',
    async (era, disableElicitations) => {
      const { client, managementApiStub } = await setupPaidProject({
        era,
        disableElicitations,
      });

      try {
        const { tools } = await client.listTools();
        const confirmation = await client.callTool({
          name: 'confirm_cost',
          arguments: {
            type: 'project',
            recurrence: 'monthly',
            amount: 10,
          },
        });
        const confirmationContent = confirmation.structuredContent;
        if (
          !confirmationContent ||
          typeof confirmationContent !== 'object' ||
          !('confirmation_id' in confirmationContent) ||
          typeof confirmationContent.confirmation_id !== 'string'
        ) {
          throw new Error('confirm_cost returned no confirmation ID');
        }
        const confirmationId = confirmationContent.confirmation_id;
        const result = await client.callTool({
          name: 'create_project',
          arguments: {
            ...projectArguments,
            confirm_cost_id: confirmationId,
          },
        });

        expect(tools.map(({ name }) => name)).toContain('confirm_cost');
        for (const tool of tools) {
          expect(tool.inputSchema).not.toHaveProperty(
            'properties.disable_elicitations'
          );
        }
        expect(result.isError).not.toBe(true);
        expect(
          managementApiStub.hits.filter(
            ({ method, url }) =>
              method === 'POST' && url.pathname === '/v1/projects'
          )
        ).toHaveLength(1);
      } finally {
        await client.close();
      }
    }
  );

  test('modern stdio opt-out preserves the legacy confirmation hash and payload', async () => {
    const legacy = await setupPaidProject({ era: 'legacy' });
    const optedOut = await setupPaidProject({
      era: 'modern',
      disableElicitations: true,
    });

    try {
      const confirmationArguments = {
        type: 'project' as const,
        recurrence: 'monthly' as const,
        amount: 10,
      };
      const legacyConfirmation = await legacy.client.callTool({
        name: 'confirm_cost',
        arguments: confirmationArguments,
      });
      const optedOutConfirmation = await optedOut.client.callTool({
        name: 'confirm_cost',
        arguments: confirmationArguments,
      });

      expect(optedOutConfirmation.content).toEqual(legacyConfirmation.content);
      expect(optedOutConfirmation.structuredContent).toEqual(
        legacyConfirmation.structuredContent
      );
    } finally {
      await Promise.all([legacy.client.close(), optedOut.client.close()]);
    }
  });

  test('--version prints the package version without a token', async () => {
    const env = { ...process.env };
    delete env.FORCE_COLOR;
    delete env.NO_COLOR;
    const { stderr, stdout } = await execFileAsync(
      'node',
      ['dist/transports/stdio.js', '--version'],
      { env }
    );

    expect(stdout.trim()).toBe(MCP_SERVER_VERSION);
    expect(stderr).toBe('');
  });

  test('missing access token fails', async () => {
    const setupPromise = setup({ accessToken: null as any });

    // The server is unchanged here: it still exits before completing the handshake.
    // Only the message this test's own client renders changed, from v1's
    // 'MCP error -32000: Connection closed' to v2's 'Connection closed'. Held against a
    // fixed v1 client, both the pre- and post-migration builds return the v1 string.
    await expect(setupPromise).rejects.toThrow('Connection closed');
  });

  test('invalid --features fails at startup', async () => {
    const setupPromise = setup({ features: 'invalid' });

    await expect(setupPromise).rejects.toThrow('Connection closed');
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
