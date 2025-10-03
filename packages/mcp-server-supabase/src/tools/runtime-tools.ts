import { tool } from '@supabase/mcp-utils';
import { z } from 'zod';
import {
  getModeManager,
  toggleReadOnlyModeForClaudeCLI,
  getCurrentModeStatus,
  getClaudeCLIStatusDisplay,
  validateModeChangeWithClaudeCLI,
  type ModeChangeResult,
} from '../runtime/mode-manager.js';
import {
  getProjectManager,
  listProjectsForClaudeCLI,
  switchProjectInteractiveClaudeCLI,
  getCurrentProjectRef,
  type ProjectSwitchResult,
} from '../runtime/project-manager.js';

export function getRuntimeTools() {
  return {
    toggle_read_only_mode: tool({
      description:
        'Toggle between read-only and write modes for database operations. Read-only mode prevents all database modifications, while write mode allows full database access. Claude CLI users receive interactive confirmation prompts.',
      annotations: {
        title: 'Toggle read-only mode',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      parameters: z.object({
        confirm_write_mode: z
          .boolean()
          .optional()
          .describe(
            'Set to true to confirm switching to write mode (required when enabling write operations)'
          ),
      }),
      execute: async (args) => {
        const modeManager = getModeManager();
        const currentMode = modeManager.getCurrentMode();
        const targetReadOnly = !currentMode.readOnly;

        // Validate the mode change
        const validation = validateModeChangeWithClaudeCLI(targetReadOnly);

        if (!validation.canChange) {
          return {
            success: false,
            error: validation.reason || 'Mode change not allowed',
          };
        }

        // If switching to write mode, require confirmation
        if (!targetReadOnly && validation.confirmationRequired) {
          if (!args.confirm_write_mode) {
            const message =
              '🔓 Claude CLI: Switching to write mode allows database modifications.\n\n⚠️  This includes potentially destructive operations like:\n• DROP TABLE statements\n• DELETE queries\n• Schema modifications\n\nTo proceed, call this tool again with confirm_write_mode: true';

            return {
              success: false,
              error: 'Confirmation required for write mode',
              message,
              current_mode: currentMode.readOnly ? 'read-only' : 'write',
              target_mode: targetReadOnly ? 'read-only' : 'write',
            };
          }
        }

        // Perform the mode toggle
        const result: ModeChangeResult = modeManager.toggleReadOnlyMode();

        return {
          success: result.success,
          message: result.message,
          previous_mode: {
            mode: result.previousMode.readOnly ? 'read-only' : 'write',
            timestamp: result.previousMode.timestamp.toISOString(),
            source: result.previousMode.source,
          },
          current_mode: {
            mode: result.newMode.readOnly ? 'read-only' : 'write',
            timestamp: result.newMode.timestamp.toISOString(),
            source: result.newMode.source,
          },
          claude_cli_message: result.claudeCLIMessage,
          warnings: result.warnings,
        };
      },
    }),

    get_runtime_mode_status: tool({
      description:
        'Get the current runtime mode status, including read-only state, security information, and Claude CLI specific guidance.',
      annotations: {
        title: 'Get runtime mode status',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({}),
      execute: async () => {
        const modeManager = getModeManager();
        const currentMode = modeManager.getCurrentMode();
        const securityInfo = modeManager.getSecurityInfo();

        return {
          current_mode: {
            mode: currentMode.readOnly ? 'read-only' : 'write',
            timestamp: currentMode.timestamp.toISOString(),
            source: currentMode.source,
          },
          security_info: {
            risk_level: securityInfo.riskLevel,
            recommendations: securityInfo.recommendations,
          },
          next_steps: currentMode.readOnly
            ? [
                'Use database query tools safely',
                'Toggle to write mode if modifications needed',
              ]
            : [
                'Use caution with database modifications',
                'Consider toggling back to read-only when done',
              ],
          claude_cli_status: getClaudeCLIStatusDisplay(),
          claude_cli_advice: securityInfo.claudeCLIAdvice,
        };
      },
    }),

    set_read_only_mode: tool({
      description:
        'Explicitly set read-only mode to enabled or disabled. Use toggle_read_only_mode for interactive switching.',
      annotations: {
        title: 'Set read-only mode',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      parameters: z.object({
        read_only: z
          .boolean()
          .describe(
            'True to enable read-only mode, false to enable write mode'
          ),
        confirm_write_mode: z
          .boolean()
          .optional()
          .describe(
            'Required confirmation when enabling write mode (setting read_only to false)'
          ),
      }),
      execute: async (args) => {
        const modeManager = getModeManager();
        const { read_only, confirm_write_mode } = args;

        // If enabling write mode, require confirmation
        if (!read_only) {
          const validation = validateModeChangeWithClaudeCLI(read_only);

          if (validation.confirmationRequired && !confirm_write_mode) {
            const message =
              '🔓 Claude CLI: Enabling write mode requires confirmation.\n\n⚠️  Write mode allows potentially destructive database operations.\n\nTo proceed, call this tool again with confirm_write_mode: true';

            return {
              success: false,
              error: 'Confirmation required for write mode',
              message,
              current_mode: modeManager.isReadOnly() ? 'read-only' : 'write',
              target_mode: read_only ? 'read-only' : 'write',
            };
          }
        }

        // Set the mode
        const result = modeManager.setReadOnlyMode(read_only, 'toggle');

        return {
          success: result.success,
          message: result.message,
          previous_mode: {
            mode: result.previousMode.readOnly ? 'read-only' : 'write',
            timestamp: result.previousMode.timestamp.toISOString(),
          },
          current_mode: {
            mode: result.newMode.readOnly ? 'read-only' : 'write',
            timestamp: result.newMode.timestamp.toISOString(),
          },
          claude_cli_message: result.claudeCLIMessage,
          warnings: result.warnings,
        };
      },
    }),

    validate_mode_change: tool({
      description:
        'Check if a mode change is allowed and what confirmations are required. Useful for understanding requirements before attempting mode changes.',
      annotations: {
        title: 'Validate mode change',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        target_mode: z
          .enum(['read-only', 'write'])
          .describe('The target mode to validate'),
      }),
      execute: async (args) => {
        const { target_mode } = args;
        const targetReadOnly = target_mode === 'read-only';

        const validation = validateModeChangeWithClaudeCLI(targetReadOnly);
        const currentMode = getCurrentModeStatus();

        const response: any = {
          can_change: validation.canChange,
          current_mode: currentMode.readOnly ? 'read-only' : 'write',
          target_mode,
          reason: validation.reason,
          confirmation_required: validation.confirmationRequired || false,
          claude_cli_prompt: validation.claudeCLIPrompt,
        };

        if (validation.confirmationRequired) {
          response.how_to_confirm = {
            tool:
              target_mode === 'write'
                ? 'toggle_read_only_mode'
                : 'set_read_only_mode',
            parameter: 'confirm_write_mode',
            value: true,
          };
        }

        return response;
      },
    }),

    switch_project: tool({
      description:
        'Switch to a different Supabase project. Claude CLI users get an interactive project selection interface when multiple projects are available.',
      annotations: {
        title: 'Switch project',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      parameters: z.object({
        project_identifier: z
          .string()
          .optional()
          .describe(
            'Project ID or name to switch to. If not provided, lists available projects for selection.'
          ),
      }),
      execute: async (args) => {
        const { project_identifier } = args;

        try {
          if (!project_identifier) {
            // List available projects
            const projectList = await listProjectsForClaudeCLI();

            if (projectList.projects.length === 0) {
              return {
                success: false,
                message: 'No projects found in your Supabase account',
                claude_cli_message:
                  '📋 Claude CLI: No projects found. Create a project at https://supabase.com/dashboard',
              };
            }

            if (projectList.projects.length === 1) {
              const singleProject = projectList.projects[0];
              if (!singleProject) {
                return {
                  success: false,
                  message: 'Project data corrupted',
                  claude_cli_message: '⚠️ Claude CLI: Project data corrupted',
                };
              }
              const currentProject = getCurrentProjectRef();

              if (singleProject.id === currentProject) {
                return {
                  success: true,
                  message: 'Already using the only available project',
                  current_project: {
                    id: singleProject.id,
                    name: singleProject.name,
                    status: singleProject.status,
                  },
                  claude_cli_message: `🎯 Claude CLI: Already using your only project "${singleProject.name}"`,
                };
              }
            }

            // Return project list for selection
            return {
              success: true,
              message:
                'Available projects listed. Specify project_identifier to switch.',
              projects: projectList.projects.map((p) => ({
                id: p.id,
                name: p.name,
                region: p.region,
                status: p.status,
                is_current: p.id === projectList.currentProject,
              })),
              current_project: projectList.currentProject,
              has_multiple_projects: projectList.hasMultipleProjects,
              claude_cli_formatted: projectList.claudeCLIFormatted,
              claude_cli_message:
                'Select a project by calling this tool again with project_identifier (ID or name).',
            };
          }

          // Switch to specified project
          const result: ProjectSwitchResult =
            await switchProjectInteractiveClaudeCLI(project_identifier);

          return {
            success: result.success,
            message: result.message,
            previous_project: result.previousProject,
            new_project: result.newProject,
            claude_cli_message: result.claudeCLIMessage,
            warnings: result.warnings,
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';

          return {
            success: false,
            error: errorMessage,
            claude_cli_message: `❌ Claude CLI: Project switching failed - ${errorMessage}`,
          };
        }
      },
    }),

    get_current_project: tool({
      description:
        'Get information about the currently selected Supabase project, including project details and switching guidance.',
      annotations: {
        title: 'Get current project',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({}),
      execute: async () => {
        const currentProjectRef = getCurrentProjectRef();

        if (!currentProjectRef) {
          const guidance = [
            '🎯 Claude CLI: No project currently selected',
            'Use switch_project tool to select a project',
            'If no projects exist, create one at https://supabase.com/dashboard',
          ];

          return {
            success: false,
            message: 'No project currently selected',
            current_project: null,
            guidance,
          };
        }

        try {
          const manager = getProjectManager();
          const projectInfo = await manager.getProjectInfo(currentProjectRef);

          return {
            success: true,
            current_project: {
              id: currentProjectRef,
              name: projectInfo?.name || 'Unknown',
              region: projectInfo?.region || 'Unknown',
              status: projectInfo?.status || 'Unknown',
              organization_id: projectInfo?.organization_id,
              created_at: projectInfo?.created_at,
              plan: projectInfo?.plan,
            },
            claude_cli_message:
              `🎯 Claude CLI: Currently using project "${projectInfo?.name || currentProjectRef}"\n` +
              `   • Project ID: ${currentProjectRef}\n` +
              `   • Status: ${projectInfo?.status || 'Unknown'}\n` +
              `   • Region: ${projectInfo?.region || 'Unknown'}\n\n` +
              '💡 Use switch_project to change to a different project',
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';

          return {
            success: false,
            error: `Failed to get project information: ${errorMessage}`,
            current_project_id: currentProjectRef,
            claude_cli_message: `❌ Claude CLI: Could not fetch details for project ${currentProjectRef}`,
          };
        }
      },
    }),

    list_projects: tool({
      description:
        'List all available Supabase projects with detailed information. Claude CLI users get a formatted display optimized for project selection.',
      annotations: {
        title: 'List projects',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      parameters: z.object({
        refresh: z
          .boolean()
          .optional()
          .describe(
            'Force refresh of project list from API (default: false, uses 5-minute cache)'
          ),
      }),
      execute: async (args) => {
        const { refresh = false } = args;

        try {
          const manager = getProjectManager();
          const projectList = await manager.listAvailableProjects(refresh);

          const response: any = {
            success: true,
            projects: projectList.projects.map((p) => ({
              id: p.id,
              name: p.name,
              region: p.region,
              status: p.status,
              organization_id: p.organization_id,
              created_at: p.created_at,
              plan: p.plan,
              is_current: p.id === projectList.currentProject,
            })),
            current_project: projectList.currentProject,
            total_projects: projectList.projects.length,
            has_multiple_projects: projectList.hasMultipleProjects,
            claude_cli_formatted: projectList.claudeCLIFormatted,
          };

          if (projectList.hasMultipleProjects) {
            response.claude_cli_message =
              'Use switch_project with project_identifier to change active project.';
          }

          return response;
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';

          return {
            success: false,
            error: `Failed to list projects: ${errorMessage}`,
            claude_cli_message: `❌ Claude CLI: Could not fetch project list - ${errorMessage}`,
          };
        }
      },
    }),
  };
}
