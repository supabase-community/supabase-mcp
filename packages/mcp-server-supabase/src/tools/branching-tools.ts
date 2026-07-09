import { tool } from '@supabase/mcp-utils';
import { z } from 'zod/v4';
import type { BranchingOperations } from '../platform/types.js';
import { branchSchema } from '../platform/types.js';
import { getBranchCost } from '../pricing.js';
import { hashObject } from '../util.js';
import { injectableTool, type ToolDefs } from './util.js';

type BranchingToolsOptions = {
  branching: BranchingOperations;
  projectId?: string;
  readOnly?: boolean;
};

const createBranchInputSchema = z.object({
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

const createBranchOutputSchema = branchSchema;

const listBranchesInputSchema = z.object({
  project_id: z.string(),
});

const listBranchesOutputSchema = z.object({
  branches: z.array(branchSchema),
});

const deleteBranchInputSchema = z.object({
  branch_id: z.string(),
});

const deleteBranchOutputSchema = z.object({
  success: z.boolean(),
});

const mergeBranchInputSchema = z.object({
  branch_id: z.string(),
});

const mergeBranchOutputSchema = z.object({
  success: z.boolean(),
});

const resetBranchInputSchema = z.object({
  branch_id: z.string(),
  migration_version: z
    .string()
    .optional()
    .describe('Reset your development branch to a specific migration version.'),
});

const resetBranchOutputSchema = z.object({
  success: z.boolean(),
});

const rebaseBranchInputSchema = z.object({
  branch_id: z.string(),
});

const rebaseBranchOutputSchema = z.object({
  success: z.boolean(),
});

export const branchingToolDefs = {
  create_branch: {
    description:
      'Create a development branch on a Supabase project with a fresh database containing all migrations from main. Use when the user wants to develop features, test changes, or experiment without affecting production data. Do not use when you need to list existing branches (use list_branches instead) or merge changes back to main (use merge_branch instead). Accepts `project_ref` (required), `branch_name` (required), and `git_branch` (optional for Git integration), e.g., project_ref="abc123", branch_name="feature-auth". Returns a new project_ref for the branch to execute queries and migrations. Raises an error if the project does not exist or branch name is already taken.',
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
    description:
      'List all development branches of a Supabase project with their current status and details. Use when the user wants to view existing branches, check operation progress, or monitor branch states before performing merge/rebase/reset actions. Accepts `project_id` (required) and returns branch names, statuses, and metadata. e.g., checking if a branch merge operation has completed or viewing all available development environments. Do not use when you need to create a new branch (use create_branch instead). Raises an error if the project does not exist or user lacks access permissions.',
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
    description: 'Delete a development branch from a Supabase project. Use when the user wants to remove an unused or completed feature branch to clean up their project workspace. Do not use when you need to merge changes first (use merge_branch instead) or reset branch data (use reset_branch instead). Accepts `project_ref` (required) and `branch_id` (required), e.g., project_ref="abc123def", branch_id="feature-auth". Raises an error if the branch is currently active or does not exist.',
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
    description:
      'Merge migrations and edge functions from a development branch into the production environment. Use when the user wants to deploy tested changes from a development branch to make them live in production. Do not use when you need to create a new branch first (use create_branch instead) or when you want to update the branch with production changes (use rebase_branch instead). Accepts `project_ref` (required) and `branch_id` (required), e.g., project_ref="abc123def", branch_id="feature-auth-updates". Raises an error if the branch has conflicts or if the user lacks merge permissions for the project.',
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
    description:
      'Reset migrations of a development branch to its initial state, discarding all database schema changes and untracked data. Use when the user wants to completely restart development work on a branch or undo problematic migrations. Do not use when you need to selectively undo specific migrations (use rebase_branch instead) or when merging changes to production (use merge_branch instead). Accepts `project_ref` (required) and `branch_id` (required), e.g., project_ref="abc123def", branch_id="feature-auth". Raises an error if the branch does not exist or is currently being used by another operation.',
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
    description:
      'Rebase a development branch onto the production branch to apply newer migrations and resolve migration drift. Use when the user wants to synchronize their development branch with the latest production database schema changes. Do not use when you need to merge completed features back to production (use merge_branch instead). Accepts `project_ref` (required) and `branch_name` (required), e.g., project_ref="abc123def", branch_name="feature/user-auth". Raises an error if the branch does not exist or if there are conflicting migrations that cannot be automatically resolved.',
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
} as const satisfies ToolDefs;

export function getBranchingTools({
  branching,
  projectId,
  readOnly,
}: BranchingToolsOptions) {
  const project_id = projectId;

  return {
    create_branch: injectableTool({
      ...branchingToolDefs.create_branch,
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
      inject: { project_id },
      execute: async ({ project_id }) => {
        return { branches: await branching.listBranches(project_id) };
      },
    }),
    delete_branch: tool({
      ...branchingToolDefs.delete_branch,
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
