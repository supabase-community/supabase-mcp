import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  CallToolResultSchema,
  type CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { StreamTransport } from '@supabase/mcp-utils';
import { setupServer } from 'msw/node';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  ACCESS_TOKEN,
  API_URL,
  createProject,
  MCP_CLIENT_NAME,
  MCP_CLIENT_VERSION,
  mockBranches,
  mockManagementApi,
  mockOrgs,
  mockProjects,
} from '../test/mocks.js';
import { createSupabaseMcpServer } from './server.js';

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

  const server = setupServer(...mockManagementApi);

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
