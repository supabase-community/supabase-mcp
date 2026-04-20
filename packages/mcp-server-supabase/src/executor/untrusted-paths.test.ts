import { describe, expect, test } from 'vitest';
import { requiresBoundary } from './untrusted-paths.js';

describe('requiresBoundary', () => {
  test('POST to database/query returns true', () => {
    expect(requiresBoundary('POST', '/v1/projects/abc123/database/query')).toBe(
      true
    );
  });
  test('POST to database/query/read-only returns true', () => {
    expect(
      requiresBoundary('POST', '/v1/projects/abc123/database/query/read-only')
    ).toBe(true);
  });
  test('GET to logs endpoint returns true', () => {
    expect(
      requiresBoundary(
        'GET',
        '/v1/projects/abc123/analytics/endpoints/logs.all'
      )
    ).toBe(true);
  });
  test('GET to edge function body returns true', () => {
    expect(
      requiresBoundary('GET', '/v1/projects/abc123/functions/my-func/body')
    ).toBe(true);
  });
  test('GET to snippet detail returns true', () => {
    expect(requiresBoundary('GET', '/v1/snippets/some-id')).toBe(true);
  });
  test('GET to organizations returns false', () => {
    expect(requiresBoundary('GET', '/v1/organizations')).toBe(false);
  });
  test('GET to projects returns false', () => {
    expect(requiresBoundary('GET', '/v1/projects')).toBe(false);
  });
  test('GET to database/query (wrong method) returns false', () => {
    expect(requiresBoundary('GET', '/v1/projects/abc123/database/query')).toBe(
      false
    );
  });
  test('GET to snippets list (no ID) returns false', () => {
    expect(requiresBoundary('GET', '/v1/snippets')).toBe(false);
  });
  test('strips query string before matching', () => {
    expect(
      requiresBoundary('POST', '/v1/projects/abc123/database/query?foo=bar')
    ).toBe(true);
  });
  test('path without leading slash is normalised', () => {
    expect(requiresBoundary('POST', 'v1/projects/abc123/database/query')).toBe(
      true
    );
  });
});
