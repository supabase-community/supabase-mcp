import { z } from 'zod';
import {
  assertSuccess,
  type ManagementApiClient,
} from '../management-api/index.js';
import { listExtensionsSql, listTablesSql } from '../pg-meta/index.js';
import type { PostgresExtension, PostgresTable } from '../pg-meta/types.js';
import { injectableTool } from './util.js';

export type DatabaseOperationToolsOptions = {
  managementApiClient: ManagementApiClient;
  projectId?: string;
  readOnly?: boolean;
};

export function getDatabaseOperationTools({
  managementApiClient,
  projectId,
  readOnly,
}: DatabaseOperationToolsOptions) {
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
          read_only: readOnly,
        },
      }
    );

    assertSuccess(response, 'Failed to execute SQL query');

    return response.data as unknown as T[];
  }

  const project_id = projectId;

  const databaseOperationTools = {
    list_tables: injectableTool({
      description: 'Lists all tables in a schema.',
      parameters: z.object({
        project_id: z.string(),
        schemas: z
          .optional(z.array(z.string()))
          .describe(
            'Optional list of schemas to include. Defaults to all schemas.'
          ),
      }),
      inject: { project_id },
      execute: async ({ project_id, schemas }) => {
        const sql = listTablesSql(schemas);
        const data = await executeSql<PostgresTable>(project_id, sql);
        return data;
      },
    }),
    list_extensions: injectableTool({
      description: 'Lists all extensions in the database.',
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        const sql = listExtensionsSql();
        const data = await executeSql<PostgresExtension>(project_id, sql);
        return data;
      },
    }),
    list_migrations: injectableTool({
      description: 'Lists all migrations in the database.',
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        const response = await managementApiClient.GET(
          '/v1/projects/{ref}/database/migrations',
          {
            params: {
              path: {
                ref: project_id,
              },
            },
          }
        );

        assertSuccess(response, 'Failed to fetch migrations');

        return response.data;
      },
    }),
    apply_migration: injectableTool({
      description:
        'Applies a migration to the database. Use this when executing DDL operations. Do not hardcode references to generated IDs in data migrations.',
      parameters: z.object({
        project_id: z.string(),
        name: z.string().describe('The name of the migration in snake_case'),
        query: z.string().describe('The SQL query to apply'),
      }),
      inject: { project_id },
      execute: async ({ project_id, name, query }) => {
        if (readOnly) {
          throw new Error('Cannot apply migration in read-only mode.');
        }

        const response = await managementApiClient.POST(
          '/v1/projects/{ref}/database/migrations',
          {
            params: {
              path: {
                ref: project_id,
              },
            },
            body: {
              name,
              query,
            },
          }
        );

        assertSuccess(response, 'Failed to apply migration');

        return response.data;
      },
    }),
    execute_sql: injectableTool({
      description:
        'Executes raw SQL in the Postgres database. Use `apply_migration` instead for DDL operations.',
      parameters: z.object({
        project_id: z.string(),
        query: z.string().describe('The SQL query to execute'),
      }),
      inject: { project_id },
      execute: async ({ query, project_id }) => {
        return await executeSql(project_id, query);
      },
    }),
  };

  type test = z.infer<
    (typeof databaseOperationTools)['list_tables']['parameters']
  >;

  return databaseOperationTools;
}
