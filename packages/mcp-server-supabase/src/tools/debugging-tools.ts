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
      'The start of the log window as an ISO 8601 timestamp. Defaults to 24 hours before the end of the window. The API caps the requested range at 24 hours.'
    ),
  iso_timestamp_end: z
    .string()
    .optional()
    .describe(
      'The end of the log window as an ISO 8601 timestamp. Defaults to the current time. The API caps the requested range at 24 hours.'
    ),
});

const getLogsOutputSchema = z.object({
  result: z.unknown(),
});

const queryLogsInputSchema = z.object({
  project_id: z.string(),
  sql: z
    .string()
    .min(1)
    .describe(
      "A read-only ClickHouse SQL query to run against the project's unified logs stream. Logs are exposed through a `logs` table; filter by `source` (e.g. 'edge_logs', 'postgres_logs', 'function_edge_logs', 'function_logs', 'auth_logs', 'storage_logs', 'realtime_logs', 'workflow_run_logs') and read nested fields via `log_attributes['<key>']`."
    ),
  iso_timestamp_start: z
    .string()
    .optional()
    .describe(
      'The start of the log window as an ISO 8601 timestamp. Defaults to 24 hours before the end of the window. The API caps the requested range at 24 hours.'
    ),
  iso_timestamp_end: z
    .string()
    .optional()
    .describe(
      'The end of the log window as an ISO 8601 timestamp. Defaults to the current time. The API caps the requested range at 24 hours.'
    ),
});

const queryLogsOutputSchema = z.object({
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
      'Gets logs for a Supabase project by service type. When the user asks about a specific time range, always pass iso_timestamp_start and iso_timestamp_end to match it; otherwise each call defaults to the last 24 hours and will return logs from a wider window than intended. The window can be up to 24 hours. Edge Function logs are split by kind: `edge-function` returns invocation/request logs, while `edge-function-runtime` returns console output from inside the function. Query one service first, then correlate with other services by timestamp or error anchors. Do not poll get_logs in a loop. On hosted (production) projects, prefer `query_logs` instead whenever you need more than a simple per-service log dump, since it supports custom ClickHouse queries. On local (CLI) and self-hosted projects, use `get_logs`: it is the only logs tool available there, since ClickHouse-backed querying is not yet supported on those platforms.',
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
  query_logs: {
    description:
      "Runs a custom read-only ClickHouse SQL query against a Supabase project's unified logs stream, for filtering, aggregating, or joining across log fields more precisely than the `get_logs` service presets allow. Only works on hosted (production) Supabase projects: on hosted projects, prefer this over `get_logs` whenever you need more than a simple per-service log dump. On local (CLI) and self-hosted projects this query will fail because ClickHouse-backed querying is not yet supported there, so use `get_logs` instead even when its presets are coarser — it is the only logs tool that works on those projects. When the user asks about a specific time range, always pass iso_timestamp_start and iso_timestamp_end to match it; otherwise the query defaults to the last 24 hours and will return results from a wider window than intended. The window can be up to 24 hours. Do not poll this tool in a loop.",
    parameters: queryLogsInputSchema,
    outputSchema: queryLogsOutputSchema,
    annotations: {
      title: 'Query project logs',
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

const DAY_MS = 24 * 60 * 60 * 1000;

function resolveLogWindow(
  iso_timestamp_start?: string,
  iso_timestamp_end?: string
) {
  const end = iso_timestamp_end ?? new Date().toISOString();
  const endMs = Date.parse(end);
  if (Number.isNaN(endMs)) {
    throw new Error(
      `Invalid iso_timestamp_end: "${end}". Expected an ISO 8601 timestamp.`
    );
  }

  const start = iso_timestamp_start ?? new Date(endMs - DAY_MS).toISOString();
  const startMs = Date.parse(start);
  if (Number.isNaN(startMs)) {
    throw new Error(
      `Invalid iso_timestamp_start: "${start}". Expected an ISO 8601 timestamp.`
    );
  }

  if (startMs >= endMs) {
    throw new Error('iso_timestamp_start must be before iso_timestamp_end.');
  }

  return { iso_timestamp_start: start, iso_timestamp_end: end };
}

export function getDebuggingTools({
  debugging,
  projectId,
}: DebuggingToolsOptions) {
  const project_id = projectId;
  const { queryLogs } = debugging;

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
        const result = await debugging.getLogs(project_id, {
          service,
          ...resolveLogWindow(iso_timestamp_start, iso_timestamp_end),
        });
        return { result: wrapWithUntrustedDataBoundary(result) };
      },
    }),
    ...(queryLogs && {
      query_logs: injectableTool({
        ...debuggingToolDefs.query_logs,
        inject: { project_id },
        execute: async ({
          project_id,
          sql,
          iso_timestamp_start,
          iso_timestamp_end,
        }) => {
          const result = await queryLogs(project_id, {
            sql,
            ...resolveLogWindow(iso_timestamp_start, iso_timestamp_end),
          });
          return { result: wrapWithUntrustedDataBoundary(result) };
        },
      }),
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
