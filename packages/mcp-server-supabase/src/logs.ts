import { stripIndent } from 'common-tags';
import type { LogsService } from './platform/types.js';

export type LogQueryOptions = {
  limit?: number;
  search?: string;
};

export function getLogQuery(
  service: LogsService,
  { limit = 100, search }: LogQueryOptions = {}
) {
  const whereClause = getSearchWhereClause(service, search);

  switch (service) {
    case 'api':
      return stripIndent`
        select id, identifier, timestamp, event_message, request.method, request.path, response.status_code
        from edge_logs
        cross join unnest(metadata) as m
        cross join unnest(m.request) as request
        cross join unnest(m.response) as response
        ${whereClause}
        order by timestamp desc
        limit ${limit}
      `;
    case 'branch-action':
      return stripIndent`
        select workflow_run, workflow_run_logs.timestamp, id, event_message from workflow_run_logs
        ${whereClause}
        order by timestamp desc
        limit ${limit}
      `;
    case 'postgres':
      return stripIndent`
        select identifier, postgres_logs.timestamp, id, event_message, parsed.error_severity from postgres_logs
        cross join unnest(metadata) as m
        cross join unnest(m.parsed) as parsed
        ${whereClause}
        order by timestamp desc
        limit ${limit}
      `;
    case 'edge-function':
      return stripIndent`
        select id, function_edge_logs.timestamp, event_message, response.status_code, request.method, m.function_id, m.execution_time_ms, m.deployment_id, m.version from function_edge_logs
        cross join unnest(metadata) as m
        cross join unnest(m.response) as response
        cross join unnest(m.request) as request
        ${whereClause}
        order by timestamp desc
        limit ${limit}
      `;
    case 'auth':
      return stripIndent`
        select id, auth_logs.timestamp, event_message, metadata.level, metadata.status, metadata.path, metadata.msg as msg, metadata.error from auth_logs
        cross join unnest(metadata) as metadata
        ${whereClause}
        order by timestamp desc
        limit ${limit}
      `;
    case 'storage':
      return stripIndent`
        select id, storage_logs.timestamp, event_message from storage_logs
        ${whereClause}
        order by timestamp desc
        limit ${limit}
      `;
    case 'realtime':
      return stripIndent`
        select id, realtime_logs.timestamp, event_message from realtime_logs
        ${whereClause}
        order by timestamp desc
        limit ${limit}
      `;
    default:
      throw new Error(`unsupported log service type: ${service}`);
  }
}

function getSearchWhereClause(service: LogsService, search?: string) {
  const searchTerm = search?.trim();
  if (!searchTerm) return '';

  const literal = sqlStringLiteral(searchTerm.toLowerCase());
  const fields = getSearchableFields(service);
  const predicates = fields.map(
    (field) => `strpos(lower(cast(${field} as string)), ${literal}) > 0`
  );

  return `where (${predicates.join('\n  or ')})`;
}

function getSearchableFields(service: LogsService) {
  switch (service) {
    case 'api':
      return [
        'id',
        'identifier',
        'event_message',
        'request.method',
        'request.path',
        'response.status_code',
      ];
    case 'branch-action':
      return ['id', 'workflow_run', 'event_message'];
    case 'postgres':
      return ['id', 'identifier', 'event_message', 'parsed.error_severity'];
    case 'edge-function':
      return [
        'id',
        'event_message',
        'request.method',
        'response.status_code',
        'm.function_id',
        'm.deployment_id',
        'm.version',
      ];
    case 'auth':
      return [
        'id',
        'event_message',
        'metadata.level',
        'metadata.status',
        'metadata.path',
        'metadata.msg',
        'metadata.error',
      ];
    case 'storage':
      return ['id', 'event_message'];
    case 'realtime':
      return ['id', 'event_message'];
    default:
      throw new Error(`unsupported log service type: ${service}`);
  }
}

function sqlStringLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}
