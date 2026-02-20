import { tool } from '@supabase/mcp-utils';
import { z } from 'zod/v4';
import type { AccountOperations } from '../platform/types.js';
import { organizationSchema, projectSchema } from '../platform/types.js';
import { getBranchCost, getNextProjectCost } from '../pricing.js';
import { AWS_REGION_CODES } from '../regions.js';
import { hashObject } from '../util.js';

export type ListOrganizationsInput = z.infer<
  typeof listOrganizationsInputSchema
>;
export type ListOrganizationsOutput = z.infer<
  typeof listOrganizationsOutputSchema
>;
export type GetOrganizationInput = z.infer<typeof getOrganizationInputSchema>;
export type GetOrganizationOutput = z.infer<typeof getOrganizationOutputSchema>;
export type ListProjectsInput = z.infer<typeof listProjectsInputSchema>;
export type ListProjectsOutput = z.infer<typeof listProjectsOutputSchema>;
export type GetProjectInput = z.infer<typeof getProjectInputSchema>;
export type GetProjectOutput = z.infer<typeof getProjectOutputSchema>;
export type GetCostInput = z.infer<typeof getCostInputSchema>;
export type GetCostOutput = z.infer<typeof getCostOutputSchema>;
export type ConfirmCostInput = z.infer<typeof confirmCostInputSchema>;
export type ConfirmCostOutput = z.infer<typeof confirmCostOutputSchema>;
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
export type CreateProjectOutput = z.infer<typeof createProjectOutputSchema>;
export type PauseProjectInput = z.infer<typeof pauseProjectInputSchema>;
export type PauseProjectOutput = z.infer<typeof pauseProjectOutputSchema>;
export type RestoreProjectInput = z.infer<typeof restoreProjectInputSchema>;
export type RestoreProjectOutput = z.infer<typeof restoreProjectOutputSchema>;
export type AccountToolsOptions = {
  account: AccountOperations;
  readOnly?: boolean;
};

export const listOrganizationsInputSchema = z.object({});

export const listOrganizationsOutputSchema = z.object({
  organizations: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
    })
  ),
});

export const getOrganizationInputSchema = z.object({
  id: z.string().describe('The organization ID'),
});

export const getOrganizationOutputSchema = organizationSchema;

export const listProjectsInputSchema = z.object({});

export const listProjectsOutputSchema = z.object({
  projects: z.array(projectSchema),
});

export const getProjectInputSchema = z.object({
  id: z.string().describe('The project ID'),
});

export const getProjectOutputSchema = projectSchema;

export const getCostInputSchema = z.object({
  type: z.enum(['project', 'branch']),
  organization_id: z
    .string()
    .describe('The organization ID. Always ask the user.'),
});

export const getCostOutputSchema = z.object({
  type: z.enum(['project', 'branch']),
  amount: z.number().describe('Cost in USD'),
  recurrence: z.enum(['hourly', 'monthly']),
});

export const confirmCostInputSchema = z.object({
  type: z.enum(['project', 'branch']),
  recurrence: z.enum(['hourly', 'monthly']),
  amount: z.number(),
});

export const confirmCostOutputSchema = z.object({
  confirmation_id: z.string(),
});

export const createProjectInputSchema = z.object({
  name: z.string().describe('The name of the project'),
  region: z
    .enum(AWS_REGION_CODES)
    .describe('The region to create the project in.'),
  organization_id: z.string(),
  confirm_cost_id: z
    .string({
      error: (issue) =>
        issue.input === undefined
          ? 'User must confirm understanding of costs before creating a project.'
          : undefined,
    })
    .describe('The cost confirmation ID. Call `confirm_cost` first.'),
});

export const createProjectOutputSchema = projectSchema;

export const pauseProjectInputSchema = z.object({
  project_id: z.string(),
});

export const pauseProjectOutputSchema = z.object({
  success: z.boolean(),
});

export const restoreProjectInputSchema = z.object({
  project_id: z.string(),
});

export const restoreProjectOutputSchema = z.object({
  success: z.boolean(),
});

export function getAccountTools({ account, readOnly }: AccountToolsOptions) {
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
      parameters: listOrganizationsInputSchema,
      outputSchema: listOrganizationsOutputSchema,
      execute: async () => {
        return { organizations: await account.listOrganizations() };
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
      parameters: getOrganizationInputSchema,
      outputSchema: getOrganizationOutputSchema,
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
      parameters: listProjectsInputSchema,
      outputSchema: listProjectsOutputSchema,
      execute: async () => {
        return { projects: await account.listProjects() };
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
      parameters: getProjectInputSchema,
      outputSchema: getProjectOutputSchema,
      execute: async ({ id }) => {
        return await account.getProject(id);
      },
    }),
    get_cost: tool({
      description:
        'Gets the cost of creating a new project or branch. Never assume organization as costs can be different for each. Always repeat the cost to the user and confirm their understanding before proceeding.',
      annotations: {
        title: 'Get cost of new resources',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: getCostInputSchema,
      outputSchema: getCostOutputSchema,
      execute: async ({ type, organization_id }) => {
        switch (type) {
          case 'project':
            return await getNextProjectCost(account, organization_id);
          case 'branch':
            return getBranchCost();
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
      parameters: confirmCostInputSchema,
      outputSchema: confirmCostOutputSchema,
      execute: async (cost) => {
        return { confirmation_id: await hashObject(cost) };
      },
    }),
    create_project: tool({
      description:
        'Creates a new Supabase project. Always ask the user which organization to create the project in. The project can take a few minutes to initialize - use `get_project` to check the status.',
      annotations: {
        title: 'Create project',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      parameters: createProjectInputSchema,
      outputSchema: createProjectOutputSchema,
      execute: async ({ name, region, organization_id, confirm_cost_id }) => {
        if (readOnly) {
          throw new Error('Cannot create a project in read-only mode.');
        }

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
      annotations: {
        title: 'Pause project',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      parameters: pauseProjectInputSchema,
      outputSchema: pauseProjectOutputSchema,
      execute: async ({ project_id }) => {
        if (readOnly) {
          throw new Error('Cannot pause a project in read-only mode.');
        }

        await account.pauseProject(project_id);
        return { success: true };
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
      parameters: restoreProjectInputSchema,
      outputSchema: restoreProjectOutputSchema,
      execute: async ({ project_id }) => {
        if (readOnly) {
          throw new Error('Cannot restore a project in read-only mode.');
        }

        await account.restoreProject(project_id);
        return { success: true };
      },
    }),
  };
}
