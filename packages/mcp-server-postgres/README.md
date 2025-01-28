# @supabase/mcp-server-postgres-meta

This is an MCP server for retrieving schema, tables, policies, and other metadata from a Postgres database.

## Resources

This server uses [MCP Resources](https://modelcontextprotocol.io/docs/concepts/resources) to expose metadata about a Postgres database. It can be used with any MCP client that supports dynamic [resource templates](https://modelcontextprotocol.io/docs/concepts/resources#resource-templates).

The following resources are available (by URI):

- `postgres-meta:///schemas`: Lists all schemas in the database

- `postgres-meta:///schemas/{schema}`: Gets details for a specific schema

- `postgres-meta:///schemas/{schema}/tables`: Lists all tables in a schema

- `postgres-meta:///schemas/{schema}/tables/{table}`: Gets details for a specific table

- `postgres-meta:///schemas/{schema}/tables/{table}/policies`: Lists all RLS policies for a table

- `postgres-meta:///schemas/{schema}/tables/{table}/policies/{policy}`: Gets details for a specific RLS policy

- `postgres-meta:///schemas/{schema}/tables/{table}/triggers`: Lists all triggers for a table

- `postgres-meta:///schemas/{schema}/tables/{table}/triggers/{trigger}`: Gets details for a specific trigger

- `postgres-meta:///schemas/{schema}/views`: Lists all views in a schema

- `postgres-meta:///schemas/{schema}/views/{view}`: Gets details for a specific view

- `postgres-meta:///schemas/{schema}/materialized-views`: Lists all materialized views in a schema

- `postgres-meta:///schemas/{schema}/materialized-views/{view}`: Gets details for a specific materialized view

- `postgres-meta:///schemas/{schema}/functions`: Lists all functions in a schema

- `postgres-meta:///schemas/{schema}/functions/{func}`: Gets details for a specific function

- `postgres-meta:///extensions`: Lists all extensions in the database

- `postgres-meta:///extensions/{extension}`: Gets details for a specific extension

## Usage

### With Cline

[Cline](https://github.com/cline/cline) is a coding agent for your IDE, capable of creating/editing files, executing commands, using the browser, and more. It supports the Model Context Protocol and can be used to fetch metadata from your Postgres database. This can be useful when developing applications, as the LLM can quickly query your database for schema information.

You can [add MCP servers](https://github.com/cline/cline?tab=readme-ov-file#add-a-tool-that) to Cline via its config file. Add the following configuration to the `mcpServers` object in the config file:

```json
{
  "mcpServers": {
    "postgres-meta": {
      "command": "npx",
      "args": [
        "-y",
        "@supabase/mcp-server-postgres-meta",
        "--connection",
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
      ]
    }
  }
}
```

#### Configuration

- `connection`: The connection string for your Postgres database.

### With Claude Desktop

[Claude Desktop](https://claude.ai/download) is a popular LLM client that supports the Model Context Protocol. Unfortunately it does not yet support dynamic [resource templates](https://modelcontextprotocol.io/docs/concepts/resources#resource-templates), so this server is not yet compatible with Claude Desktop.

### Programmatically (custom MCP client)

If you're building your own MCP client, you can connect to a PostgREST server programmatically using your preferred transport. The [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) offers built-in [stdio](https://modelcontextprotocol.io/docs/concepts/transports#standard-input-output-stdio) and [SSE](https://modelcontextprotocol.io/docs/concepts/transports#server-sent-events-sse) transports. We also offer a [`StreamTransport`](../mcp-utils#streamtransport) if you wish to directly connect to MCP servers in-memory or over your own stream-based transport.

#### Installation

```bash
npm i @supabase/mcp-server-postgres-meta
```

```bash
yarn add @supabase/mcp-server-postgres-meta
```

```bash
pnpm add @supabase/mcp-server-postgres-meta
```

#### Example

The following example uses the [`StreamTransport`](../mcp-utils#streamtransport) to connect directly between an MCP client and server.

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamTransport } from '@supabase/mcp-utils';
import { createPostgresMetaMcpServer } from '@supabase/mcp-server-postgres-meta';
import { createPostgresQuerier } from '@supabase/mcp-server-postgres-meta/queriers/postgres';

// Create a stream transport for both client and server
const clientTransport = new StreamTransport();
const serverTransport = new StreamTransport();

// Connect the streams together
clientTransport.readable.pipeTo(serverTransport.writable);
serverTransport.readable.pipeTo(clientTransport.writable);

const client = new Client(
  {
    name: 'MyClient',
    version: '0.1.0',
  },
  {
    capabilities: {},
  }
);

// Choose how to connect to your Postgres database, see below for more options
const querier = createPostgresQuerier({
  connection: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
});

const server = createPostgresMetaMcpServer({
  querier,
});

// Connect the client and server to their respective transports
await server.connect(serverTransport);
await client.connect(clientTransport);

// Fetch tables in the public schema
const { contents: tableResources } = await client.readResource({
  uri: 'postgres-meta:///schemas/public/tables',
});

// Get policies for each table
for (const tableResource of tableResources) {
  const table = JSON.parse(tableResource.text);

  const { contents: policyResources } = await client.readResource({
    uri: `${tableResource.uri}/policies`,
  });

  const policies = policyResources.map((policyResource) =>
    JSON.parse(policyResource.text)
  );

  console.log(`Policies for ${table.name}:`, policies);
}
```

#### Queriers

This server provides multiple ways to connect to your Postgres database via queriers. The following queriers are available:

- `createPostgresQuerier()`: Directly connects to a Postgres database via a connection string

  ```ts
  import { createPostgresQuerier } from '@supabase/mcp-server-postgres-meta/queriers/postgres';
  ```

  ```ts
  type PostgresQuerierOptions = {
    connection: string;
  };

  function createPostgresQuerier(
    options: PostgresQuerierOptions
  ): PostgresQuerier;
  ```

- `createManagementApiQuerier()`: Connects to a Postgres database via the Supabase Management API

  ```ts
  import { createManagementApiQuerier } from '@supabase/mcp-server-postgres-meta/queriers/management-api';
  ```

  ```ts
  type ManagementApiQuerierOptions = {
    projectRef: string;
    accessToken: string;
    apiUrl?: string;
  };

  function createManagementApiQuerier(
    options: ManagementApiQuerierOptions
  ): ManagementApiQuerier;
  ```

- `createPGliteQuerier()`: Connects to an embedded PGlite database

  ```ts
  import { createPGliteQuerier } from '@supabase/mcp-server-postgres-meta/queriers/pglite';
  ```

  ```ts
  type PGliteQuerierOptions = {
    pglite: PGliteInterface;
  };

  function createPGliteQuerier(options: PGliteQuerierOptions): PGliteQuerier;
  ```

You can also create your own querier by implementing the `Querier` interface.

```ts
export interface Querier {
  query<T>(query: string): Promise<T[]>;
}
```
