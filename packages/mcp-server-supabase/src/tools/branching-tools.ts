import { tool } from '@supabase/mcp-utils';
import { z } from 'zod';
import type { BranchingOperations } from '../platform/types.js';
import { getBranchCost } from '../pricing.js';
import { hashObject } from '../util.js';
import { injectableTool } from './util.js';

export type BranchingToolsOptions = {
  branching: BranchingOperations;
  projectId?: string;
};

export function getBranchingTools({
  branching,
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
        return await branching.createBranch(project_id, { name });
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
        return await branching.listBranches(project_id);
      },
    }),
    delete_branch: tool({
      description: 'Deletes a development branch.',
      parameters: z.object({
        branch_id: z.string(),
      }),
      execute: async ({ branch_id }) => {
        return await branching.deleteBranch(branch_id);
      },
    }),
    merge_branch: tool({
      description:
        'Merges migrations and edge functions from a development branch to production.',
      parameters: z.object({
        branch_id: z.string(),
      }),
      execute: async ({ branch_id }) => {
        return await branching.mergeBranch(branch_id);
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
        return await branching.resetBranch(branch_id, {
          migration_version,
        });
      },
    }),
    rebase_branch: tool({
      description:
        'Rebases a development branch on production. This will effectively run any newer migrations from production onto this branch to help handle migration drift.',
      parameters: z.object({
        branch_id: z.string(),
      }),
      execute: async ({ branch_id }) => {
        return await branching.rebaseBranch(branch_id);
      },
    }),
  };
}
