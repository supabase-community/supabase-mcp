import { stripIndent } from 'common-tags';
import columnsSql from './columns.sql';
import extensionsSql from './extensions.sql';
import functionsSql from './functions.sql';
import policiesSql from './policies.sql';
import tablesSql from './tables.sql';
import triggersSql from './triggers.sql';

export const SYSTEM_SCHEMAS = [
  'information_schema',
  'pg_catalog',
  'pg_toast',
  '_timescaledb_internal',
];

/**
 * Generates the SQL query to list tables in the database.
 */
export function listTablesSql(schemas: string[] = []) {
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
  let parameters: any[] = [];

  if (schemas.length > 0) {
    const placeholders = schemas.map((_, i) => `$${i + 1}`).join(', ');
    sql += `where schema in (${placeholders})`;
    parameters = schemas;
  } else {
    const placeholders = SYSTEM_SCHEMAS.map((_, i) => `$${i + 1}`).join(', ');
    sql += `where schema not in (${placeholders})`;
    parameters = SYSTEM_SCHEMAS;
  }

  return { query: sql, parameters };
}

/**
 * Generates the SQL query to list all extensions in the database.
 */
export function listExtensionsSql() {
  return extensionsSql;
}

/**
 * Generates the SQL query to list policies in the database.
 */
export function listPoliciesSql(schemas: string[] = []) {
  const { clause, parameters } = buildSchemaFilter('schema_name', schemas);
  return {
    query: stripIndent`
      select * from (
        ${policiesSql}
      ) policies
      ${clause}
    `,
    parameters,
  };
}

/**
 * Generates the SQL query to list triggers in the database.
 */
export function listTriggersSql(schemas: string[] = []) {
  const { clause, parameters } = buildSchemaFilter('table_schema', schemas);
  return {
    query: stripIndent`
      select * from (
        ${triggersSql}
      ) triggers
      ${clause}
    `,
    parameters,
  };
}

/**
 * Generates the SQL query to list functions in the database.
 */
export function listFunctionsSql(
  schemas: string[] = [],
  options: { includeInternal?: boolean } = {}
) {
  const { includeInternal = false } = options;
  const { clause, parameters } = buildSchemaFilter('schema_name', schemas);
  const internalPredicate = includeInternal
    ? ''
    : `and l.lanname not in ('internal', 'c')`;

  return {
    query: stripIndent`
      select * from (
        ${functionsSql}
        ${internalPredicate}
      ) functions
      ${clause}
    `,
    parameters,
  };
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

const buildSchemaFilter = (column: string, schemas: string[] = []) => {
  if (schemas.length > 0) {
    const placeholders = schemas.map((_, i) => `$${i + 1}`).join(', ');
    return {
      clause: `where ${column} in (${placeholders})`,
      parameters: schemas,
    };
  }

  const placeholders = SYSTEM_SCHEMAS.map((_, i) => `$${i + 1}`).join(', ');
  return {
    clause: `where ${column} not in (${placeholders})`,
    parameters: SYSTEM_SCHEMAS,
  };
};
