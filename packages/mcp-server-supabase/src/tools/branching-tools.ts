import { tool } from '@supabase/mcp-utils';
import { z } from 'zod';
import {
  assertSuccess,
  type ManagementApiClient,
} from '../management-api/index.js';
import { getBranchCost } from '../pricing.js';
import { hashObject } from '../util.js';
import { injectableTool } from './util.js';

export type BranchingToolsOptions = {
  managementApiClient: ManagementApiClient;
  projectId?: string;
};

export function getBranchingTools({
  managementApiClient,
  projectId,
}: BranchingToolsOptions) {
  const project_id = projectId;

  return {
    create_branch: injectableTool({
      description:
        'Creates a development branch on a Supabase project. This will apply all migrations from the main project to a fresh branch database. Note that production data will not carry over. The branch will get its own project_id via the resulting project_ref. Use this ID to execute queries and migrations on the branch.',
      parameters: z.object({
        project_id: z.string(),
        name: z
          .string()
          .default('develop')
          .describe('Name of the branch to create'),
        confirm_cost_id: z
          .string({
            required_error:
              'User must confirm understanding of costs before creating a branch.',
          })
          .describe('The cost confirmation ID. Call `confirm_cost` first.'),
      }),
      inject: { project_id },
      execute: async ({ project_id, name, confirm_cost_id }) => {
        const cost = getBranchCost();
        const costHash = await hashObject(cost);
        if (costHash !== confirm_cost_id) {
          throw new Error(
            'Cost confirmation ID does not match the expected cost of creating a branch.'
          );
        }

        const createBranchResponse = await managementApiClient.POST(
          '/v1/projects/{ref}/branches',
          {
            params: {
              path: {
                ref: project_id,
              },
            },
            body: {
              branch_name: name,
            },
          }
        );

        assertSuccess(createBranchResponse, 'Failed to create branch');

        // Creating a default branch means we just enabled branching
        // TODO: move this logic to API eventually.
        if (createBranchResponse.data.is_default) {
          await managementApiClient.PATCH('/v1/branches/{branch_id}', {
            params: {
              path: {
                branch_id: createBranchResponse.data.id,
              },
            },
            body: {
              branch_name: 'main',
            },
          });

          const response = await managementApiClient.POST(
            '/v1/projects/{ref}/branches',
            {
              params: {
                path: {
                  ref: project_id,
                },
              },
              body: {
                branch_name: name,
              },
            }
          );

          assertSuccess(response, 'Failed to create branch');

          return response.data;
        }

        return createBranchResponse.data;
      },
    }),
    list_branches: injectableTool({
      description:
        'Lists all development branches of a Supabase project. This will return branch details including status which you can use to check when operations like merge/rebase/reset complete.',
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        const response = await managementApiClient.GET(
          '/v1/projects/{ref}/branches',
          {
            params: {
              path: {
                ref: project_id,
              },
            },
          }
        );

        // There are no branches if branching is disabled
        if (response.response.status === 422) return [];
        assertSuccess(response, 'Failed to list branches');

        return response.data;
      },
    }),
    delete_branch: tool({
      description: 'Deletes a development branch.',
      parameters: z.object({
        branch_id: z.string(),
      }),
      execute: async ({ branch_id }) => {
        const response = await managementApiClient.DELETE(
          '/v1/branches/{branch_id}',
          {
            params: {
              path: {
                branch_id,
              },
            },
          }
        );

        assertSuccess(response, 'Failed to delete branch');

        return response.data;
      },
    }),
    merge_branch: tool({
      description:
        'Merges migrations and edge functions from a development branch to production.',
      parameters: z.object({
        branch_id: z.string(),
      }),
      execute: async ({ branch_id }) => {
        const response = await managementApiClient.POST(
          '/v1/branches/{branch_id}/merge',
          {
            params: {
              path: {
                branch_id,
              },
            },
            body: {},
          }
        );

        assertSuccess(response, 'Failed to merge branch');

        return response.data;
      },
    }),
    reset_branch: tool({
      description:
        'Resets migrations of a development branch. Any untracked data or schema changes will be lost.',
      parameters: z.object({
        branch_id: z.string(),
        migration_version: z
          .string()
          .optional()
          .describe(
            'Reset your development branch to a specific migration version.'
          ),
      }),
      execute: async ({ branch_id, migration_version }) => {
        const response = await managementApiClient.POST(
          '/v1/branches/{branch_id}/reset',
          {
            params: {
              path: {
                branch_id,
              },
            },
            body: {
              migration_version,
            },
          }
        );

        assertSuccess(response, 'Failed to reset branch');

        return response.data;
      },
    }),
    rebase_branch: tool({
      description:
        'Rebases a development branch on production. This will effectively run any newer migrations from production onto this branch to help handle migration drift.',
      parameters: z.object({
        branch_id: z.string(),
      }),
      execute: async ({ branch_id }) => {
        const response = await managementApiClient.POST(
          '/v1/branches/{branch_id}/push',
          {
            params: {
              path: {
                branch_id,
              },
            },
            body: {},
          }
        );

        assertSuccess(response, 'Failed to rebase branch');

        return response.data;
      },
    }),
  };
}
