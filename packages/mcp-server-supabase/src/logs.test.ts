import { describe, expect, test } from 'vitest';
import { getLogQuery } from './logs.js';

describe('getLogQuery', () => {
  test('keeps the existing numeric limit overload', () => {
    const query = getLogQuery('edge-function', 25);

    expect(query).toContain('from function_edge_logs');
    expect(query).toContain('limit 25');
  });

  test('adds a service-specific text filter', () => {
    const query = getLogQuery('edge-function', {
      limit: 50,
      search: 'planner',
    });

    expect(query).toContain('where (');
    expect(query).toContain("event_message ilike '%planner%'");
    expect(query).toContain("m.function_id ilike '%planner%'");
    expect(query).toContain("request.path ilike '%planner%'");
    expect(query).toContain('limit 50');
  });

  test('escapes single quotes in text filters', () => {
    const query = getLogQuery('api', {
      search: "worker's path",
    });

    expect(query).toContain("event_message ilike '%worker''s path%'");
  });

  test('casts numeric auth status before applying a text filter', () => {
    const query = getLogQuery('auth', {
      search: '500',
    });

    expect(query).toContain("cast(metadata.status as text) ilike '%500%'");
  });
});
