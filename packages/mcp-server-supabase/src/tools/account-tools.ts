import { tool, type ToolRequestContext } from '@supabase/mcp-utils';
import { z } from 'zod/v4';
import type { ToolDefs } from './util.js';
import type { ElicitationRuntime } from '../elicitations/runtime.js';
import type { AccountOperations } from '../platform/types.js';
import { organizationSchema, projectSchema } from '../platform/types.js';
import {
  assertRateStillApproved,
  createCostConfirmationPolicy,
  routeCostConfirmation,
  routeLegacyConfirmation,
  type CostConfirmationResolution,
} from '../policies/cost-confirmation.js';
import { legacyBranchCost, toCost } from '../pricing.js';
import { AWS_REGION_CODES } from '../regions.js';
import { hashObject } from '../util.js';

type AccountToolsOptions = {
  account: AccountOperations;
  readOnly?: boolean;
  /**
   * Present only when this connection serves form elicitation. Its absence
   * leaves every paid tool policy-free, which is what keeps a consumer that
   * never injects it on the exact surface it has today.
   */
  elicitation?: ElicitationRuntime;
};

const listOrganizationsInputSchema = z.object({});

const listOrganizationsOutputSchema = z.object({
  organizations: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
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
    description: 'Lists all organizations that the user is a member of.',
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
      'Gets details for an organization. Includes subscription plan.',
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
      'Lists all Supabase projects for the user. Use this to help discover the project ID of the project that the user is working on.',
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
    description: 'Gets details for a Supabase project.',
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
      'Gets the cost of creating a new project or branch. Never assume organization as costs can be different for each. Always repeat the cost to the user and confirm their understanding before proceeding.',
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
      'Ask the user to confirm their understanding of the cost of creating a new project or branch. Call `get_cost` first. Returns a unique ID for this confirmation which should be passed to `create_project` or `create_branch`.',
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
      'Creates a new Supabase project. Always ask the user which organization to create the project in. The project can take a few minutes to initialize - use `get_project` to check the status.',
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
    description: 'Pauses a Supabase project.',
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
    description: 'Restores a Supabase project.',
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

export function getAccountTools({
  account,
  readOnly,
  elicitation,
}: AccountToolsOptions) {
  const capable = (ctx: ToolRequestContext) =>
    elicitation?.availability(ctx).formElicitation === true;

  const createProjectPolicy =
    elicitation &&
    routeCostConfirmation({
      capable,
      confirmed: elicitation.policy(
        'create_project',
        createCostConfirmationPolicy<z.infer<typeof createProjectInputSchema>>({
          action: 'create_project',
          available: capable,
          // The legacy token is deliberately absent: an approval binds to the
          // project that was proposed, never to a token from the other lane.
          canonicalArguments: ({ name, region, organization_id }) => ({
            name,
            region,
            organization_id,
          }),
          subject: ({ name, organization_id }) => ({
            resourceName: name,
            account: { type: 'organization', id: organization_id },
          }),
          readRate: ({ organization_id }) =>
            account.getProjectCreationRate(organization_id),
        })
      ),
    });

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
            return toCost(
              'project',
              await account.getProjectCreationRate(organization_id)
            );
          case 'branch':
            return legacyBranchCost();
          default:
            throw new Error(`Unknown cost type: ${type}`);
        }
      },
    }),
    confirm_cost: tool({
      ...accountToolDefs.confirm_cost,
      // Hidden from a capable client's tool list, and still registered: a
      // client that calls it by name is answered either way.
      hidden: (ctx) => capable(ctx),
      policy: elicitation && routeLegacyConfirmation({ capable }),
      execute: async (cost) => {
        return { confirmation_id: await hashObject(cost) };
      },
    }),
    create_project: tool<
      typeof createProjectInputSchema,
      typeof createProjectOutputSchema,
      CostConfirmationResolution | undefined
    >({
      ...accountToolDefs.create_project,
      policy: createProjectPolicy,
      execute: async (
        { name, region, organization_id, confirm_cost_id },
        resolution
      ) => {
        if (readOnly) {
          throw new Error('Cannot create a project in read-only mode.');
        }

        if (resolution === undefined) {
          const cost = toCost(
            'project',
            await account.getProjectCreationRate(organization_id)
          );
          const costHash = await hashObject(cost);
          if (costHash !== confirm_cost_id) {
            throw new Error(
              'Cost confirmation ID does not match the expected cost of creating a project.'
            );
          }
        } else {
          assertRateStillApproved(
            await account.getProjectCreationRate(organization_id),
            resolution.maximumCreationRate
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
