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
import { nanoid } from 'nanoid';
import { beforeEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { version } from '../package.json';
import type { components } from './management-api/types';
import { createSupabaseMcpServer } from './server.js';

type Project = components['schemas']['V1ProjectWithDatabaseResponse'];
type Organization = components['schemas']['OrganizationResponseV1'];
type Branch = components['schemas']['BranchResponse'];

const API_URL = 'https://api.supabase.com';
const MCP_SERVER_NAME = 'supabase-mcp';
const MCP_SERVER_VERSION = version;
const MCP_CLIENT_NAME = 'test-client';
const MCP_CLIENT_VERSION = '0.1.0';
const ACCESS_TOKEN = 'dummy-token';

type Migration = {
  version: string;
  name: string;
  query: string;
};

type MockProjectOptions = {
  name: string;
  region: string;
  organization_id: string;
};

class MockProject {
  id: string;
  organization_id: string;
  name: string;
  region: string;
  created_at: Date;
  status: Project['status'];
  database: {
    host: string;
    version: string;
    postgres_engine: string;
    release_channel: string;
  };

  migrations: Migration[] = [];

  #db: PGliteInterface;

  // Lazy load the database connection
  get db() {
    if (!this.#db) {
      this.#db = new PGlite();
    }
    return this.#db;
  }

  get details(): Project {
    return {
      id: this.id,
      organization_id: this.organization_id,
      name: this.name,
      region: this.region,
      created_at: this.created_at.toISOString(),
      status: this.status,
      database: this.database,
    };
  }

  constructor({ name, region, organization_id }: MockProjectOptions) {
    this.id = nanoid();

    this.name = name;
    this.region = region;
    this.organization_id = organization_id;

    this.created_at = new Date();
    this.status = 'UNKNOWN';
    this.database = {
      host: `db.${this.id}.supabase.co`,
      version: '15.1',
      postgres_engine: '15',
      release_channel: 'ga',
    };

    this.#db = new PGlite();
  }

  async applyMigrations() {
    for (const migration of this.migrations) {
      const [results] = await this.db.exec(migration.query);
      if (!results) {
        throw new Error(`Failed to execute migration ${migration.name}`);
      }
    }
  }

  async resetDb() {
    if (this.#db) {
      await this.#db.close();
    }
    this.#db = new PGlite();
    return this.#db;
  }

  async destroy() {
    if (this.#db) {
      await this.#db.close();
    }
  }
}

type MockBranchOptions = {
  name: string;
  project_ref: string;
  parent_project_ref: string;
  is_default: boolean;
};

class MockBranch {
  id: string;
  name: string;
  project_ref: string;
  parent_project_ref: string;
  is_default: boolean;
  persistent: boolean;
  status: Branch['status'];
  created_at: Date;
  updated_at: Date;

  get details(): Branch {
    return {
      id: this.id,
      name: this.name,
      project_ref: this.project_ref,
      parent_project_ref: this.parent_project_ref,
      is_default: this.is_default,
      persistent: this.persistent,
      status: this.status,
      created_at: this.created_at.toISOString(),
      updated_at: this.updated_at.toISOString(),
    };
  }

  constructor({
    name,
    project_ref,
    parent_project_ref,
    is_default,
  }: MockBranchOptions) {
    this.id = nanoid();
    this.name = name;
    this.project_ref = project_ref;
    this.parent_project_ref = parent_project_ref;
    this.is_default = is_default;
    this.persistent = false;
    this.status = 'CREATING_PROJECT';
    this.created_at = new Date();
    this.updated_at = new Date();
  }
}

const mockOrgs: Organization[] = [
  { id: 'org-1', name: 'Org 1' },
  { id: 'org-2', name: 'Org 2' },
];
const mockProjects = new Map<string, MockProject>();
const mockBranches = new Map<string, MockBranch>();

async function createProject(options: MockProjectOptions) {
  const project = new MockProject(options);
  const mainBranch = new MockBranch({
    name: 'main',
    project_ref: project.id,
    parent_project_ref: project.id,
    is_default: true,
  });

  mainBranch.status = 'MIGRATIONS_PASSED';

  mockProjects.set(project.id, project);
  mockBranches.set(mainBranch.id, mainBranch);

  // Change the project status to ACTIVE_HEALTHY after a delay
  setTimeout(async () => {
    project.status = 'ACTIVE_HEALTHY';
  }, 0);

  return project;
}

async function createBranch(options: {
  name: string;
  parent_project_ref: string;
}) {
  const parentProject = mockProjects.get(options.parent_project_ref);
  if (!parentProject) {
    throw new Error(`Project with id ${options.parent_project_ref} not found`);
  }

  const project = new MockProject({
    name: `${parentProject.name} - ${options.name}`,
    region: parentProject.region,
    organization_id: parentProject.organization_id,
  });

  const branch = new MockBranch({
    name: options.name,
    project_ref: project.id,
    parent_project_ref: options.parent_project_ref,
    is_default: false,
  });

  mockProjects.set(project.id, project);
  mockBranches.set(branch.id, branch);

  project.migrations = [...parentProject.migrations];

  // Run migrations on the new branch in the background
  setTimeout(async () => {
    try {
      await project.applyMigrations();
      branch.status = 'MIGRATIONS_PASSED';
    } catch (error) {
      branch.status = 'MIGRATIONS_FAILED';
      console.error('Migration error:', error);
    }
  }, 0);

  return branch;
}

beforeEach(() => {
  mockProjects.clear();
  mockBranches.clear();

  createProject({
    name: 'Project 1',
    region: 'us-east-1',
    organization_id: 'org-1',
  });
  createProject({
    name: 'Project 2',
    region: 'us-west-2',
    organization_id: 'org-2',
  });

  // Mock the management API
  const handlers = [
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
      return HttpResponse.json(
        Array.from(mockProjects.values()).map((project) => project.details)
      );
    }),

    http.get<{ projectId: string }>(
      `${API_URL}/v1/projects/:projectId`,
      ({ params }) => {
        const project = mockProjects.get(params.projectId);
        if (!project) {
          return HttpResponse.json(
            { error: 'Project not found' },
            { status: 404 }
          );
        }
        return HttpResponse.json(project.details);
      }
    ),

    http.post(`${API_URL}/v1/projects`, async ({ request }) => {
      const bodySchema = z.object({
        name: z.string(),
        region: z.string(),
        organization_id: z.string(),
        db_pass: z.string(),
      });
      const body = await request.json();
      const { name, region, organization_id } = bodySchema.parse(body);

      const project = await createProject({
        name,
        region,
        organization_id,
      });

      const { database, ...projectResponse } = project.details;

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
        const project = mockProjects.get(params.projectId);
        if (!project) {
          return HttpResponse.json(
            { error: 'Project not found' },
            { status: 404 }
          );
        }
        const { db } = project;
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
        const project = mockProjects.get(params.projectId);
        if (!project) {
          return HttpResponse.json(
            { error: 'Project not found' },
            { status: 404 }
          );
        }

        const { migrations } = project;
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
        const project = mockProjects.get(params.projectId);
        if (!project) {
          return HttpResponse.json(
            { error: 'Project not found' },
            { status: 404 }
          );
        }
        const { db, migrations } = project;
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

    http.post<{ projectId: string }, { branch_name: string }>(
      `${API_URL}/v1/projects/:projectId/branches`,
      async ({ params, request }) => {
        const { branch_name } = await request.json();

        const project = mockProjects.get(params.projectId);
        if (!project) {
          return HttpResponse.json(
            { error: 'Project not found' },
            { status: 404 }
          );
        }

        const branch = await createBranch({
          name: branch_name,
          parent_project_ref: project.id,
        });

        return HttpResponse.json(branch.details);
      }
    ),

    http.get<{ projectId: string }>(
      `${API_URL}/v1/projects/:projectId/branches`,
      async ({ params }) => {
        const projectBranches = Array.from(mockBranches.values()).filter(
          (branch) => branch.parent_project_ref === params.projectId
        );

        return HttpResponse.json(
          projectBranches.map((branch) => branch.details)
        );
      }
    ),

    http.delete<{ branchId: string }>(
      `${API_URL}/v1/branches/:branchId`,
      async ({ params }) => {
        const branch = mockBranches.get(params.branchId);

        if (!branch) {
          return HttpResponse.json(
            { error: 'Branch not found' },
            { status: 404 }
          );
        }

        const project = mockProjects.get(branch.project_ref);
        if (!project) {
          return HttpResponse.json(
            { error: 'Project not found' },
            { status: 404 }
          );
        }

        await project.destroy();
        mockProjects.delete(project.id);
        mockBranches.delete(branch.id);

        return HttpResponse.json({ message: 'ok' });
      }
    ),

    // Merges migrations from a development branch to production
    http.post<{ branchId: string }>(
      `${API_URL}/v1/branches/:branchId/merge`,
      async ({ params }) => {
        const branch = mockBranches.get(params.branchId);
        if (!branch) {
          return HttpResponse.json(
            { error: 'Branch not found' },
            { status: 404 }
          );
        }

        const parentProject = mockProjects.get(branch.parent_project_ref);
        if (!parentProject) {
          return HttpResponse.json(
            { error: 'Parent project not found' },
            { status: 404 }
          );
        }

        const project = mockProjects.get(branch.project_ref);
        if (!project) {
          return HttpResponse.json(
            { error: 'Project not found' },
            { status: 404 }
          );
        }

        // Simulate merge by resetting the parent DB and running branch migrations
        parentProject.migrations = [...project.migrations];
        await parentProject.resetDb();
        try {
          await parentProject.applyMigrations();
        } catch (error) {
          return HttpResponse.json(
            { error: 'Failed to apply migrations' },
            { status: 500 }
          );
        }

        const migration_version = parentProject.migrations.at(-1)?.version;

        return HttpResponse.json({ migration_version });
      }
    ),

    // Resets a branch and re-runs migrations
    http.post<{ branchId: string }>(
      `${API_URL}/v1/branches/:branchId/reset`,
      async ({ params }) => {
        const branch = mockBranches.get(params.branchId);
        if (!branch) {
          return HttpResponse.json(
            { error: 'Branch not found' },
            { status: 404 }
          );
        }

        const project = mockProjects.get(branch.project_ref);
        if (!project) {
          return HttpResponse.json(
            { error: 'Project not found' },
            { status: 404 }
          );
        }

        // Reset the DB a re-run migrations
        await project.resetDb();
        try {
          await project.applyMigrations();
          branch.status = 'MIGRATIONS_PASSED';
        } catch (error) {
          branch.status = 'MIGRATIONS_FAILED';
          return HttpResponse.json(
            { error: 'Failed to apply migrations' },
            { status: 500 }
          );
        }

        const migration_version = project.migrations.at(-1)?.version;

        return HttpResponse.json({ migration_version });
      }
    ),

    // Rebase migrations from production on a development branch
    http.post<{ branchId: string }>(
      `${API_URL}/v1/branches/:branchId/push`,
      async ({ params }) => {
        const branch = mockBranches.get(params.branchId);
        if (!branch) {
          return HttpResponse.json(
            { error: 'Branch not found' },
            { status: 404 }
          );
        }

        const parentProject = mockProjects.get(branch.parent_project_ref);
        if (!parentProject) {
          return HttpResponse.json(
            { error: 'Parent project not found' },
            { status: 404 }
          );
        }

        const project = mockProjects.get(branch.project_ref);
        if (!project) {
          return HttpResponse.json(
            { error: 'Project not found' },
            { status: 404 }
          );
        }

        // Simulate rebase by resetting the branch DB and running production migrations
        project.migrations = [...parentProject.migrations];
        await project.resetDb();
        try {
          await project.applyMigrations();
          branch.status = 'MIGRATIONS_PASSED';
        } catch (error) {
          branch.status = 'MIGRATIONS_FAILED';
          return HttpResponse.json(
            { error: 'Failed to apply migrations' },
            { status: 500 }
          );
        }

        const migration_version = project.migrations.at(-1)?.version;

        return HttpResponse.json({ migration_version });
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

  server.listen({
    onUnhandledRequest: (request) => {
      throw new Error(
        `No request handler found for ${request.method} ${request.url}`
      );
    },
  });
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

    expect(result).toEqual(
      Array.from(mockProjects.values()).map((project) => project.details)
    );
  });

  test('get project', async () => {
    const { callTool } = await setup();
    const firstProject = mockProjects.values().next().value!;
    const result = await callTool({
      name: 'get_project',
      arguments: {
        id: firstProject.id,
      },
    });

    expect(result).toEqual(firstProject.details);
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
      id: expect.stringMatching(/^.+$/),
      created_at: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
      ),
      status: 'UNKNOWN',
    });
  });

  test('get project url', async () => {
    const { callTool } = await setup();
    const project = mockProjects.values().next().value!;
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
    const project = mockProjects.values().next().value!;
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

    const project = mockProjects.values().next().value!;
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

    const project = mockProjects.values().next().value!;
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

    const project = mockProjects.values().next().value!;

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

    const project = mockProjects.values().next().value!;
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

    const project = mockProjects.values().next().value!;
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

  test('create branch', async () => {
    const { callTool } = await setup();
    const project = mockProjects.values().next().value!;
    const branchName = 'test-branch';
    const result = await callTool({
      name: 'create_branch',
      arguments: {
        project_id: project.id,
        name: branchName,
      },
    });

    expect(result).toEqual({
      id: expect.stringMatching(/^.+$/),
      name: branchName,
      project_ref: expect.stringMatching(/^.+$/),
      parent_project_ref: project.id,
      is_default: false,
      persistent: false,
      status: 'CREATING_PROJECT',
      created_at: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
      ),
      updated_at: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
      ),
    });
  });

  test('list branches', async () => {
    const { callTool } = await setup();
    const project = mockProjects.values().next().value!;
    const result = await callTool({
      name: 'list_branches',
      arguments: {
        project_id: project.id,
      },
    });

    expect(result).toEqual(
      Array.from(mockBranches.values())
        .filter((branch) => branch.parent_project_ref === project.id)
        .map((branch) => branch.details)
    );
  });

  test('merge branch', async () => {
    const { callTool } = await setup();
    const project = mockProjects.values().next().value!;

    const branch = await callTool({
      name: 'create_branch',
      arguments: {
        project_id: project.id,
        name: 'test-branch',
      },
    });

    const migrationName = 'sample_migration';
    const migrationQuery =
      'create table sample (id integer generated always as identity primary key)';
    await callTool({
      name: 'apply_migration',
      arguments: {
        project_id: branch.project_ref,
        name: migrationName,
        query: migrationQuery,
      },
    });

    const mergeResult = await callTool({
      name: 'merge_branch',
      arguments: {
        branch_id: branch.id,
      },
    });

    expect(mergeResult).toEqual({
      migration_version: expect.stringMatching(/^\d{14}$/),
    });

    // Check that the migration was applied to the parent project
    const listResult = await callTool({
      name: 'list_migrations',
      arguments: {
        project_id: project.id,
      },
    });

    expect(listResult).toContainEqual({
      name: migrationName,
      version: expect.stringMatching(/^\d{14}$/),
    });
  });

  test('reset branch', async () => {
    const { callTool } = await setup();
    const project = mockProjects.values().next().value!;
    const branch = await callTool({
      name: 'create_branch',
      arguments: {
        project_id: project.id,
        name: 'test-branch',
      },
    });

    // Create a table via execute_sql so that it is untracked
    const query =
      'create table test_untracked (id integer generated always as identity primary key)';
    await callTool({
      name: 'execute_sql',
      arguments: {
        project_id: branch.project_ref,
        query,
      },
    });

    const firstTablesResult = await callTool({
      name: 'list_tables',
      arguments: {
        project_id: branch.project_ref,
      },
    });

    expect(firstTablesResult).toContainEqual(
      expect.objectContaining({ name: 'test_untracked' })
    );

    await callTool({
      name: 'reset_branch',
      arguments: {
        branch_id: branch.id,
      },
    });

    const secondTablesResult = await callTool({
      name: 'list_tables',
      arguments: {
        project_id: branch.project_ref,
      },
    });

    // Expect the untracked table to be removed after reset
    expect(secondTablesResult).not.toContainEqual(
      expect.objectContaining({ name: 'test_untracked' })
    );
  });

  test('rebase branch', async () => {
    const { callTool } = await setup();
    const project = mockProjects.values().next().value!;
    const branch = await callTool({
      name: 'create_branch',
      arguments: {
        project_id: project.id,
        name: 'test-branch',
      },
    });

    const migrationName = 'sample_migration';
    const migrationQuery =
      'create table sample (id integer generated always as identity primary key)';
    await callTool({
      name: 'apply_migration',
      arguments: {
        project_id: project.id,
        name: migrationName,
        query: migrationQuery,
      },
    });

    const rebaseResult = await callTool({
      name: 'rebase_branch',
      arguments: {
        branch_id: branch.id,
      },
    });

    expect(rebaseResult).toEqual({
      migration_version: expect.stringMatching(/^\d{14}$/),
    });

    // Check that the production migration was applied to the branch
    const listResult = await callTool({
      name: 'list_migrations',
      arguments: {
        project_id: branch.project_ref,
      },
    });

    expect(listResult).toContainEqual({
      name: migrationName,
      version: expect.stringMatching(/^\d{14}$/),
    });
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
