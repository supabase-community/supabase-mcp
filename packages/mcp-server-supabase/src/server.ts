import {
  PostgresMetaBase,
  wrapError,
  wrapResult,
} from '@gregnr/postgres-meta/base';
import { createMcpServer, tool } from '@supabase/mcp-utils';
import { z } from 'zod';
import { version } from '../package.json';
import {
  createManagementApiClient,
  type ManagementApiClient,
} from './management-api/index.js';

export type SupabasePlatformOptions = {
  apiUrl?: string;
  accessToken: string;
};

export type SupabaseMcpServerOptions = {
  platform: SupabasePlatformOptions;
};

/**
 * Creates an MCP server for interacting with Supabase.
 */
export function createSupabaseMcpServer(options: SupabaseMcpServerOptions) {
  const managementApiUrl =
    options.platform.apiUrl ?? 'https://api.supabase.com';

  let managementApiClient: ManagementApiClient;

  async function executeSql<T>(projectId: string, query: string): Promise<T[]> {
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
        },
      }
    );

    if (!response.response.ok) {
      throw new Error('Failed to execute SQL query');
    }

    return response.data as unknown as T[];
  }

  function createPGMeta(projectId: string) {
    return new PostgresMetaBase({
      query: async (sql) => {
        try {
          const res = await executeSql(projectId, sql);
          return wrapResult<any[]>(res);
        } catch (error) {
          return wrapError(error, sql);
        }
      },
      end: async () => {},
    });
  }

  const server = createMcpServer({
    name: 'supabase',
    version,
    onInitialize(clientInfo) {
      managementApiClient = createManagementApiClient(
        managementApiUrl,
        options.platform.accessToken,
        {
          'User-Agent': `supabase-mcp/${version} (${clientInfo.name}/${clientInfo.version})`,
        }
      );
    },

    // Note: tools are intentionally snake_case to align better with most MCP clients
    tools: {
      get_projects: tool({
        description: 'Gets all Supabase projects for the user.',
        parameters: z.object({}),
        execute: async () => {
          const response = await managementApiClient.GET('/v1/projects');

          if (!response.response.ok) {
            throw new Error(`Failed to fetch projects`);
          }

          return response.data;
        },
      }),
      get_organizations: tool({
        description: 'Gets all organizations for the user.',
        parameters: z.object({}),
        execute: async () => {
          const response = await managementApiClient.GET('/v1/organizations');

          if (!response.response.ok) {
            throw new Error('Failed to fetch organizations');
          }

          return response.data;
        },
      }),
      get_organization: tool({
        description: 'Gets an organization by ID.',
        parameters: z.object({
          id: z.string().describe('The organization ID'),
        }),
        execute: async ({ id: organizationId }) => {
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

          if (!response.response.ok) {
            throw new Error('Failed to fetch organization');
          }

          return response.data;
        },
      }),
      get_tables: tool({
        description: 'Gets all tables in a schema.',
        parameters: z.object({
          projectId: z.string(),
          schemas: z
            .optional(z.array(z.string()))
            .describe(
              'Optional list of schemas to include. Defaults to all schemas.'
            ),
        }),
        execute: async ({ projectId, schemas }) => {
          const pgMeta = createPGMeta(projectId);
          const { data, error } = await pgMeta.tables.list({
            includedSchemas: schemas,
          });

          if (error) {
            throw new Error(`Error fetching tables: ${error.message}`);
          }
          return data;
        },
      }),
      get_extensions: tool({
        description: 'Gets all extensions in the database.',
        parameters: z.object({
          projectId: z.string(),
        }),
        execute: async ({ projectId }) => {
          const pgMeta = createPGMeta(projectId);
          const { data, error } = await pgMeta.extensions.list();

          if (error) {
            throw new Error(`Error fetching extensions: ${error.message}`);
          }
          return data;
        },
      }),
      apply_migration: tool({
        description:
          'Applies a migration to the database. Use this when executing DDL operations.',
        parameters: z.object({
          projectId: z.string(),
          name: z.string().describe('The name of the migration in snake_case'),
          query: z.string().describe('The SQL query to apply'),
        }),
        execute: async ({ projectId, name, query }) => {
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
            } as any // TODO: remove once API spec updated to include body
          );

          if (!response.response.ok) {
            throw new Error('Failed to apply migration');
          }

          return response.data;
        },
      }),
      execute_sql: tool({
        description:
          'Executes raw SQL in the Postgres database. Use `applyMigration` instead for DDL operations.',
        parameters: z.object({
          projectId: z.string(),
          query: z.string().describe('The SQL query to execute'),
        }),
        execute: async ({ query, projectId }) => {
          return await executeSql(projectId, query);
        },
      }),
      get_project_url: tool({
        description: 'Gets the API URL for a project.',
        parameters: z.object({
          projectId: z.string(),
        }),
        execute: async ({ projectId }) => {
          return `https://${projectId}.supabase.co`;
        },
      }),
      get_anon_key: tool({
        description: 'Gets the anonymous API key for a project.',
        parameters: z.object({
          projectId: z.string(),
        }),
        execute: async ({ projectId }) => {
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

          if (!response.response.ok) {
            throw new Error('Failed to fetch API keys');
          }

          const anonKey = response.data?.find((key) => key.name === 'anon');

          if (!anonKey) {
            throw new Error('Anonymous key not found');
          }

          return anonKey.api_key;
        },
      }),
      generate_typescript_types: tool({
        description: 'Generates TypeScript types for a project.',
        parameters: z.object({
          projectId: z.string(),
        }),
        execute: async ({ projectId }) => {
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

          if (!response.response.ok) {
            throw new Error('Failed to fetch TypeScript types');
          }

          return response.data;
        },
      }),
    },
  });

  return server;
}
