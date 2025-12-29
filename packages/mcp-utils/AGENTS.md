# AGENTS.md

This file provides guidance for AI agents working on this package.

> See also: [Root AGENTS.md](../../AGENTS.md) for repository-wide guidelines.

## Package Overview

`@supabase/mcp-utils` - Shared utilities and base classes for MCP servers. This is a dependency of `mcp-server-supabase`.

## Development Environment

### Setup

From repository root:
```bash
mise install
pnpm install
```

### Development Mode

```bash
cd packages/mcp-utils
pnpm dev        # Watch mode with auto-rebuild
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
| `pnpm test:coverage` | Tests with coverage report |

## Code Style Guidelines

See [Root AGENTS.md](../../AGENTS.md#code-style-guidelines).

## Testing Patterns

### File Naming
- Unit tests: `*.test.ts` (co-located in `src/`)

### Source Structure
```
src/
├── index.ts      # Main export
├── server.ts     # Base server implementation
├── types.ts      # Common types
└── util.ts       # Utilities
```

## Do NOT

- Break the public API without updating `mcp-server-supabase`
- Add heavy dependencies - this is a utility package
- Run `pnpm build` during development - use `pnpm dev` instead

## Keeping AGENTS.md Up to Date

Update this file when you change:
- Package scripts in `package.json`
- Source structure or public API
- Dependencies that affect consumers
