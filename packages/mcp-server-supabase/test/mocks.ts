import { PGlite, type PGliteInterface } from '@electric-sql/pglite';
import { format } from 'date-fns';
import { http, HttpResponse } from 'msw';
import { customAlphabet } from 'nanoid';
import { join } from '@std/path/posix';
import { expect } from 'vitest';
import { z } from 'zod';
import packageJson from '../package.json' with { type: 'json' };
import { getDeploymentId, getPathPrefix } from '../src/edge-function.js';
import { bundleFiles } from '../src/eszip/index.js';
import type { components } from '../src/management-api/types.js';
import { TRACE_URL } from '../src/regions.js';

const { version } = packageJson;

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz', 20);

export const API_URL = 'https://api.supabase.com';
export const MCP_SERVER_NAME = 'supabase-mcp';
export const MCP_SERVER_VERSION = version;
export const MCP_CLIENT_NAME = 'test-client';
export const MCP_CLIENT_VERSION = '1.0.0';
export const ACCESS_TOKEN = 'dummy-token';
export const COUNTRY_CODE = 'US';
export const CLOSEST_REGION = 'us-east-2';

type Organization = components['schemas']['V1OrganizationSlugResponse'];
type Project = components['schemas']['V1ProjectWithDatabaseResponse'];
type Branch = components['schemas']['BranchResponse'];

export type Migration = {
  version: string;
  name: string;
  query: string;
};

export const mockOrgs = new Map<string, Organization>();
export const mockProjects = new Map<string, MockProject>();
export const mockBranches = new Map<string, MockBranch>();

export const mockManagementApi = [
  http.get(TRACE_URL, () => {
    return HttpResponse.text(
      `fl=123abc\nvisit_scheme=https\nloc=${COUNTRY_CODE}\ntls=TLSv1.3\nhttp=http/2`
    );
  }),

  /**
   * Check authorization
   */
  http.all(`${API_URL}/*`, ({ request }) => {
    const authHeader = request.headers.get('Authorization');

    const accessToken = authHeader?.replace('Bearer ', '');
    if (accessToken !== ACCESS_TOKEN) {
      return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
  }),

  /**
   * Check user agent
   */
  http.all(`${API_URL}/*`, ({ request }) => {
    const userAgent =
      request.headers.get('user-agent') ?? request.headers.get('x-user-agent');
    expect(userAgent).toBe(
      `${MCP_SERVER_NAME}/${MCP_SERVER_VERSION} (${MCP_CLIENT_NAME}/${MCP_CLIENT_VERSION})`
    );
  }),

  /**
   * List all projects
   */
  http.get(`${API_URL}/v1/projects`, () => {
    return HttpResponse.json(
      Array.from(mockProjects.values()).map((project) => project.details)
    );
  }),

  /**
   * Get details for a project
   */
  http.get<{ projectId: string }>(
    `${API_URL}/v1/projects/:projectId`,
    ({ params }) => {
      const project = mockProjects.get(params.projectId);
      if (!project) {
        return HttpResponse.json(
          { message: 'Project not found' },
          { status: 404 }
        );
      }
      return HttpResponse.json(project.details);
    }
  ),

  /**
   * Create a new project
   */
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

  /**
   * Pause a project
   */
  http.post<{ projectId: string }>(
    `${API_URL}/v1/projects/:projectId/pause`,
    ({ params }) => {
      const project = mockProjects.get(params.projectId);
      if (!project) {
        return HttpResponse.json(
          { error: 'Project not found' },
          { status: 404 }
        );
      }
      project.status = 'INACTIVE';
      return HttpResponse.json(project.details);
    }
  ),

  /**
   * Restore a project
   */
  http.post<{ projectId: string }>(
    `${API_URL}/v1/projects/:projectId/restore`,
    ({ params }) => {
      const project = mockProjects.get(params.projectId);
      if (!project) {
        return HttpResponse.json(
          { error: 'Project not found' },
          { status: 404 }
        );
      }
      project.status = 'ACTIVE_HEALTHY';
      return HttpResponse.json(project.details);
    }
  ),

  /**
   * List organizations
   */
  http.get(`${API_URL}/v1/organizations`, () => {
    return HttpResponse.json(
      Array.from(mockOrgs.values()).map(({ id, name }) => ({ id, name }))
    );
  }),

  /**
   * Get details for an organization
   */
  http.get(`${API_URL}/v1/organizations/:id`, ({ params }) => {
    const organization = Array.from(mockOrgs.values()).find(
      (org) => org.id === params.id
    );
    return HttpResponse.json(organization);
  }),

  /**
   * Get the API keys for a project
   */
  http.get(`${API_URL}/v1/projects/:projectId/api-keys`, ({ params }) => {
    return HttpResponse.json([
      {
        name: 'anon',
        api_key: 'dummy-anon-key',
      },
    ]);
  }),

  /**
   * Execute a SQL query on a project's database
   */
  http.post<{ projectId: string }, { query: string; read_only?: boolean }>(
    `${API_URL}/v1/projects/:projectId/database/query`,
    async ({ params, request }) => {
      const project = mockProjects.get(params.projectId);
      if (!project) {
        return HttpResponse.json(
          { message: 'Project not found' },
          { status: 404 }
        );
      }
      const { db } = project;
      const { query, read_only } = await request.json();

      // Not secure, but good enough for testing
      const wrappedQuery = `
        SET ROLE ${read_only ? 'supabase_read_only_role' : 'postgres'};
        ${query};
        RESET ROLE;
      `;

      try {
        const statementResults = await db.exec(wrappedQuery);

        // Remove last result, which is for the "RESET ROLE" statement
        statementResults.pop();

        const lastStatementResults = statementResults.at(-1);

        if (!lastStatementResults) {
          return HttpResponse.json(
            { message: 'Failed to execute query' },
            { status: 500 }
          );
        }

        return HttpResponse.json(lastStatementResults.rows);
      } catch (error) {
        if (!(error instanceof Error)) {
          throw error;
        }
        return HttpResponse.json({ message: error.message }, { status: 400 });
      }
    }
  ),

  /**
   * Lists all Edge Functions for a project
   */
  http.get<{ projectId: string }>(
    `${API_URL}/v1/projects/:projectId/functions`,
    ({ params }) => {
      const project = mockProjects.get(params.projectId);
      if (!project) {
        return HttpResponse.json(
          { message: 'Project not found' },
          { status: 404 }
        );
      }

      return HttpResponse.json(
        Array.from(project.edge_functions.values()).map(
          (edgeFunction) => edgeFunction.details
        )
      );
    }
  ),

  /**
   * Gets the eszip bundle for an Edge Function
   */
  http.get<{ projectId: string; functionSlug: string }>(
    `${API_URL}/v1/projects/:projectId/functions/:functionSlug/body`,
    ({ params }) => {
      const project = mockProjects.get(params.projectId);
      if (!project) {
        return HttpResponse.json(
          { message: 'Project not found' },
          { status: 404 }
        );
      }

      const edgeFunction = project.edge_functions.get(params.functionSlug);
      if (!edgeFunction) {
        return HttpResponse.json(
          { message: 'Edge Function not found' },
          { status: 404 }
        );
      }

      if (!edgeFunction.eszip) {
        return HttpResponse.json(
          { message: 'Edge Function files not found' },
          { status: 404 }
        );
      }

      return HttpResponse.arrayBuffer(edgeFunction.eszip);
    }
  ),
  /**
   * Deploys an Edge Function
   */
  http.post<{ projectId: string }>(
    `${API_URL}/v1/projects/:projectId/functions/deploy`,
    async ({ params, request }) => {
      const project = mockProjects.get(params.projectId);
      if (!project) {
        return HttpResponse.json(
          { message: 'Project not found' },
          { status: 404 }
        );
      }
      const formData = await request.formData();

      const metadataSchema = z.object({
        name: z.string(),
        entrypoint_path: z.string(),
      });

      const metadataFormValue = formData.get('metadata');
      const metadataString =
        metadataFormValue instanceof File
          ? await metadataFormValue.text()
          : (metadataFormValue ?? undefined);

      if (!metadataString) {
        throw new Error('Metadata is required');
      }

      const metadata = metadataSchema.parse(JSON.parse(metadataString));

      const fileFormValues = formData.getAll('file');

      const files = fileFormValues.map((file) => {
        if (typeof file === 'string') {
          throw new Error('Multipart file is a string instead of a File');
        }
        return file;
      });

      const edgeFunction = await project.deployEdgeFunction(metadata, files);

      return HttpResponse.json(edgeFunction.details);
    }
  ),

  /**
   * List migrations for a project
   */
  http.get<{ projectId: string }>(
    `${API_URL}/v1/projects/:projectId/database/migrations`,
    async ({ params }) => {
      const project = mockProjects.get(params.projectId);
      if (!project) {
        return HttpResponse.json(
          { message: 'Project not found' },
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

  /**
   * Create a new migration for a project
   */
  http.post<{ projectId: string }, { name: string; query: string }>(
    `${API_URL}/v1/projects/:projectId/database/migrations`,
    async ({ params, request }) => {
      const project = mockProjects.get(params.projectId);
      if (!project) {
        return HttpResponse.json(
          { message: 'Project not found' },
          { status: 404 }
        );
      }
      const { db, migrations } = project;
      const { name, query } = await request.json();

      try {
        const [results] = await db.exec(query);

        if (!results) {
          return HttpResponse.json(
            { message: 'Failed to execute query' },
            { status: 500 }
          );
        }

        migrations.push({
          version: format(new Date(), 'yyyyMMddHHmmss'),
          name,
          query,
        });

        return HttpResponse.json(results.rows);
      } catch (error) {
        if (!(error instanceof Error)) {
          throw error;
        }

        return HttpResponse.json({ message: error.message }, { status: 400 });
      }
    }
  ),

  /**
   * Get logs for a project
   */
  http.get<{ projectId: string }, { sql: string }>(
    `${API_URL}/v1/projects/:projectId/analytics/endpoints/logs.all`,
    async ({ params, request }) => {
      const project = mockProjects.get(params.projectId);
      if (!project) {
        return HttpResponse.json(
          { message: 'Project not found' },
          { status: 404 }
        );
      }

      return HttpResponse.json([]);
    }
  ),

  /**
   * Create a new branch for a project
   */
  http.post<{ projectId: string }, { branch_name: string }>(
    `${API_URL}/v1/projects/:projectId/branches`,
    async ({ params, request }) => {
      const { branch_name } = await request.json();

      const project = mockProjects.get(params.projectId);
      if (!project) {
        return HttpResponse.json(
          { message: 'Project not found' },
          { status: 404 }
        );
      }

      const projectBranches = Array.from(mockBranches.values()).filter(
        (branch) => branch.parent_project_ref === project.id
      );

      if (projectBranches.length === 0) {
        // If this is the first branch, set it as the default branch pointing to the same project
        const defaultBranch = new MockBranch({
          name: branch_name,
          project_ref: project.id,
          parent_project_ref: project.id,
          is_default: true,
        });
        defaultBranch.status = 'MIGRATIONS_PASSED';
        mockBranches.set(defaultBranch.id, defaultBranch);
      }

      const branch = await createBranch({
        name: branch_name,
        parent_project_ref: project.id,
      });

      return HttpResponse.json(branch.details);
    }
  ),

  /**
   * List all branches for a project
   */
  http.get<{ projectId: string }>(
    `${API_URL}/v1/projects/:projectId/branches`,
    async ({ params }) => {
      const projectBranches = Array.from(mockBranches.values()).filter(
        (branch) => branch.parent_project_ref === params.projectId
      );

      if (projectBranches.length === 0) {
        return HttpResponse.json(
          { message: 'Preview branching is not enabled for this project.' },
          { status: 422 }
        );
      }

      return HttpResponse.json(projectBranches.map((branch) => branch.details));
    }
  ),

  /**
   * Get details for a branch
   */
  http.delete<{ branchId: string }>(
    `${API_URL}/v1/branches/:branchId`,
    async ({ params }) => {
      const branch = mockBranches.get(params.branchId);

      if (!branch) {
        return HttpResponse.json(
          { message: 'Branch not found' },
          { status: 404 }
        );
      }

      // if default branch, return error
      if (branch.is_default) {
        return HttpResponse.json(
          { message: 'Cannot delete the default branch.' },
          { status: 422 }
        );
      }

      const project = mockProjects.get(branch.project_ref);
      if (!project) {
        return HttpResponse.json(
          { message: 'Project not found' },
          { status: 404 }
        );
      }

      await project.destroy();
      mockProjects.delete(project.id);
      mockBranches.delete(branch.id);

      return HttpResponse.json({ message: 'ok' });
    }
  ),

  /**
   * Merges migrations from a development branch to production
   */
  http.post<{ branchId: string }>(
    `${API_URL}/v1/branches/:branchId/merge`,
    async ({ params }) => {
      const branch = mockBranches.get(params.branchId);
      if (!branch) {
        return HttpResponse.json(
          { message: 'Branch not found' },
          { status: 404 }
        );
      }

      const parentProject = mockProjects.get(branch.parent_project_ref);
      if (!parentProject) {
        return HttpResponse.json(
          { message: 'Parent project not found' },
          { status: 404 }
        );
      }

      const project = mockProjects.get(branch.project_ref);
      if (!project) {
        return HttpResponse.json(
          { message: 'Project not found' },
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
          { message: 'Failed to apply migrations' },
          { status: 500 }
        );
      }

      const migration_version = parentProject.migrations.at(-1)?.version;

      return HttpResponse.json({ migration_version });
    }
  ),

  /**
   * Resets a branch and re-runs migrations
   */
  http.post<{ branchId: string }, { migration_version?: string }>(
    `${API_URL}/v1/branches/:branchId/reset`,
    async ({ params, request }) => {
      const branch = mockBranches.get(params.branchId);
      if (!branch) {
        return HttpResponse.json(
          { message: 'Branch not found' },
          { status: 404 }
        );
      }

      const project = mockProjects.get(branch.project_ref);
      if (!project) {
        return HttpResponse.json(
          { message: 'Project not found' },
          { status: 404 }
        );
      }

      // Clear migrations below the specified version
      const body = await request.json();
      if (body.migration_version) {
        const target = body.migration_version;
        project.migrations = project.migrations.filter(
          (m) => m.version <= target
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
          { message: 'Failed to apply migrations' },
          { status: 500 }
        );
      }

      const migration_version = project.migrations.at(-1)?.version;

      return HttpResponse.json({ migration_version });
    }
  ),

  /**
   * Rebase migrations from production on a development branch
   */
  http.post<{ branchId: string }>(
    `${API_URL}/v1/branches/:branchId/push`,
    async ({ params }) => {
      const branch = mockBranches.get(params.branchId);
      if (!branch) {
        return HttpResponse.json(
          { message: 'Branch not found' },
          { status: 404 }
        );
      }

      const parentProject = mockProjects.get(branch.parent_project_ref);
      if (!parentProject) {
        return HttpResponse.json(
          { message: 'Parent project not found' },
          { status: 404 }
        );
      }

      const project = mockProjects.get(branch.project_ref);
      if (!project) {
        return HttpResponse.json(
          { message: 'Project not found' },
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
          { message: 'Failed to apply migrations' },
          { status: 500 }
        );
      }

      const migration_version = project.migrations.at(-1)?.version;

      return HttpResponse.json({ migration_version });
    }
  ),
];

export async function createOrganization(options: MockOrganizationOptions) {
  const org = new MockOrganization(options);
  mockOrgs.set(org.id, org);
  return org;
}

export async function createProject(options: MockProjectOptions) {
  const project = new MockProject(options);
  mockProjects.set(project.id, project);
  return project;
}

export async function createBranch(options: {
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

  mockProjects.set(project.id, project);

  const branch = new MockBranch({
    name: options.name,
    project_ref: project.id,
    parent_project_ref: options.parent_project_ref,
    is_default: false,
  });

  mockBranches.set(branch.id, branch);
  project.migrations = [...parentProject.migrations];

  setTimeout(async () => {
    try {
      branch.status = 'RUNNING_MIGRATIONS';
      await project.applyMigrations();
      branch.status = 'MIGRATIONS_PASSED';
    } catch (error) {
      branch.status = 'MIGRATIONS_FAILED';
      console.error('Migration error:', error);
    }

    try {
      for (const edgeFunction of project.edge_functions.values()) {
        await project.deployEdgeFunction({
          name: edgeFunction.name,
          entrypoint_path: edgeFunction.entrypoint_path,
        });
      }
      branch.status = 'FUNCTIONS_DEPLOYED';
    } catch (error) {
      branch.status = 'FUNCTIONS_FAILED';
      console.error('Edge function deployment error:', error);
    }
  }, 0);

  return branch;
}

export type MockOrganizationOptions = {
  name: Organization['name'];
  plan: Organization['plan'];
  allowed_release_channels: Organization['allowed_release_channels'];
  opt_in_tags?: Organization['opt_in_tags'];
};

export class MockOrganization {
  id: string;
  name: Organization['name'];
  plan: Organization['plan'];
  allowed_release_channels: Organization['allowed_release_channels'];
  opt_in_tags: Organization['opt_in_tags'];

  get details(): Organization {
    return {
      id: this.id,
      name: this.name,
      plan: this.plan,
      allowed_release_channels: this.allowed_release_channels,
      opt_in_tags: this.opt_in_tags,
    };
  }

  constructor(options: MockOrganizationOptions) {
    this.id = nanoid();
    this.name = options.name;
    this.plan = options.plan;
    this.allowed_release_channels = options.allowed_release_channels;
    this.opt_in_tags = options.opt_in_tags ?? [];
  }
}

export type MockEdgeFunctionOptions = {
  name: string;
  entrypoint_path: string;
};

export class MockEdgeFunction {
  projectId: string;
  id: string;
  slug: string;
  version: number;
  name: string;
  status: 'ACTIVE' | 'REMOVED' | 'THROTTLED';
  entrypoint_path: string;
  import_map_path: string | null;
  import_map: boolean;
  verify_jwt: boolean;
  created_at: Date;
  updated_at: Date;

  eszip?: Uint8Array;

  async setFiles(files: File[]) {
    this.eszip = await bundleFiles(files, this.pathPrefix);
  }

  get deploymentId() {
    return getDeploymentId(this.projectId, this.id, this.version);
  }

  get pathPrefix() {
    return getPathPrefix(this.deploymentId);
  }

  get details() {
    return {
      id: this.id,
      slug: this.slug,
      version: this.version,
      name: this.name,
      status: this.status,
      entrypoint_path: this.entrypoint_path,
      import_map_path: this.import_map_path,
      import_map: this.import_map,
      verify_jwt: this.verify_jwt,
      created_at: this.created_at.toISOString(),
      updated_at: this.updated_at.toISOString(),
    };
  }

  constructor(
    projectId: string,
    { name, entrypoint_path }: MockEdgeFunctionOptions
  ) {
    this.projectId = projectId;
    this.id = crypto.randomUUID();
    this.slug = name;
    this.version = 1;
    this.name = name;
    this.status = 'ACTIVE';
    this.entrypoint_path = `file://${join(this.pathPrefix, entrypoint_path)}`;
    this.import_map_path = null;
    this.import_map = false;
    this.verify_jwt = true;
    this.created_at = new Date();
    this.updated_at = new Date();
  }

  update({ name, entrypoint_path }: MockEdgeFunctionOptions) {
    this.name = name;
    this.version += 1;
    this.entrypoint_path = `file://${join(this.pathPrefix, entrypoint_path)}`;
    this.updated_at = new Date();
  }
}

export type MockProjectOptions = {
  name: string;
  region: string;
  organization_id: string;
};

export class MockProject {
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
  edge_functions = new Map<string, MockEdgeFunction>();

  ready: Promise<void>;

  #db?: PGliteInterface;

  // Lazy load the database connection
  get db() {
    if (!this.#db) {
      this.#db = new PGlite();
      this.#db.waitReady.then(() => {
        this.#db!.exec(`
          CREATE ROLE supabase_read_only_role;
          GRANT pg_read_all_data TO supabase_read_only_role;
        `);
      });
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

    this.ready = new Promise((resolve) => {
      // Change the project status to ACTIVE_HEALTHY after a delay
      setTimeout(async () => {
        this.status = 'ACTIVE_HEALTHY';
        resolve();
      }, 0);
    });
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
    this.#db = undefined;
    return this.db;
  }

  async deployEdgeFunction(
    options: MockEdgeFunctionOptions,
    files: File[] = []
  ) {
    const edgeFunction = new MockEdgeFunction(this.id, options);
    const existingFunction = this.edge_functions.get(edgeFunction.slug);

    if (existingFunction) {
      existingFunction.update(options);
      await existingFunction.setFiles(files);
      return existingFunction;
    }

    await edgeFunction.setFiles(files);
    this.edge_functions.set(edgeFunction.slug, edgeFunction);

    return edgeFunction;
  }

  async destroy() {
    if (this.#db) {
      await this.#db.close();
    }
  }
}

export type MockBranchOptions = {
  name: string;
  project_ref: string;
  parent_project_ref: string;
  is_default: boolean;
};

export class MockBranch {
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
