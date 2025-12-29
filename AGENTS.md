# AGENTS.md

This file provides guidance for AI agents working on this codebase.

## Project Overview

Supabase MCP (Model Context Protocol) servers - a pnpm monorepo with:
- `packages/mcp-utils` - Shared utilities
- `packages/mcp-server-supabase` - Main MCP server
- `packages/mcp-server-postgrest` - PostgREST MCP server

## Package-Specific Guides

For detailed package-specific guidance, see:
- [packages/mcp-utils/AGENTS.md](packages/mcp-utils/AGENTS.md)
- [packages/mcp-server-supabase/AGENTS.md](packages/mcp-server-supabase/AGENTS.md)

## Development Environment

### Prerequisites

Install [mise](https://mise.jdx.dev/) for tool version management.

### Setup

```bash
mise install    # Install Node.js and pnpm (versions from mise.toml)
pnpm install    # Install dependencies
```

### Development Mode

```bash
cd packages/mcp-server-supabase
pnpm dev        # Watch mode with auto-rebuild
```

**Important:** Always use `pnpm dev` while iterating. Do NOT run `pnpm build` during development - it's slow and unnecessary. The `prebuild` hook runs `typecheck` automatically.

## Commands Reference

### Build

| Command | Description |
|---------|-------------|
| `pnpm build` | Build mcp-utils and mcp-server-supabase (production only) |
| `pnpm dev` | Watch mode (run from package directory) |
| `pnpm typecheck` | Type check without emitting (run from package directory) |

### Test

| Command | Description |
|---------|-------------|
| `pnpm test` | Run all tests in parallel |
| `pnpm test:unit` | Unit tests only (mcp-server-supabase) |
| `pnpm test:e2e` | E2E tests only (requires `SUPABASE_ACCESS_TOKEN`) |
| `pnpm test:integration` | Integration tests only |
| `pnpm test:coverage` | Tests with coverage report |

### Code Style

| Command | Description |
|---------|-------------|
| `pnpm format` | Auto-fix formatting issues |
| `pnpm format:check` | Check formatting (used in CI) |

## Code Style Guidelines

- **Formatter**: Biome (linting disabled, formatting only)
- **Quotes**: Single quotes
- **Trailing commas**: ES5 style
- **Indentation**: Spaces
- **Semicolons**: Required

## Testing Patterns

### File Naming
- Unit tests: `*.test.ts` (co-located in `src/`)
- E2E tests: `*.e2e.ts` (in `test/e2e/`)
- Integration tests: `*.integration.ts`

### Test Infrastructure
- **HTTP mocking**: MSW (Mock Service Worker)
- **Database**: PGlite (in-memory PostgreSQL)
- **Test timeout**: 30s default, 60s for E2E

## PR Checklist

Before submitting a PR, run:

```bash
pnpm format       # Fix formatting
pnpm build        # Ensure it compiles
pnpm test         # Run all tests
```

### CI Checks (must pass)
1. **Biome** - Code formatting
2. **Tests** - All test suites with coverage

## Do NOT

- Edit `packages/mcp-server-supabase/src/management-api/types.ts` - auto-generated from OpenAPI
- Modify `mise.lock` or `pnpm-lock.yaml` manually - managed by tools
- Use `npm` or `yarn` - this repo uses pnpm only
- Skip type checking - `prebuild` runs `tsc --noEmit`
- Ignore Biome formatting - CI will fail
- Commit `dist/` files - they're gitignored
- Commit `.env.local` or other sensitive files
- Run `pnpm build` during interactive agent sessions - use `pnpm dev` instead

## Keeping AGENTS.md Up to Date

Update this file when you change:
- Dependencies in `package.json` or `pnpm-lock.yaml`
- Scripts in `package.json` files
- Tool versions in `mise.toml`
- Test configuration in `vitest.config.ts`
- CI workflows in `.github/workflows/`
- Code style rules in `biome.json`
