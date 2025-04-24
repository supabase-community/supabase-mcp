import { z } from 'zod';
import {
  assertSuccess,
  type ManagementApiClient,
} from '../management-api/index.js';
import { injectableTool } from './util.js';

export type DevelopmentToolsOptions = {
  managementApiClient: ManagementApiClient;
  projectId?: string;
};

export function getDevelopmentTools({
  managementApiClient,
  projectId,
}: DevelopmentToolsOptions) {
  const project_id = projectId;

  return {
    get_project_url: injectableTool({
      description: 'Gets the API URL for a project.',
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        return `https://${project_id}.supabase.co`;
      },
    }),
    get_anon_key: injectableTool({
      description: 'Gets the anonymous API key for a project.',
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        const response = await managementApiClient.GET(
          '/v1/projects/{ref}/api-keys',
          {
            params: {
              path: {
                ref: project_id,
              },
              query: {
                reveal: false,
              },
            },
          }
        );

        assertSuccess(response, 'Failed to fetch API keys');

        const anonKey = response.data?.find((key) => key.name === 'anon');

        if (!anonKey) {
          throw new Error('Anonymous key not found');
        }

        return anonKey.api_key;
      },
    }),
    generate_typescript_types: injectableTool({
      description: 'Generates TypeScript types for a project.',
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        const response = await managementApiClient.GET(
          '/v1/projects/{ref}/types/typescript',
          {
            params: {
              path: {
                ref: project_id,
              },
            },
          }
        );

        assertSuccess(response, 'Failed to fetch TypeScript types');

        return response.data;
      },
    }),
  };
}
