# AGENTS.md

This file provides guidance to AI coding agents working on this package.

## Build & Test Commands

```sh
pnpm build            # Production build (runs typecheck first)
pnpm dev              # Watch mode with auto-rebuild
pnpm typecheck        # Type check without emitting

pnpm test             # Run all tests
pnpm test:unit        # Unit tests only
pnpm test:e2e         # E2E tests (requires SUPABASE_ACCESS_TOKEN)
pnpm test:integration # Integration tests

pnpm generate:management-api-types   # Regenerate API types from OpenAPI
pnpm registry:update                 # Update server.json for MCP registry
```

## Environment Variables

| Variable | Required For |
|----------|--------------|
| `SUPABASE_ACCESS_TOKEN` | E2E tests, running the server |
| `ANTHROPIC_API_KEY` | AI test matcher |

## Code Style

- Biome formatting (single quotes, ES5 trailing commas, 2-space indent)
- ESM imports with `.js` extensions
- Zod schemas for all external inputs
- Tests: `*.test.ts` co-located, `*.e2e.ts` in `test/e2e/`

## Do NOT

- Edit `src/management-api/types.ts` - use `pnpm generate:management-api-types`
- Edit `server.json` - use `pnpm registry:update`
- Skip HTTP mocking in unit tests - use MSW
- Run `pnpm build` during development - use `pnpm dev`
- Commit `.env.local` or access tokens

## Agent Skills

For detailed patterns and architecture, see the on-demand skills in `.claude/skills/`:

- **architecture** - Source structure, core layers, data flow
- **testing** - MSW mocking, PGlite, AI test matcher patterns
- **tool-registration** - Creating and registering MCP tools
