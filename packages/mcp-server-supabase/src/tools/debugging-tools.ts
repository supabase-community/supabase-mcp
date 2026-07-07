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
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Maximum number of advisor notices to return.'),
  offset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Number of advisor notices to skip before returning results.'),
});

const getAdvisorsOutputSchema = z.object({
  result: z.unknown(),
});

function paginateAdvisorResult(result: unknown, limit?: number, offset = 0) {
  if (limit === undefined && offset === 0) return result;

  if (
    !result ||
    typeof result !== 'object' ||
    !('lints' in result) ||
    !Array.isArray(result.lints)
  ) {
    return result;
  }

  const total = result.lints.length;
  const lints = result.lints.slice(offset, limit ? offset + limit : undefined);
  const next_offset =
    limit !== undefined && offset + limit < total ? offset + limit : undefined;

  return {
    ...result,
    lints,
    pagination: {
      total,
      offset,
      limit: limit ?? total - offset,
      ...(next_offset !== undefined && { next_offset }),
    },
  };
}

export const debuggingToolDefs = {
  get_logs: {
    description:
      'Gets logs for a Supabase project by service type. Use this to help debug problems with your app. This will return logs within the last 24 hours.',
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
      execute: async ({ project_id, type, limit, offset }) => {
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
        return { result: paginateAdvisorResult(result, limit, offset) };
      },
    }),
  };
}
