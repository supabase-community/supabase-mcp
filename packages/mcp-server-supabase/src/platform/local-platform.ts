import type { InitData } from '@supabase/mcp-utils';
import Docker from 'dockerode';
import { load } from 'js-toml';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  type ApplyMigrationOptions,
  type CreateBranchOptions,
  type CreateProjectOptions,
  type DeployEdgeFunctionOptions,
  type ExecuteSqlOptions,
  type GetLogsOptions,
  type ResetBranchOptions,
  type SupabasePlatform,
} from './index.js';

export type SupabaseLocalPlatformOptions = {
  /**
   * The local Supabase project ID. This is found under the `project_id` key
   * in the `supabase/config.toml` file of your local Supabase project.
   *
   * Defaults to the `project_id` for the Supabase project
   * in the current working directory. Note that not all MCP clients
   * expose the current working directory, so you may need to provide
   * this ID explicitly.
   *
   * Make sure the local stack is running via `supabase start` before
   * running the MCP server.
   */
  projectId?: string;
};

/**
 * Creates a Supabase platform implementation using the Supabase Management API.
 */
export function createSupabaseLocalPlatform(
  options: SupabaseLocalPlatformOptions = {}
): SupabasePlatform {
  const { projectId } = options;

  let studioUrl: string | undefined;

  const platform: SupabasePlatform = {
    async init(info: InitData) {
      try {
        // If a local project ID is provided, we can use it directly
        if (projectId) {
          studioUrl = await getStudioUrl(projectId);
          return;
        }

        const projectPathCandidates: string[] = [];

        // If roots are provided, prioritize them first
        if (info.roots) {
          const fileRoots = info.roots
            .filter((root) => new URL(root.uri).protocol === 'file:')
            .map((root) => fileURLToPath(root.uri));

          projectPathCandidates.push(...fileRoots);
        }

        // Fallback to Cursor's custom WORKSPACE_FOLDER_PATHS environment variable
        if (process.env.WORKSPACE_FOLDER_PATHS) {
          projectPathCandidates.push(process.env.WORKSPACE_FOLDER_PATHS);
        }

        // Then try the current working directory
        projectPathCandidates.push(process.cwd());

        console.error(
          'Found local Supabase project candidates:',
          projectPathCandidates
        );

        // Lookup the studio URL for each candidate
        const stacks = await Promise.all(
          projectPathCandidates.map(async (path) => {
            const projectId = await getProjectId(path).catch(() => undefined);

            if (!projectId) {
              return undefined;
            }

            const studioUrl = await getStudioUrl(projectId).catch(
              () => undefined
            );
            if (!studioUrl) {
              return undefined;
            }

            return { projectId, studioUrl };
          })
        );

        // Pick the first defined studio URL
        const stack = stacks.find((stack) => stack?.studioUrl !== undefined);

        if (!stack) {
          console.error(
            'Could not infer the local Supabase project. Please pass the `project_id` from your config.toml to `--project-ref` and ensure the local Supabase stack is running via `supabase start`.'
          );
          return;
        }

        console.error('Identified local Supabase stack:', stack);

        studioUrl = stack.studioUrl;
      } catch (error) {
        console.error('Error initializing local Supabase platform:', error);
        throw error;
      }
    },
    async executeSql<T>(projectId: string, options: ExecuteSqlOptions) {
      // TODO: support read-only mode

      const response = await fetch(
        `${studioUrl}/api/platform/pg-meta/${projectId}/query`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: options.query,
          }),
        }
      );

      await assertSuccess(response, 'Failed to execute SQL query');

      return await response.json();
    },
    async listMigrations(projectId: string) {
      throw new Error('Method not implemented');
    },
    async applyMigration<T>(projectId: string, options: ApplyMigrationOptions) {
      throw new Error('Method not implemented');
    },
    async listOrganizations() {
      throw new Error('Method not implemented');
    },
    async getOrganization(organizationId: string) {
      throw new Error('Method not implemented');
    },
    async listProjects() {
      throw new Error('Method not implemented');
    },
    async getProject(projectId: string) {
      const response = await fetch(
        `${studioUrl}/api/platform/projects/${projectId}`
      );

      await assertSuccess(response, 'Failed to retrieve project details');

      return await response.json();
    },
    async createProject(options: CreateProjectOptions) {
      throw new Error('Method not implemented');
    },
    async pauseProject(projectId: string) {
      throw new Error('Method not implemented');
    },
    async restoreProject(projectId: string) {
      throw new Error('Method not implemented');
    },
    async listEdgeFunctions(projectId: string) {
      throw new Error('Method not implemented');
    },
    async getEdgeFunction(projectId: string, functionSlug: string) {
      throw new Error('Method not implemented');
    },
    async deployEdgeFunction(
      projectId: string,
      options: DeployEdgeFunctionOptions
    ) {
      throw new Error('Method not implemented');
    },
    async getLogs(projectId: string, options: GetLogsOptions) {
      // TODO: figure out why edge function logs produce an error

      const queryParams = new URLSearchParams();

      queryParams.set('project', projectId);
      queryParams.set('sql', options.sql);
      if (options.iso_timestamp_start) {
        queryParams.set('iso_timestamp_start', options.iso_timestamp_start);
      }
      if (options.iso_timestamp_end) {
        queryParams.set('iso_timestamp_end', options.iso_timestamp_end);
      }

      const url = new URL(
        `/api/platform/projects/${projectId}/analytics/endpoints/logs.all`,
        studioUrl
      );

      url.search = queryParams.toString();

      const response = await fetch(url);

      await assertSuccess(response, 'Failed to retrieve logs');

      return await response.json();
    },
    async getProjectUrl(projectId: string): Promise<string> {
      const response = await fetch(
        `${studioUrl}/api/platform/projects/${projectId}/settings`
      );

      await assertSuccess(response, 'Failed to retrieve project settings');

      const settings = await response.json();

      const appConfig: { endpoint: string; protocol: string } =
        settings.app_config;

      return `${appConfig.protocol}://${appConfig.endpoint}`;
    },
    async getAnonKey(projectId: string): Promise<string> {
      const response = await fetch(
        `${studioUrl}/api/platform/projects/${projectId}/settings`
      );

      await assertSuccess(response, 'Failed to retrieve project settings');

      const settings = await response.json();

      const apiKeys: { api_key: string; name: string }[] =
        settings.service_api_keys;

      const anonKey = apiKeys.find((key) => key.name === 'anon key');

      if (!anonKey) {
        throw new Error('Anon key not found in project settings');
      }

      return anonKey.api_key;
    },
    async generateTypescriptTypes(projectId: string) {
      const response = await fetch(
        `${studioUrl}/api/v1/projects/${projectId}/types/typescript`
      );

      await assertSuccess(response, 'Failed to generate TypeScript types');

      return await response.json();
    },
    async listBranches(projectId: string) {
      throw new Error('Method not implemented');
    },
    async createBranch(projectId: string, options: CreateBranchOptions) {
      throw new Error('Method not implemented');
    },
    async deleteBranch(branchId: string) {
      throw new Error('Method not implemented');
    },
    async mergeBranch(branchId: string) {
      throw new Error('Method not implemented');
    },
    async resetBranch(branchId: string, options: ResetBranchOptions) {
      throw new Error('Method not implemented');
    },
    async rebaseBranch(branchId: string) {
      throw new Error('Method not implemented');
    },
  };

  return platform;
}

const configSchema = z.object({
  project_id: z.string(),
});

async function getProjectId(projectPath: string) {
  const configPath = join(projectPath, 'supabase', 'config.toml');
  const configContents = await readFile(configPath, 'utf8');
  const config = load(configContents);
  const { project_id } = configSchema.parse(config);
  return project_id;
}

async function getStudioUrl(projectId: string) {
  const docker = new Docker();

  const containers = await docker.listContainers({
    all: true,
    filters: {
      label: [`com.supabase.cli.project=${projectId}`],
    },
  });

  const studioContainer = containers.find((container) =>
    container.Image.includes('supabase/studio')
  );

  if (!studioContainer) {
    return undefined;
  }

  const port = studioContainer.Ports.find((port) => port.PublicPort === 54323);

  if (!port) {
    return undefined;
  }

  return `http://localhost:${port.PublicPort}`;
}

export async function assertSuccess(
  response: Response,
  fallbackMessage: string
) {
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    console.error('Response error:', result);
    throw new Error(fallbackMessage);
  }
}
