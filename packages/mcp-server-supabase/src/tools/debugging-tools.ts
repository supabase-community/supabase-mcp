import { z } from 'zod';
import {
  logsServiceSchema,
  type DebuggingOperations,
} from '../platform/types.js';
import { injectableTool } from './util.js';

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
        'Gets logs for a Supabase project by service type. Use this to help debug problems with your app. This will return logs within the last 24 hours.',
      annotations: {
        title: 'Get project logs',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        service: logsServiceSchema.describe('The service to fetch logs for'),
      }),
      inject: { project_id },
      execute: async ({ project_id, service }) => {
        const startTimestamp = new Date(Date.now() - 24 * 60 * 60 * 1000); // Last 24 hours
        const endTimestamp = new Date();

        return debugging.getLogs(project_id, {
          service,
          iso_timestamp_start: startTimestamp.toISOString(),
          iso_timestamp_end: endTimestamp.toISOString(),
        });
      },
    }),
    get_advisors: injectableTool({
      description:
        "Gets a list of advisory notices for the Supabase project. Use this to check for security vulnerabilities or performance improvements. Include the remediation URL as a clickable link so that the user can reference the issue themselves. It's recommended to run this tool regularly, especially after making DDL changes to the database since it will catch things like missing RLS policies.",
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
      }),
      inject: { project_id },
      execute: async ({ project_id, type }) => {
        switch (type) {
          case 'security':
            return debugging.getSecurityAdvisors(project_id);
          case 'performance':
            return debugging.getPerformanceAdvisors(project_id);
          default:
            throw new Error(`Unknown advisor type: ${type}`);
        }
      },
    }),
  };
}
