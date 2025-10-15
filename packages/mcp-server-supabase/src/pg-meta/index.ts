import { stripIndent } from 'common-tags';
import columnsSql from './columns.sql';
import extensionsSql from './extensions.sql';
import tablesSql from './tables.sql';

export const SYSTEM_SCHEMAS = [
  'information_schema',
  'pg_catalog',
  'pg_toast',
  '_timescaledb_internal',
];

export interface ListTablesOptions {
  schemas?: string[];
  table_names?: string[];
  limit?: number;
  offset?: number;
}

/**
 * Generates the SQL query to list tables in the database.
 */
export function listTablesSql(options: ListTablesOptions = {}) {
  const { schemas = [], table_names, limit, offset } = options;

  let sql = stripIndent`
    with
      tables as (${tablesSql}),
      columns as (${columnsSql})
    select
      *,
      ${coalesceRowsToArray('columns', 'columns.table_id = tables.id')}
    from tables
  `;

  sql += '\n';

  // Build WHERE clause
  const conditions: string[] = [];

  if (schemas.length > 0) {
    conditions.push(`schema in (${schemas.map((s) => `'${s}'`).join(',')})`);
  } else {
    conditions.push(`schema not in (${SYSTEM_SCHEMAS.map((s) => `'${s}'`).join(',')})`);
  }

  if (table_names && table_names.length > 0) {
    conditions.push(`name in (${table_names.map((t) => `'${t}'`).join(',')})`);
  }

  sql += `where ${conditions.join(' and ')}\n`;

  // Add ORDER BY for consistent pagination
  sql += 'order by schema, name\n';

  // Add LIMIT and OFFSET
  if (limit !== undefined) {
    sql += `limit ${limit}\n`;
  }

  if (offset !== undefined) {
    sql += `offset ${offset}\n`;
  }

  return sql;
}

/**
 * Generates the SQL query to list all extensions in the database.
 */
export function listExtensionsSql() {
  return extensionsSql;
}

/**
 * Generates a SQL segment that coalesces rows into an array of JSON objects.
 */
export const coalesceRowsToArray = (source: string, filter: string) => {
  return stripIndent`
    COALESCE(
      (
        SELECT
          array_agg(row_to_json(${source})) FILTER (WHERE ${filter})
        FROM
          ${source}
      ),
      '{}'
    ) AS ${source}
  `;
};
