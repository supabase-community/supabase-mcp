# Contributing

## Development setup

This repo uses pnpm for package management and the active LTS version of Node.js (see versions pinned in `.nvmrc` and `"packageManager"` in `package.json`).

Clone the repo and run:

```bash
pnpm install
```

To build the MCP server and watch for file changes:

```bash
cd packages/mcp-server-supabase
pnpm dev
```

Configure your MCP client with the `file:` protocol to run the local build. You may need to restart the server in your MCP client after each change.

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": [
        "-y",
        "@supabase/mcp-server-supabase@file:/path/to/mcp-server-supabase/packages/mcp-server-supabase",
        "--project-ref",
        "<your project ref>"
      ],
      "env": {
        "SUPABASE_ACCESS_TOKEN": "<your pat>"
      }
    }
  }
}
```

Optionally, configure `--api-url` to point at a different Supabase instance (defaults to `https://api.supabase.com`)

## Publishing to the MCP registry

We publish the MCP server to the official MCP registry so that it can be discovered and used by MCP clients.
Note the MCP registry does not host the server itself, only metadata about the server. This is defined in the `packages/mcp-server-supabase/server.json` file.

### Dependencies

You will need to install the MCP publisher globally if you haven't already. On macOS, you can do this with Homebrew:

```shell
brew install mcp-publisher
```

See the [MCP publisher documentation](https://github.com/modelcontextprotocol/registry/blob/main/docs/guides/publishing/publish-server.md) for other installation methods.

### Steps

1. Update the package version in `packages/mcp-server-supabase/package.json`. Follow [semver](https://semver.org/) guidelines for versioning.

2. Update `server.json` with the new version by running:

   ```shell
   pnpm registry:update
   ```

3. Download the `domain-verification-key.pem` from Bitwarden and place it in `packages/mcp-server-supabase/`. This will be used to verify ownership of the `supabase.com` domain during the login process.

   > This works because of the [`.well-known/mcp-registry-auth`](https://github.com/supabase/supabase/blob/master/apps/www/public/.well-known/mcp-registry-auth) endpoint served by `supabase.com`.

4. Login to the MCP registry:

   ```shell
   pnpm registry:login
   ```

5. Publish the new version:

   ```shell
   pnpm registry:publish
   ```
