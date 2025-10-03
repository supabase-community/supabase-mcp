# Repository Guidelines

## Project Structure & Module Organization
The pnpm workspace centers on `packages/mcp-server-supabase` (production MCP server) and `packages/mcp-utils` (shared schemas, validation, and helpers). An experimental `mcp-server-postgrest` lives alongside them for targeted pilots. Runtime code stays under each package’s `src/`; Vitest fixtures sit in sibling `test/` folders. Top-level `docs/` holds integration guides, `scripts/` provides registry and release automation, and `supabase/` contains migrations plus seed data consumed by integration suites.

## Build, Test, and Development Commands
- `pnpm install` — install workspace dependencies.
- `pnpm build` — run `tsup` builds for utils and the Supabase server.
- `pnpm --filter @supabase/mcp-server-supabase dev` — watch-and-rebuild while coding.
- `pnpm test` — execute all Vitest projects in parallel.
- `pnpm test:coverage` — collect coverage for the Supabase server.
- `pnpm format` / `pnpm format:check` — apply or verify Biome formatting.

## Coding Style & Naming Conventions
Code is TypeScript-first, strict ESM, and two-space indented. Favor named exports; map filesystem names to camelCase exports (see `src/tools`). Generated OpenAPI artifacts belong under `src/management-api/`. Biome is the source of truth for formatting, linting, and import order—run it before committing. `tsup.config.ts` already targets both ESM and CJS outputs; keep new entrypoints consistent with existing build targets.

## Testing Guidelines
Vitest drives unit, integration, and e2e suites configured in `vitest.workspace.ts`. Use package-scoped scripts (`pnpm test:unit`, `test:integration`, `test:e2e`) for faster iteration. Integration flows expect the seeded Supabase instance; refresh with `supabase db reset` when fixtures drift. Place new tests beside the modules they cover, naming files `*.test.ts`, and assert on concrete Supabase responses where possible instead of broad snapshots.

## Commit & Pull Request Guidelines
Follow Conventional Commits (`feat:`, `fix:`, `chore:`) and collapse WIP history before raising a PR. Reference Supabase issues or MCP registry tickets when applicable. PR descriptions should outline behaviour changes, highlight tooling updates, and mention any Supabase config required for reviewers. Confirm `pnpm build`, `pnpm test`, and `pnpm format:check` pass locally, and attach CLI output for non-obvious failures or regressions.

## Security & Configuration Tips
Store `SUPABASE_ACCESS_TOKEN` outside the repo (environment managers or MCP client secrets). Prefer `--read-only` and `--project-ref` flags when sharing demos, and scrub captured payloads before committing fixtures or docs.
