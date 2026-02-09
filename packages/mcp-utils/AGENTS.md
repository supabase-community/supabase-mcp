# AGENTS.md

This file provides guidance to AI coding agents working on this package.

## Build & Test Commands

```sh
pnpm build        # Production build (runs typecheck first)
pnpm dev          # Watch mode with auto-rebuild
pnpm typecheck    # Type check without emitting

pnpm test         # Run all tests
pnpm test:coverage
```

## Key Exports

- `createMcpServer()` - Server factory with tool/resource registration
- `tool()` - Type-safe tool definition helper
- `StreamTransport` - Bidirectional stream transport for testing

## Do NOT

- Break the public API without updating `mcp-server-supabase`
- Add heavy dependencies - this is a lightweight utility package
- Run `pnpm build` during development - use `pnpm dev`

## Agent Skills

For detailed patterns, see the on-demand skills in `.claude/skills/`:

- **server-patterns** - MCP server creation, tool() helper, dynamic registration
