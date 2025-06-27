import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  CallToolResultSchema,
  type CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { StreamTransport } from '@supabase/mcp-utils';
import { codeBlock, stripIndent } from 'common-tags';
import { setupServer } from 'msw/node';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  ACCESS_TOKEN,
  API_URL,
  CLOSEST_REGION,
  contentApiMockSchema,
  createOrganization,
  createProject,
  MCP_CLIENT_NAME,
  MCP_CLIENT_VERSION,
  mockBranches,
  mockContentApi,
  mockManagementApi,
  mockOrgs,
  mockProjects,
} from '../test/mocks.js';
import { createSupabaseApiPlatform } from './platform/api-platform.js';
import { BRANCH_COST_HOURLY, PROJECT_COST_MONTHLY } from './pricing.js';
import { createSupabaseMcpServer } from './server.js';
import type { SupabasePlatform } from './platform/types.js';

beforeEach(async () => {
  mockOrgs.clear();
  mockProjects.clear();
  mockBranches.clear();

  const server = setupServer(...mockContentApi, ...mockManagementApi);
  server.listen({ onUnhandledRequest: 'error' });
});

type SetupOptions = {
  accessToken?: string;
  projectId?: string;
  platform?: SupabasePlatform;
  readOnly?: boolean;
  features?: string[];
};

/**
 * Sets up an MCP client and server for testing.
 */
async function setup(options: SetupOptions = {}) {
  const { accessToken = ACCESS_TOKEN, projectId, readOnly, features } = options;
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

  const platform =
    options.platform ??
    createSupabaseApiPlatform({
      accessToken,
      apiUrl: API_URL,
    });

  const server = createSupabaseMcpServer({
    platform,
    projectId,
    readOnly,
    features,
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
      return undefined;
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

    const org1 = await createOrganization({
      name: 'Org 1',
      plan: 'free',
      allowed_release_channels: ['ga'],
    });
    const org2 = await createOrganization({
      name: 'Org 2',
      plan: 'free',
      allowed_release_channels: ['ga'],
    });

    const result = await callTool({
      name: 'list_organizations',
      arguments: {},
    });

    expect(result).toEqual([
      { id: org1.id, name: org1.name },
      { id: org2.id, name: org2.name },
    ]);
  });

  test('get organization', async () => {
    const { callTool } = await setup();

    const org = await createOrganization({
      name: 'My Org',
      plan: 'free',
      allowed_release_channels: ['ga'],
    });

    const result = await callTool({
      name: 'get_organization',
      arguments: {
        id: org.id,
      },
    });

    expect(result).toEqual(org);
  });

  test('get next project cost for free org', async () => {
    const { callTool } = await setup();

    const freeOrg = await createOrganization({
      name: 'Free Org',
      plan: 'free',
      allowed_release_channels: ['ga'],
    });

    const result = await callTool({
      name: 'get_cost',
      arguments: {
        type: 'project',
        organization_id: freeOrg.id,
      },
    });

    expect(result).toEqual(
      'The new project will cost $0 monthly. You must repeat this to the user and confirm their understanding.'
    );
  });

  test('get next project cost for paid org with 0 projects', async () => {
    const { callTool } = await setup();

    const paidOrg = await createOrganization({
      name: 'Paid Org',
      plan: 'pro',
      allowed_release_channels: ['ga'],
    });

    const result = await callTool({
      name: 'get_cost',
      arguments: {
        type: 'project',
        organization_id: paidOrg.id,
      },
    });

    expect(result).toEqual(
      'The new project will cost $0 monthly. You must repeat this to the user and confirm their understanding.'
    );
  });

  test('get next project cost for paid org with > 0 active projects', async () => {
    const { callTool } = await setup();

    const paidOrg = await createOrganization({
      name: 'Paid Org',
      plan: 'pro',
      allowed_release_channels: ['ga'],
    });

    const priorProject = await createProject({
      name: 'Project 1',
      region: 'us-east-1',
      organization_id: paidOrg.id,
    });
    priorProject.status = 'ACTIVE_HEALTHY';

    const result = await callTool({
      name: 'get_cost',
      arguments: {
        type: 'project',
        organization_id: paidOrg.id,
      },
    });

    expect(result).toEqual(
      `The new project will cost $${PROJECT_COST_MONTHLY} monthly. You must repeat this to the user and confirm their understanding.`
    );
  });

  test('get next project cost for paid org with > 0 inactive projects', async () => {
    const { callTool } = await setup();

    const paidOrg = await createOrganization({
      name: 'Paid Org',
      plan: 'pro',
      allowed_release_channels: ['ga'],
    });

    const priorProject = await createProject({
      name: 'Project 1',
      region: 'us-east-1',
      organization_id: paidOrg.id,
    });
    priorProject.status = 'INACTIVE';

    const result = await callTool({
      name: 'get_cost',
      arguments: {
        type: 'project',
        organization_id: paidOrg.id,
      },
    });

    expect(result).toEqual(
      `The new project will cost $0 monthly. You must repeat this to the user and confirm their understanding.`
    );
  });

  test('get branch cost', async () => {
    const { callTool } = await setup();

    const paidOrg = await createOrganization({
      name: 'Paid Org',
      plan: 'pro',
      allowed_release_channels: ['ga'],
    });

    const result = await callTool({
      name: 'get_cost',
      arguments: {
        type: 'branch',
        organization_id: paidOrg.id,
      },
    });

    expect(result).toEqual(
      `The new branch will cost $${BRANCH_COST_HOURLY} hourly. You must repeat this to the user and confirm their understanding.`
    );
  });

  test('list projects', async () => {
    const { callTool } = await setup();

    const org = await createOrganization({
      name: 'My Org',
      plan: 'free',
      allowed_release_channels: ['ga'],
    });

    const project1 = await createProject({
      name: 'Project 1',
      region: 'us-east-1',
      organization_id: org.id,
    });

    const project2 = await createProject({
      name: 'Project 2',
      region: 'us-east-1',
      organization_id: org.id,
    });

    const result = await callTool({
      name: 'list_projects',
      arguments: {},
    });

    expect(result).toEqual([project1.details, project2.details]);
  });

  test('get project', async () => {
    const { callTool } = await setup();

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

    const result = await callTool({
      name: 'get_project',
      arguments: {
        id: project.id,
      },
    });

    expect(result).toEqual(project.details);
  });

  test('create project', async () => {
    const { callTool } = await setup();

    const freeOrg = await createOrganization({
      name: 'Free Org',
      plan: 'free',
      allowed_release_channels: ['ga'],
    });

    const confirm_cost_id = await callTool({
      name: 'confirm_cost',
      arguments: {
        type: 'project',
        recurrence: 'monthly',
        amount: 0,
      },
    });

    const newProject = {
      name: 'New Project',
      region: 'us-east-1',
      organization_id: freeOrg.id,
      confirm_cost_id,
    };

    const result = await callTool({
      name: 'create_project',
      arguments: newProject,
    });

    const { confirm_cost_id: _, ...projectInfo } = newProject;

    expect(result).toEqual({
      ...projectInfo,
      id: expect.stringMatching(/^.+$/),
      created_at: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
      ),
      status: 'UNKNOWN',
    });
  });

  test('create project chooses closest region when undefined', async () => {
    const { callTool } = await setup();

    const freeOrg = await createOrganization({
      name: 'Free Org',
      plan: 'free',
      allowed_release_channels: ['ga'],
    });

    const confirm_cost_id = await callTool({
      name: 'confirm_cost',
      arguments: {
        type: 'project',
        recurrence: 'monthly',
        amount: 0,
      },
    });

    const newProject = {
      name: 'New Project',
      organization_id: freeOrg.id,
      confirm_cost_id,
    };

    const result = await callTool({
      name: 'create_project',
      arguments: newProject,
    });

    const { confirm_cost_id: _, ...projectInfo } = newProject;

    expect(result).toEqual({
      ...projectInfo,
      id: expect.stringMatching(/^.+$/),
      created_at: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
      ),
      status: 'UNKNOWN',
      region: CLOSEST_REGION,
    });
  });

  test('create project without cost confirmation fails', async () => {
    const { callTool } = await setup();

    const org = await createOrganization({
      name: 'Paid Org',
      plan: 'pro',
      allowed_release_channels: ['ga'],
    });

    const newProject = {
      name: 'New Project',
      region: 'us-east-1',
      organization_id: org.id,
    };

    const createProjectPromise = callTool({
      name: 'create_project',
      arguments: newProject,
    });

    await expect(createProjectPromise).rejects.toThrow(
      'User must confirm understanding of costs before creating a project.'
    );
  });

  test('pause project', async () => {
    const { callTool } = await setup();

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

    await callTool({
      name: 'pause_project',
      arguments: {
        project_id: project.id,
      },
    });

    expect(project.status).toEqual('INACTIVE');
  });

  test('restore project', async () => {
    const { callTool } = await setup();

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
    project.status = 'INACTIVE';

    await callTool({
      name: 'restore_project',
      arguments: {
        project_id: project.id,
      },
    });

    expect(project.status).toEqual('ACTIVE_HEALTHY');
  });

  test('get project url', async () => {
    const { callTool } = await setup();

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

    const result = await callTool({
      name: 'get_anon_key',
      arguments: {
        project_id: project.id,
      },
    });
    expect(result).toEqual('dummy-anon-key');
  });

  test('list storage buckets', async () => {
    const { callTool } = await setup({ features: ['storage'] });

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

    project.createStorageBucket('bucket1', true);
    project.createStorageBucket('bucket2', false);

    const result = await callTool({
      name: 'list_storage_buckets',
      arguments: {
        project_id: project.id,
      },
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    expect(result[0]).toEqual(
      expect.objectContaining({
        name: 'bucket1',
        public: true,
        created_at: expect.any(String),
        updated_at: expect.any(String),
      })
    );
    expect(result[1]).toEqual(
      expect.objectContaining({
        name: 'bucket2',
        public: false,
        created_at: expect.any(String),
        updated_at: expect.any(String),
      })
    );
  });

  test('get storage config', async () => {
    const { callTool } = await setup({ features: ['storage'] });

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

    const result = await callTool({
      name: 'get_storage_config',
      arguments: {
        project_id: project.id,
      },
    });

    expect(result).toEqual({
      fileSizeLimit: expect.any(Number),
      features: {
        imageTransformation: { enabled: expect.any(Boolean) },
        s3Protocol: { enabled: expect.any(Boolean) },
      },
    });
  });

  test('update storage config', async () => {
    const { callTool } = await setup({ features: ['storage'] });

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

    const config = {
      fileSizeLimit: 50,
      features: {
        imageTransformation: { enabled: true },
        s3Protocol: { enabled: false },
      },
    };

    const result = await callTool({
      name: 'update_storage_config',
      arguments: {
        project_id: project.id,
        config,
      },
    });

    expect(result).toEqual({ success: true });
  });

  test('execute sql', async () => {
    const { callTool } = await setup();

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

    const query = 'select 1+1 as sum';

    const result = await callTool({
      name: 'execute_sql',
      arguments: {
        project_id: project.id,
        query,
      },
    });

    expect(result).toContain('untrusted user data');
    expect(result).toMatch(/<untrusted-data-\w{8}-\w{4}-\w{4}-\w{4}-\w{12}>/);
    expect(result).toContain(JSON.stringify([{ sum: 2 }]));
    expect(result).toMatch(/<\/untrusted-data-\w{8}-\w{4}-\w{4}-\w{4}-\w{12}>/);
  });

  test('can run read queries in read-only mode', async () => {
    const { callTool } = await setup({ readOnly: true });

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

    const query = 'select 1+1 as sum';

    const result = await callTool({
      name: 'execute_sql',
      arguments: {
        project_id: project.id,
        query,
      },
    });

    expect(result).toContain('untrusted user data');
    expect(result).toMatch(/<untrusted-data-\w{8}-\w{4}-\w{4}-\w{4}-\w{12}>/);
    expect(result).toContain(JSON.stringify([{ sum: 2 }]));
    expect(result).toMatch(/<\/untrusted-data-\w{8}-\w{4}-\w{4}-\w{4}-\w{12}>/);
  });

  test('cannot run write queries in read-only mode', async () => {
    const { callTool } = await setup({ readOnly: true });

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

    const query =
      'create table test (id integer generated always as identity primary key)';

    const resultPromise = callTool({
      name: 'execute_sql',
      arguments: {
        project_id: project.id,
        query,
      },
    });

    await expect(resultPromise).rejects.toThrow(
      'permission denied for schema public'
    );
  });

  test('apply migration, list migrations, check tables', async () => {
    const { callTool } = await setup();

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

    expect(result).toEqual({ success: true });

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

    expect(listTablesResult).toEqual([
      {
        bytes: 8192,
        columns: [
          {
            check: null,
            comment: null,
            data_type: 'integer',
            default_value: null,
            enums: [],
            format: 'int4',
            id: expect.stringMatching(/^\d+\.\d+$/),
            identity_generation: 'ALWAYS',
            is_generated: false,
            is_identity: true,
            is_nullable: false,
            is_unique: false,
            is_updatable: true,
            name: 'id',
            ordinal_position: 1,
            schema: 'public',
            table: 'test',
            table_id: expect.any(Number),
          },
        ],
        comment: null,
        dead_rows_estimate: 0,
        id: expect.any(Number),
        live_rows_estimate: 0,
        name: 'test',
        primary_keys: [
          {
            name: 'id',
            schema: 'public',
            table_id: expect.any(Number),
            table_name: 'test',
          },
        ],
        relationships: [],
        replica_identity: 'DEFAULT',
        rls_enabled: false,
        rls_forced: false,
        schema: 'public',
        size: '8192 bytes',
      },
    ]);
  });

  test('cannot apply migration in read-only mode', async () => {
    const { callTool } = await setup({ readOnly: true });

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

    const name = 'test-migration';
    const query =
      'create table test (id integer generated always as identity primary key)';

    const resultPromise = callTool({
      name: 'apply_migration',
      arguments: {
        project_id: project.id,
        name,
        query,
      },
    });

    await expect(resultPromise).rejects.toThrow(
      'Cannot apply migration in read-only mode.'
    );
  });

  test('list tables only under a specific schema', async () => {
    const { callTool } = await setup();

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

    await project.db.exec('create schema test;');
    await project.db.exec(
      'create table public.test_1 (id serial primary key);'
    );
    await project.db.exec('create table test.test_2 (id serial primary key);');

    const result = await callTool({
      name: 'list_tables',
      arguments: {
        project_id: project.id,
        schemas: ['test'],
      },
    });

    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'test_2' })])
    );
    expect(result).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'test_1' })])
    );
  });

  test('listing all tables excludes system schemas', async () => {
    const { callTool } = await setup();

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

    const result = await callTool({
      name: 'list_tables',
      arguments: {
        project_id: project.id,
      },
    });

    expect(result).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ schema: 'pg_catalog' }),
      ])
    );

    expect(result).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ schema: 'information_schema' }),
      ])
    );

    expect(result).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ schema: 'pg_toast' })])
    );
  });

  test('list extensions', async () => {
    const { callTool } = await setup();

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

    const listOrganizationsPromise = callTool({
      name: 'list_organizations',
      arguments: {},
    });

    await expect(listOrganizationsPromise).rejects.toThrow('Unauthorized.');
  });

  test('invalid sql for apply_migration', async () => {
    const { callTool } = await setup();

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

    const name = 'test-migration';
    const query = 'invalid sql';

    const applyMigrationPromise = callTool({
      name: 'apply_migration',
      arguments: {
        project_id: project.id,
        name,
        query,
      },
    });

    await expect(applyMigrationPromise).rejects.toThrow(
      'syntax error at or near "invalid"'
    );
  });

  test('invalid sql for execute_sql', async () => {
    const { callTool } = await setup();

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

    const query = 'invalid sql';

    const executeSqlPromise = callTool({
      name: 'execute_sql',
      arguments: {
        project_id: project.id,
        query,
      },
    });

    await expect(executeSqlPromise).rejects.toThrow(
      'syntax error at or near "invalid"'
    );
  });

  test('get logs for each service type', async () => {
    const { callTool } = await setup();

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

    const services = [
      'api',
      'branch-action',
      'postgres',
      'edge-function',
      'auth',
      'storage',
      'realtime',
    ] as const;

    for (const service of services) {
      const result = await callTool({
        name: 'get_logs',
        arguments: {
          project_id: project.id,
          service,
        },
      });

      expect(result).toEqual([]);
    }
  });

  test('get security advisors', async () => {
    const { callTool } = await setup();

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

    const result = await callTool({
      name: 'get_advisors',
      arguments: {
        project_id: project.id,
        type: 'security',
      },
    });

    expect(result).toEqual({ lints: [] });
  });

  test('get performance advisors', async () => {
    const { callTool } = await setup();

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

    const result = await callTool({
      name: 'get_advisors',
      arguments: {
        project_id: project.id,
        type: 'performance',
      },
    });

    expect(result).toEqual({ lints: [] });
  });

  test('get logs for invalid service type', async () => {
    const { callTool } = await setup();

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

    const invalidService = 'invalid-service';
    const getLogsPromise = callTool({
      name: 'get_logs',
      arguments: {
        project_id: project.id,
        service: invalidService,
      },
    });
    await expect(getLogsPromise).rejects.toThrow('Invalid enum value');
  });

  test('list edge functions', async () => {
    const { callTool } = await setup();

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

    const indexContent = codeBlock`
      Deno.serve(async (req: Request) => {
        return new Response('Hello world!', { headers: { 'Content-Type': 'text/plain' } })
      });
    `;

    const edgeFunction = await project.deployEdgeFunction(
      {
        name: 'hello-world',
        entrypoint_path: 'index.ts',
      },
      [
        new File([indexContent], 'index.ts', {
          type: 'application/typescript',
        }),
      ]
    );

    const result = await callTool({
      name: 'list_edge_functions',
      arguments: {
        project_id: project.id,
      },
    });

    expect(result).toEqual([
      {
        id: edgeFunction.id,
        slug: edgeFunction.slug,
        version: edgeFunction.version,
        name: edgeFunction.name,
        status: edgeFunction.status,
        entrypoint_path: 'index.ts',
        import_map_path: undefined,
        import_map: false,
        verify_jwt: true,
        created_at: expect.stringMatching(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
        ),
        updated_at: expect.stringMatching(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
        ),
        files: [
          {
            name: 'index.ts',
            content: indexContent,
          },
        ],
      },
    ]);
  });

  test('deploy new edge function', async () => {
    const { callTool } = await setup();

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

    const functionName = 'hello-world';
    const functionCode = 'console.log("Hello, world!");';

    const result = await callTool({
      name: 'deploy_edge_function',
      arguments: {
        project_id: project.id,
        name: functionName,
        files: [
          {
            name: 'index.ts',
            content: functionCode,
          },
        ],
      },
    });

    expect(result).toEqual({
      id: expect.stringMatching(/^.+$/),
      slug: functionName,
      version: 1,
      name: functionName,
      status: 'ACTIVE',
      entrypoint_path: expect.stringMatching(/index\.ts$/),
      import_map_path: undefined,
      import_map: false,
      verify_jwt: true,
      created_at: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
      ),
      updated_at: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
      ),
    });
  });

  test('deploy new version of existing edge function', async () => {
    const { callTool } = await setup();
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

    const functionName = 'hello-world';

    const edgeFunction = await project.deployEdgeFunction(
      {
        name: functionName,
        entrypoint_path: 'index.ts',
      },
      [
        new File(['console.log("Hello, world!");'], 'index.ts', {
          type: 'application/typescript',
        }),
      ]
    );

    expect(edgeFunction.version).toEqual(1);

    const originalCreatedAt = edgeFunction.created_at.getTime();
    const originalUpdatedAt = edgeFunction.updated_at.getTime();

    const result = await callTool({
      name: 'deploy_edge_function',
      arguments: {
        project_id: project.id,
        name: functionName,
        files: [
          {
            name: 'index.ts',
            content: 'console.log("Hello, world! v2");',
          },
        ],
      },
    });

    expect(result).toEqual({
      id: edgeFunction.id,
      slug: functionName,
      version: 2,
      name: functionName,
      status: 'ACTIVE',
      entrypoint_path: expect.stringMatching(/index\.ts$/),
      import_map_path: undefined,
      import_map: false,
      verify_jwt: true,
      created_at: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
      ),
      updated_at: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
      ),
    });

    expect(new Date(result.created_at).getTime()).toEqual(originalCreatedAt);
    expect(new Date(result.updated_at).getTime()).toBeGreaterThan(
      originalUpdatedAt
    );
  });

  test('custom edge function import map', async () => {
    const { callTool } = await setup();

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

    const functionName = 'hello-world';
    const functionCode = 'console.log("Hello, world!");';

    const result = await callTool({
      name: 'deploy_edge_function',
      arguments: {
        project_id: project.id,
        name: functionName,
        import_map_path: 'custom-map.json',
        files: [
          {
            name: 'index.ts',
            content: functionCode,
          },
          {
            name: 'custom-map.json',
            content: '{}',
          },
        ],
      },
    });

    expect(result.import_map).toBe(true);
    expect(result.import_map_path).toMatch(/custom-map\.json$/);
  });

  test('default edge function import map to deno.json', async () => {
    const { callTool } = await setup();

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

    const functionName = 'hello-world';
    const functionCode = 'console.log("Hello, world!");';

    const result = await callTool({
      name: 'deploy_edge_function',
      arguments: {
        project_id: project.id,
        name: functionName,
        files: [
          {
            name: 'index.ts',
            content: functionCode,
          },
          {
            name: 'deno.json',
            content: '{}',
          },
        ],
      },
    });

    expect(result.import_map).toBe(true);
    expect(result.import_map_path).toMatch(/deno\.json$/);
  });

  test('default edge function import map to import_map.json', async () => {
    const { callTool } = await setup();

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

    const functionName = 'hello-world';
    const functionCode = 'console.log("Hello, world!");';

    const result = await callTool({
      name: 'deploy_edge_function',
      arguments: {
        project_id: project.id,
        name: functionName,
        files: [
          {
            name: 'index.ts',
            content: functionCode,
          },
          {
            name: 'import_map.json',
            content: '{}',
          },
        ],
      },
    });

    expect(result.import_map).toBe(true);
    expect(result.import_map_path).toMatch(/import_map\.json$/);
  });

  test('updating edge function with missing import_map_path defaults to previous value', async () => {
    const { callTool } = await setup();
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

    const functionName = 'hello-world';

    const edgeFunction = await project.deployEdgeFunction(
      {
        name: functionName,
        entrypoint_path: 'index.ts',
        import_map_path: 'custom-map.json',
      },
      [
        new File(['console.log("Hello, world!");'], 'index.ts', {
          type: 'application/typescript',
        }),
        new File(['{}'], 'custom-map.json', {
          type: 'application/json',
        }),
      ]
    );

    const result = await callTool({
      name: 'deploy_edge_function',
      arguments: {
        project_id: project.id,
        name: functionName,
        files: [
          {
            name: 'index.ts',
            content: 'console.log("Hello, world! v2");',
          },
          {
            name: 'custom-map.json',
            content: '{}',
          },
        ],
      },
    });

    expect(result.import_map).toBe(true);
    expect(result.import_map_path).toMatch(/custom-map\.json$/);
  });

  test('create branch', async () => {
    const { callTool } = await setup({
      features: ['account', 'branching'],
    });

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

    const confirm_cost_id = await callTool({
      name: 'confirm_cost',
      arguments: {
        type: 'branch',
        recurrence: 'hourly',
        amount: BRANCH_COST_HOURLY,
      },
    });

    const branchName = 'test-branch';
    const result = await callTool({
      name: 'create_branch',
      arguments: {
        project_id: project.id,
        name: branchName,
        confirm_cost_id,
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

  test('create branch without cost confirmation fails', async () => {
    const { callTool } = await setup({ features: ['branching'] });

    const org = await createOrganization({
      name: 'Paid Org',
      plan: 'pro',
      allowed_release_channels: ['ga'],
    });

    const project = await createProject({
      name: 'Project 1',
      region: 'us-east-1',
      organization_id: org.id,
    });
    project.status = 'ACTIVE_HEALTHY';

    const branchName = 'test-branch';
    const createBranchPromise = callTool({
      name: 'create_branch',
      arguments: {
        project_id: project.id,
        name: branchName,
      },
    });

    await expect(createBranchPromise).rejects.toThrow(
      'User must confirm understanding of costs before creating a branch.'
    );
  });

  test('delete branch', async () => {
    const { callTool } = await setup({
      features: ['account', 'branching'],
    });

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

    const confirm_cost_id = await callTool({
      name: 'confirm_cost',
      arguments: {
        type: 'branch',
        recurrence: 'hourly',
        amount: BRANCH_COST_HOURLY,
      },
    });

    const branch = await callTool({
      name: 'create_branch',
      arguments: {
        project_id: project.id,
        name: 'test-branch',
        confirm_cost_id,
      },
    });

    const listBranchesResult = await callTool({
      name: 'list_branches',
      arguments: {
        project_id: project.id,
      },
    });

    expect(listBranchesResult).toContainEqual(
      expect.objectContaining({ id: branch.id })
    );
    expect(listBranchesResult).toHaveLength(2);

    await callTool({
      name: 'delete_branch',
      arguments: {
        branch_id: branch.id,
      },
    });

    const listBranchesResultAfterDelete = await callTool({
      name: 'list_branches',
      arguments: {
        project_id: project.id,
      },
    });

    expect(listBranchesResultAfterDelete).not.toContainEqual(
      expect.objectContaining({ id: branch.id })
    );
    expect(listBranchesResultAfterDelete).toHaveLength(1);

    const mainBranch = listBranchesResultAfterDelete[0];

    const deleteBranchPromise = callTool({
      name: 'delete_branch',
      arguments: {
        branch_id: mainBranch.id,
      },
    });

    await expect(deleteBranchPromise).rejects.toThrow(
      'Cannot delete the default branch.'
    );
  });

  test('list branches', async () => {
    const { callTool } = await setup({ features: ['branching'] });

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

    const result = await callTool({
      name: 'list_branches',
      arguments: {
        project_id: project.id,
      },
    });

    expect(result).toStrictEqual([]);
  });

  test('merge branch', async () => {
    const { callTool } = await setup({
      features: ['account', 'branching', 'database'],
    });

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

    const confirm_cost_id = await callTool({
      name: 'confirm_cost',
      arguments: {
        type: 'branch',
        recurrence: 'hourly',
        amount: BRANCH_COST_HOURLY,
      },
    });

    const branch = await callTool({
      name: 'create_branch',
      arguments: {
        project_id: project.id,
        name: 'test-branch',
        confirm_cost_id,
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

    await callTool({
      name: 'merge_branch',
      arguments: {
        branch_id: branch.id,
      },
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
    const { callTool } = await setup({
      features: ['account', 'branching', 'database'],
    });

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

    const confirm_cost_id = await callTool({
      name: 'confirm_cost',
      arguments: {
        type: 'branch',
        recurrence: 'hourly',
        amount: BRANCH_COST_HOURLY,
      },
    });

    const branch = await callTool({
      name: 'create_branch',
      arguments: {
        project_id: project.id,
        name: 'test-branch',
        confirm_cost_id,
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

  test('revert migrations', async () => {
    const { callTool } = await setup({
      features: ['account', 'branching', 'database'],
    });

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

    const confirm_cost_id = await callTool({
      name: 'confirm_cost',
      arguments: {
        type: 'branch',
        recurrence: 'hourly',
        amount: BRANCH_COST_HOURLY,
      },
    });

    const branch = await callTool({
      name: 'create_branch',
      arguments: {
        project_id: project.id,
        name: 'test-branch',
        confirm_cost_id,
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

    // Check that migration has been applied to the branch
    const firstListResult = await callTool({
      name: 'list_migrations',
      arguments: {
        project_id: branch.project_ref,
      },
    });

    expect(firstListResult).toContainEqual({
      name: migrationName,
      version: expect.stringMatching(/^\d{14}$/),
    });

    const firstTablesResult = await callTool({
      name: 'list_tables',
      arguments: {
        project_id: branch.project_ref,
      },
    });

    expect(firstTablesResult).toContainEqual(
      expect.objectContaining({ name: 'sample' })
    );

    await callTool({
      name: 'reset_branch',
      arguments: {
        branch_id: branch.id,
        migration_version: '0',
      },
    });

    // Check that all migrations have been reverted
    const secondListResult = await callTool({
      name: 'list_migrations',
      arguments: {
        project_id: branch.project_ref,
      },
    });

    expect(secondListResult).toStrictEqual([]);

    const secondTablesResult = await callTool({
      name: 'list_tables',
      arguments: {
        project_id: branch.project_ref,
      },
    });

    expect(secondTablesResult).not.toContainEqual(
      expect.objectContaining({ name: 'sample' })
    );
  });

  test('rebase branch', async () => {
    const { callTool } = await setup({
      features: ['account', 'branching', 'database'],
    });

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

    const confirm_cost_id = await callTool({
      name: 'confirm_cost',
      arguments: {
        type: 'branch',
        recurrence: 'hourly',
        amount: BRANCH_COST_HOURLY,
      },
    });

    const branch = await callTool({
      name: 'create_branch',
      arguments: {
        project_id: project.id,
        name: 'test-branch',
        confirm_cost_id,
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

    await callTool({
      name: 'rebase_branch',
      arguments: {
        branch_id: branch.id,
      },
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

describe('feature groups', () => {
  test('account tools', async () => {
    const { client } = await setup({
      features: ['account'],
    });

    const { tools } = await client.listTools();
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toEqual([
      'list_organizations',
      'get_organization',
      'list_projects',
      'get_project',
      'get_cost',
      'confirm_cost',
      'create_project',
      'pause_project',
      'restore_project',
    ]);
  });

  test('database tools', async () => {
    const { client } = await setup({
      features: ['database'],
    });

    const { tools } = await client.listTools();
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toEqual([
      'list_tables',
      'list_extensions',
      'list_migrations',
      'apply_migration',
      'execute_sql',
    ]);
  });

  test('debugging tools', async () => {
    const { client } = await setup({
      features: ['debugging'],
    });

    const { tools } = await client.listTools();
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toEqual(['get_logs', 'get_advisors']);
  });

  test('development tools', async () => {
    const { client } = await setup({
      features: ['development'],
    });

    const { tools } = await client.listTools();
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toEqual([
      'get_project_url',
      'get_anon_key',
      'generate_typescript_types',
    ]);
  });

  test('docs tools', async () => {
    const { client } = await setup({
      features: ['docs'],
    });

    const { tools } = await client.listTools();
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toEqual(['search_docs']);
  });

  test('functions tools', async () => {
    const { client } = await setup({
      features: ['functions'],
    });

    const { tools } = await client.listTools();
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toEqual(['list_edge_functions', 'deploy_edge_function']);
  });

  test('branching tools', async () => {
    const { client } = await setup({
      features: ['branching'],
    });

    const { tools } = await client.listTools();
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toEqual([
      'create_branch',
      'list_branches',
      'delete_branch',
      'merge_branch',
      'reset_branch',
      'rebase_branch',
    ]);
  });

  test('storage tools', async () => {
    const { client } = await setup({
      features: ['storage'],
    });

    const { tools } = await client.listTools();
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toEqual([
      'list_storage_buckets',
      'get_storage_config',
      'update_storage_config',
    ]);
  });

  test('invalid group fails', async () => {
    const setupPromise = setup({
      features: ['my-invalid-group'],
    });

    await expect(setupPromise).rejects.toThrow('Invalid enum value');
  });

  test('duplicate group behaves like single group', async () => {
    const { client: duplicateClient } = await setup({
      features: ['account', 'account'],
    });

    const { tools } = await duplicateClient.listTools();
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toEqual([
      'list_organizations',
      'get_organization',
      'list_projects',
      'get_project',
      'get_cost',
      'confirm_cost',
      'create_project',
      'pause_project',
      'restore_project',
    ]);
  });

  test('tools filtered to available platform operations', async () => {
    const platform: SupabasePlatform = {
      database: {
        executeSql() {
          throw new Error('Not implemented');
        },
        listMigrations() {
          throw new Error('Not implemented');
        },
        applyMigration() {
          throw new Error('Not implemented');
        },
      },
    };

    const { client } = await setup({ platform });
    const { tools } = await client.listTools();
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toEqual([
      'search_docs',
      'list_tables',
      'list_extensions',
      'list_migrations',
      'apply_migration',
      'execute_sql',
    ]);
  });

  test('unimplemented feature group produces custom error message', async () => {
    const platform: SupabasePlatform = {
      database: {
        executeSql() {
          throw new Error('Not implemented');
        },
        listMigrations() {
          throw new Error('Not implemented');
        },
        applyMigration() {
          throw new Error('Not implemented');
        },
      },
    };

    const setupPromise = setup({ platform, features: ['account'] });

    await expect(setupPromise).rejects.toThrow(
      "This platform does not support the 'account' feature group"
    );
  });
});

describe('project scoped tools', () => {
  test('no account level tools should exist', async () => {
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

    const { client } = await setup({ projectId: project.id });

    const result = await client.listTools();

    const accountLevelToolNames = [
      'list_organizations',
      'get_organization',
      'list_projects',
      'get_project',
      'get_cost',
      'confirm_cost',
      'create_project',
      'pause_project',
      'restore_project',
    ];

    const toolNames = result.tools.map((tool) => tool.name);

    for (const accountLevelToolName of accountLevelToolNames) {
      expect(
        toolNames,
        `tool ${accountLevelToolName} should not be available in project scope`
      ).not.toContain(accountLevelToolName);
    }
  });

  test('no tool should accept a project_id', async () => {
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

    const { client } = await setup({ projectId: project.id });

    const result = await client.listTools();

    expect(result.tools).toBeDefined();
    expect(Array.isArray(result.tools)).toBe(true);

    for (const tool of result.tools) {
      const schemaProperties = tool.inputSchema.properties ?? {};
      expect(
        'project_id' in schemaProperties,
        `tool ${tool.name} should not accept a project_id`
      ).toBe(false);
    }
  });

  test('invalid project ID should throw an error', async () => {
    const { callTool } = await setup({ projectId: 'invalid-project-id' });

    const listTablesPromise = callTool({
      name: 'list_tables',
      arguments: {
        schemas: ['public'],
      },
    });

    await expect(listTablesPromise).rejects.toThrow('Project not found');
  });

  test('passing project_id to a tool should throw an error', async () => {
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

    const { callTool } = await setup({ projectId: project.id });

    const listTablesPromise = callTool({
      name: 'list_tables',
      arguments: {
        project_id: 'my-project-id',
        schemas: ['public'],
      },
    });

    await expect(listTablesPromise).rejects.toThrow('Unrecognized key');
  });

  test('listing tables implicitly uses the scoped project_id', async () => {
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

    project.db
      .sql`create table test (id integer generated always as identity primary key)`;

    const { callTool } = await setup({ projectId: project.id });

    const result = await callTool({
      name: 'list_tables',
      arguments: {
        schemas: ['public'],
      },
    });

    expect(result).toEqual([
      expect.objectContaining({
        name: 'test',
        schema: 'public',
        columns: [
          expect.objectContaining({
            name: 'id',
            is_identity: true,
            is_generated: false,
          }),
        ],
      }),
    ]);
  });
});

describe('docs tools', () => {
  test('gets content', async () => {
    const { callTool } = await setup();
    const query = stripIndent`
      query ContentQuery {
        searchDocs(query: "typescript") {
          nodes {
            title
            href
          }
        }
      }
    `;

    const result = await callTool({
      name: 'search_docs',
      arguments: {
        graphql_query: query,
      },
    });

    expect(result).toEqual({ dummy: true });
  });

  test('tool description contains schema', async () => {
    const { client } = await setup();

    const { tools } = await client.listTools();

    const tool = tools.find((tool) => tool.name === 'search_docs');

    if (!tool) {
      throw new Error('tool not found');
    }

    if (!tool.description) {
      throw new Error('tool description not found');
    }

    expect(tool.description.includes(contentApiMockSchema)).toBe(true);
  });
});
