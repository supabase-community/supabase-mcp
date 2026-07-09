
import { z } from 'zod/v4';
import {
  listFunctionsSql,
  listPoliciesSql,
  listTablesSql,
  listTriggersSql,
} from '../pg-meta/index.js';
import {
  postgresFunctionSchema,
  postgresPolicySchema,
  postgresTableSchema,
  postgresTriggerSchema,
} from '../pg-meta/types.js';
import type { DatabaseOperations } from '../platform/types.js';
import { injectableTool, type ToolDefs } from './util.js';

type DatabaseDocsToolsOptions = {
  database: DatabaseOperations;
  projectId?: string;
};

const schemaDocsColumnSchema = z.object({
  name: z.string(),
  data_type: z.string(),
  format: z.string(),
  options: z.array(z.string()),
  default_value: z.any().optional(),
  identity_generation: z.union([z.string(), z.null()]).optional(),
  enums: z.array(z.string()).optional(),
  check: z.union([z.string(), z.null()]).optional(),
  comment: z.union([z.string(), z.null()]).optional(),
});

const schemaDocsForeignKeySchema = z.object({
  name: z.string(),
  source: z.string(),
  target: z.string(),
});

const schemaDocsTableSchema = z.object({
  schema: z.string(),
  name: z.string(),
  full_name: z.string(),
  rls_enabled: z.boolean(),
  rows: z.number().nullable(),
  comment: z.string().nullable().optional(),
  columns: z.array(schemaDocsColumnSchema),
  primary_keys: z.array(z.string()),
  foreign_key_constraints: z.array(schemaDocsForeignKeySchema),
});

const schemaDocsPolicySchema = z.object({
  schema_name: z.string(),
  table_name: z.string(),
  full_table_name: z.string(),
  policy_name: z.string(),
  permissive: z.string(),
  command: z.string(),
  roles: z.array(z.string()),
  using_expression: z.string().nullable().optional(),
  with_check_expression: z.string().nullable().optional(),
});

const schemaDocsTriggerSchema = z.object({
  table_schema: z.string(),
  table_name: z.string(),
  full_table_name: z.string(),
  trigger_name: z.string(),
  function_schema: z.string(),
  function_name: z.string(),
  full_function_name: z.string(),
  trigger_definition: z.string(),
});

const schemaDocsFunctionSchema = z.object({
  schema_name: z.string(),
  function_name: z.string(),
  full_name: z.string(),
  identity_arguments: z.string(),
  result_type: z.string(),
  language: z.string(),
  volatility: z.string(),
  security_definer: z.boolean(),
  comment: z.string().nullable().optional(),
  is_trigger_function: z.boolean(),
});

const schemaDocsDataSchema = z.object({
  tables: z.array(schemaDocsTableSchema),
  policies: z.array(schemaDocsPolicySchema),
  triggers: z.array(schemaDocsTriggerSchema),
  functions: z.array(schemaDocsFunctionSchema),
  trigger_functions: z.array(schemaDocsFunctionSchema),
});

const schemaDocsSummarySchema = z.object({
  table_count: z.number().int(),
  policy_count: z.number().int(),
  trigger_count: z.number().int(),
  function_count: z.number().int(),
  standalone_function_count: z.number().int(),
  trigger_function_count: z.number().int(),
});

const generateSchemaDocsInputSchema = z.object({
  project_id: z.string(),
  schemas: z
    .array(z.string())
    .describe('List of schemas to include. Defaults to ["public"].')
    .default(['public']),
  include_tables: z
    .boolean()
    .describe('Include table and column details in the result.')
    .default(true),
  include_policies: z
    .boolean()
    .describe(
      'Include row level security policies. When include_tables is also true, policies appear nested under their table section. When include_tables is false, they appear in a standalone section.'
    )
    .default(true),
  include_triggers: z
    .boolean()
    .describe(
      'Include table triggers. When include_tables is also true, triggers appear nested under their table section. When include_tables is false, they appear in a standalone section.'
    )
    .default(true),
  include_functions: z
    .boolean()
    .describe('Include user-defined SQL functions in the result.')
    .default(true),
  include_internal: z
    .boolean()
    .describe(
      'When true, includes functions written in internal/C languages (system built-ins). Trigger functions are always separated into their own list regardless of this flag.'
    )
    .default(false),
  format: z
    .enum(['json', 'markdown', 'both'])
    .describe('Choose whether to return structured JSON, markdown, or both.')
    .default('both'),
});

const generateSchemaDocsOutputSchema = z.object({
  data: schemaDocsDataSchema.optional(),
  markdown: z.string().optional(),
  summary: schemaDocsSummarySchema,
});

export const databaseDocsToolDefs = {
  generate_schema_docs: {
    description:
      'Generates schema documentation for a Supabase Postgres database, including tables, RLS policies, triggers, and functions. Can return JSON, Markdown, or both.',
    parameters: generateSchemaDocsInputSchema,
    outputSchema: generateSchemaDocsOutputSchema,
    annotations: {
      title: 'Generate schema docs',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
} as const satisfies ToolDefs;

export function getDatabaseDocsTools({
  database,
  projectId,
}: DatabaseDocsToolsOptions) {
  const project_id = projectId;

  return {
    generate_schema_docs: injectableTool({
      ...databaseDocsToolDefs.generate_schema_docs,
      inject: { project_id },
      execute: async ({
        project_id,
        schemas,
        include_tables,
        include_policies,
        include_triggers,
        include_functions,
        include_internal,
        format,
      }) => {
        const [tables, policies, triggers] = await Promise.all([
          include_tables ? fetchTables(database, project_id, schemas) : [],
          include_policies ? fetchPolicies(database, project_id, schemas) : [],
          include_triggers ? fetchTriggers(database, project_id, schemas) : [],
        ]);

        const { functions, trigger_functions } = include_functions
          ? await fetchFunctions(
              database,
              project_id,
              schemas,
              include_internal,
              triggers
            )
          : { functions: [], trigger_functions: [] };

        const data = {
          tables,
          policies,
          triggers,
          functions,
          trigger_functions,
        };

        const summary = {
          table_count: tables.length,
          policy_count: policies.length,
          trigger_count: triggers.length,
          function_count: functions.length + trigger_functions.length,
          standalone_function_count: functions.length,
          trigger_function_count: trigger_functions.length,
        };

        return {
          ...(format !== 'markdown' && { data }),
          ...(format !== 'json' && {
            markdown: formatSchemaDocsMarkdown(data, schemas),
          }),
          summary,
        };
      },
    }),
  };
}

async function fetchTables(
  database: DatabaseOperations,
  projectId: string,
  schemas: string[]
) {
  const { query, parameters } = listTablesSql(schemas);
  const data = await database.executeSql(projectId, {
    query,
    parameters,
    read_only: true,
  });

  return data
    .map((table) => postgresTableSchema.parse(table))
    .map(
      ({
        schema,
        name,
        comment,
        columns,
        primary_keys,
        relationships,
        live_rows_estimate,
        rls_enabled,
      }) => ({
        schema,
        name,
        full_name: `${schema}.${name}`,
        rls_enabled,
        rows: live_rows_estimate,
        ...(comment !== null && { comment }),
        columns: (columns ?? []).map(
          ({
            id,
            table,
            table_id,
            schema,
            ordinal_position,
            default_value,
            is_identity,
            identity_generation,
            is_generated,
            is_nullable,
            is_updatable,
            is_unique,
            check,
            comment,
            enums,
            ...column
          }) => {
            const options: string[] = [];
            if (is_identity) options.push('identity');
            if (is_generated) options.push('generated');
            if (is_nullable) options.push('nullable');
            if (is_updatable) options.push('updatable');
            if (is_unique) options.push('unique');

            return {
              ...column,
              options,
              ...(default_value !== null && { default_value }),
              ...(identity_generation !== null && { identity_generation }),
              ...(enums.length > 0 && { enums }),
              ...(check !== null && { check }),
              ...(comment !== null && { comment }),
            };
          }
        ),
        primary_keys: primary_keys.map((primaryKey) => primaryKey.name),
        foreign_key_constraints: relationships.map(
          ({
            constraint_name,
            source_schema,
            source_table_name,
            source_column_name,
            target_table_schema,
            target_table_name,
            target_column_name,
          }) => ({
            name: constraint_name,
            source: `${source_schema}.${source_table_name}.${source_column_name}`,
            target: `${target_table_schema}.${target_table_name}.${target_column_name}`,
          })
        ),
      })
    )
    .sort(compareBy('full_name'));
}

async function fetchPolicies(
  database: DatabaseOperations,
  projectId: string,
  schemas: string[]
) {
  const { query, parameters } = listPoliciesSql(schemas);
  const data = await database.executeSql(projectId, {
    query,
    parameters,
    read_only: true,
  });

  return data
    .map((policy) => postgresPolicySchema.parse(policy))
    .map(
      ({
        schema_name,
        table_name,
        policy_name,
        permissive,
        roles,
        cmd,
        qual,
        with_check,
      }) => ({
        schema_name,
        table_name,
        full_table_name: `${schema_name}.${table_name}`,
        policy_name,
        permissive,
        command: cmd,
        roles,
        ...(qual !== null && { using_expression: qual }),
        ...(with_check !== null && { with_check_expression: with_check }),
      })
    )
    .sort(compareBy('full_table_name', 'policy_name'));
}

async function fetchTriggers(
  database: DatabaseOperations,
  projectId: string,
  schemas: string[]
) {
  const { query, parameters } = listTriggersSql(schemas);
  const data = await database.executeSql(projectId, {
    query,
    parameters,
    read_only: true,
  });

  return data
    .map((trigger) => postgresTriggerSchema.parse(trigger))
    .map(
      ({
        table_schema,
        table_name,
        trigger_name,
        function_schema,
        function_name,
        trigger_definition,
      }) => ({
        table_schema,
        table_name,
        full_table_name: `${table_schema}.${table_name}`,
        trigger_name,
        function_schema,
        function_name,
        full_function_name: `${function_schema}.${function_name}`,
        trigger_definition,
      })
    )
    .sort(compareBy('full_table_name', 'trigger_name'));
}

async function fetchFunctions(
  database: DatabaseOperations,
  projectId: string,
  schemas: string[],
  includeInternal: boolean,
  triggers: z.infer<typeof schemaDocsTriggerSchema>[]
) {
  const { query, parameters } = listFunctionsSql(schemas, {
    includeInternal,
  });
  const data = await database.executeSql(projectId, {
    query,
    parameters,
    read_only: true,
  });

  const triggerFunctionKeys = new Set(
    triggers.map((trigger) => trigger.full_function_name)
  );

  const allFunctions = data
    .map((fn) => postgresFunctionSchema.parse(fn))
    .map(
      ({
        schema_name,
        function_name,
        identity_arguments,
        result_type,
        language,
        volatility,
        security_definer,
        comment,
      }) => ({
        schema_name,
        function_name,
        full_name: `${schema_name}.${function_name}`,
        identity_arguments,
        result_type,
        language,
        volatility,
        security_definer,
        ...(comment !== null && { comment }),
        is_trigger_function: triggerFunctionKeys.has(
          `${schema_name}.${function_name}`
        ),
      })
    );

  const trigger_functions = allFunctions
    .filter((fn) => fn.is_trigger_function)
    .sort(compareBy('full_name', 'identity_arguments'));

  // Always exclude trigger functions from the standalone list.
  // The includeInternal flag controls SQL-level filtering of internal/C
  // language functions (handled in pg-meta/index.ts), not this split.
  const functions = allFunctions
    .filter((fn) => !fn.is_trigger_function)
    .sort(compareBy('full_name', 'identity_arguments'));

  return {
    functions,
    trigger_functions,
  };
}

function formatSchemaDocsMarkdown(
  data: z.infer<typeof schemaDocsDataSchema>,
  schemas: string[]
) {
  const policiesByTable = groupBy(data.policies, (policy) => policy.full_table_name);
  const triggersByTable = groupBy(data.triggers, (trigger) => trigger.full_table_name);
  const sections = [
    '# Database Documentation',
    '',
    '## Overview',
    `- Schemas: ${schemas.length > 0 ? schemas.join(', ') : 'all non-system schemas'}`,
    `- Tables: ${data.tables.length}`,
    `- RLS Policies: ${data.policies.length}`,
    `- Triggers: ${data.triggers.length}`,
    `- Standalone Functions: ${data.functions.length}`,
    `- Trigger Functions: ${data.trigger_functions.length}`,
  ];

  if (data.tables.length > 0) {
    sections.push('', '## Tables');
    for (const table of data.tables) {
      sections.push(
        '',
        `### ${table.full_name}`,
        `- RLS enabled: ${table.rls_enabled ? 'yes' : 'no'}`,
        `- Estimated rows: ${table.rows ?? 'unknown'}`
      );

      if (table.comment) {
        sections.push(`- Comment: ${table.comment}`);
      }

      if (table.primary_keys.length > 0) {
        sections.push(`- Primary keys: ${table.primary_keys.join(', ')}`);
      }

      if (table.foreign_key_constraints.length > 0) {
        sections.push('- Foreign keys:');
        for (const foreignKey of table.foreign_key_constraints) {
          sections.push(
            `  - ${foreignKey.name}: ${foreignKey.source} -> ${foreignKey.target}`
          );
        }
      }

      if (table.columns.length > 0) {
        sections.push(
          '',
          '#### Columns',
          '',
          '| Name | Type | Options | Default | Comment |',
          '| --- | --- | --- | --- | --- |'
        );
        for (const column of table.columns) {
          sections.push(
            `| ${escapeMarkdownCell(column.name)} | ${escapeMarkdownCell(column.data_type)} | ${escapeMarkdownCell(column.options.join(', '))} | ${escapeMarkdownCell(column.default_value !== undefined ? String(column.default_value) : '')} | ${escapeMarkdownCell(column.comment ?? '')} |`
          );
        }
      }

      const tablePolicies = policiesByTable.get(table.full_name) ?? [];
      if (tablePolicies.length > 0) {
        sections.push('', '#### RLS Policies');
        for (const policy of tablePolicies) {
          sections.push(
            '',
            `- ${policy.policy_name}`,
            `  - Command: ${policy.command}`,
            `  - Mode: ${policy.permissive}`,
            `  - Roles: ${policy.roles.join(', ')}`
          );

          if (policy.using_expression) {
            sections.push('', '```sql', policy.using_expression, '```');
          }

          if (policy.with_check_expression) {
            sections.push(
              '',
              '```sql',
              `WITH CHECK (${policy.with_check_expression})`,
              '```'
            );
          }
        }
      }

      const tableTriggers = triggersByTable.get(table.full_name) ?? [];
      if (tableTriggers.length > 0) {
        sections.push('', '#### Triggers');
        for (const trigger of tableTriggers) {
          sections.push(
            '',
            `- ${trigger.trigger_name}`,
            `  - Function: ${trigger.full_function_name}`,
            '',
            '```sql',
            trigger.trigger_definition,
            '```'
          );
        }
      }
    }
  }

  if (data.policies.length > 0 && data.tables.length === 0) {
    sections.push('', '## RLS Policies');
    for (const policy of data.policies) {
      sections.push(
        '',
        `### ${policy.full_table_name} :: ${policy.policy_name}`,
        `- Command: ${policy.command}`,
        `- Mode: ${policy.permissive}`,
        `- Roles: ${policy.roles.join(', ')}`
      );

      if (policy.using_expression) {
        sections.push('', '```sql', policy.using_expression, '```');
      }

      if (policy.with_check_expression) {
        sections.push(
          '',
          '```sql',
          `WITH CHECK (${policy.with_check_expression})`,
          '```'
        );
      }
    }
  }

  if (data.triggers.length > 0 && data.tables.length === 0) {
    sections.push('', '## Triggers');
    for (const trigger of data.triggers) {
      sections.push(
        '',
        `### ${trigger.full_table_name} :: ${trigger.trigger_name}`,
        `- Function: ${trigger.full_function_name}`,
        '',
        '```sql',
        trigger.trigger_definition,
        '```'
      );
    }
  }

  if (data.functions.length > 0 || data.trigger_functions.length > 0) {
    sections.push('', '## Functions');
    if (data.functions.length > 0) {
      sections.push('', '### Standalone Functions');
      for (const fn of data.functions) {
        const signature = `${fn.full_name}(${fn.identity_arguments}) -> ${fn.result_type}`;
        sections.push(
          '',
          `#### ${signature}`,
          `- Language: ${fn.language}`,
          `- Volatility: ${fn.volatility}`,
          `- Security definer: ${fn.security_definer ? 'yes' : 'no'}`
        );

        if (fn.comment) {
          sections.push(`- Comment: ${fn.comment}`);
        }
      }
    } else {
      sections.push('', '### Standalone Functions', '', 'No standalone public functions found.');
    }

    if (data.trigger_functions.length > 0) {
      sections.push('', '### Trigger Functions');
      for (const fn of data.trigger_functions) {
        const signature = `${fn.full_name}(${fn.identity_arguments}) -> ${fn.result_type}`;
        sections.push(
          '',
          `#### ${signature}`,
          `- Language: ${fn.language}`,
          `- Volatility: ${fn.volatility}`,
          `- Security definer: ${fn.security_definer ? 'yes' : 'no'}`
        );

        if (fn.comment) {
          sections.push(`- Comment: ${fn.comment}`);
        }
      }
    }
  }

  if (
    data.tables.length === 0 &&
    data.policies.length === 0 &&
    data.triggers.length === 0 &&
    data.functions.length === 0 &&
    data.trigger_functions.length === 0
  ) {
    sections.push('', 'No matching schema objects were found.');
  }

  return sections.join('\n').trim();
}

function groupBy<T>(
  values: T[],
  getKey: (value: T) => string
): Map<string, T[]> {
  const map = new Map<string, T[]>();

  for (const value of values) {
    const key = getKey(value);
    const existing = map.get(key);
    if (existing) {
      existing.push(value);
    } else {
      map.set(key, [value]);
    }
  }

  return map;
}

function escapeMarkdownCell(value: string) {
  return value.replace(/\|/g, '\\|').replace(/\n/g, '<br />');
}

function compareBy<T extends Record<string, unknown>>(
  ...keys: (keyof T)[]
): (a: T, b: T) => number {
  return (a, b) => {
    for (const key of keys) {
      const left = String(a[key] ?? '');
      const right = String(b[key] ?? '');
      const result = left.localeCompare(right);
      if (result !== 0) return result;
    }

    return 0;
  };
}
