# AGENTS Guidelines for This Package

This package (`@supabase/mcp-server-supabase`) is the main Supabase MCP server implementation.
When working on this package interactively with an agent, please follow the guidelines below.

## 1. Use Development Mode, **not** Production Builds

* **Always use `pnpm dev`** while iterating on the package. This starts tsup in watch mode
  with hot-reload enabled, automatically rebuilding on file changes.

* **Do _not_ run `pnpm build` inside the agent session.** Running the production build
  command is slow and unnecessary during development. The `prebuild` hook runs
  `typecheck` automatically, so type errors will fail builds anyway. If a production
  build is required, do it outside of the interactive agent workflow.

## 2. Testing the Package Locally

To test the local build with an MCP client (e.g., Cursor):

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": [
        "-y",
        "@supabase/mcp-server-supabase@file:/absolute/path/to/packages/mcp-server-supabase",
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

* Use absolute path for `file:` protocol
* Restart MCP client after rebuilding
* Optional: Use `--api-url` to point at different Supabase instance

## 3. Running Tests

* **Unit tests:** `pnpm test:unit` - Fast tests, 30s timeout
* **E2E tests:** `pnpm test:e2e` - Requires `SUPABASE_ACCESS_TOKEN`, 60s timeout, uses MSW mocks
* **Integration tests:** `pnpm test:integration` - 30s timeout
* **All tests:** `pnpm test` - Runs all test projects
* **Coverage:** `pnpm test:coverage` - Generates coverage report in `test/coverage/`

## 4. Code Generation

* **Management API types:** Run `pnpm generate:management-api-types` to regenerate types
  from Supabase OpenAPI spec. Do NOT edit `src/management-api/types.ts` manually.

## 5. Publishing to MCP Registry

When publishing a new version:

1. Update version in `package.json` (follow semver)
2. Run `pnpm registry:update` to sync version to `server.json`
3. Ensure `domain-verification-key.pem` is in package directory
4. Run `pnpm registry:login` to authenticate
5. Run `pnpm registry:publish` to publish metadata

**⚠️ Important:** Do NOT edit `server.json` manually - use `registry:update` script.

## 6. Useful Commands

| Command | Purpose |
|---------|---------|
| `pnpm dev` | **Start dev server with watch mode** |
| `pnpm typecheck` | Type check without emitting files |
| `pnpm test` | Run all test projects |
| `pnpm test:unit` | Run unit tests only |
| `pnpm test:e2e` | Run e2e tests only |
| `pnpm test:integration` | Run integration tests only |
| `pnpm format` | Format files (run from repo root) |
| `pnpm build` | **Production build – _do not run during agent sessions_** |

## 7. Package Structure

* `src/tools/` - MCP tool implementations
* `src/transports/` - Transport layer (stdio)
* `src/platform/` - Platform-specific implementations
* `src/pg-meta/` - PostgreSQL metadata queries (SQL files)
* `src/management-api/` - Supabase Management API client (types auto-generated)
* `src/content-api/` - Content API (GraphQL) client
* `test/e2e/` - End-to-end tests
* `test/` - Integration tests and utilities

## 8. What NOT to Commit

* Do NOT commit `dist/` files (they're gitignored)
* Do NOT commit `.env.local` or coverage files
* Do NOT manually edit `src/management-api/types.ts` (it's auto-generated)
* Do NOT manually edit `server.json` (use `registry:update` script)

---

**Tech Stack:** TypeScript, Vitest (unit/e2e/integration), tsup, MCP SDK, GraphQL/PostgREST/OpenAPI Fetch

**Build Outputs:** Multiple entry points (index, stdio transport, platform exports) to `dist/` with CJS, ESM, types, and sourcemaps.

Following these practices ensures that the agent-assisted development workflow stays fast and
dependable. When in doubt, restart the dev server rather than running the production build.
