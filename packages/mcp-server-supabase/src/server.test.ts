import { PGlite, type PGliteInterface } from '@electric-sql/pglite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamTransport } from '@supabase/mcp-utils';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { beforeEach, describe, expect, test } from 'vitest';
import type { components } from './management-api/types';
import { createSupabaseMcpServer } from './server.js';

type Project = components['schemas']['V1ProjectWithDatabaseResponse'];
type Organization = components['schemas']['OrganizationResponseV1'];

const API_URL = 'https://api.supabase.com';

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
      host: 'db.supabase.com',
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
      host: 'db.supabase.com',
      version: '15.1',
      postgres_engine: '15',
      release_channel: 'ga',
    },
  },
];

beforeEach(() => {
  // Mock databases using PGlite
  const projectDbs = new Map<string, PGliteInterface>();
  function getDb(projectId: string) {
    if (!mockProjects.find((p) => p.id === projectId)) {
      throw new Error(`Project ${projectId} not found`);
    }
    let db = projectDbs.get(projectId);
    if (!db) {
      db = new PGlite();
      projectDbs.set(projectId, db);
    }
    return db;
  }

  // Mock the management API
  const handlers = [
    http.get(`${API_URL}/v1/projects`, () => {
      return HttpResponse.json(mockProjects);
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
        const db = getDb(params.projectId);
        const { query } = await request.json();
        const [results] = await db.exec(query);

        if (!results) {
          return HttpResponse.json({ error: 'No results' }, { status: 404 });
        }

        return HttpResponse.json(results.rows);
      }
    ),

    http.post<{ projectId: string }, { name: string; query: string }>(
      `${API_URL}/v1/projects/:projectId/database/migrations`,
      async ({ params, request }) => {
        const db = getDb(params.projectId);
        const { query } = await request.json();
        const [results] = await db.exec(query);

        if (!results) {
          return HttpResponse.json({ error: 'No results' }, { status: 404 });
        }

        return HttpResponse.json(results.rows);
      }
    ),
  ];

  const server = setupServer(...handlers);

  server.listen({
    onUnhandledRequest: (request) => {
      throw new Error(
        `No request handler found for ${request.method} ${request.url}`
      );
    },
  });
});

/**
 * Sets up an MCP client and server for testing.
 */
async function setup() {
  const clientTransport = new StreamTransport();
  const serverTransport = new StreamTransport();

  clientTransport.readable.pipeTo(serverTransport.writable);
  serverTransport.readable.pipeTo(clientTransport.writable);

  const client = new Client(
    {
      name: 'TestClient',
      version: '0.1.0',
    },
    {
      capabilities: {},
    }
  );

  const server = createSupabaseMcpServer({
    platform: {
      apiUrl: API_URL,
      accessToken: 'dummy-token',
    },
  });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, clientTransport, server, serverTransport };
}

describe('tools', () => {
  test('get organizations', async () => {
    const { client } = await setup();

    const output = await client.callTool({
      name: 'get_organizations',
      arguments: {},
    });

    const [content] = output.content as any[];
    if (!content) {
      throw new Error('no content');
    }

    const result = JSON.parse(content.text);
    if (output.isError) {
      throw new Error(`Error calling tool: ${result}`);
    }

    expect(result).toEqual(mockOrgs);
  });

  test('get organization', async () => {
    const { client } = await setup();

    const firstOrg = mockOrgs[0]!;

    const output = await client.callTool({
      name: 'get_organization',
      arguments: {
        id: firstOrg.id,
      },
    });

    const [content] = output.content as any[];
    if (!content) {
      throw new Error('no content');
    }

    const result = JSON.parse(content.text);
    if (output.isError) {
      throw new Error(`Error calling tool: ${result}`);
    }

    expect(result).toEqual(firstOrg);
  });

  test('get projects', async () => {
    const { client } = await setup();

    const output = await client.callTool({
      name: 'get_projects',
      arguments: {},
    });

    const [content] = output.content as any[];

    if (!content) {
      throw new Error('no content');
    }

    const result = JSON.parse(content.text);

    if (output.isError) {
      throw new Error(`Error calling tool: ${result}`);
    }

    expect(result).toEqual(mockProjects);
  });

  test('get project url', async () => {
    const { client } = await setup();
    const project = mockProjects[0]!;
    const output = await client.callTool({
      name: 'get_project_url',
      arguments: {
        projectId: project.id,
      },
    });
    const [content] = output.content as any[];
    if (!content) {
      throw new Error('no content');
    }
    const result = JSON.parse(content.text);
    if (output.isError) {
      throw new Error(`Error calling tool: ${result.error.message}`);
    }
    expect(result).toEqual(`https://${project.id}.supabase.co`);
  });

  test('get anon key', async () => {
    const { client } = await setup();
    const project = mockProjects[0]!;
    const output = await client.callTool({
      name: 'get_anon_key',
      arguments: {
        projectId: project.id,
      },
    });
    const [content] = output.content as any[];
    if (!content) {
      throw new Error('no content');
    }

    const result = JSON.parse(content.text);
    if (output.isError) {
      throw new Error(`Error calling tool: ${result.error.message}`);
    }
    expect(result).toEqual('dummy-anon-key');
  });

  test('execute sql', async () => {
    const { client } = await setup();

    const project = mockProjects[0]!;
    const query = 'select 1+1 as sum';

    const output = await client.callTool({
      name: 'execute_sql',
      arguments: {
        projectId: project.id,
        query,
      },
    });

    const [content] = output.content as any[];

    if (!content) {
      throw new Error('no content');
    }

    const result = JSON.parse(content.text);

    if (output.isError) {
      throw new Error(`Error calling tool: ${result}`);
    }

    expect(result).toEqual([{ sum: 2 }]);
  });

  test('apply migration', async () => {
    const { client } = await setup();

    const project = mockProjects[0]!;
    const name = 'test-migration';
    const query =
      'create table test (id integer generated always as identity primary key)';

    const output = await client.callTool({
      name: 'apply_migration',
      arguments: {
        projectId: project.id,
        name,
        query,
      },
    });

    const [content] = output.content as any[];

    if (!content) {
      throw new Error('no content');
    }

    const result = JSON.parse(content.text);

    if (output.isError) {
      throw new Error(`Error calling tool: ${result}`);
    }

    expect(result).toEqual([]);

    const listOutput = await client.callTool({
      name: 'get_tables',
      arguments: {
        projectId: project.id,
        schemas: ['public'],
      },
    });

    const [listContent] = listOutput.content as any[];
    if (!listContent) {
      throw new Error('no content');
    }

    const listResult = JSON.parse(listContent.text);
    if (listOutput.isError) {
      throw new Error(`Error calling tool: ${listResult}`);
    }
    expect(listResult).toMatchInlineSnapshot(`
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
});
