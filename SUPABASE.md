# Supabase extension for Gemini CLI

## Overview

This extension allows you to access your Supabase projects and perform tasks like managing tables, fetching config, and querying data.

**Key capabilities**: Execute SQL, manage migrations, deploy functions, generate TypeScript types, access logs, and search documentation.

Tools executing using this server affect the hosted Supabase project(s), and changes can be synced to the filesystem using Supabase CLI. Assume the hosted database is the source of truth for migration history, and use CLI to sync changes to the local workspace.

## CLI invocation

Supabase CLI may be installed globally (e.g. with homebrew or scoop) or as a project dependency (e.g. in "devDependency" with npm, pnpm, bun, etc.). Prefer using it as a project dependency to keep CLI version pinned in your development environment.

**Package manager setup**

To install or use CLI through a Node.js package manager, you must determine which package manager is desired for the project.

You MUST either:

- Determine the project's existing package manager by checking for popular lockfile formats (e.g. package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb)
- Ask the user which package manager they prefer

For Node.js package managers, `supabase` commands MUST be prefixed with the package manager's command runner.
- npm: `npx supabase ...`
- pnpm: `pnpm supabase ...`
- bun: `bun supabase ...`

**IMPORTANT** Every time a bare `supabase` command is mentioned, consider which prefix is needed and add it accordingly.

## Best Practices

**Project identification**

The user will likely have linked their Supabase CLI to a development project. You can find the linked project ref in `supabase/.temp/project-ref`, use this as the `project_id` in MCP tool calls.

**Schema management**

To update tables:

1. Call MCP `list_tables` to inspect the current schema
2. Call `apply_migration` with desired changes
3. Call MCP `get_advisors` to find and fix "security" and "performance" issues as needed with further migrations
4. Sync new migration(s) to `supabase/migrations/` locally with `[prefix?] supabase migration fetch --yes`
5. Generate updated types and review codebase to align usage

- Use `apply_migration` for schema changes (CREATE/ALTER/DROP tables) - these are tracked
- Use `execute_sql` for queries and data operations (SELECT/INSERT/UPDATE/DELETE) - these are not tracked
- Always specify schemas explicitly: `public.users` instead of `users`

**Type generation**

While iterating on the schema, you should generate updated types with `[prefix?] supabase gen types --linked`. This outputs to stdio, so use `>` to redirect to a file.

## Troubleshooting

**Common errors**
- "permission denied": Remove `read_only=true` for write operations
- "relation does not exist": Use `list_tables` to verify table names and schemas
- "Not authenticated": Restart MCP connection and verify organization access
- Migration conflicts: Check `list_migrations` history before applying new migrations
- Frontend error `Could not find the '<column>' column of '<table>' in the schema cache`: Update types + implementation to ensure code matches current schema
- No project ref: Run `[prefix?] supabase link` to link the workspace to a hosted development project
- Data not appearing in app: Run `[prefix?] supabase db diff --linked`. If schema drift exists run `[prefix?] supabase db pull <migration_name> --yes` to store changes in a new local migration and repair remote migration history. Then proceed to update types and usage.

**Using logs for debugging**
- Use `get_logs` to view service logs when certain action fails
- Available log types: `api`, `branch-action`, `postgres`, `edge-function`, `auth`, `storage`, `realtime`
- Check Postgres logs to see slow queries, errors, or connection issues
- Review API logs to debug PostgREST endpoint failures or RLS policy issues

**Further resources**
- For MCP configuration help: https://supabase.com/mcp
- For Supabase CLI troubleshooting: https://supabase.com/docs/guides/cli/getting-started
