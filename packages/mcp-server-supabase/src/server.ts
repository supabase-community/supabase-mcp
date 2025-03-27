import {
  PostgresMetaBase,
  wrapError,
  wrapResult,
} from '@gregnr/postgres-meta/base';
import { createMcpServer, tool } from '@supabase/mcp-utils';
import { z } from 'zod';
import { version } from '../package.json';
import { createManagementApiClient } from './management-api/index.js';

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

  const managementApiClient = createManagementApiClient(
    managementApiUrl,
    options.platform.accessToken
  );

  async function query<T>(projectId: string, query: string): Promise<T[]> {
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
        headers: {
          'user-agent': getUserAgent(),
        },
      }
    );

    if (response.error) {
      throw new Error(response.error);
    }

    return response.data as unknown as T[];
  }

  function createPGMeta(projectId: string) {
    return new PostgresMetaBase({
      query: async (sql) => {
        try {
          const res = await query(projectId, sql);
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

    // Note: tools are intentionally snake_case to align better with most MCP clients
    tools: {
      get_user_agent: tool({
        description: 'Gets the user agent string.',
        parameters: z.object({}),
        execute: async () => {
          return getUserAgent();
        },
      }),
      get_projects: tool({
        description: 'Gets all Supabase projects for the user.',
        parameters: z.object({}),
        execute: async () => {
          const response = await managementApiClient.GET('/v1/projects', {
            headers: {
              'user-agent': getUserAgent(),
            },
          });
          return response.data;
        },
      }),
      get_organizations: tool({
        description: 'Gets all organizations for the user.',
        parameters: z.object({}),
        execute: async () => {
          const response = await managementApiClient.GET('/v1/organizations', {
            headers: {
              'user-agent': getUserAgent(),
            },
          });
          return response.data;
        },
      }),
      get_organization: tool({
        description: 'Gets an organization by ID.',
        parameters: z.object({
          orgId: z.string().describe('The organization ID'),
        }),
        execute: async ({ orgId: organizationId }) => {
          const response = await managementApiClient.GET(
            '/v1/organizations/{slug}',
            {
              params: {
                path: {
                  slug: organizationId,
                },
              },
              headers: {
                'user-agent': getUserAgent(),
              },
            }
          );
          return response.data;
        },
      }),
      get_tables: tool({
        description: 'Gets all tables in a schema.',
        parameters: z.object({
          projectId: z.string(),
          schema: z.string(),
        }),
        execute: async ({ projectId, schema }) => {
          const pgMeta = createPGMeta(projectId);
          return await pgMeta.tables.list({ includedSchemas: [schema] });
        },
      }),
      get_extensions: tool({
        description: 'Gets all extensions in the database.',
        parameters: z.object({
          projectId: z.string(),
        }),
        execute: async ({ projectId }) => {
          const pgMeta = createPGMeta(projectId);
          return await pgMeta.extensions.list();
        },
      }),
      apply_migration: tool({
        description:
          'Applies a migration to the database. Use this when executing DDL operations.',
        parameters: z.object({
          projectId: z.string(),
          name: z.string(),
          query: z.string(),
        }),
        execute: async ({ projectId, name, query }) => {
          const response = await managementApiClient.POST(
            '/v1/projects/{ref}/database/migrations',
            {
              headers: {
                'user-agent': getUserAgent(),
              },
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

          if (response.error) {
            throw new Error(JSON.stringify(response.error));
          }

          return response.data;
        },
      }),
      execute_sql: tool({
        description:
          'Executes raw SQL in the Postgres database. Use `applyMigration` instead for DDL operations.',
        parameters: z.object({
          projectId: z.string(),
          sql: z.string(),
        }),
        execute: async ({ sql, projectId }) => {
          return await query(projectId, sql);
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
              headers: {
                'user-agent': getUserAgent(),
              },
            }
          );

          if (response.error) {
            throw new Error(response.error);
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
              headers: {
                'user-agent': getUserAgent(),
              },
            }
          );

          if (response.error) {
            throw new Error(response.error);
          }

          return response.data;
        },
      }),
    },
  });

  function getUserAgent() {
    const clientInfo = server.getClientVersion();
    if (clientInfo) {
      return `supabase-mcp/${version} (${clientInfo.name}/${clientInfo.version})`;
    }
    return `supabase-mcp/${version}`;
  }

  return server;
}
