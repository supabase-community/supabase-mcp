# AGENTS.md

This file provides guidance to AI coding agents working on this repository.

## Project Overview

Supabase MCP (Model Context Protocol) servers - a pnpm monorepo.

## Packages

| Package | Description |
|---------|-------------|
| `@supabase/mcp-utils` | Shared utilities and base classes for MCP servers |
| `@supabase/mcp-server-supabase` | Main MCP server for Supabase platform |
| `@supabase/mcp-server-postgrest` | PostgREST MCP server |

## Build & Test Commands

```sh
pnpm install    # Install all workspace dependencies
pnpm build      # Build mcp-utils and mcp-server-supabase
pnpm test       # Run all tests in parallel
pnpm test:coverage
pnpm format     # Fix formatting with Biome
pnpm format:check
```

## Package Manager

This repo uses **pnpm** exclusively. Do not use npm or yarn.

## Dev Dependencies

- `@biomejs/biome` - Code formatting
- `supabase` - Supabase CLI

## Package-Specific Guides

- [packages/mcp-utils/AGENTS.md](packages/mcp-utils/AGENTS.md)
- [packages/mcp-server-supabase/AGENTS.md](packages/mcp-server-supabase/AGENTS.md)

## Do NOT

- Use `npm` or `yarn` - this repo uses pnpm only
- Modify `mise.lock` or `pnpm-lock.yaml` manually
- Run `pnpm build` during dev sessions - use `pnpm dev` in package directories
