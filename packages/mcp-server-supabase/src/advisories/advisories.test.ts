import { describe, expect, test } from 'vitest';
import { buildRlsDisabledAdvisory } from './rls-disabled.js';
import { type Advisory, selectAdvisory } from './schema.js';

describe('buildRlsDisabledAdvisory', () => {
  test('returns advisory when tables have RLS disabled', () => {
    const tables = [
      { name: 'public.users', rls_enabled: false },
      { name: 'public.posts', rls_enabled: true },
      { name: 'public.comments', rls_enabled: false },
    ];

    const advisory = buildRlsDisabledAdvisory(tables);

    expect(advisory).not.toBeNull();
    expect(advisory!.id).toBe('rls_disabled');
    expect(advisory!.priority).toBe(1);
    expect(advisory!.level).toBe('critical');
    expect(advisory!.message).toContain('public.users');
    expect(advisory!.message).toContain('public.comments');
    expect(advisory!.message).not.toContain('public.posts');
    expect(advisory!.message).toContain('2 table(s)');
    expect(advisory!.remediation_sql).toBe(
      'ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;\n' +
        'ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;'
    );
    expect(advisory!.doc_url).toContain('row-level-security');
  });

  test('returns null when all tables have RLS enabled', () => {
    const tables = [
      { name: 'public.users', rls_enabled: true },
      { name: 'public.posts', rls_enabled: true },
    ];

    expect(buildRlsDisabledAdvisory(tables)).toBeNull();
  });

  test('returns null for empty table list', () => {
    expect(buildRlsDisabledAdvisory([])).toBeNull();
  });

  test('ignores system schema tables with RLS disabled', () => {
    const tables = [
      { name: 'auth.users', rls_enabled: false },
      { name: 'storage.objects', rls_enabled: false },
      { name: 'pg_catalog.pg_class', rls_enabled: false },
      { name: 'extensions.http', rls_enabled: false },
      { name: 'vault.secrets', rls_enabled: false },
    ];

    expect(buildRlsDisabledAdvisory(tables)).toBeNull();
  });

  test('only reports user-schema tables when mixed with system schemas', () => {
    const tables = [
      { name: 'auth.users', rls_enabled: false },
      { name: 'public.profiles', rls_enabled: false },
      { name: 'storage.objects', rls_enabled: false },
    ];

    const advisory = buildRlsDisabledAdvisory(tables);

    expect(advisory).not.toBeNull();
    expect(advisory!.message).toContain('1 table(s)');
    expect(advisory!.message).toContain('public.profiles');
    expect(advisory!.message).not.toContain('auth.users');
    expect(advisory!.remediation_sql).toBe(
      'ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;'
    );
  });

  test('handles custom user schemas', () => {
    const tables = [
      { name: 'myapp.orders', rls_enabled: false },
      { name: 'api.products', rls_enabled: false },
    ];

    const advisory = buildRlsDisabledAdvisory(tables);

    expect(advisory).not.toBeNull();
    expect(advisory!.message).toContain('myapp.orders');
    expect(advisory!.message).toContain('api.products');
  });
});

describe('selectAdvisory', () => {
  const highPriority: Advisory = {
    id: 'rls_disabled',
    priority: 1,
    level: 'critical',
    title: 'RLS disabled',
    message: 'test',
    remediation_sql: 'test',
    doc_url: 'test',
  };

  const lowPriority: Advisory = {
    id: 'feature_discovery',
    priority: 4,
    level: 'info',
    title: 'Feature discovery',
    message: 'test',
    remediation_sql: 'test',
    doc_url: 'test',
  };

  test('returns null for empty candidates', () => {
    expect(selectAdvisory([])).toBeNull();
  });

  test('returns null when all candidates are null', () => {
    expect(selectAdvisory([null, null])).toBeNull();
  });

  test('returns the only non-null candidate', () => {
    expect(selectAdvisory([null, highPriority, null])).toBe(highPriority);
  });

  test('picks the highest priority (lowest number)', () => {
    expect(selectAdvisory([lowPriority, highPriority])).toBe(highPriority);
    expect(selectAdvisory([highPriority, lowPriority])).toBe(highPriority);
  });
});
