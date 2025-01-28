import {
  PostgresMetaBase,
  wrapError,
  wrapResult,
} from '@gregnr/postgres-meta/base';
import {
  createMcpServer,
  jsonResource,
  jsonResourceResponse,
  jsonResourceTemplate,
  resources,
} from '@supabase/mcp-utils';
import { version } from '../package.json';
import type { Querier } from './queriers/types.js';
import { unwrapResult } from './util.js';

export type PostgresMetaMcpServerOptions = {
  querier: Querier;
};

/**
 * Creates an MCP server for querying Postgres and retrieving metadata.
 *
 * Useful for app builders who want to expose Postgres metadata to their LLMs
 */
export function createPostgresMcpServer(options: PostgresMetaMcpServerOptions) {
  const pgMeta = new PostgresMetaBase({
    query: async (sql) => {
      try {
        const res = await options.querier.query(sql);
        return wrapResult<any[]>(res);
      } catch (error) {
        return wrapError(error, sql);
      }
    },
    end: async () => {},
  });

  return createMcpServer({
    name: 'supabase/postgres',
    version,
    resources: resources('postgres', [
      jsonResource('/schemas', {
        name: 'schemas',
        description: 'Postgres schemas',
        read: async (uri) => {
          const results = await unwrapResult(pgMeta.schemas.list());

          return results.map((result) =>
            jsonResourceResponse(`${uri}/${result.name}`, result)
          );
        },
      }),
      jsonResourceTemplate('/schemas/{schema}', {
        name: 'schema',
        description: 'Postgres schema',
        read: async (uri, { schema }) => {
          const result = await unwrapResult(
            pgMeta.schemas.retrieve({
              name: schema,
            })
          );

          return jsonResourceResponse(uri, result);
        },
      }),
      jsonResourceTemplate('/schemas/{schema}/tables', {
        name: 'tables',
        description:
          'Postgres tables, including columns, constraints, and indexes',
        read: async (uri, { schema }) => {
          const results = await unwrapResult(
            pgMeta.tables.list({
              includedSchemas: [schema],
              includeColumns: true,
            })
          );

          return results.map((result) =>
            jsonResourceResponse(`${uri}/${result.name}`, result)
          );
        },
      }),
      jsonResourceTemplate('/schemas/{schema}/tables/{table}', {
        name: 'table',
        description:
          'Postgres table, including columns, constraints, and indexes',
        read: async (uri, { schema, table }) => {
          const result = await unwrapResult(
            pgMeta.tables.retrieve({
              schema,
              name: table,
            })
          );

          return jsonResourceResponse(uri, result);
        },
      }),
      jsonResourceTemplate('/schemas/{schema}/tables/{table}/policies', {
        name: 'policies',
        description: 'Postgres RLS policies for a table',
        read: async (uri, { schema, table }) => {
          const results = await unwrapResult(
            pgMeta.policies.list({
              includedSchemas: [schema],
            })
          );

          return results
            .filter((result) => result.table === table)
            .map((result) =>
              jsonResourceResponse(`${uri}/${result.name}`, result)
            );
        },
      }),
      jsonResourceTemplate(
        '/schemas/{schema}/tables/{table}/policies/{policy}',
        {
          name: 'policy',
          description: 'Postgres RLS policy',
          read: async (uri, { schema, table, policy }) => {
            const result = await unwrapResult(
              pgMeta.policies.retrieve({
                schema,
                table,
                name: policy,
              })
            );

            return jsonResourceResponse(uri, result);
          },
        }
      ),
      jsonResourceTemplate('/schemas/{schema}/tables/{table}/triggers', {
        name: 'triggers',
        description: 'Postgres triggers',
        read: async (uri, { schema, table }) => {
          const results = await unwrapResult(
            pgMeta.triggers.list({
              includedSchemas: [schema],
            })
          );

          return results
            .filter((result) => result.table === table)
            .map((result) =>
              jsonResourceResponse(`${uri}/${result.name}`, result)
            );
        },
      }),
      jsonResourceTemplate(
        '/schemas/{schema}/tables/{table}/triggers/{trigger}',
        {
          name: 'trigger',
          description: 'Postgres trigger',
          read: async (uri, { schema, table, trigger }) => {
            const result = await unwrapResult(
              pgMeta.triggers.retrieve({
                schema,
                table,
                name: trigger,
              })
            );

            return jsonResourceResponse(uri, result);
          },
        }
      ),
      jsonResourceTemplate('/schemas/{schema}/views', {
        name: 'views',
        description: 'Postgres views',
        read: async (uri, { schema }) => {
          const results = await unwrapResult(
            pgMeta.views.list({
              includedSchemas: [schema],
            })
          );

          return results.map((result) =>
            jsonResourceResponse(`${uri}/${result.name}`, result)
          );
        },
      }),
      jsonResourceTemplate('/schemas/{schema}/views/{view}', {
        name: 'view',
        description: 'Postgres view',
        read: async (uri, { schema, view }) => {
          const result = await unwrapResult(
            pgMeta.views.retrieve({
              schema,
              name: view,
            })
          );

          return jsonResourceResponse(uri, result);
        },
      }),
      jsonResourceTemplate('/schemas/{schema}/materialized-views', {
        name: 'materialized-views',
        description: 'Postgres materialized views',
        read: async (uri, { schema }) => {
          const results = await unwrapResult(
            pgMeta.materializedViews.list({
              includedSchemas: [schema],
            })
          );

          return results.map((result) =>
            jsonResourceResponse(`${uri}/${result.name}`, result)
          );
        },
      }),
      jsonResourceTemplate('/schemas/{schema}/materialized-views/{view}', {
        name: 'materialized-view',
        description: 'Postgres materialized view',
        read: async (uri, { schema, view }) => {
          const result = await unwrapResult(
            pgMeta.materializedViews.retrieve({
              schema,
              name: view,
            })
          );

          return jsonResourceResponse(uri, result);
        },
      }),
      jsonResourceTemplate('/schemas/{schema}/functions', {
        name: 'functions',
        description: 'Postgres functions',
        read: async (uri, { schema }) => {
          const results = await unwrapResult(
            pgMeta.functions.list({
              includedSchemas: [schema],
            })
          );

          return results.map((result) =>
            jsonResourceResponse(`${uri}/${result.name}`, result)
          );
        },
      }),
      jsonResourceTemplate('/schemas/{schema}/functions/{func}', {
        name: 'function',
        description: 'Postgres function',
        read: async (uri, { schema, func }) => {
          const result = await unwrapResult(
            pgMeta.functions.retrieve({
              schema,
              name: func,
              args: [],
            })
          );

          return jsonResourceResponse(uri, result);
        },
      }),
      jsonResource('/extensions', {
        name: 'extensions',
        description: 'Postgres extensions',
        read: async (uri) => {
          const results = await unwrapResult(pgMeta.extensions.list());

          return results.map((result) =>
            jsonResourceResponse(`${uri}/${result.name}`, result)
          );
        },
      }),
      jsonResourceTemplate('/extensions/{extension}', {
        name: 'extension',
        description: 'Postgres extension',
        read: async (uri, { extension }) => {
          const result = await unwrapResult(
            pgMeta.extensions.retrieve({
              name: extension,
            })
          );

          return jsonResourceResponse(uri, result);
        },
      }),
    ]),
  });
}
