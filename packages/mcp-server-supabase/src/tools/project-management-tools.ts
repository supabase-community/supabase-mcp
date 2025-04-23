import { tool } from '@supabase/mcp-utils';
import { z } from 'zod';
import {
  assertSuccess,
  type ManagementApiClient,
} from '../management-api/index.js';
import { generatePassword } from '../password.js';
import { type Cost, getBranchCost, getNextProjectCost } from '../pricing.js';
import {
  AWS_REGION_CODES,
  getClosestAwsRegion,
  getCountryCode,
  getCountryCoordinates,
} from '../regions.js';
import { hashObject } from '../util.js';

export type ProjectManagementToolsOptions = {
  managementApiClient: ManagementApiClient;
};

export function getProjectManagementTools({
  managementApiClient,
}: ProjectManagementToolsOptions) {
  async function getClosestRegion() {
    return getClosestAwsRegion(getCountryCoordinates(await getCountryCode()))
      .code;
  }

  return {
    list_organizations: tool({
      description: 'Lists all organizations that the user is a member of.',
      parameters: z.object({}),
      execute: async () => {
        const response = await managementApiClient.GET('/v1/organizations');

        assertSuccess(response, 'Failed to fetch organizations');

        return response.data;
      },
    }),
    get_organization: tool({
      description:
        'Gets details for an organization. Includes subscription plan.',
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

        assertSuccess(response, 'Failed to fetch organization');

        return response.data;
      },
    }),
    list_projects: tool({
      description: 'Lists all Supabase projects for the user.',
      parameters: z.object({}),
      execute: async () => {
        const response = await managementApiClient.GET('/v1/projects');

        assertSuccess(response, 'Failed to fetch projects');

        return response.data;
      },
    }),
    get_project: tool({
      description: 'Gets details for a Supabase project.',
      parameters: z.object({
        id: z.string().describe('The project ID'),
      }),
      execute: async ({ id }) => {
        const response = await managementApiClient.GET('/v1/projects/{ref}', {
          params: {
            path: {
              ref: id,
            },
          },
        });
        assertSuccess(response, 'Failed to fetch project');
        return response.data;
      },
    }),
    get_cost: tool({
      description:
        'Gets the cost of creating a new project or branch. Never assume organization as costs can be different for each.',
      parameters: z.object({
        type: z.enum(['project', 'branch']),
        organization_id: z
          .string()
          .describe('The organization ID. Always ask the user.'),
      }),
      execute: async ({ type, organization_id }) => {
        function generateResponse(cost: Cost) {
          return `The new ${type} will cost $${cost.amount} ${cost.recurrence}. You must repeat this to the user and confirm their understanding.`;
        }
        switch (type) {
          case 'project': {
            const cost = await getNextProjectCost(
              managementApiClient,
              organization_id
            );
            return generateResponse(cost);
          }
          case 'branch': {
            const cost = getBranchCost();
            return generateResponse(cost);
          }
          default:
            throw new Error(`Unknown cost type: ${type}`);
        }
      },
    }),
    confirm_cost: tool({
      description:
        'Ask the user to confirm their understanding of the cost of creating a new project or branch. Call `get_cost` first. Returns a unique ID for this confirmation which should be passed to `create_project` or `create_branch`.',
      parameters: z.object({
        type: z.enum(['project', 'branch']),
        recurrence: z.enum(['hourly', 'monthly']),
        amount: z.number(),
      }),
      execute: async (cost) => {
        return await hashObject(cost);
      },
    }),
    create_project: tool({
      description:
        'Creates a new Supabase project. Always ask the user which organization to create the project in. The project can take a few minutes to initialize - use `get_project` to check the status.',
      parameters: z.object({
        name: z.string().describe('The name of the project'),
        region: z.optional(
          z
            .enum(AWS_REGION_CODES)
            .describe(
              'The region to create the project in. Defaults to the closest region.'
            )
        ),
        organization_id: z.string(),
        confirm_cost_id: z
          .string({
            required_error:
              'User must confirm understanding of costs before creating a project.',
          })
          .describe('The cost confirmation ID. Call `confirm_cost` first.'),
      }),
      execute: async ({ name, region, organization_id, confirm_cost_id }) => {
        const cost = await getNextProjectCost(
          managementApiClient,
          organization_id
        );
        const costHash = await hashObject(cost);
        if (costHash !== confirm_cost_id) {
          throw new Error(
            'Cost confirmation ID does not match the expected cost of creating a project.'
          );
        }

        const response = await managementApiClient.POST('/v1/projects', {
          body: {
            name,
            region: region ?? (await getClosestRegion()),
            organization_id,
            db_pass: generatePassword({
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
    }),
    pause_project: tool({
      description: 'Pauses a Supabase project.',
      parameters: z.object({
        project_id: z.string(),
      }),
      execute: async ({ project_id }) => {
        const response = await managementApiClient.POST(
          '/v1/projects/{ref}/pause',
          {
            params: {
              path: {
                ref: project_id,
              },
            },
          }
        );

        assertSuccess(response, 'Failed to pause project');
      },
    }),
    restore_project: tool({
      description: 'Restores a Supabase project.',
      parameters: z.object({
        project_id: z.string(),
      }),
      execute: async ({ project_id }) => {
        const response = await managementApiClient.POST(
          '/v1/projects/{ref}/restore',
          {
            params: {
              path: {
                ref: project_id,
              },
            },
            body: {},
          }
        );

        assertSuccess(response, 'Failed to restore project');
      },
    }),
  };
}
