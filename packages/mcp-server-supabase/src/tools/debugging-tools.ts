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
  minutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .optional()
    .describe(
      'Optional lookback window in minutes. Defaults to 1440 minutes (24 hours).'
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe(
      'Optional maximum number of log rows to return. Defaults to 100.'
    ),
  search: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Optional case-insensitive text filter matched against log messages and service-specific fields.'
    ),
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
      'Gets logs for a Supabase project by service type. Use this to help debug problems with your app. Supports narrowing the lookback window, row limit, and text search to reduce noisy log output.',
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
      "Gets a list of advisory notices for the Supabase project. Use this to check for security vulnerabilities or performance improvements. Include the remediation URL as a clickable link so that the user can reference the issue themselves. It's recommended to run this tool regularly, especially after making DDL changes to the database since it will catch things like missing RLS policies.",
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
      execute: async ({ project_id, service, minutes, limit, search }) => {
        const startTimestamp = new Date(
          Date.now() - (minutes ?? 24 * 60) * 60 * 1000
        );
        const endTimestamp = new Date();

        const result = await debugging.getLogs(project_id, {
          service,
          iso_timestamp_start: startTimestamp.toISOString(),
          iso_timestamp_end: endTimestamp.toISOString(),
          limit,
          search,
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
