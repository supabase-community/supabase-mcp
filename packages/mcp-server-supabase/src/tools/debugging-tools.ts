import { z } from 'zod/v4';
import {
  logsServiceSchema,
  type DebuggingOperations,
} from '../platform/types.js';
import { injectableTool, type ToolDefs } from './util.js';

type DebuggingToolsOptions = {
  debugging: DebuggingOperations;
  projectId?: string;
};

const getLogsInputSchema = z.object({
  project_id: z.string(),
  service: logsServiceSchema.describe('The service to fetch logs for'),
});

const getLogsOutputSchema = z.object({
  result: z.unknown(),
});

const getAdvisorsInputSchema = z.object({
  project_id: z.string(),
  type: z
    .enum(['security', 'performance'])
    .describe('The type of advisors to fetch'),
});

const getAdvisorsOutputSchema = z.object({
  result: z.unknown(),
});

export const debuggingToolDefs = {
  get_logs: {
    description:
      'Retrieve logs for a Supabase project filtered by service type to debug application issues. Use when the user wants to investigate errors, monitor performance, or troubleshoot problems with their Supabase application. Accepts `project_id` (required) and `service_type` (optional: "api", "auth", "realtime", "storage", or "edge-functions"). Returns logs from the last 24 hours only. e.g., service_type="api" to view API gateway logs or service_type="auth" for authentication errors. Raises an error if the project does not exist or you lack access permissions. Do not use when you need general project information (use get_project instead).',
    parameters: getLogsInputSchema,
    outputSchema: getLogsOutputSchema,
    annotations: {
      title: 'Get project logs',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  get_advisors: {
    description:
      "Retrieve advisory notices for a Supabase project to identify security vulnerabilities and performance issues. Use when the user wants to audit their database for missing RLS policies, security gaps, or optimization opportunities. Accepts `project_id` (required) and returns notices with clickable remediation URLs. e.g., checking for missing row-level security after schema changes. Raises an error if the project does not exist or access is denied. Do not use when you need general project information (use get_project instead).",
    parameters: getAdvisorsInputSchema,
    outputSchema: getAdvisorsOutputSchema,
    annotations: {
      title: 'Get project advisors',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
} as const satisfies ToolDefs;

export function getDebuggingTools({
  debugging,
  projectId,
}: DebuggingToolsOptions) {
  const project_id = projectId;

  return {
    get_logs: injectableTool({
      ...debuggingToolDefs.get_logs,
      inject: { project_id },
      execute: async ({ project_id, service }) => {
        const startTimestamp = new Date(Date.now() - 24 * 60 * 60 * 1000); // Last 24 hours
        const endTimestamp = new Date();

        const result = await debugging.getLogs(project_id, {
          service,
          iso_timestamp_start: startTimestamp.toISOString(),
          iso_timestamp_end: endTimestamp.toISOString(),
        });
        return { result };
      },
    }),
    get_advisors: injectableTool({
      ...debuggingToolDefs.get_advisors,
      inject: { project_id },
      execute: async ({ project_id, type }) => {
        let result: unknown;
        switch (type) {
          case 'security':
            result = await debugging.getSecurityAdvisors(project_id);
            break;
          case 'performance':
            result = await debugging.getPerformanceAdvisors(project_id);
            break;
          default:
            throw new Error(`Unknown advisor type: ${type}`);
        }
        return { result };
      },
    }),
  };
}
