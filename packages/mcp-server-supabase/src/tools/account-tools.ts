import { tool } from '@supabase/mcp-utils';
import { z } from 'zod/v4';
import type { ToolDefs } from './util.js';
import type { AccountOperations } from '../platform/types.js';
import { organizationSchema, projectSchema } from '../platform/types.js';
import { getBranchCost, getNextProjectCost } from '../pricing.js';
import { AWS_REGION_CODES } from '../regions.js';
import { hashObject } from '../util.js';

type AccountToolsOptions = {
  account: AccountOperations;
  readOnly?: boolean;
};

const listOrganizationsInputSchema = z.object({});

const listOrganizationsOutputSchema = z.object({
  organizations: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
    })
  ),
});

const getOrganizationInputSchema = z.object({
  id: z.string().describe('The organization ID'),
});

const getOrganizationOutputSchema = organizationSchema;

const listProjectsInputSchema = z.object({});

const listProjectsOutputSchema = z.object({
  projects: z.array(projectSchema),
});

const getProjectInputSchema = z.object({
  id: z.string().describe('The project ID'),
});

const getProjectOutputSchema = projectSchema;

const getCostInputSchema = z.object({
  type: z.enum(['project', 'branch']),
  organization_id: z
    .string()
    .describe('The organization ID. Always ask the user.'),
});

const getCostOutputSchema = z.object({
  type: z.enum(['project', 'branch']),
  amount: z.number().describe('Cost in USD'),
  recurrence: z.enum(['hourly', 'monthly']),
});

const confirmCostInputSchema = z.object({
  type: z.enum(['project', 'branch']),
  recurrence: z.enum(['hourly', 'monthly']),
  amount: z.number(),
});

const confirmCostOutputSchema = z.object({
  confirmation_id: z.string(),
});

const createProjectInputSchema = z.object({
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

const createProjectOutputSchema = projectSchema;

const pauseProjectInputSchema = z.object({
  project_id: z.string(),
});

const pauseProjectOutputSchema = z.object({
  success: z.boolean(),
});

const restoreProjectInputSchema = z.object({
  project_id: z.string(),
});

const restoreProjectOutputSchema = z.object({
  success: z.boolean(),
});

export const accountToolDefs = {
  list_organizations: {
    description: 'List all organizations that the user is a member of in their Supabase account. Use when the user wants to see which organizations they belong to or need to select an organization for project management. Do not use when you need detailed information about a specific organization (use get_organization instead). Takes no required parameters. e.g., returns organizations like "acme-corp" or "my-startup-llc". Raises an error if the user's authentication token is invalid or expired.',
    parameters: listOrganizationsInputSchema,
    outputSchema: listOrganizationsOutputSchema,
    annotations: {
      title: 'List organizations',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  get_organization: {
    description:
      'Retrieve detailed information about a specific Supabase organization, including subscription plan, billing details, and member count. Use when the user wants to inspect organization settings, check billing status, or review subscription limits for a particular organization. Do not use when you need to see all organizations the user belongs to (use list_organizations instead). Accepts `org_id` (required string), e.g., "my-company-org" or "personal-workspace". Raises an error if the organization does not exist or the user lacks access permissions.',
    parameters: getOrganizationInputSchema,
    outputSchema: getOrganizationOutputSchema,
    annotations: {
      title: 'Get organization details',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  list_projects: {
    description:
      'List all Supabase projects associated with your account. Use when the user wants to browse available projects, find a specific project ID, or select which project to work with. Do not use when you need details about a specific project (use get_project instead) or when working with organizations (use list_organizations instead). Takes no required parameters. Returns project names, IDs, regions, and status information, e.g., project ID "abc123def" with name "my-app-prod". Raises an error if authentication fails or the API is unavailable.',
    parameters: listProjectsInputSchema,
    outputSchema: listProjectsOutputSchema,
    annotations: {
      title: 'List projects',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  get_project: {
    description: 'Retrieve detailed information about a specific Supabase project including configuration, status, and metadata. Use when the user wants to inspect project settings, check project health, or gather information about a particular project. Do not use when you need to see all available projects (use list_projects instead). Accepts `project_ref` (required string), e.g., "abcdefghijklmnop" or "my-project-ref". Raises an error if the project reference is invalid or the user lacks access permissions.',
    parameters: getProjectInputSchema,
    outputSchema: getProjectOutputSchema,
    annotations: {
      title: 'Get project details',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  get_cost: {
    description:
      'Retrieve the cost of creating a new Supabase project or branch and confirm user understanding before proceeding. Use when the user wants to understand pricing implications before creating resources. Do not use when you need to actually confirm the cost with the user (use confirm_cost instead). Accepts `organization_id` (required) and `type` (required: "project" or "branch"), e.g., organization_id="my-org-123", type="project". Always repeats the cost to the user and requires confirmation of their understanding. Raises an error if the organization does not exist or user lacks access permissions.',
    parameters: getCostInputSchema,
    outputSchema: getCostOutputSchema,
    annotations: {
      title: 'Get cost of new resources',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  confirm_cost: {
    description:
      'Confirm the user's understanding of project or branch creation costs before proceeding with the operation. Use when the user wants to acknowledge and approve the financial implications of creating new Supabase resources. Do not use when you need to calculate costs without user confirmation (use get_cost instead) or when creating resources that don't require cost approval. Must call `get_cost` first to obtain pricing information. Returns a unique `confirmation_id` (required for `create_project` or `create_branch`), e.g., "conf_abc123xyz". Fails if `get_cost` was not called previously or if the user declines the cost confirmation.',
    parameters: confirmCostInputSchema,
    outputSchema: confirmCostOutputSchema,
    annotations: {
      title: 'Confirm cost understanding',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  create_project: {
    description:
      'Create a new Supabase project within a specified organization. Use when the user wants to set up a fresh database and backend infrastructure for a new application or service. Do not use when you need to create a development environment for an existing project (use create_branch instead). Accepts `organization_id` (required) and `name` (required), e.g., organization_id="org_abc123", name="my-new-app". The project takes several minutes to initialize - check status with get_project. Raises an error if the organization has reached its project limit or lacks sufficient permissions.',
    parameters: createProjectInputSchema,
    outputSchema: createProjectOutputSchema,
    annotations: {
      title: 'Create project',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  pause_project: {
    description: 'Pause a Supabase project to temporarily stop all database operations and API access. Use when the user wants to temporarily disable a project to save costs or prevent access during maintenance. Do not use when you need to restore an already paused project (use restore_project instead). Accepts `project_ref` (required string), e.g., "abcdefghijklmnop". Raises an error if the project is already paused or if you lack sufficient permissions to modify the project.',
    parameters: pauseProjectInputSchema,
    outputSchema: pauseProjectOutputSchema,
    annotations: {
      title: 'Pause project',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  restore_project: {
    description: 'Restore a previously paused or deleted Supabase project to active status. Use when the user wants to reactivate a project that was temporarily paused or recover a recently deleted project. Do not use when you need to pause an active project (use pause_project instead). Accepts `project_ref` (required string identifier for the project to restore), e.g., "abc123def456" or "my-project-ref". Raises an error if the project reference is invalid or if the project cannot be restored due to billing issues.',
    parameters: restoreProjectInputSchema,
    outputSchema: restoreProjectOutputSchema,
    annotations: {
      title: 'Restore project',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
} as const satisfies ToolDefs;

export function getAccountTools({ account, readOnly }: AccountToolsOptions) {
  return {
    list_organizations: tool({
      ...accountToolDefs.list_organizations,
      execute: async () => {
        return { organizations: await account.listOrganizations() };
      },
    }),
    get_organization: tool({
      ...accountToolDefs.get_organization,
      execute: async ({ id: organizationId }) => {
        return await account.getOrganization(organizationId);
      },
    }),
    list_projects: tool({
      ...accountToolDefs.list_projects,
      execute: async () => {
        return { projects: await account.listProjects() };
      },
    }),
    get_project: tool({
      ...accountToolDefs.get_project,
      execute: async ({ id }) => {
        return await account.getProject(id);
      },
    }),
    get_cost: tool({
      ...accountToolDefs.get_cost,
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
      ...accountToolDefs.confirm_cost,
      execute: async (cost) => {
        return { confirmation_id: await hashObject(cost) };
      },
    }),
    create_project: tool({
      ...accountToolDefs.create_project,
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
      ...accountToolDefs.pause_project,
      execute: async ({ project_id }) => {
        if (readOnly) {
          throw new Error('Cannot pause a project in read-only mode.');
        }

        await account.pauseProject(project_id);
        return { success: true };
      },
    }),
    restore_project: tool({
      ...accountToolDefs.restore_project,
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
