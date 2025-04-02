import { PGlite, type PGliteInterface } from '@electric-sql/pglite';
import { format } from 'date-fns';
import { http, HttpResponse } from 'msw';
import { nanoid } from 'nanoid';
import { expect } from 'vitest';
import { z } from 'zod';
import { version } from '../package.json';
import type { components } from '../src/management-api/types';
import { TRACE_URL } from '../src/regions.js';

export const API_URL = 'https://api.supabase.com';
export const MCP_SERVER_NAME = 'supabase-mcp';
export const MCP_SERVER_VERSION = version;
export const MCP_CLIENT_NAME = 'test-client';
export const MCP_CLIENT_VERSION = '0.1.0';
export const ACCESS_TOKEN = 'dummy-token';
export const COUNTRY_CODE = 'US';
export const CLOSEST_REGION = 'us-east-2';

type Organization = components['schemas']['OrganizationResponseV1'];
type Project = components['schemas']['V1ProjectWithDatabaseResponse'];
type Branch = components['schemas']['BranchResponse'];

export type Migration = {
  version: string;
  name: string;
  query: string;
};

export const mockOrgs: Organization[] = [
  { id: 'org-1', name: 'Org 1' },
  { id: 'org-2', name: 'Org 2' },
];
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
  http.all('*', ({ request }) => {
    const authHeader = request.headers.get('Authorization');

    const accessToken = authHeader?.replace('Bearer ', '');
    if (accessToken !== ACCESS_TOKEN) {
      return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
  }),

  /**
   * Check user agent
   */
  http.all('*', ({ request }) => {
    const userAgent = request.headers.get('user-agent');
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
    return HttpResponse.json(mockOrgs);
  }),

  /**
   * Get details for an organization
   */
  http.get(`${API_URL}/v1/organizations/:id`, ({ params }) => {
    const organization = mockOrgs.find((org) => org.id === params.id);
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
  http.post<{ projectId: string }, { query: string }>(
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
      const { query } = await request.json();
      const [results] = await db.exec(query);

      if (!results) {
        return HttpResponse.json(
          { message: 'Failed to execute query' },
          { status: 500 }
        );
      }

      return HttpResponse.json(results.rows);
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

      let branch: MockBranch;

      if (projectBranches.length === 0) {
        // If this is the first branch, set it as the default branch pointing to the same project
        branch = new MockBranch({
          name: branch_name,
          project_ref: project.id,
          parent_project_ref: project.id,
          is_default: true,
        });

        branch.status = 'MIGRATIONS_PASSED';
        mockBranches.set(branch.id, branch);
      } else {
        // Otherwise, create a new branch
        branch = await createBranch({
          name: branch_name,
          parent_project_ref: project.id,
        });
      }

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
          { status: 400 }
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
          { status: 400 }
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
  http.post<{ branchId: string }>(
    `${API_URL}/v1/branches/:branchId/reset`,
    async ({ params }) => {
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

  /**
   * Catch-all handler that rejects any other requests
   */
  http.all('*', ({ request }) => {
    throw new Error(
      `No request handler found for ${request.method} ${request.url}`
    );
  }),
];

export async function createProject(options: MockProjectOptions) {
  const project = new MockProject(options);

  mockProjects.set(project.id, project);

  // Change the project status to ACTIVE_HEALTHY after a delay
  setTimeout(async () => {
    project.status = 'ACTIVE_HEALTHY';
  }, 0);

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
