# AGENTS Guidelines for This Repository

This repository is a monorepo containing MCP (Model Context Protocol) servers for Supabase.
When working on this project interactively with an agent, please follow the guidelines below.

## 1. Use Development Mode, **not** Production Builds

* **Always use `pnpm dev`** while iterating on packages. Navigate to the package directory first:
  ```bash
  cd packages/mcp-server-supabase && pnpm dev
  ```
  This starts tsup in watch mode with hot-reload enabled.

* **Do _not_ run `pnpm build` inside the agent session.** Running the production build
  command is slow and unnecessary during development. The `prebuild` hook runs
  `typecheck` automatically, so type errors will fail builds anyway. If a production
  build is required, do it outside of the interactive agent workflow.

## 2. Keep Dependencies in Sync

If you add or update dependencies:

1. Update the lockfile (`pnpm-lock.yaml`) - pnpm handles this automatically.
2. Re-start the development server if it's running so changes are picked up.

## 3. Run Tests Before Committing

* Run `pnpm test` from the repository root to test all packages.
* For package-specific tests: `cd packages/mcp-server-supabase && pnpm test:unit`
* E2E tests require `SUPABASE_ACCESS_TOKEN` environment variable.

## 4. Format Code Before Committing

* Always run `pnpm format` from the repository root before committing.
* Formatting is checked in CI - unformatted code will fail PR checks.

## 5. Useful Commands

| Command | Purpose |
|---------|---------|
| `pnpm install` | Install dependencies (from repo root) |
| `cd packages/mcp-server-supabase && pnpm dev` | **Start dev server with watch mode** |
| `cd packages/mcp-server-supabase && pnpm typecheck` | Type check without emitting files |
| `pnpm test` | Run all tests |
| `pnpm format` | Format all files with Biome |
| `pnpm build` | **Production build – _do not run during agent sessions_** |

## 6. What NOT to Commit

* Do NOT commit `dist/` files (they're gitignored)
* Do NOT commit `.env.local` or other sensitive files
* Do NOT modify `pnpm-lock.yaml` manually - let pnpm manage it

---

**Tech Stack:** Node.js 22.18.0, pnpm 10.15.0, TypeScript, Vitest, Biome, tsup

**Packages:**
- `@supabase/mcp-server-supabase` - Main Supabase MCP server
- `@supabase/mcp-server-postgrest` - PostgREST MCP server
- `@supabase/mcp-utils` - Shared utilities

Following these practices ensures that the agent-assisted development workflow stays fast and
dependable. When in doubt, restart the dev server rather than running the production build.
