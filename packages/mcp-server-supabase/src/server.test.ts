import { PGlite, type PGliteInterface } from '@electric-sql/pglite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  CallToolResultSchema,
  type CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { StreamTransport } from '@supabase/mcp-utils';
import { format } from 'date-fns';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { beforeEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { version } from '../package.json';
import type { components } from './management-api/types';
import { TRACE_URL } from './regions.js';
import { createSupabaseMcpServer } from './server.js';

type Project = components['schemas']['V1ProjectWithDatabaseResponse'];
type Organization = components['schemas']['OrganizationResponseV1'];

const API_URL = 'https://api.supabase.com';
const MCP_SERVER_NAME = 'supabase-mcp';
const MCP_SERVER_VERSION = version;
const MCP_CLIENT_NAME = 'test-client';
const MCP_CLIENT_VERSION = '0.1.0';
const ACCESS_TOKEN = 'dummy-token';
const COUNTRY_CODE = 'US';
const CLOSEST_REGION = 'us-east-2';

const mockOrgs: Organization[] = [
  { id: 'org-1', name: 'Org 1' },
  { id: 'org-2', name: 'Org 2' },
];

const mockProjects: Project[] = [
  {
    id: 'project-1',
    organization_id: 'org-1',
    name: 'Project 1',
    region: 'us-east-1',
    created_at: '2023-01-01T00:00:00Z',
    status: 'ACTIVE_HEALTHY',
    database: {
      host: 'db.project-1.supabase.co',
      version: '15.1',
      postgres_engine: '15',
      release_channel: 'ga',
    },
  },
  {
    id: 'project-2',
    organization_id: 'org-2',
    name: 'Project 2',
    region: 'us-west-2',
    created_at: '2023-01-02T00:00:00Z',
    status: 'ACTIVE_HEALTHY',
    database: {
      host: 'db.project-2.supabase.co',
      version: '15.1',
      postgres_engine: '15',
      release_channel: 'ga',
    },
  },
];

type Migration = {
  version: string;
  name: string;
  query: string;
};

type ProjectImpl = {
  db: PGliteInterface;
  migrations: Migration[];
};

beforeEach(() => {
  // Mock project using PGlite
  const projects = new Map<string, ProjectImpl>();
  function getProject(projectId: string) {
    if (!mockProjects.find((p) => p.id === projectId)) {
      throw new Error(`Project ${projectId} not found`);
    }
    let project = projects.get(projectId);
    if (!project) {
      project = {
        db: new PGlite(),
        migrations: [],
      };
      projects.set(projectId, project);
    }
    return project;
  }

  // Mock the management API
  const handlers = [
    http.get(TRACE_URL, () => {
      return HttpResponse.text(
        `fl=123abc\nvisit_scheme=https\nloc=${COUNTRY_CODE}\ntls=TLSv1.3\nhttp=http/2`
      );
    }),

    http.all('*', ({ request }) => {
      const authHeader = request.headers.get('Authorization');

      const accessToken = authHeader?.replace('Bearer ', '');
      if (accessToken !== ACCESS_TOKEN) {
        return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }),

    http.all('*', ({ request }) => {
      const userAgent = request.headers.get('user-agent');
      expect(userAgent).toBe(
        `${MCP_SERVER_NAME}/${MCP_SERVER_VERSION} (${MCP_CLIENT_NAME}/${MCP_CLIENT_VERSION})`
      );
    }),

    http.get(`${API_URL}/v1/projects`, () => {
      return HttpResponse.json(mockProjects);
    }),

    http.get(`${API_URL}/v1/projects/:projectId`, ({ params }) => {
      const project = mockProjects.find((p) => p.id === params.projectId);
      return HttpResponse.json(project);
    }),

    http.post(`${API_URL}/v1/projects`, async ({ request }) => {
      const bodySchema = z.object({
        name: z.string(),
        region: z.string(),
        organization_id: z.string(),
        db_pass: z.string(),
      });
      const body = await request.json();
      const { name, region, organization_id } = bodySchema.parse(body);
      const id = `project-${mockProjects.length + 1}`;

      const project: Project = {
        id,
        organization_id,
        name,
        region,
        created_at: new Date().toISOString(),
        status: 'UNKNOWN',
        database: {
          host: `db.${id}.supabase.co`,
          version: '15.1',
          postgres_engine: '15',
          release_channel: 'ga',
        },
      };
      mockProjects.push(project);

      const { database, ...projectResponse } = project;

      return HttpResponse.json(projectResponse);
    }),

    http.get(`${API_URL}/v1/organizations`, () => {
      return HttpResponse.json(mockOrgs);
    }),

    http.get(`${API_URL}/v1/organizations/:id`, ({ params }) => {
      const organization = mockOrgs.find((org) => org.id === params.id);
      return HttpResponse.json(organization);
    }),

    http.get(`${API_URL}/v1/projects/:projectId/api-keys`, ({ params }) => {
      return HttpResponse.json([
        {
          name: 'anon',
          api_key: 'dummy-anon-key',
        },
      ]);
    }),

    http.post<{ projectId: string }, { query: string }>(
      `${API_URL}/v1/projects/:projectId/database/query`,
      async ({ params, request }) => {
        const { db } = getProject(params.projectId);
        const { query } = await request.json();
        const [results] = await db.exec(query);

        if (!results) {
          return HttpResponse.json(
            { error: 'Failed to execute query' },
            { status: 500 }
          );
        }

        return HttpResponse.json(results.rows);
      }
    ),

    http.get<{ projectId: string }>(
      `${API_URL}/v1/projects/:projectId/database/migrations`,
      async ({ params }) => {
        const { migrations } = getProject(params.projectId);
        const modified = migrations.map(({ version, name }) => ({
          version,
          name,
        }));

        return HttpResponse.json(modified);
      }
    ),

    http.post<{ projectId: string }, { name: string; query: string }>(
      `${API_URL}/v1/projects/:projectId/database/migrations`,
      async ({ params, request }) => {
        const { db, migrations } = getProject(params.projectId);
        const { name, query } = await request.json();
        const [results] = await db.exec(query);

        if (!results) {
          return HttpResponse.json(
            { error: 'Failed to execute query' },
            { status: 500 }
          );
        }

        migrations.push({
          version: format(new Date(), 'yyyyMMddHHmmss'),
          name,
          query,
        });

        return HttpResponse.json(results.rows);
      }
    ),

    // Catch-all handler for any other requests
    http.all('*', ({ request }) => {
      throw new Error(
        `No request handler found for ${request.method} ${request.url}`
      );
    }),
  ];

  const server = setupServer(...handlers);
  server.listen({ onUnhandledRequest: 'error' });
});

type SetupOptions = {
  accessToken?: string;
};

/**
 * Sets up an MCP client and server for testing.
 */
async function setup(options: SetupOptions = {}) {
  const { accessToken = ACCESS_TOKEN } = options;
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

  const server = createSupabaseMcpServer({
    platform: {
      apiUrl: API_URL,
      accessToken,
    },
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

    if (!textContent) {
      throw new Error('tool result content is missing');
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
  test('list organizations', async () => {
    const { callTool } = await setup();

    const result = await callTool({
      name: 'list_organizations',
      arguments: {},
    });

    expect(result).toEqual(mockOrgs);
  });

  test('get organization', async () => {
    const { callTool } = await setup();

    const firstOrg = mockOrgs[0]!;

    const result = await callTool({
      name: 'get_organization',
      arguments: {
        id: firstOrg.id,
      },
    });

    expect(result).toEqual(firstOrg);
  });

  test('list projects', async () => {
    const { callTool } = await setup();

    const result = await callTool({
      name: 'list_projects',
      arguments: {},
    });

    expect(result).toEqual(mockProjects);
  });

  test('get project', async () => {
    const { callTool } = await setup();
    const firstProject = mockProjects[0]!;
    const result = await callTool({
      name: 'get_project',
      arguments: {
        id: firstProject.id,
      },
    });

    expect(result).toEqual(firstProject);
  });

  test('create project', async () => {
    const { callTool } = await setup();

    const newProject = {
      name: 'New Project',
      region: 'us-east-1',
      organization_id: mockOrgs[0]!.id,
      db_pass: 'dummy-password',
    };

    const result = await callTool({
      name: 'create_project',
      arguments: newProject,
    });

    const { db_pass, ...projectInfo } = newProject;

    expect(result).toEqual({
      ...projectInfo,
      id: expect.stringMatching(/^project-\d+$/),
      created_at: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
      ),
      status: 'UNKNOWN',
    });
  });

  test('create project chooses closest region when undefined', async () => {
    const { callTool } = await setup();

    const newProject = {
      name: 'New Project',
      organization_id: mockOrgs[0]!.id,
      db_pass: 'dummy-password',
    };

    const result = await callTool({
      name: 'create_project',
      arguments: newProject,
    });

    const { db_pass, ...projectInfo } = newProject;

    expect(result).toEqual({
      ...projectInfo,
      id: expect.stringMatching(/^project-\d+$/),
      created_at: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
      ),
      status: 'UNKNOWN',
      region: CLOSEST_REGION,
    });
  });

  test('get project url', async () => {
    const { callTool } = await setup();
    const project = mockProjects[0]!;
    const result = await callTool({
      name: 'get_project_url',
      arguments: {
        project_id: project.id,
      },
    });
    expect(result).toEqual(`https://${project.id}.supabase.co`);
  });

  test('get anon key', async () => {
    const { callTool } = await setup();
    const project = mockProjects[0]!;
    const result = await callTool({
      name: 'get_anon_key',
      arguments: {
        project_id: project.id,
      },
    });
    expect(result).toEqual('dummy-anon-key');
  });

  test('execute sql', async () => {
    const { callTool } = await setup();

    const project = mockProjects[0]!;
    const query = 'select 1+1 as sum';

    const result = await callTool({
      name: 'execute_sql',
      arguments: {
        project_id: project.id,
        query,
      },
    });

    expect(result).toEqual([{ sum: 2 }]);
  });

  test('apply migration, list migrations, check tables', async () => {
    const { callTool } = await setup();

    const project = mockProjects[0]!;
    const name = 'test_migration';
    const query =
      'create table test (id integer generated always as identity primary key)';

    const result = await callTool({
      name: 'apply_migration',
      arguments: {
        project_id: project.id,
        name,
        query,
      },
    });

    expect(result).toEqual([]);

    const listMigrationsResult = await callTool({
      name: 'list_migrations',
      arguments: {
        project_id: project.id,
      },
    });

    expect(listMigrationsResult).toEqual([
      {
        name,
        version: expect.stringMatching(/^\d{14}$/),
      },
    ]);

    const listTablesResult = await callTool({
      name: 'list_tables',
      arguments: {
        project_id: project.id,
        schemas: ['public'],
      },
    });

    expect(listTablesResult).toMatchInlineSnapshot(`
      [
        {
          "bytes": 8192,
          "columns": [
            {
              "check": null,
              "comment": null,
              "data_type": "integer",
              "default_value": null,
              "enums": [],
              "format": "int4",
              "id": "16385.1",
              "identity_generation": "ALWAYS",
              "is_generated": false,
              "is_identity": true,
              "is_nullable": false,
              "is_unique": false,
              "is_updatable": true,
              "name": "id",
              "ordinal_position": 1,
              "schema": "public",
              "table": "test",
              "table_id": 16385,
            },
          ],
          "comment": null,
          "dead_rows_estimate": 0,
          "id": 16385,
          "live_rows_estimate": 0,
          "name": "test",
          "primary_keys": [
            {
              "name": "id",
              "schema": "public",
              "table_id": 16385,
              "table_name": "test",
            },
          ],
          "relationships": [],
          "replica_identity": "DEFAULT",
          "rls_enabled": false,
          "rls_forced": false,
          "schema": "public",
          "size": "8192 bytes",
        },
      ]
    `);
  });

  test('list extensions', async () => {
    const { callTool } = await setup();

    const project = mockProjects[0]!;

    const result = await callTool({
      name: 'list_extensions',
      arguments: {
        project_id: project.id,
      },
    });

    expect(result).toMatchInlineSnapshot(`
      [
        {
          "comment": "PL/pgSQL procedural language",
          "default_version": "1.0",
          "installed_version": "1.0",
          "name": "plpgsql",
          "schema": "pg_catalog",
        },
      ]
    `);
  });

  test('invalid access token', async () => {
    const { callTool } = await setup({ accessToken: 'bad-token' });

    async function run() {
      return await callTool({
        name: 'list_organizations',
        arguments: {},
      });
    }

    await expect(run()).rejects.toThrow(
      'Unauthorized. Please provide a valid access token to the MCP server via the --access-token flag.'
    );
  });

  test('invalid sql for apply_migration', async () => {
    const { callTool } = await setup();

    const project = mockProjects[0]!;
    const name = 'test-migration';
    const query = 'invalid sql';

    async function run() {
      return await callTool({
        name: 'apply_migration',
        arguments: {
          project_id: project.id,
          name,
          query,
        },
      });
    }

    await expect(run()).rejects.toThrow('syntax error at or near "invalid"');
  });

  test('invalid sql for execute_sql', async () => {
    const { callTool } = await setup();

    const project = mockProjects[0]!;
    const query = 'invalid sql';

    async function run() {
      return await callTool({
        name: 'execute_sql',
        arguments: {
          project_id: project.id,
          query,
        },
      });
    }

    await expect(run()).rejects.toThrow('syntax error at or near "invalid"');
  });

  // We use snake_case because it aligns better with most MCP clients
  test('all tools follow snake_case naming convention', async () => {
    const { client } = await setup();

    const { tools } = await client.listTools();

    for (const tool of tools) {
      expect(tool.name, 'expected tool name to be snake_case').toMatch(
        /^[a-z0-9_]+$/
      );

      const parameterNames = Object.keys(tool.inputSchema.properties ?? {});
      for (const name of parameterNames) {
        expect(name, 'expected parameter to be snake_case').toMatch(
          /^[a-z0-9_]+$/
        );
      }
    }
  });
});
