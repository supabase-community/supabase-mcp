import { describe, expect, test } from 'vitest';
import { getClickHouseLogQuery } from './logs.js';
import type { LogsService } from './platform/types.js';

const serviceSources = {
  api: 'edge_logs',
  'branch-action': 'workflow_run_logs',
  postgres: 'postgres_logs',
  'edge-function': 'function_edge_logs',
  'edge-function-runtime': 'function_logs',
  auth: 'auth_logs',
  storage: 'storage_logs',
  realtime: 'realtime_logs',
} as const satisfies Record<LogsService, string>;

describe('getClickHouseLogQuery', () => {
  test.each(Object.entries(serviceSources))(
    'queries logs table for %s logs',
    (service, source) => {
      const query = getClickHouseLogQuery(service as LogsService);

      expect(query).toContain('from logs');
      expect(query).toContain(`where source = '${source}'`);
      expect(query).toContain('order by timestamp desc');
      expect(query).toContain('limit 100');
      expect(query).not.toContain('select *');
    }
  );

  test('queries runtime logs fields without invocation request fields', () => {
    const query = getClickHouseLogQuery('edge-function-runtime');

    expect(query).toContain('severity_text');
    expect(query).toContain("log_attributes['level'] as level");
    expect(query).toContain("log_attributes['event_type'] as event_type");
    expect(query).toContain("log_attributes['execution_id'] as execution_id");
    expect(query).not.toContain("log_attributes['request.method']");
    expect(query).not.toContain("log_attributes['response.status_code']");
  });
});
