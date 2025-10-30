import { tool, type ToolExecuteContext } from '@supabase/mcp-utils';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { z } from 'zod';
import type { AccountOperations } from '../platform/types.js';
import { type Cost, getBranchCost, getNextProjectCost } from '../pricing.js';
import { AWS_REGION_CODES } from '../regions.js';
import { hashObject } from '../util.js';

const SUCCESS_RESPONSE = { success: true };

export type AccountToolsOptions = {
  account: AccountOperations;
  readOnly?: boolean;
  server?: Server;
};

export function getAccountTools({
  account,
  readOnly,
  server,
}: AccountToolsOptions) {
  return {
    list_organizations: tool({
      description: 'Lists all organizations that the user is a member of.',
      annotations: {
        title: 'List organizations',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({}),
      execute: async () => {
        return await account.listOrganizations();
      },
    }),
    get_organization: tool({
      description:
        'Gets details for an organization. Includes subscription plan.',
      annotations: {
        title: 'Get organization details',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
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
      annotations: {
        title: 'List projects',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({}),
      execute: async () => {
        return await account.listProjects();
      },
    }),
    get_project: tool({
      description: 'Gets details for a Supabase project.',
      annotations: {
        title: 'Get project details',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
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
      annotations: {
        title: 'Get cost of new resources',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
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
      annotations: {
        title: 'Confirm cost understanding',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
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
        'Creates a new Supabase project. Always ask the user which organization to create the project in. If there is a cost involved, the user will be asked to confirm before creation. The project can take a few minutes to initialize - use `get_project` to check the status.',
      annotations: {
        title: 'Create project',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      parameters: z.object({
        name: z.string().describe('The name of the project'),
        region: z
          .enum(AWS_REGION_CODES)
          .describe('The region to create the project in.'),
        organization_id: z.string(),
      }),
      execute: async ({ name, region, organization_id }, context) => {
        if (readOnly) {
          throw new Error('Cannot create a project in read-only mode.');
        }

        // Calculate cost inline
        const cost = await getNextProjectCost(account, organization_id);

        // Only request confirmation if there's a cost AND server supports elicitation
        if (cost.amount > 0 && context?.server?.elicitInput) {
          const costMessage = `$${cost.amount} per ${cost.recurrence}`;

          const result = await context.server.elicitInput({
            message: `You are about to create project "${name}" in region ${region}.\n\n💰 Cost: ${costMessage}\n\nDo you want to proceed with this billable project?`,
            requestedSchema: {
              type: 'object',
              properties: {
                confirm: {
                  type: 'boolean',
                  title: 'Confirm billable project creation',
                  description: `I understand this will cost ${costMessage} and want to proceed`,
                },
              },
              required: ['confirm'],
            },
          });

          // Handle user response
          if (result.action === 'decline' || result.action === 'cancel') {
            throw new Error('Project creation cancelled by user.');
          }

          if (result.action === 'accept' && !result.content?.confirm) {
            throw new Error(
              'You must confirm understanding of the cost to create a billable project.'
            );
          }
        }

        // Create the project (either free or confirmed)
        const project = await account.createProject({
          name,
          region,
          organization_id,
        });

        // Return appropriate message based on cost
        const costInfo =
          cost.amount > 0
            ? `Cost: $${cost.amount}/${cost.recurrence}`
            : 'Cost: Free';

        return {
          ...project,
          message: `Project "${name}" created successfully. ${costInfo}`,
        };
      },
    }),
    pause_project: tool({
      description: 'Pauses a Supabase project.',
      annotations: {
        title: 'Pause project',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
      }),
      execute: async ({ project_id }) => {
        if (readOnly) {
          throw new Error('Cannot pause a project in read-only mode.');
        }

        await account.pauseProject(project_id);
        return SUCCESS_RESPONSE;
      },
    }),
    restore_project: tool({
      description: 'Restores a Supabase project.',
      annotations: {
        title: 'Restore project',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
      }),
      execute: async ({ project_id }) => {
        if (readOnly) {
          throw new Error('Cannot restore a project in read-only mode.');
        }

        await account.restoreProject(project_id);
        return SUCCESS_RESPONSE;
      },
    }),
  };
}
