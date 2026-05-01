# Contributing

## Development setup

This repo uses pnpm for package management and the active LTS version of Node.js. Node.js and pnpm versions are managed via [mise](https://mise.jdx.dev/) (see `mise.toml`).

> **Why mise?** We use mise to ensure all contributors use consistent versions of tools, reducing instances where code behaves differently on different machines.

Clone the repo and run:

```bash
mise install
pnpm install
```

To build the MCP server and watch for file changes:

```bash
cd packages/mcp-server-supabase
pnpm dev
```

Configure your MCP client to run the local build. You may need to restart the server in your MCP client after each change.

```json
{
  "mcpServers": {
    "supabase": {
      "command": "node",
      "args": [
        "/path/to/supabase-mcp/packages/mcp-server-supabase/dist/transports/stdio.js",
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

## Releases

Releases are automated via [release-please](https://github.com/googleapis/release-please). It tracks commits on `main` and opens a release PR when there are releasable changes. Merging that PR:

1. Creates a GitHub release and git tag
2. Publishes updated packages to npm
3. Publishes the MCP server to the [MCP registry](https://registry.modelcontextprotocol.io)

Most contributors don't need to do anything beyond merging the release PR.

If the release PR gets into a bad state, close it and manually re-run the workflow from the [Actions tab](https://github.com/supabase-community/supabase-mcp/actions/workflows/release.yml) → **Run workflow**. release-please will recreate the PR from scratch.

## Manual MCP registry publish (optional)

This is only needed if the automated publish failed or needs to be re-run manually. The MCP registry stores metadata about the server (defined in `packages/mcp-server-supabase/server.json`) — it does not host the server itself.

### Dependencies

You will need `mcp-publisher` installed ([quickstart](https://modelcontextprotocol.io/registry/quickstart)):

```bash
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher && sudo mv mcp-publisher /usr/local/bin/
```

For version consistency with CI, use the version pinned in `MCP_PUBLISHER_VERSION` in `.github/workflows/release.yml`.

### Steps

1. Update `server.json` with the new version by running:

   ```shell
   pnpm registry:update
   ```

2. Download the `domain-verification-key.pem` from Bitwarden and place it in `packages/mcp-server-supabase/`. This will be used to verify ownership of the `supabase.com` domain during the login process.

   > This works because of the [`.well-known/mcp-registry-auth`](https://github.com/supabase/supabase/blob/master/apps/www/public/.well-known/mcp-registry-auth) endpoint served by `supabase.com`.

3. Login to the MCP registry:

   ```shell
   pnpm registry:login
   ```

4. Publish:

   ```shell
   pnpm registry:publish
   ```
