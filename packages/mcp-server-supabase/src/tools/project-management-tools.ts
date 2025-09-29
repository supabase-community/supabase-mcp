import { z } from 'zod';
import type { ProjectManagementOperations } from '../platform/types.js';
import { injectableTool } from './util.js';
import { source } from 'common-tags';

export interface ProjectManagementToolsOptions {
  projectManagement: ProjectManagementOperations;
  projectId?: string;
}

export function getProjectManagementTools({
  projectManagement,
  projectId,
}: ProjectManagementToolsOptions) {
  const project_id = projectId;

  const projectManagementTools = {
    upgrade_project: injectableTool({
      description: 'Upgrades a project to a higher tier plan.',
      annotations: {
        title: 'Upgrade project',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        target_tier: z
          .enum(['pro', 'team', 'enterprise'])
          .describe('Target tier to upgrade to'),
      }),
      inject: { project_id },
      execute: async ({ project_id, target_tier }) => {
        const result = await projectManagement.upgradeProject(
          project_id,
          target_tier
        );
        return source`
          Project upgrade initiated:
          ${JSON.stringify(result, null, 2)}
        `;
      },
    }),

    check_upgrade_eligibility: injectableTool({
      description:
        'Checks if a project is eligible for upgrade to a higher tier.',
      annotations: {
        title: 'Check upgrade eligibility',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        target_tier: z
          .enum(['pro', 'team', 'enterprise'])
          .optional()
          .describe('Target tier to check eligibility for'),
      }),
      inject: { project_id },
      execute: async ({ project_id, target_tier }) => {
        const eligibility = await projectManagement.checkUpgradeEligibility(
          project_id,
          target_tier
        );
        return source`
          Upgrade Eligibility:
          ${JSON.stringify(eligibility, null, 2)}
        `;
      },
    }),

    get_upgrade_status: injectableTool({
      description: 'Gets the current status of an ongoing project upgrade.',
      annotations: {
        title: 'Get upgrade status',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        const status = await projectManagement.getUpgradeStatus(project_id);
        return source`
          Upgrade Status:
          ${JSON.stringify(status, null, 2)}
        `;
      },
    }),

    transfer_project: injectableTool({
      description: 'Transfers a project to a different organization.',
      annotations: {
        title: 'Transfer project',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        target_organization_id: z
          .string()
          .describe('ID of the organization to transfer to'),
      }),
      inject: { project_id },
      execute: async ({ project_id, target_organization_id }) => {
        const result = await projectManagement.transferProject(
          project_id,
          target_organization_id
        );
        return source`
          Project transfer initiated:
          ${JSON.stringify(result, null, 2)}
        `;
      },
    }),

    set_project_readonly: injectableTool({
      description:
        'Sets a project to read-only mode, preventing writes to the database.',
      annotations: {
        title: 'Set project read-only',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        readonly: z
          .boolean()
          .describe('Whether to enable or disable read-only mode'),
      }),
      inject: { project_id },
      execute: async ({ project_id, readonly }) => {
        await projectManagement.setProjectReadonly(project_id, readonly);
        return source`
          Project read-only mode ${readonly ? 'enabled' : 'disabled'}.
        `;
      },
    }),

    disable_readonly_temporarily: injectableTool({
      description:
        'Temporarily disables read-only mode for maintenance operations.',
      annotations: {
        title: 'Disable read-only temporarily',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        duration_minutes: z
          .number()
          .optional()
          .describe('Duration in minutes (default: 60)'),
      }),
      inject: { project_id },
      execute: async ({ project_id, duration_minutes }) => {
        const result = await projectManagement.disableReadonlyTemporarily(
          project_id,
          duration_minutes
        );
        return source`
          Read-only mode temporarily disabled:
          ${JSON.stringify(result, null, 2)}
        `;
      },
    }),

    enable_pgsodium: injectableTool({
      description:
        'Enables the pgsodium extension for encryption capabilities.',
      annotations: {
        title: 'Enable pgsodium',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        await projectManagement.enablePgsodium(project_id);
        return source`
          pgsodium extension enabled successfully.
        `;
      },
    }),

    get_project_context: injectableTool({
      description:
        'Retrieves comprehensive context and metadata about a project.',
      annotations: {
        title: 'Get project context',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        const context = await projectManagement.getProjectContext(project_id);
        return source`
          Project Context:
          ${JSON.stringify(context, null, 2)}
        `;
      },
    }),

    enable_postgrest: injectableTool({
      description: 'Enables or configures PostgREST API for a project.',
      annotations: {
        title: 'Enable PostgREST',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        max_rows: z
          .number()
          .optional()
          .describe('Maximum rows returned per request'),
        default_limit: z
          .number()
          .optional()
          .describe('Default limit when not specified'),
      }),
      inject: { project_id },
      execute: async ({ project_id, max_rows, default_limit }) => {
        const config = await projectManagement.enablePostgrest(project_id, {
          max_rows,
          default_limit,
        });
        return source`
          PostgREST configured:
          ${JSON.stringify(config, null, 2)}
        `;
      },
    }),

    cancel_project_restore: injectableTool({
      description: 'Cancels an ongoing project restore operation.',
      annotations: {
        title: 'Cancel project restore',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        await projectManagement.cancelProjectRestore(project_id);
        return source`
          Project restore operation cancelled.
        `;
      },
    }),

    get_project_secrets: injectableTool({
      description: 'Retrieves environment secrets configured for a project.',
      annotations: {
        title: 'Get project secrets',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        const secrets = await projectManagement.getProjectSecrets(project_id);
        return source`
          Project Secrets:
          ${JSON.stringify(secrets, null, 2)}
        `;
      },
    }),

    update_project_secrets: injectableTool({
      description: 'Updates environment secrets for a project.',
      annotations: {
        title: 'Update project secrets',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      parameters: z.object({
        project_id: z.string(),
        secrets: z
          .record(z.string())
          .describe('Key-value pairs of secrets to set'),
      }),
      inject: { project_id },
      execute: async ({ project_id, secrets }) => {
        await projectManagement.updateProjectSecrets(project_id, secrets);
        return source`
          Project secrets updated successfully.
        `;
      },
    }),
  };

  return projectManagementTools;
}
