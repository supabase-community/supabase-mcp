import { z } from 'zod';
import { getLogQuery } from '../logs.js';
import {
  assertSuccess,
  type ManagementApiClient,
} from '../management-api/index.js';
import { injectableTool } from './util.js';

export type DebuggingToolsOptions = {
  managementApiClient: ManagementApiClient;
  projectId?: string;
};

export function getDebuggingTools({
  managementApiClient,
  projectId,
}: DebuggingToolsOptions) {
  const project_id = projectId;

  return {
    get_logs: injectableTool({
      description:
        'Gets logs for a Supabase project by service type. Use this to help debug problems with your app. This will only return logs within the last minute. If the logs you are looking for are older than 1 minute, re-run your test to reproduce them.',
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
        // Omitting start and end time defaults to the last minute.
        // But since branch actions are async, we need to wait longer
        // for jobs to be scheduled and run to completion.
        const timestamp =
          service === 'branch-action'
            ? new Date(Date.now() - 5 * 60 * 1000)
            : undefined;
        const response = await managementApiClient.GET(
          '/v1/projects/{ref}/analytics/endpoints/logs.all',
          {
            params: {
              path: {
                ref: project_id,
              },
              query: {
                iso_timestamp_start: timestamp?.toISOString(),
                sql: getLogQuery(service),
              },
            },
          }
        );

        assertSuccess(response, 'Failed to fetch logs');

        return response.data;
      },
    }),
  };
}
