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
  last_minutes: z
    .number()
    .int()
    .min(1)
    .max(1440)
    .optional()
    .describe(
      'Fetch logs from the last N minutes. Defaults to the last 24 hours when no explicit start timestamp is provided.'
    ),
  iso_timestamp_start: z
    .string()
    .optional()
    .describe('The ISO timestamp to start fetching logs from.'),
  iso_timestamp_end: z
    .string()
    .optional()
    .describe('The ISO timestamp to stop fetching logs at. Defaults to now.'),
  search: z
    .string()
    .trim()
    .min(1)
    .max(256)
    .optional()
    .describe(
      'Filters logs to rows containing this text in common log fields such as messages, paths, or edge function IDs.'
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(100)
    .describe('Maximum number of log rows to return. Defaults to 100.'),
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
      'Gets logs for a Supabase project by service type. Use this to help debug problems with your app. Defaults to the last 24 hours, with optional time window, search, and limit filters for focused debugging.',
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
      execute: async ({
        project_id,
        service,
        last_minutes,
        iso_timestamp_start,
        iso_timestamp_end,
        search,
        limit,
      }) => {
        const endTimestamp = parseTimestamp(iso_timestamp_end) ?? new Date();
        const startTimestamp =
          parseTimestamp(iso_timestamp_start) ??
          new Date(
            endTimestamp.getTime() - (last_minutes ?? 24 * 60) * 60 * 1000
          );

        if (startTimestamp > endTimestamp) {
          throw new Error(
            'iso_timestamp_start must be before iso_timestamp_end.'
          );
        }

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

function parseTimestamp(value?: string) {
  if (!value) return undefined;

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Invalid ISO timestamp: ${value}`);
  }

  return timestamp;
}
