import { tool } from '@supabase/mcp-utils';
import { z } from 'zod/v4';
import type { BranchingOperations } from '../platform/types.js';
import { branchSchema } from '../platform/types.js';
import { getBranchCost } from '../pricing.js';
import { hashObject } from '../util.js';
import { injectableTool } from './util.js';

export type CreateBranchInput = z.infer<typeof createBranchInputSchema>;
export type CreateBranchOutput = z.infer<typeof createBranchOutputSchema>;
export type ListBranchesInput = z.infer<typeof listBranchesInputSchema>;
export type ListBranchesOutput = z.infer<typeof listBranchesOutputSchema>;
export type DeleteBranchInput = z.infer<typeof deleteBranchInputSchema>;
export type DeleteBranchOutput = z.infer<typeof deleteBranchOutputSchema>;
export type MergeBranchInput = z.infer<typeof mergeBranchInputSchema>;
export type MergeBranchOutput = z.infer<typeof mergeBranchOutputSchema>;
export type ResetBranchInput = z.infer<typeof resetBranchInputSchema>;
export type ResetBranchOutput = z.infer<typeof resetBranchOutputSchema>;
export type RebaseBranchInput = z.infer<typeof rebaseBranchInputSchema>;
export type RebaseBranchOutput = z.infer<typeof rebaseBranchOutputSchema>;
export type BranchingToolsOptions = {
  branching: BranchingOperations;
  projectId?: string;
  readOnly?: boolean;
};

export const createBranchInputSchema = z.object({
  project_id: z.string(),
  name: z.string().default('develop').describe('Name of the branch to create'),
  confirm_cost_id: z
    .string({
      error: (issue) =>
        issue.input === undefined
          ? 'User must confirm understanding of costs before creating a branch.'
          : undefined,
    })
    .describe('The cost confirmation ID. Call `confirm_cost` first.'),
});

export const createBranchOutputSchema = branchSchema;

export const listBranchesInputSchema = z.object({
  project_id: z.string(),
});

export const listBranchesOutputSchema = z.object({
  branches: z.array(branchSchema),
});

export const deleteBranchInputSchema = z.object({
  branch_id: z.string(),
});

export const deleteBranchOutputSchema = z.object({
  success: z.boolean(),
});

export const mergeBranchInputSchema = z.object({
  branch_id: z.string(),
});

export const mergeBranchOutputSchema = z.object({
  success: z.boolean(),
});

export const resetBranchInputSchema = z.object({
  branch_id: z.string(),
  migration_version: z
    .string()
    .optional()
    .describe('Reset your development branch to a specific migration version.'),
});

export const resetBranchOutputSchema = z.object({
  success: z.boolean(),
});

export const rebaseBranchInputSchema = z.object({
  branch_id: z.string(),
});

export const rebaseBranchOutputSchema = z.object({
  success: z.boolean(),
});

export const branchingToolDefs = {
  create_branch: {
    parameters: createBranchInputSchema,
    outputSchema: createBranchOutputSchema,
    annotations: {
      title: 'Create branch',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  list_branches: {
    parameters: listBranchesInputSchema,
    outputSchema: listBranchesOutputSchema,
    annotations: {
      title: 'List branches',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  delete_branch: {
    parameters: deleteBranchInputSchema,
    outputSchema: deleteBranchOutputSchema,
    annotations: {
      title: 'Delete branch',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  merge_branch: {
    parameters: mergeBranchInputSchema,
    outputSchema: mergeBranchOutputSchema,
    annotations: {
      title: 'Merge branch',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  reset_branch: {
    parameters: resetBranchInputSchema,
    outputSchema: resetBranchOutputSchema,
    annotations: {
      title: 'Reset branch',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  rebase_branch: {
    parameters: rebaseBranchInputSchema,
    outputSchema: rebaseBranchOutputSchema,
    annotations: {
      title: 'Rebase branch',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
} as const;

export function getBranchingTools({
  branching,
  projectId,
  readOnly,
}: BranchingToolsOptions) {
  const project_id = projectId;

  return {
    create_branch: injectableTool({
      ...branchingToolDefs.create_branch,
      description:
        'Creates a development branch on a Supabase project. This will apply all migrations from the main project to a fresh branch database. Note that production data will not carry over. The branch will get its own project_id via the resulting project_ref. Use this ID to execute queries and migrations on the branch.',
      inject: { project_id },
      execute: async ({ project_id, name, confirm_cost_id }) => {
        if (readOnly) {
          throw new Error('Cannot create a branch in read-only mode.');
        }

        const cost = getBranchCost();
        const costHash = await hashObject(cost);
        if (costHash !== confirm_cost_id) {
          throw new Error(
            'Cost confirmation ID does not match the expected cost of creating a branch.'
          );
        }
        return await branching.createBranch(project_id, { name });
      },
    }),
    list_branches: injectableTool({
      ...branchingToolDefs.list_branches,
      description:
        'Lists all development branches of a Supabase project. This will return branch details including status which you can use to check when operations like merge/rebase/reset complete.',
      inject: { project_id },
      execute: async ({ project_id }) => {
        return { branches: await branching.listBranches(project_id) };
      },
    }),
    delete_branch: tool({
      ...branchingToolDefs.delete_branch,
      description: 'Deletes a development branch.',
      execute: async ({ branch_id }) => {
        if (readOnly) {
          throw new Error('Cannot delete a branch in read-only mode.');
        }

        await branching.deleteBranch(branch_id);
        return { success: true };
      },
    }),
    merge_branch: tool({
      ...branchingToolDefs.merge_branch,
      description:
        'Merges migrations and edge functions from a development branch to production.',
      execute: async ({ branch_id }) => {
        if (readOnly) {
          throw new Error('Cannot merge a branch in read-only mode.');
        }

        await branching.mergeBranch(branch_id);
        return { success: true };
      },
    }),
    reset_branch: tool({
      ...branchingToolDefs.reset_branch,
      description:
        'Resets migrations of a development branch. Any untracked data or schema changes will be lost.',
      execute: async ({ branch_id, migration_version }) => {
        if (readOnly) {
          throw new Error('Cannot reset a branch in read-only mode.');
        }

        await branching.resetBranch(branch_id, {
          migration_version,
        });
        return { success: true };
      },
    }),
    rebase_branch: tool({
      ...branchingToolDefs.rebase_branch,
      description:
        'Rebases a development branch on production. This will effectively run any newer migrations from production onto this branch to help handle migration drift.',
      execute: async ({ branch_id }) => {
        if (readOnly) {
          throw new Error('Cannot rebase a branch in read-only mode.');
        }

        await branching.rebaseBranch(branch_id);
        return { success: true };
      },
    }),
  };
}
