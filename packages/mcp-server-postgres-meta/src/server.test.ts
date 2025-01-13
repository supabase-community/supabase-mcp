import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamTransport } from '@supabase/mcp-utils';
import { describe, expect, test } from 'vitest';
import { createPostgresQuerier } from './queriers/postgres/index.js';
import { createPostgresMetaMcpServer } from './server.js';

// Requires local Supabase stack running
const CONNECTION = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/**
 * Sets up a client and server for testing.
 */
async function setup() {
  const clientTransport = new StreamTransport();
  const serverTransport = new StreamTransport();

  clientTransport.readable.pipeTo(serverTransport.writable);
  serverTransport.readable.pipeTo(clientTransport.writable);

  const client = new Client(
    {
      name: 'TestClient',
      version: '0.1.0',
    },
    {
      capabilities: {},
    }
  );

  const querier = createPostgresQuerier({
    connection: CONNECTION,
  });

  const server = createPostgresMetaMcpServer({
    querier,
  });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, clientTransport, server, serverTransport };
}

describe('SupabaseBuilderMcpServer', () => {
  test('lists resources', async () => {
    const { client } = await setup();

    const { resources } = await client.listResources();

    expect(resources).toMatchInlineSnapshot(`
      [
        {
          "description": "Postgres schemas",
          "mimeType": "application/json",
          "name": "schemas",
          "uri": "postgres-meta:///schemas",
        },
        {
          "description": "Postgres extensions",
          "mimeType": "application/json",
          "name": "extensions",
          "uri": "postgres-meta:///extensions",
        },
      ]
    `);
  });

  test('lists resource templates', async () => {
    const { client } = await setup();

    const { resourceTemplates } = await client.listResourceTemplates();

    expect(resourceTemplates).toMatchInlineSnapshot(`
      [
        {
          "description": "Postgres schema",
          "mimeType": "application/json",
          "name": "schema",
          "uriTemplate": "postgres-meta:///schemas/{schema}",
        },
        {
          "description": "Postgres tables, including columns, constraints, and indexes",
          "mimeType": "application/json",
          "name": "tables",
          "uriTemplate": "postgres-meta:///schemas/{schema}/tables",
        },
        {
          "description": "Postgres table, including columns, constraints, and indexes",
          "mimeType": "application/json",
          "name": "table",
          "uriTemplate": "postgres-meta:///schemas/{schema}/tables/{table}",
        },
        {
          "description": "Postgres RLS policies for a table",
          "mimeType": "application/json",
          "name": "policies",
          "uriTemplate": "postgres-meta:///schemas/{schema}/tables/{table}/policies",
        },
        {
          "description": "Postgres RLS policy",
          "mimeType": "application/json",
          "name": "policy",
          "uriTemplate": "postgres-meta:///schemas/{schema}/tables/{table}/policies/{policy}",
        },
        {
          "description": "Postgres triggers",
          "mimeType": "application/json",
          "name": "triggers",
          "uriTemplate": "postgres-meta:///schemas/{schema}/tables/{table}/triggers",
        },
        {
          "description": "Postgres trigger",
          "mimeType": "application/json",
          "name": "trigger",
          "uriTemplate": "postgres-meta:///schemas/{schema}/tables/{table}/triggers/{trigger}",
        },
        {
          "description": "Postgres views",
          "mimeType": "application/json",
          "name": "views",
          "uriTemplate": "postgres-meta:///schemas/{schema}/views",
        },
        {
          "description": "Postgres view",
          "mimeType": "application/json",
          "name": "view",
          "uriTemplate": "postgres-meta:///schemas/{schema}/views/{view}",
        },
        {
          "description": "Postgres materialized views",
          "mimeType": "application/json",
          "name": "materialized-views",
          "uriTemplate": "postgres-meta:///schemas/{schema}/materialized-views",
        },
        {
          "description": "Postgres materialized view",
          "mimeType": "application/json",
          "name": "materialized-view",
          "uriTemplate": "postgres-meta:///schemas/{schema}/materialized-views/{view}",
        },
        {
          "description": "Postgres functions",
          "mimeType": "application/json",
          "name": "functions",
          "uriTemplate": "postgres-meta:///schemas/{schema}/functions",
        },
        {
          "description": "Postgres function",
          "mimeType": "application/json",
          "name": "function",
          "uriTemplate": "postgres-meta:///schemas/{schema}/functions/{func}",
        },
        {
          "description": "Postgres extension",
          "mimeType": "application/json",
          "name": "extension",
          "uriTemplate": "postgres-meta:///extensions/{extension}",
        },
      ]
    `);
  });

  test('gets all schemas', async () => {
    const { client } = await setup();

    const { contents } = await client.readResource({
      uri: 'postgres-meta:///schemas',
    });

    expect(contents).toMatchInlineSnapshot(`
      [
        {
          "mimeType": "application/json",
          "text": "{"id":"2200","name":"public","owner":"pg_database_owner"}",
          "uri": "postgres-meta:///schemas/public",
        },
        {
          "mimeType": "application/json",
          "text": "{"id":"16618","name":"graphql","owner":"supabase_admin"}",
          "uri": "postgres-meta:///schemas/graphql",
        },
        {
          "mimeType": "application/json",
          "text": "{"id":"16607","name":"graphql_public","owner":"supabase_admin"}",
          "uri": "postgres-meta:///schemas/graphql_public",
        },
        {
          "mimeType": "application/json",
          "text": "{"id":"16949","name":"vault","owner":"supabase_admin"}",
          "uri": "postgres-meta:///schemas/vault",
        },
        {
          "mimeType": "application/json",
          "text": "{"id":"16772","name":"pgsodium_masks","owner":"supabase_admin"}",
          "uri": "postgres-meta:///schemas/pgsodium_masks",
        },
        {
          "mimeType": "application/json",
          "text": "{"id":"16645","name":"pgsodium","owner":"supabase_admin"}",
          "uri": "postgres-meta:///schemas/pgsodium",
        },
        {
          "mimeType": "application/json",
          "text": "{"id":"16457","name":"auth","owner":"supabase_admin"}",
          "uri": "postgres-meta:///schemas/auth",
        },
        {
          "mimeType": "application/json",
          "text": "{"id":"16505","name":"storage","owner":"supabase_admin"}",
          "uri": "postgres-meta:///schemas/storage",
        },
        {
          "mimeType": "application/json",
          "text": "{"id":"16599","name":"realtime","owner":"supabase_admin"}",
          "uri": "postgres-meta:///schemas/realtime",
        },
        {
          "mimeType": "application/json",
          "text": "{"id":"16996","name":"net","owner":"supabase_admin"}",
          "uri": "postgres-meta:///schemas/net",
        },
        {
          "mimeType": "application/json",
          "text": "{"id":"17038","name":"supabase_functions","owner":"supabase_admin"}",
          "uri": "postgres-meta:///schemas/supabase_functions",
        },
        {
          "mimeType": "application/json",
          "text": "{"id":"16994","name":"_realtime","owner":"postgres"}",
          "uri": "postgres-meta:///schemas/_realtime",
        },
        {
          "mimeType": "application/json",
          "text": "{"id":"16391","name":"extensions","owner":"postgres"}",
          "uri": "postgres-meta:///schemas/extensions",
        },
        {
          "mimeType": "application/json",
          "text": "{"id":"18252","name":"supabase_migrations","owner":"postgres"}",
          "uri": "postgres-meta:///schemas/supabase_migrations",
        },
        {
          "mimeType": "application/json",
          "text": "{"id":"16386","name":"pgbouncer","owner":"pgbouncer"}",
          "uri": "postgres-meta:///schemas/pgbouncer",
        },
      ]
    `);
  });

  test('gets all tables in public schema', async () => {
    const { client } = await setup();

    const { contents } = await client.readResource({
      uri: 'postgres-meta:///schemas/public/tables',
    });

    expect(contents).toMatchInlineSnapshot(`
      [
        {
          "mimeType": "application/json",
          "text": "{"id":"18261","schema":"public","name":"todos","rls_enabled":true,"rls_forced":false,"replica_identity":"DEFAULT","bytes":"65536","size":"64 kB","live_rows_estimate":"0","dead_rows_estimate":"0","comment":"Table to manage todo items with details such as title, description, due date, and completion status.","primary_keys":[{"name":"id","schema":"public","table_id":18261,"table_name":"todos"}],"relationships":[{"id":18270,"source_schema":"public","constraint_name":"todos_user_id_fkey","source_table_name":"todos","target_table_name":"users","source_column_name":"user_id","target_column_name":"id","target_table_schema":"auth"}],"columns":[{"table_id":18261,"schema":"public","table":"todos","id":"18261.1","ordinal_position":1,"name":"id","default_value":null,"data_type":"bigint","format":"int8","is_identity":true,"identity_generation":"ALWAYS","is_generated":false,"is_nullable":false,"is_updatable":true,"is_unique":false,"check":null,"enums":[],"comment":null},{"table_id":18261,"schema":"public","table":"todos","id":"18261.2","ordinal_position":2,"name":"title","default_value":null,"data_type":"text","format":"text","is_identity":false,"identity_generation":null,"is_generated":false,"is_nullable":false,"is_updatable":true,"is_unique":false,"check":null,"enums":[],"comment":null},{"table_id":18261,"schema":"public","table":"todos","id":"18261.3","ordinal_position":3,"name":"description","default_value":null,"data_type":"text","format":"text","is_identity":false,"identity_generation":null,"is_generated":false,"is_nullable":true,"is_updatable":true,"is_unique":false,"check":null,"enums":[],"comment":null},{"table_id":18261,"schema":"public","table":"todos","id":"18261.4","ordinal_position":4,"name":"due_date","default_value":null,"data_type":"date","format":"date","is_identity":false,"identity_generation":null,"is_generated":false,"is_nullable":true,"is_updatable":true,"is_unique":false,"check":null,"enums":[],"comment":null},{"table_id":18261,"schema":"public","table":"todos","id":"18261.5","ordinal_position":5,"name":"is_completed","default_value":"false","data_type":"boolean","format":"bool","is_identity":false,"identity_generation":null,"is_generated":false,"is_nullable":true,"is_updatable":true,"is_unique":false,"check":null,"enums":[],"comment":null},{"table_id":18261,"schema":"public","table":"todos","id":"18261.6","ordinal_position":6,"name":"user_id","default_value":"auth.uid()","data_type":"uuid","format":"uuid","is_identity":false,"identity_generation":null,"is_generated":false,"is_nullable":false,"is_updatable":true,"is_unique":false,"check":null,"enums":[],"comment":null}]}",
          "uri": "postgres-meta:///schemas/public/tables/todos",
        },
      ]
    `);
  });

  test('gets a specific table', async () => {
    const { client } = await setup();

    const { contents } = await client.readResource({
      uri: 'postgres-meta:///schemas/public/tables/todos',
    });

    expect(contents).toMatchInlineSnapshot(`
      [
        {
          "mimeType": "application/json",
          "text": "{"id":"18261","schema":"public","name":"todos","rls_enabled":true,"rls_forced":false,"replica_identity":"DEFAULT","bytes":"65536","size":"64 kB","live_rows_estimate":"0","dead_rows_estimate":"0","comment":"Table to manage todo items with details such as title, description, due date, and completion status.","primary_keys":[{"name":"id","schema":"public","table_id":18261,"table_name":"todos"}],"relationships":[{"id":18270,"source_schema":"public","constraint_name":"todos_user_id_fkey","source_table_name":"todos","target_table_name":"users","source_column_name":"user_id","target_column_name":"id","target_table_schema":"auth"}],"columns":[{"table_id":18261,"schema":"public","table":"todos","id":"18261.1","ordinal_position":1,"name":"id","default_value":null,"data_type":"bigint","format":"int8","is_identity":true,"identity_generation":"ALWAYS","is_generated":false,"is_nullable":false,"is_updatable":true,"is_unique":false,"check":null,"enums":[],"comment":null},{"table_id":18261,"schema":"public","table":"todos","id":"18261.2","ordinal_position":2,"name":"title","default_value":null,"data_type":"text","format":"text","is_identity":false,"identity_generation":null,"is_generated":false,"is_nullable":false,"is_updatable":true,"is_unique":false,"check":null,"enums":[],"comment":null},{"table_id":18261,"schema":"public","table":"todos","id":"18261.3","ordinal_position":3,"name":"description","default_value":null,"data_type":"text","format":"text","is_identity":false,"identity_generation":null,"is_generated":false,"is_nullable":true,"is_updatable":true,"is_unique":false,"check":null,"enums":[],"comment":null},{"table_id":18261,"schema":"public","table":"todos","id":"18261.4","ordinal_position":4,"name":"due_date","default_value":null,"data_type":"date","format":"date","is_identity":false,"identity_generation":null,"is_generated":false,"is_nullable":true,"is_updatable":true,"is_unique":false,"check":null,"enums":[],"comment":null},{"table_id":18261,"schema":"public","table":"todos","id":"18261.5","ordinal_position":5,"name":"is_completed","default_value":"false","data_type":"boolean","format":"bool","is_identity":false,"identity_generation":null,"is_generated":false,"is_nullable":true,"is_updatable":true,"is_unique":false,"check":null,"enums":[],"comment":null},{"table_id":18261,"schema":"public","table":"todos","id":"18261.6","ordinal_position":6,"name":"user_id","default_value":"auth.uid()","data_type":"uuid","format":"uuid","is_identity":false,"identity_generation":null,"is_generated":false,"is_nullable":false,"is_updatable":true,"is_unique":false,"check":null,"enums":[],"comment":null}]}",
          "uri": "postgres-meta:///schemas/public/tables/todos",
        },
      ]
    `);
  });

  test('gets rls policies for a table', async () => {
    const { client } = await setup();

    const { contents } = await client.readResource({
      uri: 'postgres-meta:///schemas/public/tables/todos/policies',
    });

    expect(contents).toMatchInlineSnapshot(`
      [
        {
          "mimeType": "application/json",
          "text": "{"id":"18278","schema":"public","table":"todos","table_id":"18261","name":"Users can delete their own todos","action":"PERMISSIVE","roles":["public"],"command":"DELETE","definition":"( SELECT (auth.uid() = todos.user_id))","check":null}",
          "uri": "postgres-meta:///schemas/public/tables/todos/policies/Users can delete their own todos",
        },
        {
          "mimeType": "application/json",
          "text": "{"id":"18277","schema":"public","table":"todos","table_id":"18261","name":"Users can update their own todos","action":"PERMISSIVE","roles":["public"],"command":"UPDATE","definition":"( SELECT (auth.uid() = todos.user_id))","check":"( SELECT (auth.uid() = todos.user_id))"}",
          "uri": "postgres-meta:///schemas/public/tables/todos/policies/Users can update their own todos",
        },
        {
          "mimeType": "application/json",
          "text": "{"id":"18276","schema":"public","table":"todos","table_id":"18261","name":"Users can create their own todos","action":"PERMISSIVE","roles":["public"],"command":"INSERT","definition":null,"check":"( SELECT (auth.uid() = todos.user_id))"}",
          "uri": "postgres-meta:///schemas/public/tables/todos/policies/Users can create their own todos",
        },
        {
          "mimeType": "application/json",
          "text": "{"id":"18275","schema":"public","table":"todos","table_id":"18261","name":"Users can view their own todos","action":"PERMISSIVE","roles":["public"],"command":"SELECT","definition":"( SELECT (auth.uid() = todos.user_id))","check":null}",
          "uri": "postgres-meta:///schemas/public/tables/todos/policies/Users can view their own todos",
        },
      ]
    `);
  });
});
