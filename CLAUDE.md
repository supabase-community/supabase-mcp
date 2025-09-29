# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a monorepo containing MCP (Model Context Protocol) servers for Supabase integration. The project allows AI assistants like Claude to directly interact with Supabase projects through standardized tools.

### Repository Structure

- `packages/mcp-server-supabase/` - Main MCP server providing Supabase management tools
- `packages/mcp-server-postgrest/` - PostgREST-specific MCP server for REST API interactions
- `packages/mcp-utils/` - Shared utilities for building MCP servers

## Development Commands

### Installation
```bash
pnpm install
```

### Building
```bash
# Build all packages
pnpm build

# Build specific package
pnpm --filter @supabase/mcp-server-supabase build
```

### Development
```bash
# Watch mode for main server
cd packages/mcp-server-supabase
pnpm dev
```

### Testing
```bash
# Run all tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Run specific test types for main package
pnpm --filter @supabase/mcp-server-supabase test:unit
pnpm --filter @supabase/mcp-server-supabase test:e2e
pnpm --filter @supabase/mcp-server-supabase test:integration
```

### Linting & Formatting
```bash
# Format code (using Biome)
pnpm format

# Check formatting
pnpm format:check
```

### Type Checking
```bash
# Type check main server
cd packages/mcp-server-supabase
pnpm typecheck
```

## Architecture

### MCP Server Architecture

The main server (`packages/mcp-server-supabase/`) follows a modular tool-based architecture:

- **Platform Interface** (`src/platform/`): Defines operations interface that different platform implementations can fulfill
- **Authentication System** (`src/auth.ts`, `src/config/`): Enhanced dual-mode authentication with automatic project detection
- **Tool Groups** (`src/tools/`): Organized by feature area:
  - `account-tools.ts` - Project and organization management
  - `database-operation-tools.ts` - SQL execution and migrations
  - `development-tools.ts` - API keys, URLs, TypeScript type generation
  - `debugging-tools.ts` - Logs and performance advisors
  - `edge-function-tools.ts` - Edge Function deployment and management
  - `storage-tools.ts` - Storage bucket and config management
  - `branching-tools.ts` - Development branch operations
  - `docs-tools.ts` - Documentation search

### Authentication Features (NEW)

The server now includes comprehensive authentication enhancements:

- **Automatic Project Detection** (`src/config/project-context.ts`):
  - Scans current working directory for Supabase configuration
  - Supports `.env`, `.env.local`, `.supabase/config.toml`, `.supabase/.env`
  - Framework-specific variable naming (Next.js, React, Vite)
  - Priority-based configuration resolution

- **Enhanced Token Detection** (`src/config/supabase-config.ts`):
  - Automatic detection from `~/.supabase/access-token` (CLI integration)
  - Support for multiple token file formats and locations
  - Seamless integration with `supabase login` workflow

- **Dual Authentication Modes** (`src/auth.ts`):
  - `personal-token`: Uses management API with personal access tokens
  - `project-keys`: Uses project-specific anon/service keys when available
  - Automatic switching based on available credentials

- **Smart Fallback Chain**:
  1. CLI flags (--project-ref)
  2. Environment variables (SUPABASE_ACCESS_TOKEN)
  3. Project context from working directory
  4. Config files (~/.supabase/access-token)
  5. None (graceful degradation)

### Feature System

The server uses a feature group system allowing selective tool enablement:
- `--features=database,docs` enables only database and docs tools
- Default groups: `account`, `database`, `debugging`, `development`, `docs`, `functions`, `branching`
- Storage tools are disabled by default to reduce tool count

### Platform Independence

Core functionality is separated into platform-specific implementations through the `SupabasePlatform` interface, allowing different backends (API-based, local, etc.) while maintaining the same tool interface.

## Key Dependencies

- **pnpm** (v10.15.0) - Package manager
- **Node.js** 22.18.0 (see `.nvmrc`)
- **Vitest** - Testing framework with unit/e2e/integration test separation
- **Biome** - Formatting and linting
- **tsup** - TypeScript bundling
- **Zod** - Runtime type validation and schema definition

## Testing Strategy

- **Unit tests**: `src/**/*.test.ts` - Component testing with 30s timeout for PGlite initialization
- **E2E tests**: `test/e2e/**/*.e2e.ts` - End-to-end flows with 60s timeout
- **Integration tests**: `test/**/*.integration.ts` - Integration testing
- Uses Vitest workspace for parallel execution of different test types
- Custom text loader plugin for SQL files
- MSW for API mocking

## Registry Publishing

The main server is published to the official MCP registry:

1. Update version in `packages/mcp-server-supabase/package.json`
2. Run `pnpm registry:update` to update `server.json`
3. Login with `pnpm registry:login`
4. Publish with `pnpm registry:publish`

## Development Configuration

- Local development uses `file:` protocol for MCP client testing
- Server exposes both ES modules and CommonJS builds
- Multiple entry points for platform-specific usage
- Uses TypeScript with `@total-typescript/tsconfig` for strict configuration