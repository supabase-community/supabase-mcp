import { z } from 'zod';
import type { DebuggingOperations } from '../platform/types.js';
import { injectableTool } from './util.js';
import { limitResponseSize } from '../response/index.js';

export type DebuggingToolsOptions = {
  debugging: DebuggingOperations;
  projectId?: string;
};

export function getDebuggingTools({
  debugging,
  projectId,
}: DebuggingToolsOptions) {
  const project_id = projectId;

  return {
    get_logs: injectableTool({
      description:
        'Gets logs for a Supabase project by service type. Returns logs from the last 24 hours. Use this to help debug problems with your app.',
      annotations: {
        title: 'Get project logs',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        service: z
          .enum([
            'api',
            'branch-action',
            'postgres',
            'edge-function',
            'auth',
            'storage',
            'realtime',
          ])
          .describe('The service to fetch logs for'),
      }),
      inject: { project_id },
      execute: async ({ project_id, service }) => {
        // Get logs from last 24 hours
        const startTimestamp = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const logs = await debugging.getLogs(project_id, {
          service,
          iso_timestamp_start: startTimestamp.toISOString(),
        });

        return limitResponseSize(
          logs,
          `${service} service logs (last 24 hours)`,
          { maxTokens: 12000 }
        );
      },
    }),
    get_advisors: injectableTool({
      description:
        "Gets a list of advisory notices for the Supabase project with intelligent filtering. Use this to check for security vulnerabilities or performance improvements. Include the remediation URL as a clickable link so that the user can reference the issue themselves. It's recommended to run this tool regularly, especially after making DDL changes to the database since it will catch things like missing RLS policies.",
      annotations: {
        title: 'Get project advisors',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        type: z
          .enum(['security', 'performance'])
          .describe('The type of advisors to fetch'),
        severity_filter: z
          .enum(['critical', 'high', 'medium', 'low', 'all'])
          .default('all')
          .describe('Filter by issue severity (critical=critical only, high=high and above, etc.)'),
        response_format: z
          .enum(['detailed', 'summary', 'critical_only'])
          .default('detailed')
          .describe('Format: detailed=full info, summary=key points, critical_only=urgent issues only'),
      }),
      inject: { project_id },
      execute: async ({ project_id, type, severity_filter, response_format }) => {
        let advisors;
        switch (type) {
          case 'security':
            advisors = await debugging.getSecurityAdvisors(project_id);
            break;
          case 'performance':
            advisors = await debugging.getPerformanceAdvisors(project_id);
            break;
          default:
            throw new Error(`Unknown advisor type: ${type}`);
        }

        // Ensure advisors is an array
        const advisorList = Array.isArray(advisors) ? advisors : [];

        // Apply severity filtering
        let filteredAdvisors = advisorList;
        if (severity_filter !== 'all' && advisorList.length > 0) {
          const severityLevels = { low: 1, medium: 2, high: 3, critical: 4 };
          const minSeverity = severityLevels[severity_filter as keyof typeof severityLevels] || 1;

          filteredAdvisors = advisorList.filter(advisor => {
            const severity = advisor.severity?.toLowerCase() || 'medium';
            const advisorLevel = severityLevels[severity as keyof typeof severityLevels] || 2;
            return advisorLevel >= minSeverity;
          });
        }

        // Apply response format
        let processedAdvisors;
        switch (response_format) {
          case 'summary':
            processedAdvisors = filteredAdvisors.map(advisor => ({
              title: advisor.title || advisor.name,
              severity: advisor.severity,
              category: advisor.category || type,
              summary: advisor.description?.substring(0, 150) + '...' || 'No description',
              remediation_url: advisor.remediation_url || advisor.url,
            }));
            break;

          case 'critical_only':
            processedAdvisors = filteredAdvisors
              .filter(advisor => {
                const severity = advisor.severity?.toLowerCase() || 'medium';
                return severity === 'critical' || severity === 'high';
              })
              .map(advisor => ({
                title: advisor.title || advisor.name,
                severity: advisor.severity,
                description: advisor.description,
                remediation_url: advisor.remediation_url || advisor.url,
                action_required: advisor.action_required || 'Review and address',
              }));
            break;

          default:
            processedAdvisors = filteredAdvisors;
        }

        // Build context
        const contextParts = [
          `${type} advisors`,
          severity_filter !== 'all' && `(${severity_filter}+ severity)`,
          `(${processedAdvisors.length} issues)`,
          response_format !== 'detailed' && `(${response_format} format)`
        ].filter(Boolean);

        // Determine max tokens based on response format
        let maxTokens: number;
        switch (response_format) {
          case 'summary':
            maxTokens = 8000;
            break;
          case 'critical_only':
            maxTokens = 5000;
            break;
          case 'detailed':
          default:
            maxTokens = 12000;
            break;
        }

        return limitResponseSize(
          processedAdvisors,
          contextParts.join(' '),
          { maxTokens }
        );
      },
    }),
    get_project_health: injectableTool({
      description:
        'Gets the health status of all services in a Supabase project. This shows which services are running and their current status.',
      annotations: {
        title: 'Get project health',
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
        return debugging.getProjectHealth(project_id);
      },
    }),
    get_upgrade_status: injectableTool({
      description:
        'Gets the current upgrade status of a Supabase project. Use this to check if an upgrade is in progress.',
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
        return debugging.getUpgradeStatus(project_id);
      },
    }),
    check_upgrade_eligibility: injectableTool({
      description:
        'Checks if a Supabase project is eligible for upgrade. This shows available upgrade options.',
      annotations: {
        title: 'Check upgrade eligibility',
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
        return debugging.checkUpgradeEligibility(project_id);
      },
    }),
  };
}
