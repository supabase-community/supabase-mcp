# AGENTS.md

This file provides guidance for AI agents working on this package.

> See also: [Root AGENTS.md](../../AGENTS.md) for repository-wide guidelines.

## Package Overview

`@supabase/mcp-server-supabase` - Main MCP server for Supabase platform. Provides tools for database operations, edge functions, storage, branching, and more.

## Development Environment

### Setup

From repository root:
```bash
mise install
pnpm install
```

### Development Mode

```bash
cd packages/mcp-server-supabase
pnpm dev        # Watch mode with auto-rebuild
```

### Testing Locally with MCP Client

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

## Commands Reference

### Build

| Command | Description |
|---------|-------------|
| `pnpm build` | Production build |
| `pnpm dev` | Watch mode with auto-rebuild |
| `pnpm typecheck` | Type check without emitting |

### Test

| Command | Description |
|---------|-------------|
| `pnpm test` | Run all tests |
| `pnpm test:unit` | Unit tests only |
| `pnpm test:e2e` | E2E tests (requires `SUPABASE_ACCESS_TOKEN`) |
| `pnpm test:integration` | Integration tests only |
| `pnpm test:coverage` | Tests with coverage report |

### Code Generation

| Command | Description |
|---------|-------------|
| `pnpm generate:management-api-types` | Regenerate Management API types from OpenAPI |

## Code Style Guidelines

See [Root AGENTS.md](../../AGENTS.md#code-style-guidelines).

## Testing Patterns

### File Naming
- Unit tests: `*.test.ts` (co-located in `src/`)
- E2E tests: `*.e2e.ts` (in `test/e2e/`)
- Integration tests: `*.integration.ts`

### Test Infrastructure
- **HTTP mocking**: MSW (Mock Service Worker) in `test/mocks.ts`
- **Database**: PGlite (in-memory PostgreSQL)
- **AI testing**: Custom `toMatchCriteria()` matcher using Claude API

### Environment Variables for Tests

| Variable | Required For | Description |
|----------|--------------|-------------|
| `SUPABASE_ACCESS_TOKEN` | E2E tests | Personal access token |
| `ANTHROPIC_API_KEY` | AI matcher | Used by `toMatchCriteria()` |

### Source Structure

```
src/
├── tools/                  # MCP tool implementations
├── management-api/         # Supabase Management API client
│   └── types.ts            # AUTO-GENERATED - do not edit
├── content-api/            # Documentation API
├── pg-meta/                # Database introspection
├── platform/               # Platform abstractions
├── transports/             # IPC transports (stdio)
└── server.ts               # Main MCP server
```

## Do NOT

- Edit `src/management-api/types.ts` - regenerate with `pnpm generate:management-api-types`
- Edit `server.json` manually - use `pnpm registry:update`
- Commit `.env.local` or access tokens
- Skip mocking HTTP calls in unit tests - use MSW
- Run `pnpm build` during development - use `pnpm dev` instead

## Keeping AGENTS.md Up to Date

Update this file when you change:
- Package scripts in `package.json`
- Test configuration in `vitest.config.ts` or `vitest.workspace.ts`
- Source structure (new directories or major reorganization)
- Environment variable requirements
