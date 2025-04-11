# Supabase MCP Server

> Connect your Supabase projects to Cursor, Claude, Windsurf, and other AI assistants.

![supabase-mcp-demo](https://github.com/user-attachments/assets/3fce101a-b7d4-482f-9182-0be70ed1ad56)

The [Model Context Protocol](https://modelcontextprotocol.io/introduction) (MCP) standardizes how Large Language Models (LLMs) talk to external services like Supabase. It connects AI assistants directly with your Supabase project and allows them to perform tasks like managing tables, fetching config, and querying data. See the [full list of tools](#tools).

## Prerequisites

You will need Node.js installed on your machine. You can check this by running:

```shell
node -v
```

If you don't have Node.js installed, you can download it from [nodejs.org](https://nodejs.org/).

## Setup

### 1. Personal access token (PAT)

First, go to your [Supabase settings](https://supabase.com/dashboard/account/tokens) and create a personal access token. Give it a name that describes its purpose, like "Cursor MCP Server".

This will be used to authenticate the MCP server with your Supabase account. Make sure to copy the token, as you won't be able to see it again.

### 2. Configure MCP client

Next, configure your MCP client (such as Cursor) to use this server. Most MCP clients store the configuration as JSON in the following format:

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": [
        "-y",
        "@supabase/mcp-server-supabase@latest",
        "--access-token",
        "<personal-access-token>"
      ]
    }
  }
}
```

Replace `<personal-access-token>` with the token you created in step 1. Alternatively you can omit `--access-token` and instead set the `SUPABASE_ACCESS_TOKEN` environment variable to your personal access token (you will need to restart your MCP client after setting this). This allows you to keep your token out of version control if you plan on committing this configuration to a repository.

If you are on Windows, you will need to [prefix the command](#windows). If your MCP client doesn't accept JSON, the direct CLI command is:

```shell
npx -y @supabase/mcp-server-supabase@latest --access-token=<personal-access-token>
```

> Note: Do not run this command directly - this is meant to be executed by your MCP client in order to start the server. `npx` automatically downloads the latest version of the MCP server from `npm` and runs it in a single command.

#### Windows

On Windows, you will need to prefix the command with `cmd /c`:

```json
{
  "mcpServers": {
    "supabase": {
      "command": "cmd",
      "args": [
        "/c",
        "npx",
        "-y",
        "@supabase/mcp-server-supabase@latest",
        "--access-token",
        "<personal-access-token>"
      ]
    }
  }
}
```

or with `wsl` if you are running Node.js inside WSL:

```json
{
  "mcpServers": {
    "supabase": {
      "command": "wsl",
      "args": [
        "npx",
        "-y",
        "@supabase/mcp-server-supabase@latest",
        "--access-token",
        "<personal-access-token>"
      ]
    }
  }
}
```

Make sure Node.js is available in your system `PATH` environment variable. If you are running Node.js natively on Windows, you can set this by running the following commands in your terminal.

1. Get the path to `npm`:

   ```shell
   npm config get prefix
   ```

2. Add the directory to your PATH:

   ```shell
   setx PATH "%PATH%;<path-to-dir>"
   ```

3. Restart your MCP client.

## Tools

_**Note:** This server is pre-1.0, so expect some breaking changes between versions. Since LLMs will automatically adapt to the tools available, this shouldn't affect most users._

The following Supabase tools are available to the LLM:

#### Project Management

- `list_projects`: Lists all Supabase projects for the user.
- `get_project`: Gets details for a project.
- `create_project`: Creates a new Supabase project.
- `pause_project`: Pauses a project.
- `restore_project`: Restores a project.
- `list_organizations`: Lists all organizations that the user is a member of.
- `get_organization`: Gets details for an organization.

#### Database Operations

- `list_tables`: Lists all tables within the specified schemas.
- `list_extensions`: Lists all extensions in the database.
- `list_migrations`: Lists all migrations in the database.
- `apply_migration`: Applies a SQL migration to the database. SQL passed to this tool will be tracked within the database, so LLMs should use this for DDL operations (schema changes).
- `execute_sql`: Executes raw SQL in the database. LLMs should use this for regular queries that don't change the schema.
- `get_logs`: Gets logs for a Supabase project by service type (api, postgres, edge functions, auth, storage, realtime). LLMs can use this to help with debugging and monitoring service performance.

#### Project Configuration

- `get_project_url`: Gets the API URL for a project.
- `get_anon_key`: Gets the anonymous API key for a project.

#### Branching (Experimental, requires a paid plan)

- `create_branch`: Creates a development branch with migrations from production branch.
- `list_branches`: Lists all development branches.
- `delete_branch`: Deletes a development branch.
- `merge_branch`: Merges migrations and edge functions from a development branch to production.
- `reset_branch`: Resets migrations of a development branch to a prior version.
- `rebase_branch`: Rebases development branch on production to handle migration drift.

#### Development Tools

- `generate_typescript_types`: Generates TypeScript types based on the database schema. LLMs can save this to a file and use it in their code.

#### Cost Confirmation

- `get_cost`: Gets the cost of a new project or branch for an organization.
- `confirm_cost`: Confirms the user's understanding of new project or branch costs. This is required to create a new project or branch.

## MCP as a library

You can embed the Supabase MCP server as a TypeScript library in your own AI applications. This allows you to hook into Supabase MCP tools directly without running a separate CLI command or HTTP server.

We'll use Vercel's [AI SDK](https://sdk.vercel.ai/docs/introduction) to orchestrate LLM generations and connect it with the Supabase MCP server. This is a great way to build your own custom AI applications that leverage Supabase.

### 1. Install the libraries

```shell
npm i ai @ai-sdk/anthropic
npm i @supabase/mcp-server-supabase @supabase/mcp-utils
```

### 2. Create a Supabase MCP client

A unique MCP client/server pair needs to be created for every request. To embed the Supabase MCP server directly in your application, we'll instantiate both the client and the server together, and connect them via an in-memory transport.

_./supabase-mcp.ts_

```typescript
import { StreamTransport } from '@supabase/mcp-utils';
import { experimental_createMCPClient as createMCPClient } from 'ai';
import { createSupabaseMcpServer } from '@supabase/mcp-server-supabase';

export async function createSupabaseMCPClient(accessToken: string) {
  // Create an in-memory transport pair
  const clientTransport = new StreamTransport();
  const serverTransport = new StreamTransport();
  clientTransport.readable.pipeTo(serverTransport.writable);
  serverTransport.readable.pipeTo(clientTransport.writable);

  // Instantiate the MCP server and connect to its transport
  const server = createSupabaseMcpServer({
    platform: {
      accessToken,
    },
  });
  await server.connect(serverTransport);

  // Create the MCP client and connect to its transport
  const client = await createMCPClient({
    name: 'My app',
    transport: clientTransport,
  });

  return client;
}
```

### 3. Create an OAuth app

In order to authenticate your users with their Supabase accounts, you need to create an [OAuth app](https://supabase.com/docs/guides/integrations/build-a-supabase-integration). This will allow your users to log in with their Supabase accounts and authorize your app to access their projects. To create an OAuth app, follow the instructions in [Build a Supabase Integration](https://supabase.com/docs/guides/integrations/build-a-supabase-integration).

Every OAuth implementation is different, so you will need to adapt these instructions to your specific use case. For the rest of this example, we'll assume you have a `getAccessToken()` function that returns the Supabase access token for the user.

_./supabase-oauth.ts_

```typescript
export async function getAccessToken(userId: string) {
  // Implement logic to retrieve your user's
  // Supabase access token via the OAuth integration
  return 'user_access_token';
}
```

### 4. Use the MCP client with your LLM

We'll use the Supabase MCP client to generate Supabase tools in a format that the AI SDK expects. The following example uses Supabase Edge Functions, but you can replace this with any JavaScript HTTP server.

```typescript
import { anthropic } from '@ai-sdk/anthropic';
import { streamText } from 'ai';
import { createSupabaseMCPClient } from './supabase-mcp.ts';
import { getAccessToken } from './supabase-oauth.ts';

const model = anthropic('claude-3-7-sonnet-20250219');

function getUserId(req: Request) {
  // Implement logic to retrieve the user from the request (eg. JWT token)
  return 'user_id';
}

Deno.serve(async (req) => {
  const userId = getUserId(req);
  const accessToken = await getAccessToken(userId);
  const supabaseMCPClient = await createSupabaseMCPClient(accessToken);
  const supabaseTools = await supabaseMCPClient.tools();

  const { text } = await streamText({
    model,
    tools: {
      ...supabaseTools,
      // Add any other tools you want to use
    },
    messages: [
      {
        role: 'system',
        content: 'You are a helpful coding assistant.',
      },
      {
        role: 'user',
        content: 'What Supabase projects do I have?',
      },
    ],
    // Increasing `maxSteps` allows `streamText` to perform
    // sequential LLM calls when tools are used
    maxSteps: 10,
  });

  return result.toDataStreamResponse();
});
```

## Other MCP servers

### `@supabase/mcp-server-postgrest`

The PostgREST MCP server allows you to connect your own users to your app via REST API. See more details on its [project README](./packages/mcp-server-postgrest).

## Resources

- [**Model Context Protocol**](https://modelcontextprotocol.io/introduction): Learn more about MCP and its capabilities.

## License

This project is licensed under Apache 2.0. See the [LICENSE](./LICENSE) file for details.
