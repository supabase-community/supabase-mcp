import { tool } from '@supabase/mcp-utils';
import { z } from 'zod';
import type { AccountOperations } from '../platform/types.js';
import { type Cost, getBranchCost, getNextProjectCost } from '../pricing.js';
import { AWS_REGION_CODES } from '../regions.js';
import { hashObject } from '../util.js';

export type AccountToolsOptions = {
  account: AccountOperations;
};

export function getAccountTools({ account }: AccountToolsOptions) {
  return {
    list_organizations: tool({
      description: 'Lists all organizations that the user is a member of.',
      parameters: z.object({}),
      execute: async () => {
        return await account.listOrganizations();
      },
    }),
    get_organization: tool({
      description:
        'Gets details for an organization. Includes subscription plan.',
      parameters: z.object({
        id: z.string().describe('The organization ID'),
      }),
      execute: async ({ id: organizationId }) => {
        return await account.getOrganization(organizationId);
      },
    }),
    list_projects: tool({
      description:
        'Lists all Supabase projects for the user. Use this to help discover the project ID of the project that the user is working on.',
      parameters: z.object({}),
      execute: async () => {
        return await account.listProjects();
      },
    }),
    get_project: tool({
      description: 'Gets details for a Supabase project.',
      parameters: z.object({
        id: z.string().describe('The project ID'),
      }),
      execute: async ({ id }) => {
        return await account.getProject(id);
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
            const cost = await getNextProjectCost(account, organization_id);
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
        const cost = await getNextProjectCost(account, organization_id);
        const costHash = await hashObject(cost);
        if (costHash !== confirm_cost_id) {
          throw new Error(
            'Cost confirmation ID does not match the expected cost of creating a project.'
          );
        }

        return await account.createProject({
          name,
          region,
          organization_id,
        });
      },
    }),
    pause_project: tool({
      description: 'Pauses a Supabase project.',
      parameters: z.object({
        project_id: z.string(),
      }),
      execute: async ({ project_id }) => {
        return await account.pauseProject(project_id);
      },
    }),
    restore_project: tool({
      description: 'Restores a Supabase project.',
      parameters: z.object({
        project_id: z.string(),
      }),
      execute: async ({ project_id }) => {
        return await account.restoreProject(project_id);
      },
    }),
  };
}
