import { stripIndent } from 'common-tags';
import type { LogsService } from './platform/types.js';

type LogQueryOptions = {
  limit?: number;
  search?: string;
};

function sqlString(value: string) {
  return value.replaceAll("'", "''");
}

function buildSearchFilter(search: string | undefined, columns: string[]) {
  if (!search) return '';

  const pattern = sqlString(`%${search}%`);
  return `where (${columns
    .map((column) => `${column} ilike '${pattern}'`)
    .join(' or ')})`;
}

export function getLogQuery(
  service: LogsService,
  options: LogQueryOptions | number = {}
) {
  const { limit = 100, search } =
    typeof options === 'number' ? { limit: options } : options;

  switch (service) {
    case 'api': {
      const searchFilter = buildSearchFilter(search, [
        'event_message',
        'identifier',
        'request.method',
        'request.path',
        'cast(response.status_code as text)',
      ]);
      return stripIndent`
        select id, identifier, timestamp, event_message, request.method, request.path, response.status_code
        from edge_logs
        cross join unnest(metadata) as m
        cross join unnest(m.request) as request
        cross join unnest(m.response) as response
        ${searchFilter}
        order by timestamp desc
        limit ${limit}
      `;
    }
    case 'branch-action': {
      const searchFilter = buildSearchFilter(search, [
        'event_message',
        'workflow_run',
      ]);
      return stripIndent`
        select workflow_run, workflow_run_logs.timestamp, id, event_message from workflow_run_logs
        ${searchFilter}
        order by timestamp desc
        limit ${limit}
      `;
    }
    case 'postgres': {
      const searchFilter = buildSearchFilter(search, [
        'event_message',
        'identifier',
        'parsed.error_severity',
      ]);
      return stripIndent`
        select identifier, postgres_logs.timestamp, id, event_message, parsed.error_severity from postgres_logs
        cross join unnest(metadata) as m
        cross join unnest(m.parsed) as parsed
        ${searchFilter}
        order by timestamp desc
        limit ${limit}
      `;
    }
    case 'edge-function': {
      const searchFilter = buildSearchFilter(search, [
        'event_message',
        'm.function_id',
        'request.method',
        'request.path',
        'm.deployment_id',
        'm.version',
        'cast(response.status_code as text)',
      ]);
      return stripIndent`
        select id, function_edge_logs.timestamp, event_message, response.status_code, request.method, m.function_id, m.execution_time_ms, m.deployment_id, m.version from function_edge_logs
        cross join unnest(metadata) as m
        cross join unnest(m.response) as response
        cross join unnest(m.request) as request
        ${searchFilter}
        order by timestamp desc
        limit ${limit}
      `;
    }
    case 'auth': {
      const searchFilter = buildSearchFilter(search, [
        'event_message',
        'metadata.level',
        'cast(metadata.status as text)',
        'metadata.path',
        'metadata.msg',
        'metadata.error',
      ]);
      return stripIndent`
        select id, auth_logs.timestamp, event_message, metadata.level, metadata.status, metadata.path, metadata.msg as msg, metadata.error from auth_logs
        cross join unnest(metadata) as metadata
        ${searchFilter}
        order by timestamp desc
        limit ${limit}
      `;
    }
    case 'storage': {
      const searchFilter = buildSearchFilter(search, ['event_message', 'id']);
      return stripIndent`
        select id, storage_logs.timestamp, event_message from storage_logs
        ${searchFilter}
        order by timestamp desc
        limit ${limit}
      `;
    }
    case 'realtime': {
      const searchFilter = buildSearchFilter(search, ['event_message', 'id']);
      return stripIndent`
        select id, realtime_logs.timestamp, event_message from realtime_logs
        ${searchFilter}
        order by timestamp desc
        limit ${limit}
      `;
    }
    default:
      throw new Error(`unsupported log service type: ${service}`);
  }
}
