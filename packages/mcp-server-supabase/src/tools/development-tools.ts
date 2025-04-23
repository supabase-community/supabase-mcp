import { tool } from '@supabase/mcp-utils';
import { z } from 'zod';
import {
  assertSuccess,
  type ManagementApiClient,
} from '../management-api/index.js';
import { injectProjectId } from './util.js';

export type DevelopmentToolsOptions = {
  managementApiClient: ManagementApiClient;
  projectId?: string;
};

export function getDevelopmentTools({
  managementApiClient,
  projectId,
}: DevelopmentToolsOptions) {
  return {
    get_project_url: injectProjectId(
      projectId,
      tool({
        description: 'Gets the API URL for a project.',
        parameters: z.object({
          project_id: z.string(),
        }),
        execute: async ({ project_id }) => {
          return `https://${project_id}.supabase.co`;
        },
      })
    ),
    get_anon_key: injectProjectId(
      projectId,
      tool({
        description: 'Gets the anonymous API key for a project.',
        parameters: z.object({
          project_id: z.string(),
        }),
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
      })
    ),
    generate_typescript_types: injectProjectId(
      projectId,
      tool({
        description: 'Generates TypeScript types for a project.',
        parameters: z.object({
          project_id: z.string(),
        }),
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
      })
    ),
  };
}
