import {
  getMultipartBoundary,
  parseMultipartStream,
} from '@mjackson/multipart-parser';
import type { InitData } from '@supabase/mcp-utils';
import { relative } from 'node:path/posix';
import { fileURLToPath } from 'node:url';
import packageJson from '../../package.json' with { type: 'json' };
import { detectClientContext, type ClientContext } from '../auth.js';
import type { ProjectContext } from '../config/project-context.js';
import { getDeploymentId, normalizeFilename } from '../edge-function.js';
import { getLogQuery } from '../logs.js';
import {
  assertSuccess,
  createManagementApiClient,
} from '../management-api/index.js';
import { generatePassword } from '../password.js';
import {
  applyMigrationOptionsSchema,
  createBranchOptionsSchema,
  createProjectOptionsSchema,
  deployEdgeFunctionOptionsSchema,
  executeSqlOptionsSchema,
  getLogsOptionsSchema,
  resetBranchOptionsSchema,
  type AccountOperations,
  type ApplyMigrationOptions,
  type BackupOperations,
  type BranchingOperations,
  type CreateBranchOptions,
  type CreateProjectOptions,
  type CustomDomainOperations,
  type DatabaseOperations,
  type DatabaseConfigOperations,
  type DebuggingOperations,
  type DeployEdgeFunctionOptions,
  type DevelopmentOperations,
  type EdgeFunction,
  type EdgeFunctionsOperations,
  type EdgeFunctionWithBody,
  type ExecuteSqlOptions,
  type GetLogsOptions,
  type ResetBranchOptions,
  type StorageConfig,
  type StorageOperations,
  type SecretsOperations,
  type SupabasePlatform,
} from './index.js';

const { version } = packageJson;

export type SupabaseApiPlatformOptions = {
  /**
   * The access token for the Supabase Management API.
   */
  accessToken: string;

  /**
   * The API URL for the Supabase Management API.
   */
  apiUrl?: string;

  /**
   * Client context for enhanced error handling.
   */
  clientContext?: ClientContext;

  /**
   * Project context for project-specific operations.
   */
  projectContext?: ProjectContext;
};

/**
 * Creates a Supabase platform implementation using the Supabase Management API.
 */
export function createSupabaseApiPlatform(
  options: SupabaseApiPlatformOptions
): SupabasePlatform {
  const { accessToken, apiUrl, clientContext, projectContext } = options;

  const managementApiUrl = apiUrl ?? 'https://api.supabase.com';

  let managementApiClient = createManagementApiClient(
    managementApiUrl,
    accessToken,
    {},
    clientContext
  );

  const account: AccountOperations = {
    async listOrganizations() {
      const response = await managementApiClient.GET('/v1/organizations');

      assertSuccess(
        response,
        'Failed to fetch organizations',
        managementApiClient
      );

      return response.data;
    },
    async getOrganization(organizationId: string) {
      const response = await managementApiClient.GET(
        '/v1/organizations/{slug}',
        {
          params: {
            path: {
              slug: organizationId,
            },
          },
        }
      );

      assertSuccess(
        response,
        'Failed to fetch organization',
        managementApiClient
      );

      return response.data;
    },
    async listProjects() {
      const response = await managementApiClient.GET('/v1/projects');

      assertSuccess(response, 'Failed to fetch projects', managementApiClient);

      return response.data;
    },
    async getProject(projectId: string) {
      const response = await managementApiClient.GET('/v1/projects/{ref}', {
        params: {
          path: {
            ref: projectId,
          },
        },
      });
      assertSuccess(response, 'Failed to fetch project');
      return response.data;
    },
    async createProject(options: CreateProjectOptions) {
      const { name, organization_id, region, db_pass } =
        createProjectOptionsSchema.parse(options);

      const response = await managementApiClient.POST('/v1/projects', {
        body: {
          name,
          region,
          organization_id,
          db_pass:
            db_pass ??
            generatePassword({
              length: 16,
              numbers: true,
              uppercase: true,
              lowercase: true,
            }),
        },
      });

      assertSuccess(response, 'Failed to create project');

      return response.data;
    },
    async pauseProject(projectId: string) {
      const response = await managementApiClient.POST(
        '/v1/projects/{ref}/pause',
        {
          params: {
            path: {
              ref: projectId,
            },
          },
        }
      );

      assertSuccess(response, 'Failed to pause project');
    },
    async restoreProject(projectId: string) {
      const response = await managementApiClient.POST(
        '/v1/projects/{ref}/restore',
        {
          params: {
            path: {
              ref: projectId,
            },
          },
        }
      );

      assertSuccess(response, 'Failed to restore project');
    },
    async listOrganizationMembers(organizationId: string) {
      const response = await managementApiClient.GET(
        '/v1/organizations/{slug}/members',
        {
          params: {
            path: {
              slug: organizationId,
            },
          },
        }
      );

      assertSuccess(response, 'Failed to list organization members');

      return response.data;
    },
  };

  const database: DatabaseOperations = {
    async executeSql<T>(projectId: string, options: ExecuteSqlOptions) {
      const { query, read_only } = executeSqlOptionsSchema.parse(options);

      const response = await managementApiClient.POST(
        '/v1/projects/{ref}/database/query',
        {
          params: {
            path: {
              ref: projectId,
            },
          },
          body: {
            query,
            read_only,
          },
        }
      );

      assertSuccess(response, 'Failed to execute SQL query');

      return response.data as unknown as T[];
    },
    async listMigrations(projectId: string) {
      const response = await managementApiClient.GET(
        '/v1/projects/{ref}/database/migrations',
        {
          params: {
            path: {
              ref: projectId,
            },
          },
        }
      );

      assertSuccess(response, 'Failed to fetch migrations');

      return response.data;
    },
    async applyMigration(projectId: string, options: ApplyMigrationOptions) {
      const { name, query } = applyMigrationOptionsSchema.parse(options);

      const response = await managementApiClient.POST(
        '/v1/projects/{ref}/database/migrations',
        {
          params: {
            path: {
              ref: projectId,
            },
          },
          body: {
            name,
            query,
          },
        }
      );

      assertSuccess(response, 'Failed to apply migration');

      // Intentionally don't return the result of the migration
      // to avoid prompt injection attacks. If the migration failed,
      // it will throw an error.
    },
    async listSnippets(projectId?: string) {
      const response = await managementApiClient.GET('/v1/snippets', {
        params: {
          query: {
            ...(projectId && { project_ref: projectId }),
          },
        },
      });

      assertSuccess(response, 'Failed to list SQL snippets');

      return (response.data.data || []) as any;
    },
    async getSnippet(snippetId: string) {
      const response = await managementApiClient.GET('/v1/snippets/{id}', {
        params: {
          path: {
            id: snippetId,
          },
        },
      });

      assertSuccess(response, 'Failed to get SQL snippet');

      return response.data as any;
    },
  };

  const debugging: DebuggingOperations = {
    async getLogs(projectId: string, options: GetLogsOptions) {
      const { service, iso_timestamp_start, iso_timestamp_end } =
        getLogsOptionsSchema.parse(options);

      const sql = getLogQuery(service);

      const response = await managementApiClient.GET(
        '/v1/projects/{ref}/analytics/endpoints/logs.all',
        {
          params: {
            path: {
              ref: projectId,
            },
            query: {
              sql,
              iso_timestamp_start,
              iso_timestamp_end,
            },
          },
        }
      );

      assertSuccess(response, 'Failed to fetch logs');

      return response.data;
    },
    async getSecurityAdvisors(projectId: string) {
      const response = await managementApiClient.GET(
        '/v1/projects/{ref}/advisors/security',
        {
          params: {
            path: {
              ref: projectId,
            },
          },
        }
      );

      assertSuccess(response, 'Failed to fetch security advisors');

      return response.data;
    },
    async getPerformanceAdvisors(projectId: string) {
      const response = await managementApiClient.GET(
        '/v1/projects/{ref}/advisors/performance',
        {
          params: {
            path: {
              ref: projectId,
            },
          },
        }
      );

      assertSuccess(response, 'Failed to fetch performance advisors');

      return response.data;
    },
    async getProjectHealth(projectId: string) {
      const response = await managementApiClient.GET(
        '/v1/projects/{ref}/health',
        {
          params: {
            path: {
              ref: projectId,
            },
            query: {
              services: ['auth', 'db', 'pooler', 'realtime', 'rest', 'storage'],
            },
          },
        }
      );

      assertSuccess(response, 'Failed to fetch project health');

      return response.data;
    },
    async getUpgradeStatus(projectId: string) {
      const response = await managementApiClient.GET(
        '/v1/projects/{ref}/upgrade/status',
        {
          params: {
            path: {
              ref: projectId,
            },
          },
        }
      );

      assertSuccess(response, 'Failed to fetch upgrade status');

      return response.data;
    },
    async checkUpgradeEligibility(projectId: string) {
      const response = await managementApiClient.GET(
        '/v1/projects/{ref}/upgrade/eligibility',
        {
          params: {
            path: {
              ref: projectId,
            },
          },
        }
      );

      assertSuccess(response, 'Failed to check upgrade eligibility');

      return response.data;
    },
  };

  const development: DevelopmentOperations = {
    async getProjectUrl(projectId: string): Promise<string> {
      // Use project context URL if available and matches the requested project
      if (
        projectContext?.hasProjectConfig &&
        projectContext.credentials.projectId === projectId &&
        projectContext.credentials.supabaseUrl
      ) {
        if (clientContext?.isClaudeCLI) {
          console.log(
            `🎯 Using project URL from local config (${projectContext.configSource})`
          );
        }
        return projectContext.credentials.supabaseUrl;
      }

      // Fallback to constructing URL from management API domain
      const apiUrl = new URL(managementApiUrl);
      return `https://${projectId}.${getProjectDomain(apiUrl.hostname)}`;
    },
    async getAnonKey(projectId: string): Promise<string> {
      // Use project context anon key if available and matches the requested project
      if (
        projectContext?.hasProjectConfig &&
        projectContext.credentials.projectId === projectId &&
        projectContext.credentials.anonKey
      ) {
        if (clientContext?.isClaudeCLI) {
          console.log(
            `🎯 Using anon key from local config (${projectContext.configSource})`
          );
        }
        return projectContext.credentials.anonKey;
      }

      // Fallback to fetching from Management API
      const response = await managementApiClient.GET(
        '/v1/projects/{ref}/api-keys',
        {
          params: {
            path: {
              ref: projectId,
            },
            query: {
              reveal: false,
            },
          },
        }
      );

      assertSuccess(response, 'Failed to fetch API keys');

      const anonKey = response.data?.find((key) => key.name === 'anon');

      if (!anonKey?.api_key) {
        throw new Error('Anonymous key not found');
      }

      return anonKey.api_key;
    },
    async generateTypescriptTypes(projectId: string) {
      const response = await managementApiClient.GET(
        '/v1/projects/{ref}/types/typescript',
        {
          params: {
            path: {
              ref: projectId,
            },
          },
        }
      );

      assertSuccess(response, 'Failed to fetch TypeScript types');

      return response.data;
    },
  };

  const functions: EdgeFunctionsOperations = {
    async listEdgeFunctions(projectId: string) {
      const response = await managementApiClient.GET(
        '/v1/projects/{ref}/functions',
        {
          params: {
            path: {
              ref: projectId,
            },
          },
        }
      );

      assertSuccess(response, 'Failed to fetch Edge Functions');

      return response.data.map((edgeFunction) => {
        const deploymentId = getDeploymentId(
          projectId,
          edgeFunction.id,
          edgeFunction.version
        );

        const entrypoint_path = edgeFunction.entrypoint_path
          ? normalizeFilename({
              deploymentId,
              filename: fileURLToPath(edgeFunction.entrypoint_path, {
                windows: false,
              }),
            })
          : undefined;

        const import_map_path = edgeFunction.import_map_path
          ? normalizeFilename({
              deploymentId,
              filename: fileURLToPath(edgeFunction.import_map_path, {
                windows: false,
              }),
            })
          : undefined;

        return {
          ...edgeFunction,
          entrypoint_path,
          import_map_path,
        };
      });
    },
    async getEdgeFunction(projectId: string, functionSlug: string) {
      const functionResponse = await managementApiClient.GET(
        '/v1/projects/{ref}/functions/{function_slug}',
        {
          params: {
            path: {
              ref: projectId,
              function_slug: functionSlug,
            },
          },
        }
      );

      if (functionResponse.error) {
        throw functionResponse.error;
      }

      assertSuccess(functionResponse, 'Failed to fetch Edge Function');

      const edgeFunction = functionResponse.data;

      const deploymentId = getDeploymentId(
        projectId,
        edgeFunction.id,
        edgeFunction.version
      );

      const entrypoint_path = edgeFunction.entrypoint_path
        ? normalizeFilename({
            deploymentId,
            filename: fileURLToPath(edgeFunction.entrypoint_path, {
              windows: false,
            }),
          })
        : undefined;

      const import_map_path = edgeFunction.import_map_path
        ? normalizeFilename({
            deploymentId,
            filename: fileURLToPath(edgeFunction.import_map_path, {
              windows: false,
            }),
          })
        : undefined;

      const bodyResponse = await managementApiClient.GET(
        '/v1/projects/{ref}/functions/{function_slug}/body',
        {
          params: {
            path: {
              ref: projectId,
              function_slug: functionSlug,
            },
          },
          headers: {
            Accept: 'multipart/form-data',
          },
          parseAs: 'stream',
        }
      );

      assertSuccess(bodyResponse, 'Failed to fetch Edge Function files');

      const contentType = bodyResponse.response.headers.get('content-type');

      if (!contentType || !contentType.startsWith('multipart/form-data')) {
        throw new Error(
          `Unexpected content type: ${contentType}. Expected multipart/form-data.`
        );
      }

      const boundary = getMultipartBoundary(contentType);

      if (!boundary) {
        throw new Error('No multipart boundary found in response headers');
      }

      if (!bodyResponse.data) {
        throw new Error('No data received from Edge Function body');
      }

      const files: EdgeFunctionWithBody['files'] = [];
      const parts = parseMultipartStream(bodyResponse.data, { boundary });

      for await (const part of parts) {
        if (part.isFile && part.filename) {
          files.push({
            name: normalizeFilename({
              deploymentId,
              filename: part.filename,
            }),
            content: part.text,
          });
        }
      }

      return {
        ...edgeFunction,
        entrypoint_path,
        import_map_path,
        files,
      };
    },
    async deployEdgeFunction(
      projectId: string,
      options: DeployEdgeFunctionOptions
    ) {
      let {
        name,
        entrypoint_path,
        import_map_path,
        files: inputFiles,
      } = deployEdgeFunctionOptionsSchema.parse(options);

      let existingEdgeFunction: EdgeFunction | undefined;
      try {
        existingEdgeFunction = await functions.getEdgeFunction(projectId, name);
      } catch (error) {}

      const import_map_file = inputFiles.find((file) =>
        ['deno.json', 'import_map.json'].includes(file.name)
      );

      // Use existing import map path or file name heuristic if not provided
      import_map_path ??=
        existingEdgeFunction?.import_map_path ?? import_map_file?.name;

      const response = await managementApiClient.POST(
        '/v1/projects/{ref}/functions/deploy',
        {
          params: {
            path: {
              ref: projectId,
            },
            query: { slug: name },
          },
          body: {
            metadata: {
              name,
              entrypoint_path,
              import_map_path,
            },
            file: inputFiles as any, // We need to pass file name and content to our serializer
          },
          bodySerializer(body) {
            const formData = new FormData();

            const blob = new Blob([JSON.stringify(body.metadata)], {
              type: 'application/json',
            });
            formData.append('metadata', blob);

            body.file?.forEach((f: any) => {
              const file: { name: string; content: string } = f;
              const blob = new Blob([file.content], {
                type: 'application/typescript',
              });
              formData.append('file', blob, file.name);
            });

            return formData;
          },
        }
      );

      assertSuccess(response, 'Failed to deploy Edge Function');

      return response.data;
    },
  };

  const branching: BranchingOperations = {
    async listBranches(projectId: string) {
      const response = await managementApiClient.GET(
        '/v1/projects/{ref}/branches',
        {
          params: {
            path: {
              ref: projectId,
            },
          },
        }
      );

      // There are no branches if branching is disabled
      if (response.response.status === 422) return [];
      assertSuccess(response, 'Failed to list branches');

      return response.data;
    },
    async createBranch(projectId: string, options: CreateBranchOptions) {
      const { name } = createBranchOptionsSchema.parse(options);

      const createBranchResponse = await managementApiClient.POST(
        '/v1/projects/{ref}/branches',
        {
          params: {
            path: {
              ref: projectId,
            },
          },
          body: {
            branch_name: name,
          },
        }
      );

      assertSuccess(createBranchResponse, 'Failed to create branch');

      return createBranchResponse.data;
    },
    async deleteBranch(branchId: string) {
      const response = await managementApiClient.DELETE(
        '/v1/branches/{branch_id}',
        {
          params: {
            path: {
              branch_id: branchId,
            },
          },
        }
      );

      assertSuccess(response, 'Failed to delete branch');
    },
    async mergeBranch(branchId: string) {
      const response = await managementApiClient.POST(
        '/v1/branches/{branch_id}/merge',
        {
          params: {
            path: {
              branch_id: branchId,
            },
          },
          body: {},
        }
      );

      assertSuccess(response, 'Failed to merge branch');
    },
    async resetBranch(branchId: string, options: ResetBranchOptions) {
      const { migration_version } = resetBranchOptionsSchema.parse(options);

      const response = await managementApiClient.POST(
        '/v1/branches/{branch_id}/reset',
        {
          params: {
            path: {
              branch_id: branchId,
            },
          },
          body: {
            migration_version,
          },
        }
      );

      assertSuccess(response, 'Failed to reset branch');
    },
    async rebaseBranch(branchId: string) {
      const response = await managementApiClient.POST(
        '/v1/branches/{branch_id}/push',
        {
          params: {
            path: {
              branch_id: branchId,
            },
          },
          body: {},
        }
      );

      assertSuccess(response, 'Failed to rebase branch');
    },
  };

  const storage: StorageOperations = {
    // Storage methods
    async listAllBuckets(project_id: string) {
      const response = await managementApiClient.GET(
        '/v1/projects/{ref}/storage/buckets',
        {
          params: {
            path: {
              ref: project_id,
            },
          },
        }
      );

      assertSuccess(response, 'Failed to list storage buckets');

      return response.data;
    },

    async getStorageConfig(project_id: string) {
      const response = await managementApiClient.GET(
        '/v1/projects/{ref}/config/storage',
        {
          params: {
            path: {
              ref: project_id,
            },
          },
        }
      );

      assertSuccess(response, 'Failed to get storage config');

      return response.data;
    },

    async updateStorageConfig(projectId: string, config: StorageConfig) {
      const response = await managementApiClient.PATCH(
        '/v1/projects/{ref}/config/storage',
        {
          params: {
            path: {
              ref: projectId,
            },
          },
          body: {
            fileSizeLimit: config.fileSizeLimit,
            features: {
              imageTransformation: {
                enabled: config.features.imageTransformation.enabled,
              },
              s3Protocol: {
                enabled: config.features.s3Protocol.enabled,
              },
            },
          },
        }
      );

      assertSuccess(response, 'Failed to update storage config');

      return response.data;
    },
  };

  const secrets: SecretsOperations = {
    async getServiceRoleKey(projectId: string): Promise<string> {
      // Use project context service role key if available and matches the requested project
      if (
        projectContext?.hasProjectConfig &&
        projectContext.credentials.projectId === projectId &&
        projectContext.credentials.serviceRoleKey
      ) {
        if (clientContext?.isClaudeCLI) {
          console.log(
            `🎯 Using service role key from local config (${projectContext.configSource})`
          );
        }
        return projectContext.credentials.serviceRoleKey;
      }

      // Fallback to fetching from Management API
      const response = await managementApiClient.GET(
        '/v1/projects/{ref}/api-keys',
        {
          params: {
            path: {
              ref: projectId,
            },
            query: {
              reveal: true, // Need to reveal to get the actual key
            },
          },
        }
      );

      assertSuccess(response, 'Failed to fetch API keys');

      const serviceRoleKey = response.data?.find((key) => key.name === 'service_role');

      if (!serviceRoleKey?.api_key) {
        throw new Error('Service role key not found');
      }

      return serviceRoleKey.api_key;
    },
    async listApiKeys(projectId: string, reveal?: boolean) {
      const response = await managementApiClient.GET(
        '/v1/projects/{ref}/api-keys',
        {
          params: {
            path: {
              ref: projectId,
            },
            query: {
              ...(reveal !== undefined && { reveal }),
            },
          },
        }
      );

      assertSuccess(response, 'Failed to list API keys');

      return response.data as any;
    },
    async getApiKey(projectId: string, keyId: string, reveal?: boolean) {
      const response = await managementApiClient.GET(
        '/v1/projects/{ref}/api-keys/{id}',
        {
          params: {
            path: {
              ref: projectId,
              id: keyId,
            },
            query: {
              ...(reveal !== undefined && { reveal }),
            },
          },
        }
      );

      assertSuccess(response, 'Failed to get API key');

      return response.data as any;
    },
    async createApiKey(projectId: string, options, reveal?: boolean) {
      const response = await managementApiClient.POST(
        '/v1/projects/{ref}/api-keys',
        {
          params: {
            path: {
              ref: projectId,
            },
            query: {
              ...(reveal !== undefined && { reveal }),
            },
          },
          body: options as any,
        }
      );

      assertSuccess(response, 'Failed to create API key');

      return response.data as any;
    },
    async updateApiKey(
      projectId: string,
      keyId: string,
      options,
      reveal?: boolean
    ) {
      const response = await managementApiClient.PATCH(
        '/v1/projects/{ref}/api-keys/{id}',
        {
          params: {
            path: {
              ref: projectId,
              id: keyId,
            },
            query: {
              ...(reveal !== undefined && { reveal }),
            },
          },
          body: options as any,
        }
      );

      assertSuccess(response, 'Failed to update API key');

      return response.data as any;
    },
    async deleteApiKey(projectId: string, keyId: string, options = {}) {
      const response = await managementApiClient.DELETE(
        '/v1/projects/{ref}/api-keys/{id}',
        {
          params: {
            path: {
              ref: projectId,
              id: keyId,
            },
            query: {
              ...options,
            },
          },
        }
      );

      assertSuccess(response, 'Failed to delete API key');

      return response.data as any;
    },
  };

  const backup: BackupOperations = {
    async listBackups(projectId: string) {
      const response = await managementApiClient.GET(
        '/v1/projects/{ref}/database/backups',
        {
          params: {
            path: {
              ref: projectId,
            },
          },
        }
      );

      assertSuccess(response, 'Failed to list backups');

      // The API returns an object with backups array, not a direct array
      return (response.data as any)?.backups || [];
    },
    async createBackup(projectId: string, region?: string) {
      // Note: The API doesn't have a direct create backup endpoint
      // This might need to be implemented via creating a restore point
      throw new Error('Direct backup creation is not supported. Use createRestorePoint instead.');
    },
    async restoreBackup(projectId: string, backupId: string) {
      const response = await managementApiClient.POST(
        '/v1/projects/{ref}/database/backups/restore-point',
        {
          params: {
            path: {
              ref: projectId,
            },
          },
          body: {
            backup_id: backupId,
          } as any,
        }
      );

      assertSuccess(response, 'Failed to restore backup');

      return response.data;
    },
    async restoreToPointInTime(projectId: string, timestamp: string) {
      const response = await managementApiClient.POST(
        '/v1/projects/{ref}/database/backups/restore-pitr',
        {
          params: {
            path: {
              ref: projectId,
            },
          },
          body: {
            recovery_time: timestamp,
          } as any,
        }
      );

      assertSuccess(response, 'Failed to restore to point in time');

      return response.data;
    },
    async undoRestore(projectId: string) {
      const response = await managementApiClient.POST(
        '/v1/projects/{ref}/database/backups/undo',
        {
          params: {
            path: {
              ref: projectId,
            },
          },
          body: {} as any,
        }
      );

      assertSuccess(response, 'Failed to undo restore');
    },
    async listRestorePoints(projectId: string) {
      const response = await managementApiClient.GET(
        '/v1/projects/{ref}/database/backups/restore-point',
        {
          params: {
            path: {
              ref: projectId,
            },
          },
        }
      );

      assertSuccess(response, 'Failed to list restore points');

      // Return as array - API may return object or array depending on response
      const data = response.data as any;
      return Array.isArray(data) ? data : (data?.restore_points || []);
    },
    async createRestorePoint(projectId: string) {
      const response = await managementApiClient.POST(
        '/v1/projects/{ref}/database/backups/restore-point',
        {
          params: {
            path: {
              ref: projectId,
            },
          },
          body: {} as any,
        }
      );

      assertSuccess(response, 'Failed to create restore point');

      return response.data;
    },
  };

  const customDomain: CustomDomainOperations = {
    async getCustomHostname(projectId: string) {
      const response = await managementApiClient.GET(
        '/v1/projects/{ref}/custom-hostname',
        { params: { path: { ref: projectId } } }
      );
      assertSuccess(response, 'Failed to get custom hostname');
      return response.data;
    },

    async createCustomHostname(projectId: string, hostname: string) {
      const response = await managementApiClient.POST(
        '/v1/projects/{ref}/custom-hostname/initialize',
        {
          params: { path: { ref: projectId } },
          body: { custom_hostname: hostname } as any,
        }
      );
      assertSuccess(response, 'Failed to create custom hostname');
      return response.data;
    },

    async initializeCustomHostname(projectId: string) {
      // Re-initialize/refresh the DNS configuration
      const response = await managementApiClient.POST(
        '/v1/projects/{ref}/custom-hostname/initialize',
        {
          params: { path: { ref: projectId } },
          body: {} as any,
        }
      );
      assertSuccess(response, 'Failed to initialize custom hostname');
      return response.data;
    },

    async activateCustomHostname(projectId: string) {
      const response = await managementApiClient.POST(
        '/v1/projects/{ref}/custom-hostname/activate',
        {
          params: { path: { ref: projectId } },
          body: {} as any,
        }
      );
      assertSuccess(response, 'Failed to activate custom hostname');
      return response.data;
    },

    async reverifyCustomHostname(projectId: string) {
      const response = await managementApiClient.POST(
        '/v1/projects/{ref}/custom-hostname/reverify',
        {
          params: { path: { ref: projectId } },
          body: {} as any,
        }
      );
      assertSuccess(response, 'Failed to reverify custom hostname');
      return response.data;
    },

    async deleteCustomHostname(projectId: string) {
      const response = await managementApiClient.DELETE(
        '/v1/projects/{ref}/custom-hostname',
        { params: { path: { ref: projectId } } }
      );
      assertSuccess(response, 'Failed to delete custom hostname');
    },

    async getVanitySubdomain(projectId: string) {
      const response = await managementApiClient.GET(
        '/v1/projects/{ref}/vanity-subdomain',
        { params: { path: { ref: projectId } } }
      );
      assertSuccess(response, 'Failed to get vanity subdomain');
      return response.data;
    },

    async createVanitySubdomain(projectId: string, subdomain: string) {
      // Creating and activating a vanity subdomain is done in one step via the activate endpoint
      const response = await managementApiClient.POST(
        '/v1/projects/{ref}/vanity-subdomain/activate',
        {
          params: { path: { ref: projectId } },
          body: { vanity_subdomain: subdomain } as any,
        }
      );
      assertSuccess(response, 'Failed to create vanity subdomain');
      return response.data;
    },

    async checkSubdomainAvailability(projectId: string, subdomain: string) {
      const response = await managementApiClient.POST(
        '/v1/projects/{ref}/vanity-subdomain/check-availability',
        {
          params: { path: { ref: projectId } },
          body: { vanity_subdomain: subdomain } as any,
        }
      );
      assertSuccess(response, 'Failed to check subdomain availability');
      return response.data as { available: boolean };
    },

    async activateVanitySubdomain(projectId: string) {
      // If the subdomain is already set, this re-activates it
      // Otherwise, a subdomain must be provided via createVanitySubdomain
      const response = await managementApiClient.POST(
        '/v1/projects/{ref}/vanity-subdomain/activate',
        {
          params: { path: { ref: projectId } },
          body: {} as any,
        }
      );
      assertSuccess(response, 'Failed to activate vanity subdomain');
      return response.data;
    },

    async deleteVanitySubdomain(projectId: string) {
      const response = await managementApiClient.DELETE(
        '/v1/projects/{ref}/vanity-subdomain',
        { params: { path: { ref: projectId } } }
      );
      assertSuccess(response, 'Failed to delete vanity subdomain');
    },
  };

  const databaseConfig: DatabaseConfigOperations = {
    async getPostgresConfig(projectId: string) {
      const response = await managementApiClient.GET(
        '/v1/projects/{ref}/config/database/postgres',
        { params: { path: { ref: projectId } } }
      );
      assertSuccess(response, 'Failed to get postgres config');
      return response.data;
    },

    async updatePostgresConfig(projectId: string, config: unknown) {
      const response = await managementApiClient.PUT(
        '/v1/projects/{ref}/config/database/postgres',
        {
          params: { path: { ref: projectId } },
          body: config as any,
        }
      );
      assertSuccess(response, 'Failed to update postgres config');
      return response.data;
    },

    async getPoolerConfig(projectId: string) {
      const response = await managementApiClient.GET(
        '/v1/projects/{ref}/config/database/pgbouncer',
        { params: { path: { ref: projectId } } }
      );
      assertSuccess(response, 'Failed to get pooler config');
      return response.data;
    },

    async updatePoolerConfig(projectId: string, config: unknown) {
      const response = await managementApiClient.PATCH(
        '/v1/projects/{ref}/config/database/pooler',
        {
          params: { path: { ref: projectId } },
          body: config as any,
        }
      );
      assertSuccess(response, 'Failed to update pooler config');
      return response.data;
    },

    async configurePgBouncer(projectId: string, settings: unknown) {
      const response = await managementApiClient.PATCH(
        '/v1/projects/{ref}/config/database/pooler',
        {
          params: { path: { ref: projectId } },
          body: settings as any,
        }
      );
      assertSuccess(response, 'Failed to configure pgbouncer');
    },

    async getPostgrestConfig(projectId: string) {
      const response = await managementApiClient.GET(
        '/v1/projects/{ref}/postgrest',
        { params: { path: { ref: projectId } } }
      );
      assertSuccess(response, 'Failed to get postgrest config');
      return response.data;
    },

    async updatePostgrestConfig(projectId: string, config: unknown) {
      const response = await managementApiClient.PATCH(
        '/v1/projects/{ref}/postgrest',
        {
          params: { path: { ref: projectId } },
          body: config as any,
        }
      );
      assertSuccess(response, 'Failed to update postgrest config');
    },

    async getPgsodiumConfig(projectId: string) {
      const response = await managementApiClient.GET(
        '/v1/projects/{ref}/pgsodium',
        { params: { path: { ref: projectId } } }
      );
      assertSuccess(response, 'Failed to get pgsodium config');
      return response.data;
    },

    async updatePgsodiumConfig(projectId: string, config: unknown) {
      const response = await managementApiClient.PUT(
        '/v1/projects/{ref}/pgsodium',
        {
          params: { path: { ref: projectId } },
          body: config as any,
        }
      );
      assertSuccess(response, 'Failed to update pgsodium config');
      return response.data;
    },

    async enableDatabaseWebhooks(projectId: string) {
      const response = await managementApiClient.POST(
        '/v1/projects/{ref}/database/webhooks/enable',
        {
          params: { path: { ref: projectId } },
          body: {} as any,
        }
      );
      assertSuccess(response, 'Failed to enable database webhooks');
    },

    async configurePitr(
      projectId: string,
      config: { enabled: boolean; retention_period?: number }
    ) {
      // Note: PITR configuration is managed through project addons, not a direct config endpoint
      // This is a placeholder implementation
      throw new Error(
        'PITR configuration is managed through the Supabase dashboard or via project addons API. ' +
        'This method is not yet implemented in the Management API.'
      );
    },

    async managePgSodium(projectId: string, action: 'enable' | 'disable') {
      // Note: pgsodium enable/disable is managed through updatePgsodiumConfig()
      // The Management API does not have dedicated enable/disable endpoints
      throw new Error(
        `Use updatePgsodiumConfig() to ${action} pgsodium. ` +
        'Dedicated enable/disable endpoints are not available in the Management API.'
      );
    },

    async manageReadReplicas(projectId: string, action: 'setup' | 'remove') {
      if (action === 'setup') {
        const response = await managementApiClient.POST(
          '/v1/projects/{ref}/read-replicas/setup',
          {
            params: { path: { ref: projectId } },
            body: {} as any,
          }
        );
        assertSuccess(response, 'Failed to setup read replicas');
      } else {
        const response = await managementApiClient.POST(
          '/v1/projects/{ref}/read-replicas/remove',
          {
            params: { path: { ref: projectId } },
            body: {} as any,
          }
        );
        assertSuccess(response, 'Failed to remove read replicas');
      }
    },
  };

  const platform: SupabasePlatform = {
    async init(info: InitData) {
      const { clientInfo } = info;
      if (!clientInfo) {
        throw new Error('Client info is required');
      }

      // Update client context with actual client info
      const userAgent = `supabase-mcp/${version} (${clientInfo.name}/${clientInfo.version})`;
      const updatedClientContext = detectClientContext(clientInfo, userAgent);

      // Re-initialize the management API client with the user agent and updated context
      managementApiClient = createManagementApiClient(
        managementApiUrl,
        accessToken,
        {
          'User-Agent': userAgent,
        },
        updatedClientContext
      );
    },
    account,
    database,
    debugging,
    development,
    functions,
    branching,
    storage,
    secrets,
    backup,
    customDomain,
    databaseConfig,
  };

  return platform;
}

function getProjectDomain(apiHostname: string) {
  switch (apiHostname) {
    case 'api.supabase.com':
      return 'supabase.co';
    case 'api.supabase.green':
      return 'supabase.green';
    default:
      return 'supabase.red';
  }
}
