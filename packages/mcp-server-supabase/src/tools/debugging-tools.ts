import { z } from 'zod';
import { getLogQuery } from '../logs.js';
import type { SupabasePlatform } from '../platform/types.js';
import { injectableTool } from './util.js';

export type DebuggingToolsOptions = {
  platform: SupabasePlatform;
  projectRef?: string;
};

export function getDebuggingTools({
  platform,
  projectRef,
}: DebuggingToolsOptions) {
  const project_ref = projectRef;

  return {
    get_logs: injectableTool({
      description:
        'Gets logs for a Supabase project by service type. Use this to help debug problems with your app. This will only return logs within the last minute. If the logs you are looking for are older than 1 minute, re-run your test to reproduce them.',
      parameters: z.object({
        project_ref: z.string(),
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
      inject: { project_ref },
      execute: async ({ project_ref, service }) => {
        // Omitting start and end time defaults to the last minute.
        // But since branch actions are async, we need to wait longer
        // for jobs to be scheduled and run to completion.
        const startTimestamp =
          service === 'branch-action'
            ? new Date(Date.now() - 5 * 60 * 1000)
            : undefined;

        return platform.getLogs(project_ref, {
          sql: getLogQuery(service),
          iso_timestamp_start: startTimestamp?.toISOString(),
        });
      },
    }),
    get_advisors: injectableTool({
      description:
        "Gets a list of advisory notices for the Supabase project. Use this to check for security vulnerabilities or performance improvements. Include the remediation URL as a clickable link so that the user can reference the issue themselves. It's recommended to run this tool regularly, especially after making DDL changes to the database since it will catch things like missing RLS policies.",
      parameters: z.object({
        project_ref: z.string(),
        type: z
          .enum(['security', 'performance'])
          .describe('The type of advisors to fetch'),
      }),
      inject: { project_ref },
      execute: async ({ project_ref, type }) => {
        switch (type) {
          case 'security':
            return platform.getSecurityAdvisors(project_ref);
          case 'performance':
            return platform.getPerformanceAdvisors(project_ref);
          default:
            throw new Error(`Unknown advisor type: ${type}`);
        }
      },
    }),
  };
}
