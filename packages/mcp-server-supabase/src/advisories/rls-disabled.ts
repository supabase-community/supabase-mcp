import type { Advisory } from './schema.js';

/**
 * Schemas excluded from the RLS advisory.
 * Matches the exclusion list in the database linter (lints.sql `rls_disabled_in_public`).
 */
const SYSTEM_SCHEMAS = new Set([
  '_timescaledb_cache',
  '_timescaledb_catalog',
  '_timescaledb_config',
  '_timescaledb_internal',
  'auth',
  'cron',
  'extensions',
  'graphql',
  'graphql_public',
  'information_schema',
  'net',
  'pgbouncer',
  'pg_catalog',
  'pgmq',
  'pgroonga',
  'pgsodium',
  'pgsodium_masks',
  'pgtle',
  'realtime',
  'repack',
  'storage',
  'supabase_functions',
  'supabase_migrations',
  'tiger',
  'topology',
  'vault',
]);

/**
 * Builds an RLS advisory when any user-schema tables have RLS disabled.
 *
 * Expects table names in `schema.table` format (as returned by `list_tables`).
 * Returns `null` if all tables have RLS enabled or are in system schemas.
 */
export function buildRlsDisabledAdvisory(
  tables: Array<{ name: string; rls_enabled: boolean }>
): Advisory | null {
  const unprotected = tables.filter((t) => {
    const schema = t.name.split('.')[0] ?? '';
    return !t.rls_enabled && !SYSTEM_SCHEMAS.has(schema);
  });

  if (unprotected.length === 0) return null;

  const sqlStatements = unprotected
    .map((t) => `ALTER TABLE ${t.name} ENABLE ROW LEVEL SECURITY;`)
    .join('\n');

  return {
    id: 'rls_disabled',
    priority: 1,
    level: 'critical',
    title: 'Row Level Security is disabled',
    message: `${unprotected.length} table(s) do not have Row Level Security (RLS) enabled: ${unprotected.map((t) => t.name).join(', ')}. Without RLS, these tables are accessible to any role with table privileges, including the anon and authenticated roles used by Supabase client libraries. Enable RLS and create appropriate policies to protect your data.`,
    remediation_sql: sqlStatements,
    doc_url:
      'https://supabase.com/docs/guides/database/postgres/row-level-security',
  };
}
