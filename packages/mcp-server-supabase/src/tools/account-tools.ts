import { tool, type ToolExecuteContext } from '@supabase/mcp-utils';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ElicitResultSchema } from '@modelcontextprotocol/sdk/types.js';
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
    get_and_confirm_cost: tool({
      description: async () => {
        const clientCapabilities = server?.getClientCapabilities();
        if (clientCapabilities?.elicitation) {
          return 'Gets the cost of creating a new project or branch and requests user confirmation. Returns a unique ID for this confirmation which must be passed to `create_project` or `create_branch`. Never assume organization as costs can be different for each.';
        }
        return 'Gets the cost of creating a new project or branch. You must repeat the cost to the user and confirm their understanding before calling `create_project` or `create_branch`. Returns a unique ID for this confirmation which must be passed to `create_project` or `create_branch`. Never assume organization as costs can be different for each.';
      },
      annotations: {
        title: 'Get and confirm cost',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        type: z.enum(['project', 'branch']),
        organization_id: z
          .string()
          .describe('The organization ID. Always ask the user.')
          .optional(),
      }),
      execute: async ({ type, organization_id }) => {
        // Get the cost
        let cost: Cost;
        switch (type) {
          case 'project': {
            if (!organization_id) {
              throw new Error(
                'organization_id is required for project cost calculation'
              );
            }
            cost = await getNextProjectCost(account, organization_id);
            break;
          }
          case 'branch': {
            cost = getBranchCost();
            break;
          }
          default:
            throw new Error(`Unknown cost type: ${type}`);
        }

        let userDeclinedCost = false;

        // Request confirmation via elicitation if supported
        const clientCapabilities = server?.getClientCapabilities();
        if (server && clientCapabilities?.elicitation) {
          try {
            const costMessage =
              cost.amount > 0 ? `$${cost.amount} ${cost.recurrence}` : 'Free';

            const result = await server.request(
              {
                method: 'elicitation/create',
                params: {
                  message: `You are about to create a new ${type}.\n\nCost: ${costMessage}\n\nDo you want to proceed?`,
                  requestedSchema: {
                    type: 'object',
                    properties: {
                      confirm: {
                        type: 'boolean',
                        title: 'Confirm Cost',
                        description: `I understand the cost and want to create the ${type}`,
                      },
                    },
                    required: ['confirm'],
                  },
                },
              },
              ElicitResultSchema
            );

            if (result.action !== 'accept' || !result.content?.confirm) {
              userDeclinedCost = true;
            }
          } catch (error) {
            // If elicitation fails (client doesn't support it), return cost info for manual confirmation
            console.warn(
              'Elicitation not supported by client, returning cost for manual confirmation'
            );
            console.warn(error);
          }
        }

        if (userDeclinedCost) {
          throw new Error(
            'The user declined to confirm the cost. Ask the user to confirm if they want to proceed with the operation or do something else.'
          );
        }

        // Generate and return confirmation ID
        const confirmationId = await hashObject(cost);

        return {
          ...cost,
          confirm_cost_id: confirmationId,
          message:
            cost.amount > 0
              ? `The new ${type} will cost $${cost.amount} ${cost.recurrence}. ${clientCapabilities?.elicitation ? 'User has confirmed.' : 'You must confirm this cost with the user before proceeding.'}`
              : `The new ${type} is free. ${clientCapabilities?.elicitation ? 'User has confirmed.' : 'You may proceed with creation.'}`,
        };
      },
    }),
    create_project: tool({
      description:
        'Creates a new Supabase project. Always ask the user which organization to create the project in. Call `get_and_confirm_cost` first to verify the cost and get user confirmation. The project can take a few minutes to initialize - use `get_project` to check the status.',
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
        confirm_cost_id: z
          .string({
            required_error:
              'User must confirm understanding of costs before creating a project.',
          })
          .describe(
            'The cost confirmation ID. Call `get_and_confirm_cost` first.'
          ),
      }),
      execute: async ({ name, region, organization_id, confirm_cost_id }) => {
        if (readOnly) {
          throw new Error('Cannot create a project in read-only mode.');
        }

        // Verify the confirmation ID matches the expected cost
        const cost = await getNextProjectCost(account, organization_id);
        const costHash = await hashObject(cost);
        if (costHash !== confirm_cost_id) {
          throw new Error(
            'Cost confirmation ID does not match the expected cost of creating a project.'
          );
        }

        // Create the project
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
