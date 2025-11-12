# Supabase extension for Gemini CLI

## Overview

This extension allows you to access your Supabase projects and perform tasks like managing tables, fetching config, and querying data.

**Key capabilities**: Execute SQL, manage migrations, deploy functions, generate TypeScript types, access logs, and search documentation.

## Best Practices

**Security defaults**
- Use read-only mode (`?read_only=true`) to prevent accidental writes
- Scope to specific projects (`?project_ref=<project-ref>`) to limit access
- Limit tool access with feature groups (`?features=docs%2Caccount%2Cdatabase%2Cdebugging%2Cdevelopment`)
  - Available groups: `account`, `docs`, `database`, `debugging`, `development`, `functions`, `storage`, `branching`
- Avoid connecting to production databases even in read-only mode

**Schema management**
- Use `apply_migration` for schema changes (CREATE/ALTER/DROP tables) - these are tracked
- Use `execute_sql` for queries and data operations (SELECT/INSERT/UPDATE/DELETE) - these are not tracked
- Always specify schemas explicitly: `public.users` instead of `users`

## Troubleshooting

**Common errors**
- "permission denied": Remove `read_only=true` for write operations
- "relation does not exist": Use `list_tables` to verify table names and schemas
- "Not authenticated": Restart MCP connection and verify organization access
- Migration conflicts: Check `list_migrations` history before applying new migrations

**Using logs for debugging**
- Use `get_logs` to view service logs when certain action fails
- Available log types: `api`, `branch-action`, `postgres`, `edge-function`, `auth`, `storage`, `realtime`
- Check Postgres logs to see slow queries, errors, or connection issues
- Review API logs to debug PostgREST endpoint failures or RLS policy issues
