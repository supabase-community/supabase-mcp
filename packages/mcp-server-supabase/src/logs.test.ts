import { describe, expect, test } from 'vitest';
import { getLogQuery } from './logs.js';

describe('getLogQuery', () => {
  test('uses the default limit without a search filter', () => {
    const query = getLogQuery('edge-function');

    expect(query).toContain('from function_edge_logs');
    expect(query).not.toContain('where (');
    expect(query).toContain('limit 100');
  });

  test('filters edge function logs across message and function metadata', () => {
    const query = getLogQuery('edge-function', {
      search: 'billing-worker',
      limit: 25,
    });

    expect(query).toContain('where (');
    expect(query).toContain('event_message');
    expect(query).toContain('m.function_id');
    expect(query).toContain("'billing-worker'");
    expect(query).toContain('limit 25');
  });

  test('escapes search terms before embedding them in the log query', () => {
    const query = getLogQuery('auth', {
      search: "can't sign in",
      limit: 10,
    });

    expect(query).toContain("'can''t sign in'");
    expect(query).toContain('metadata.path');
    expect(query).toContain('metadata.error');
  });
});
