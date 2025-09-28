import { z } from 'zod';
import type { AnalyticsOperations } from '../platform/types.js';
import { injectableTool } from './util.js';
import { source } from 'common-tags';

export interface AnalyticsToolsOptions {
  analytics: AnalyticsOperations;
  projectId?: string;
}

export function getAnalyticsTools({
  analytics,
  projectId,
}: AnalyticsToolsOptions) {
  const project_id = projectId;

  const analyticsTools = {
    get_api_usage: injectableTool({
      description:
        'Retrieves API usage statistics for a project. Shows request counts and patterns over time.',
      annotations: {
        title: 'Get API usage',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        start_date: z
          .string()
          .optional()
          .describe('ISO 8601 date string for start of time range'),
        end_date: z
          .string()
          .optional()
          .describe('ISO 8601 date string for end of time range'),
      }),
      inject: { project_id },
      execute: async ({ project_id, start_date, end_date }) => {
        const timeRange =
          start_date && end_date
            ? { start: start_date, end: end_date }
            : undefined;
        const usage = await analytics.getApiUsage(project_id, timeRange);
        return source`
          API Usage Statistics:
          ${JSON.stringify(usage, null, 2)}
        `;
      },
    }),

    get_function_stats: injectableTool({
      description:
        'Retrieves analytics and statistics for edge functions. Can get stats for all functions or a specific one.',
      annotations: {
        title: 'Get edge function statistics',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        function_slug: z
          .string()
          .optional()
          .describe('Specific function slug to get stats for'),
      }),
      inject: { project_id },
      execute: async ({ project_id, function_slug }) => {
        const stats = await analytics.getFunctionStats(project_id, function_slug);
        return source`
          Edge Function Statistics${function_slug ? ` for ${function_slug}` : ''}:
          ${JSON.stringify(stats, null, 2)}
        `;
      },
    }),

    get_all_logs: injectableTool({
      description:
        'Retrieves all application logs with optional filtering. Useful for debugging and monitoring.',
      annotations: {
        title: 'Get all logs',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      parameters: z.object({
        project_id: z.string(),
        limit: z
          .number()
          .optional()
          .default(100)
          .describe('Maximum number of logs to return'),
        offset: z.number().optional().describe('Offset for pagination'),
        query: z
          .string()
          .optional()
          .describe('Search query to filter logs'),
      }),
      inject: { project_id },
      execute: async ({ project_id, limit, offset, query }) => {
        const logs = await analytics.getAllLogs(project_id, {
          limit,
          offset,
          query,
        });
        return source`
          Application Logs:
          ${JSON.stringify(logs, null, 2)}
        `;
      },
    }),

    query_logs: injectableTool({
      description:
        'Execute SQL queries against project logs. Requires time range (max 24 hours).',
      annotations: {
        title: 'Query logs with SQL',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      parameters: z.object({
        project_id: z.string(),
        sql: z
          .string()
          .describe('SQL query to execute against logs'),
        start_time: z
          .string()
          .describe('ISO 8601 timestamp for start of time range'),
        end_time: z
          .string()
          .describe('ISO 8601 timestamp for end of time range'),
      }),
      inject: { project_id },
      execute: async ({ project_id, sql, start_time, end_time }) => {
        const result = await analytics.queryLogs(project_id, sql, {
          start: start_time,
          end: end_time,
        });
        return source`
          Query Results:
          ${JSON.stringify(result, null, 2)}
        `;
      },
    }),

    get_network_bans: injectableTool({
      description:
        'Lists all banned IP addresses and network restrictions for security monitoring.',
      annotations: {
        title: 'Get network bans',
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
        const bans = await analytics.getNetworkBans(project_id);
        return source`
          Network Bans:
          ${JSON.stringify(bans, null, 2)}
        `;
      },
    }),

    get_enriched_network_bans: injectableTool({
      description:
        'Retrieves detailed information about banned IPs including geolocation and threat intelligence.',
      annotations: {
        title: 'Get enriched network bans',
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
        const enrichedBans = await analytics.getEnrichedBans(project_id);
        return source`
          Enriched Network Ban Information:
          ${JSON.stringify(enrichedBans, null, 2)}
        `;
      },
    }),
  };

  return analyticsTools;
}