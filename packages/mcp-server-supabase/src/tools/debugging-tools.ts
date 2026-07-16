import { z } from 'zod/v4';
import {
  logsServiceSchema,
  type DebuggingOperations,
} from '../platform/types.js';
import {
  injectableTool,
  type ToolDefs,
  wrapWithUntrustedDataBoundary,
} from './util.js';

type DebuggingToolsOptions = {
  debugging: DebuggingOperations;
  projectId?: string;
};

const getLogsInputSchema = z.object({
  project_id: z.string(),
  service: logsServiceSchema.describe('The service to fetch logs for'),
  iso_timestamp_start: z
    .string()
    .optional()
    .describe(
      'The start of the log window as an ISO 8601 timestamp. The API caps the requested range at 24 hours.'
    ),
  iso_timestamp_end: z
    .string()
    .optional()
    .describe(
      'The end of the log window as an ISO 8601 timestamp. The API caps the requested range at 24 hours.'
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
      'Gets logs for a Supabase project by service type. Each call returns logs from the last 24 hours by default. Provide a custom iso_timestamp_start/iso_timestamp_end window up to 24 hours. Edge Function logs are split by kind: `edge-function` returns invocation/request logs, while `edge-function-runtime` returns console output from inside the function. Query one service first, then correlate with other services by timestamp or error anchors. Do not poll get_logs in a loop.',
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
        iso_timestamp_start,
        iso_timestamp_end,
      }) => {
        const endTimestamp = new Date();
        const startTimestamp = new Date(
          endTimestamp.getTime() - 24 * 60 * 60 * 1000
        ); // Last 24 hours

        const result = await debugging.getLogs(project_id, {
          service,
          iso_timestamp_start:
            iso_timestamp_start ?? startTimestamp.toISOString(),
          iso_timestamp_end: iso_timestamp_end ?? endTimestamp.toISOString(),
        });
        return { result: wrapWithUntrustedDataBoundary(result) };
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
